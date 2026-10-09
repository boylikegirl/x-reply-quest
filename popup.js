const STORAGE_KEY = "xReplyQuestState";
let selectedDayKey = utcDayKey();

function utcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function defaultState() {
  return { version: 1, totalXp: 0, days: {}, achievements: {}, lastRecorded: null };
}

function ensureDay(state, dayKey = utcDayKey()) {
  state.days ||= {};
  state.days[dayKey] ||= { replies: [], people: {} };
  state.days[dayKey].replies ||= [];
  state.days[dayKey].people ||= {};
  return state.days[dayKey];
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
  const activeDays = new Set(
    Object.entries(state.days || {})
      .filter(([, day]) => (day.replies || []).length > 0)
      .map(([key]) => key)
  );
  let streak = 0;
  const cursor = new Date(`${utcDayKey()}T00:00:00.000Z`);
  while (activeDays.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

async function readState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return { ...defaultState(), ...(result[STORAGE_KEY] || {}) };
}

async function writeState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  chrome.runtime.sendMessage({ type: "xrq:update-badge" });
}

function formatTime(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(iso));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderPeople(day, selectedIsToday) {
  const peopleList = document.getElementById("peopleList");
  const people = Object.values(day.people || {}).sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
  if (!people.length) {
    peopleList.innerHTML = `<div class="empty">${selectedIsToday ? "今天还没有记录。去 X 回复第一条，经验条就会开始动。" : "这一天没有回复记录。"}</div>`;
    return;
  }
  peopleList.innerHTML = people
    .map((person) => {
      const title = person.name || `@${person.handle}`;
      const meta = `@${person.handle} · 最后 ${formatTime(person.lastAt)}`;
      return `
        <div class="person">
          <div>
            <strong>${escapeHtml(title)}</strong>
            <small>${escapeHtml(meta)}</small>
          </div>
          <span class="count">${person.count} 次</span>
        </div>
      `;
    })
    .join("");
}

function renderAchievements(state) {
  const list = document.getElementById("achievementList");
  const items = Object.values(state.achievements || {}).sort((a, b) => b.unlockedAt.localeCompare(a.unlockedAt));
  document.getElementById("achievementCount").textContent = `${items.length} 个`;
  if (!items.length) {
    list.innerHTML = `<div class="empty">成就会在首次回复、连续天数、触达人群增长时解锁。</div>`;
    return;
  }
  list.innerHTML = items
    .map((item) => {
      return `
        <div class="achievement">
          <div>
            <strong>${item.title}</strong>
            <small>${formatTime(item.unlockedAt)}</small>
          </div>
          <span class="count">+${item.xp}</span>
        </div>
      `;
    })
    .join("");
}

async function render() {
  const state = await readState();
  const dayKey = utcDayKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDayKey)) selectedDayKey = dayKey;
  const day = state.days?.[selectedDayKey] || { replies: [], people: {} };
  const level = levelForXp(state.totalXp || 0);
  const selectedIsToday = selectedDayKey === dayKey;

  document.getElementById("datePicker").value = selectedDayKey;
  document.getElementById("dayLabel").textContent = `${selectedDayKey}，${selectedIsToday ? "UTC 00:00 自动进入新的一天" : "历史记录"}`;
  document.getElementById("levelValue").textContent = level.level;
  document.getElementById("xpText").textContent = `${level.current} / ${level.next} XP`;
  document.getElementById("totalXp").textContent = `总计 ${state.totalXp || 0} XP`;
  document.getElementById("xpBar").style.width = `${level.percent}%`;
  document.getElementById("replyCount").textContent = day.replies.length;
  document.getElementById("peopleCount").textContent = Object.keys(day.people || {}).length;
  document.getElementById("streakCount").textContent = computeStreak(state);
  document.getElementById("replyLabel").textContent = selectedIsToday ? "今日回复" : "当日回复";
  document.getElementById("peopleTitle").textContent = selectedIsToday ? "今日名单" : "历史名单";

  renderPeople(day, selectedIsToday);
  renderAchievements(state);
}

async function exportData() {
  const state = await readState();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `x-reply-quest-${utcDayKey()}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function clearToday() {
  if (!confirm("确定清空今天的回复记录吗？总 XP 和历史成就会保留。")) return;
  const state = await readState();
  state.days ||= {};
  state.days[utcDayKey()] = { replies: [], people: {} };
  await writeState(state);
  await render();
}

document.getElementById("exportBtn").addEventListener("click", exportData);
document.getElementById("clearTodayBtn").addEventListener("click", clearToday);
document.getElementById("datePicker").addEventListener("change", (event) => {
  selectedDayKey = event.target.value || utcDayKey();
  render();
});
document.getElementById("todayBtn").addEventListener("click", () => {
  selectedDayKey = utcDayKey();
  render();
});
chrome.storage.onChanged.addListener(render);
render();
