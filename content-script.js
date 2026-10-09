(() => {
  const STORAGE_KEY = "xReplyQuestState";
  const HUD_ID = "x-reply-quest-hud";
  const STYLE_ID = "x-reply-quest-style";
  const HANDLE_RE = /^\/([A-Za-z0-9_]{1,15})(?:\/(?:photo|header_photo))?\/?(?:\?.*)?$/;
  const RECENT_WINDOW_MS = 15000;

  let cachedState = null;
  let lastHudRender = 0;
  let scanTimer = null;
  let isPageScrolling = false;
  let scrollStopTimer = null;

  function utcDayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  function defaultState() {
    return {
      version: 1,
      totalXp: 0,
      days: {},
      achievements: {},
      settings: {
        hudMinimized: false
      },
      lastRecorded: null
    };
  }

  function ensureDay(state, dayKey = utcDayKey()) {
    state.days ||= {};
    state.days[dayKey] ||= { replies: [], people: {} };
    state.days[dayKey].replies ||= [];
    state.days[dayKey].people ||= {};
    return state.days[dayKey];
  }

  function safeSendMessage(message) {
    try {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    } catch (_) {
      // The page can outlive the extension context during reloads.
    }
  }

  async function readState() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    cachedState = { ...defaultState(), ...(result[STORAGE_KEY] || {}) };
    cachedState.days ||= {};
    cachedState.achievements ||= {};
    cachedState.settings = { ...defaultState().settings, ...(cachedState.settings || {}) };
    return cachedState;
  }

  async function writeState(state) {
    cachedState = state;
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
    safeSendMessage({ type: "xrq:update-badge" });
  }

  function normalizeHandle(value) {
    return (value || "").replace(/^@/, "").trim().toLowerCase();
  }

  function displayHandle(value) {
    const handle = normalizeHandle(value);
    return handle ? `@${handle}` : "未知用户";
  }

  function cleanDisplayName(value, handle = "") {
    const normalizedHandle = normalizeHandle(handle);
    const lines = String(value || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^@?[A-Za-z0-9_]{1,15}$/.test(line.replace(/\s/g, "")))
      .filter((line) => normalizeHandle(line) !== normalizedHandle)
      .filter((line) => !/^(Follow|Following|关注|正在关注|Replying to|回复)$/i.test(line));
    return (lines[0] || "").replace(/\s+/g, " ").slice(0, 80);
  }

  function nameForHandleNear(root, handle) {
    const normalizedHandle = normalizeHandle(handle);
    if (!normalizedHandle) return "";

    const userNameBlocks = [...(root?.querySelectorAll?.('[data-testid="User-Name"]') || [])];
    for (const block of userNameBlocks) {
      const hasHandle = [...block.querySelectorAll('a[href^="/"]')].some((anchor) => extractHandleFromAnchor(anchor) === normalizedHandle);
      if (hasHandle) {
        const name = cleanDisplayName(block.innerText || block.textContent || "", normalizedHandle);
        if (name) return name;
      }
    }

    const matchingAnchor = [...(root?.querySelectorAll?.('a[href^="/"]') || [])].find((anchor) => {
      return extractHandleFromAnchor(anchor) === normalizedHandle;
    });
    return cleanDisplayName(matchingAnchor?.getAttribute("aria-label") || matchingAnchor?.textContent || "", normalizedHandle);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatHudTime(iso) {
    if (!iso) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(iso));
  }

  function levelForXp(totalXp = 0) {
    let level = 1;
    let xp = Math.max(0, totalXp);
    let next = 100;
    while (xp >= next) {
      xp -= next;
      level += 1;
      next = 100 + (level - 1) * 35;
    }
    return { level, current: xp, next, percent: Math.min(100, Math.round((xp / next) * 100)) };
  }

  function computeStreak(state) {
    const dayKeys = new Set(
      Object.entries(state.days || {})
        .filter(([, day]) => (day.replies || []).length > 0)
        .map(([key]) => key)
    );
    let streak = 0;
    const cursor = new Date(`${utcDayKey()}T00:00:00.000Z`);
    while (dayKeys.has(cursor.toISOString().slice(0, 10))) {
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return streak;
  }

  const achievements = [
    {
      id: "first_reply",
      title: "第一声招呼",
      xp: 25,
      test: (state, day) => day.replies.length >= 1
    },
    {
      id: "five_replies_day",
      title: "今日热身完成",
      xp: 35,
      test: (state, day) => day.replies.length >= 5
    },
    {
      id: "ten_people_day",
      title: "社交雷达开启",
      xp: 60,
      test: (state, day) => Object.keys(day.people).length >= 10
    },
    {
      id: "three_day_streak",
      title: "三日连击",
      xp: 75,
      test: (state) => computeStreak(state) >= 3
    }
  ];

  function applyAchievements(state, day) {
    const unlocked = [];
    state.achievements ||= {};
    for (const achievement of achievements) {
      if (!state.achievements[achievement.id] && achievement.test(state, day)) {
        state.achievements[achievement.id] = {
          title: achievement.title,
          xp: achievement.xp,
          unlockedAt: new Date().toISOString()
        };
        state.totalXp += achievement.xp;
        unlocked.push(achievement);
      }
    }
    return unlocked;
  }

  function replyXp(beforeCount, dayReplyCount, uniquePeopleCount) {
    let xp = beforeCount === 0 ? 15 : 6;
    if ([5, 10, 25, 50].includes(dayReplyCount)) xp += 20;
    if ([5, 10, 20].includes(uniquePeopleCount)) xp += 25;
    return xp;
  }

  function extractHandleFromAnchor(anchor) {
    try {
      const url = new URL(anchor.href);
      const match = url.pathname.match(HANDLE_RE);
      if (!match) return "";
      const handle = normalizeHandle(match[1]);
      const blocked = new Set(["home", "explore", "notifications", "messages", "search", "settings", "i"]);
      return blocked.has(handle) ? "" : handle;
    } catch (_) {
      return "";
    }
  }

  function detectOwnHandles() {
    const selectors = [
      '[data-testid="SideNav_AccountSwitcher_Button"] a[href^="/"]',
      '[data-testid="AppTabBar_Profile_Link"]',
      'a[aria-label*="Profile"][href^="/"]',
      'a[aria-label*="个人资料"][href^="/"]',
      'nav a[href^="/"]'
    ];
    const handles = new Set();
    for (const selector of selectors) {
      for (const anchor of document.querySelectorAll(selector)) {
        const handle = extractHandleFromAnchor(anchor);
        if (handle) handles.add(handle);
      }
    }
    return handles;
  }

  function inferTargetFromText(text) {
    const patterns = [
      /Replying to\s+@([A-Za-z0-9_]{1,15})/i,
      /回复\s*@([A-Za-z0-9_]{1,15})/i,
      /正在回复\s*@([A-Za-z0-9_]{1,15})/i,
      /@([A-Za-z0-9_]{1,15})/
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return normalizeHandle(match[1]);
    }
    return "";
  }

  function findComposerRoot(target) {
    return (
      target?.closest?.('[role="dialog"]') ||
      target?.closest?.('[data-testid="tweetTextarea_0"]')?.parentElement ||
      target?.closest?.("section") ||
      target?.closest?.("article") ||
      document
    );
  }

  function findComposerText(root) {
    const textbox = root?.querySelector?.('[role="textbox"]');
    return (textbox?.innerText || textbox?.textContent || "").trim().replace(/\s+/g, " ");
  }

  function inferTargetFromUrl() {
    const match = location.pathname.match(/^\/([^/]+)\/status\/\d+/);
    return match ? normalizeHandle(match[1]) : "";
  }

  function inferTargetFromRoot(root) {
    const textTarget = inferTargetFromText(root?.innerText || "");
    if (textTarget) return textTarget;

    const anchors = [...(root?.querySelectorAll?.('a[href^="/"]') || [])];
    for (const anchor of anchors) {
      const handle = extractHandleFromAnchor(anchor);
      if (handle) return handle;
    }

    return inferTargetFromUrl();
  }

  function detectReplyFromEvent(event) {
    const root = findComposerRoot(event.target);
    const targetHandle = inferTargetFromRoot(root);
    if (!targetHandle) return null;

    const targetAnchor = [...(root?.querySelectorAll?.('a[href^="/"]') || [])].find((anchor) => {
      return extractHandleFromAnchor(anchor) === targetHandle;
    });

    return {
      targetHandle,
      targetName: nameForHandleNear(root, targetHandle) || cleanDisplayName(targetAnchor?.textContent || "", targetHandle),
      textPreview: findComposerText(root).slice(0, 180),
      url: location.href
    };
  }

  function isSubmitButton(button) {
    if (!button || button.disabled) return false;
    const testId = button.getAttribute("data-testid") || "";
    const label = `${button.innerText || ""} ${button.getAttribute("aria-label") || ""}`;
    return (
      /tweetButton|tweetButtonInline/i.test(testId) ||
      /\b(Reply|Post|Send)\b/i.test(label) ||
      /(回复|发布|发送)/.test(label)
    );
  }

  function isDuplicate(day, targetHandle, textPreview) {
    const now = Date.now();
    return day.replies.some((reply) => {
      return (
        reply.targetHandle === targetHandle &&
        reply.textPreview === textPreview &&
        now - reply.ts < RECENT_WINDOW_MS
      );
    });
  }

  async function recordReply(payload, source = "auto") {
    const targetHandle = normalizeHandle(payload?.targetHandle);
    if (!targetHandle) {
      showToast("没有识别到回复对象，可以打开某条推文后再试。");
      return false;
    }

    const state = await readState();
    const dayKey = utcDayKey();
    const day = ensureDay(state, dayKey);
    const textPreview = (payload.textPreview || "").trim().slice(0, 180);

    if (isDuplicate(day, targetHandle, textPreview)) {
      if (source === "manual") showToast(`${displayHandle(targetHandle)} 刚刚已经记录过了。`);
      return false;
    }

    const beforeCount = day.people[targetHandle]?.count || 0;
    const nowIso = new Date().toISOString();
    const reply = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ts: Date.now(),
      at: nowIso,
      source,
      targetHandle,
      targetName: cleanDisplayName(payload.targetName || "", targetHandle),
      textPreview,
      url: payload.url || location.href
    };

    day.replies.push(reply);
    day.people[targetHandle] ||= {
      handle: targetHandle,
      name: cleanDisplayName(payload.targetName || "", targetHandle),
      count: 0,
      firstAt: nowIso,
      lastAt: nowIso
    };
    day.people[targetHandle].count += 1;
    day.people[targetHandle].name = cleanDisplayName(payload.targetName || "", targetHandle) || day.people[targetHandle].name;
    day.people[targetHandle].lastAt = nowIso;

    const gained = replyXp(beforeCount, day.replies.length, Object.keys(day.people).length);
    state.totalXp = (state.totalXp || 0) + gained;
    const unlocked = applyAchievements(state, day);
    state.lastRecorded = { ...reply, gained, unlocked: unlocked.map((item) => item.title) };

    await writeState(state);
    renderHud(true);
    markVisiblePeople();
    showToast(`${displayHandle(targetHandle)} +${gained} XP${beforeCount ? `，今日第 ${beforeCount + 1} 次` : "，今日首次"}`);
    safeSendMessage({ type: "xrq:reply-recorded" });
    return true;
  }

  function handleClick(event) {
    const button = event.target?.closest?.("button");
    if (!isSubmitButton(button)) return;
    const detected = detectReplyFromEvent(event);
    if (!detected) return;
    setTimeout(() => recordReply(detected, "auto"), 900);
  }

  function handleKeydown(event) {
    if (!(event.key === "Enter" && (event.ctrlKey || event.metaKey))) return;
    if (!event.target?.closest?.('[role="textbox"]')) return;
    const detected = detectReplyFromEvent(event);
    if (!detected) return;
    setTimeout(() => recordReply(detected, "shortcut"), 900);
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${HUD_ID} {
        position: fixed;
        right: 18px;
        top: 18px;
        z-index: 2147483647;
        width: 326px;
        max-height: calc(100vh - 36px);
        color: #eef2ff;
        background: rgba(10, 15, 28, 0.94);
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 14px;
        box-shadow: 0 18px 45px rgba(0, 0, 0, 0.35);
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow: auto;
      }
      #${HUD_ID}.is-minimized {
        width: auto;
        min-width: 154px;
        overflow: visible;
      }
      #${HUD_ID} * { box-sizing: border-box; }
      #${HUD_ID} button {
        border: 0;
        border-radius: 10px;
        color: #ecfeff;
        background: #16a34a;
        cursor: pointer;
        font-weight: 700;
        height: 32px;
        padding: 0 10px;
      }
      .xrq-top { display: flex; align-items: center; gap: 10px; padding: 12px; }
      .xrq-mini {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 42px;
        padding: 0 12px;
        cursor: pointer;
        user-select: none;
      }
      .xrq-mini strong { font-size: 13px; }
      .xrq-mini span { color: #a5b4fc; font-size: 12px; font-weight: 800; }
      .xrq-gem {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background: linear-gradient(135deg, #22c55e, #06b6d4);
        color: #02111f;
        font-size: 18px;
        font-weight: 900;
      }
      .xrq-title { font-weight: 900; font-size: 14px; }
      .xrq-sub { color: #a5b4fc; font-size: 12px; }
      .xrq-grid { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid rgba(148, 163, 184, 0.22); }
      .xrq-cell { padding: 10px 8px; text-align: center; border-right: 1px solid rgba(148, 163, 184, 0.18); }
      .xrq-cell:last-child { border-right: 0; }
      .xrq-num { font-weight: 900; font-size: 17px; }
      .xrq-label { color: #94a3b8; font-size: 11px; }
      .xrq-progress { height: 8px; background: #1e293b; margin: 0 12px 12px; border-radius: 999px; overflow: hidden; }
      .xrq-bar { height: 100%; width: 0%; background: linear-gradient(90deg, #22c55e, #38bdf8); }
      .xrq-actions { display: flex; gap: 8px; padding: 0 12px 12px; }
      .xrq-actions button { width: 100%; }
      .xrq-ghost { background: #334155 !important; color: #e2e8f0 !important; }
      .xrq-detail { display: grid; gap: 10px; padding: 0 12px 12px; }
      .xrq-section {
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.72);
        overflow: hidden;
      }
      .xrq-section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        color: #e2e8f0;
        font-weight: 900;
      }
      .xrq-section-head span { color: #94a3b8; font-size: 11px; font-weight: 700; }
      .xrq-list { display: grid; gap: 1px; max-height: 184px; overflow: auto; }
      .xrq-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 36px;
        padding: 7px 10px;
        background: rgba(2, 6, 23, 0.34);
      }
      .xrq-row strong {
        display: block;
        max-width: 196px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #f8fafc;
        font-size: 12px;
      }
      .xrq-row small {
        display: block;
        max-width: 196px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #94a3b8;
        font-size: 11px;
      }
      .xrq-count {
        flex: 0 0 auto;
        min-width: 38px;
        border-radius: 999px;
        padding: 3px 7px;
        color: #052e16;
        background: #86efac;
        font-size: 11px;
        font-weight: 900;
        text-align: center;
      }
      .xrq-empty { padding: 10px; color: #94a3b8; font-size: 12px; }
      .xrq-last {
        padding: 8px 10px;
        color: #cbd5e1;
        background: rgba(2, 6, 23, 0.34);
        font-size: 12px;
      }
      .xrq-avatar-layer {
        position: absolute;
        left: 0;
        top: 0;
        width: 0;
        height: 0;
        overflow: visible;
        z-index: 2147483646;
        pointer-events: none;
      }
      .xrq-avatar-badge {
        position: absolute;
        z-index: 2147483647;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        height: 18px;
        padding: 0 6px;
        border-radius: 999px;
        color: #052e16;
        background: #86efac;
        border: 2px solid #07111f;
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.28);
        font: 900 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: none;
        white-space: nowrap;
      }
      .xrq-avatar-badge.is-zero {
        color: #cbd5e1;
        background: #334155;
        border-color: #0f172a;
      }
      .xrq-toast {
        position: fixed;
        right: 18px;
        top: 284px;
        z-index: 2147483647;
        max-width: 320px;
        color: #f8fafc;
        background: #0f172a;
        border: 1px solid rgba(148, 163, 184, 0.25);
        border-radius: 12px;
        box-shadow: 0 16px 38px rgba(0,0,0,.28);
        padding: 10px 12px;
        font: 700 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
    `;
    document.documentElement.appendChild(style);
  }

  async function renderHud(force = false) {
    const now = Date.now();
    if (!force && now - lastHudRender < 1000) return;
    lastHudRender = now;

    injectStyle();
    const state = cachedState || (await readState());
    const dayKey = utcDayKey();
    const selectedDay = ensureDay(state, dayKey);
    const level = levelForXp(state.totalXp || 0);
    const streak = computeStreak(state);
    const selectedPeople = Object.values(selectedDay.people || {}).sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
    const peopleRows = selectedPeople.slice(0, 8).map((person) => {
      const title = person.name || `@${person.handle}`;
      const sub = `@${person.handle} · 最后 ${formatHudTime(person.lastAt)}`;
      return `
        <div class="xrq-row">
          <div>
            <strong>${escapeHtml(title)}</strong>
            <small>${escapeHtml(sub)}</small>
          </div>
          <span class="xrq-count">${person.count}次</span>
        </div>
      `;
    }).join("");
    const achievementRows = Object.values(state.achievements || {})
      .sort((a, b) => b.unlockedAt.localeCompare(a.unlockedAt))
      .slice(0, 4)
      .map((item) => `
        <div class="xrq-row">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <small>${formatHudTime(item.unlockedAt)}</small>
          </div>
          <span class="xrq-count">+${item.xp}</span>
        </div>
      `)
      .join("");
    const lastRecorded = state.lastRecorded
      ? `${displayHandle(state.lastRecorded.targetHandle)} · +${state.lastRecorded.gained || 0} XP · ${formatHudTime(state.lastRecorded.at)}`
      : "还没有记录，回复或补记后会出现在这里。";

    let hud = document.getElementById(HUD_ID);
    if (!hud) {
      hud = document.createElement("div");
      hud.id = HUD_ID;
      hud.addEventListener("click", (event) => event.stopPropagation(), true);
      hud.addEventListener("mousedown", (event) => event.stopPropagation(), true);
      document.documentElement.appendChild(hud);
    }

    if (state.settings?.hudMinimized) {
      hud.classList.add("is-minimized");
      hud.innerHTML = `
        <div class="xrq-mini" data-xrq-restore title="展开 X Reply Quest">
          <div class="xrq-gem">XP</div>
          <div>
            <strong>Lv.${level.level}</strong>
            <span>${selectedDay.replies.length} 回复</span>
          </div>
        </div>
      `;
      hud.onclick = async (event) => {
        event.stopPropagation();
        const restore = event.target?.closest?.("[data-xrq-restore]");
        if (!restore) return;
        const nextState = await readState();
        nextState.settings = { ...defaultState().settings, ...(nextState.settings || {}), hudMinimized: false };
        await writeState(nextState);
        await renderHud(true);
      };
      return;
    }

    hud.classList.remove("is-minimized");

    hud.innerHTML = `
      <div class="xrq-top">
        <div class="xrq-gem">XP</div>
        <div>
          <div class="xrq-title">X Reply Quest · Lv.${level.level}</div>
          <div class="xrq-sub">UTC ${dayKey} · ${level.current}/${level.next} XP</div>
        </div>
      </div>
      <div class="xrq-grid">
        <div class="xrq-cell"><div class="xrq-num">${selectedDay.replies.length}</div><div class="xrq-label">今日回复</div></div>
        <div class="xrq-cell"><div class="xrq-num">${Object.keys(selectedDay.people || {}).length}</div><div class="xrq-label">已触达</div></div>
        <div class="xrq-cell"><div class="xrq-num">${streak}</div><div class="xrq-label">连续天</div></div>
      </div>
      <div class="xrq-progress"><div class="xrq-bar" style="width:${level.percent}%"></div></div>
      <div class="xrq-detail">
        <div class="xrq-section">
          <div class="xrq-section-head">最近记录 <span>自动同步弹窗</span></div>
          <div class="xrq-last">${escapeHtml(lastRecorded)}</div>
        </div>
        <div class="xrq-section">
          <div class="xrq-section-head">今日名单 <span>${selectedPeople.length} 人</span></div>
          <div class="xrq-list">
            ${peopleRows || `<div class="xrq-empty">今天还没有记录。回复第一条后，这里会出现名单。</div>`}
          </div>
        </div>
        <div class="xrq-section">
          <div class="xrq-section-head">成就 <span>${Object.keys(state.achievements || {}).length} 个</span></div>
          <div class="xrq-list">
            ${achievementRows || `<div class="xrq-empty">达成首次回复、连续天数、触达人群后会解锁。</div>`}
          </div>
        </div>
      </div>
      <div class="xrq-actions">
        <button type="button" class="xrq-ghost" data-xrq-minimize>最小化</button>
      </div>
    `;

    hud.onclick = async (event) => {
      event.stopPropagation();
      const minimize = event.target?.closest?.("[data-xrq-minimize]");
      if (!minimize) return;
      const nextState = await readState();
      nextState.settings = { ...defaultState().settings, ...(nextState.settings || {}), hudMinimized: true };
      await writeState(nextState);
      await renderHud(true);
    };
  }

  function detectActiveComposerReply() {
    const active = document.activeElement;
    if (!active?.closest?.('[role="textbox"], [role="dialog"], article, section')) return null;
    if (active.closest(`#${HUD_ID}`)) return null;
    return detectReplyFromEvent({ target: active });
  }

  function visibleArticlesByDistance() {
    const center = window.innerHeight / 2;
    return [...document.querySelectorAll("article")]
      .map((article) => {
        const rect = article.getBoundingClientRect();
        const visible = rect.bottom > 0 && rect.top < window.innerHeight;
        return { article, visible, distance: Math.abs(rect.top + rect.height / 2 - center) };
      })
      .filter((item) => item.visible)
      .sort((a, b) => a.distance - b.distance)
      .map((item) => item.article);
  }

  function extractAuthorFromArticle(article) {
    const avatarAnchor = [...article.querySelectorAll('a[href^="/"]')].find((anchor) => {
      return anchor.querySelector('img[src*="profile_images"], img[draggable="true"]');
    });
    const avatarHandle = avatarAnchor ? extractHandleFromAnchor(avatarAnchor) : "";
    if (avatarHandle) {
      return {
        handle: avatarHandle,
        name: nameForHandleNear(article, avatarHandle) || cleanDisplayName(avatarAnchor.getAttribute("aria-label") || "", avatarHandle)
      };
    }

    const nameArea = article.querySelector('[data-testid="User-Name"]') || article;
    const profileAnchor = [...nameArea.querySelectorAll('a[href^="/"]')].find((anchor) => extractHandleFromAnchor(anchor));
    const handle = profileAnchor ? extractHandleFromAnchor(profileAnchor) : "";
    return { handle, name: nameForHandleNear(article, handle) || cleanDisplayName(profileAnchor?.textContent || "", handle) };
  }

  function findVisibleTweetTarget() {
    const article = visibleArticlesByDistance()[0];
    if (!article) {
      return {
        targetHandle: "",
        targetName: "",
        textPreview: "",
        url: location.href
      };
    }
    const author = extractAuthorFromArticle(article);
    return {
      targetHandle: author.handle || inferTargetFromRoot(article),
      targetName: author.name,
      textPreview: (article.innerText || "").trim().replace(/\s+/g, " ").slice(0, 180),
      url: location.href
    };
  }

  function showToast(message) {
    injectStyle();
    const existing = document.querySelector(".xrq-toast");
    existing?.remove();
    const toast = document.createElement("div");
    toast.className = "xrq-toast";
    toast.textContent = message;
    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  async function markVisiblePeople() {
    if (isPageScrolling) return;
    const state = cachedState || (await readState());
    const people = ensureDay(state).people || {};
    const ownHandles = detectOwnHandles();
    let layer = document.querySelector(".xrq-avatar-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "xrq-avatar-layer";
      document.documentElement.appendChild(layer);
    }

    const avatarAnchors = [...document.querySelectorAll('a[href^="/"]')].filter((anchor) => {
      return anchor.querySelector('img[src*="profile_images"], img[draggable="true"]');
    });

    const badges = [];
    for (const [index, anchor] of avatarAnchors.entries()) {
      const handle = extractHandleFromAnchor(anchor);
      if (!handle) continue;
      if (ownHandles.has(handle)) continue;
      const image = anchor.querySelector('img[src*="profile_images"], img[draggable="true"]');
      const rect = (image || anchor).getBoundingClientRect();
      if (rect.width < 18 || rect.height < 18 || rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) continue;
      const count = people[handle]?.count || 0;
      const left = Math.round(window.scrollX + rect.left + rect.width / 2);
      const top = Math.max(2, Math.round(window.scrollY + rect.top - 6));
      badges.push(`
        <span
          class="xrq-avatar-badge ${count ? "" : "is-zero"}"
          data-handle="${escapeHtml(handle)}"
          data-index="${index}"
          title="${count ? `今天已回复 @${handle} ${count} 次` : `今天还没回复 @${handle}`}"
          style="left:${left}px; top:${top}px; transform:translateX(-50%);"
        >${count}</span>
      `);
    }
    layer.innerHTML = badges.join("");
  }

  function startScanning() {
    if (scanTimer) return;
    scanTimer = setInterval(() => {
      renderHud();
      markVisiblePeople();
    }, 2500);
    const observer = new MutationObserver(() => {
      if (isPageScrolling) return;
      window.requestIdleCallback ? requestIdleCallback(markVisiblePeople, { timeout: 1500 }) : setTimeout(markVisiblePeople, 500);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("scroll", () => {
      isPageScrolling = true;
      window.clearTimeout(scrollStopTimer);
      scrollStopTimer = window.setTimeout(() => {
        isPageScrolling = false;
        markVisiblePeople();
      }, 140);
    }, { passive: true });
  }

  async function init() {
    if (!/^(x|twitter)\.com$/i.test(location.hostname)) return;
    injectStyle();
    await readState();
    await renderHud(true);
    await markVisiblePeople();
    startScanning();
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeydown, true);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[STORAGE_KEY]) {
        cachedState = changes[STORAGE_KEY].newValue;
        renderHud(true);
        markVisiblePeople();
      }
    });
  }

  init();
})();
