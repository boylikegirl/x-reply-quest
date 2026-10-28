importScripts("file-sync-storage.js");
const STORAGE_KEY = "xReplyQuestState";

function utcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

async function getState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || { version: 1, totalXp: 0, days: {}, achievements: {} };
}

async function updateBadge() {
  const state = await getState();
  const today = state.days?.[utcDayKey()];
  const count = today?.replies?.length || 0;
  await chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
  await chrome.action.setBadgeText({ text: count > 0 ? String(Math.min(count, 99)) : "" });
}

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "xrq:reply-recorded" || message?.type === "xrq:update-badge") {
    updateBadge();
  }
});

// Settings and status are separate from reply data so status updates never trigger exports.
const SYNC_KEY = "xReplyQuestFileSync";
const STATUS_KEY = "xReplyQuestFileSyncStatus";
let syncQueue = Promise.resolve();

const TODAY_STATUS_KEY = "xReplyQuestTodayFileSyncStatus";

function todaySnapshot(state, date = new Date()) {
  const dayKey = utcDayKey(date);
  const day = state.days?.[dayKey] || { replies: [], people: {} };
  return {
    version: 1, date: dayKey, timeZone: "UTC", updatedAt: date.toISOString(),
    replyCount: (day.replies || []).length, peopleCount: Object.keys(day.people || {}).length,
    replies: day.replies || [], people: day.people || {}
  };
}

async function writeSnapshot(handle, filename, snapshot, statusKey) {
  try {
    if (!handle) throw new Error(`请先在同步设置中选择 ${filename}`);
    if (await handle.queryPermission({ mode: "readwrite" }) !== "granted") {
      throw new Error(`${filename} 写入权限已失效，请打开同步设置，点击重新授权`);
    }
    await chrome.storage.local.set({ [statusKey]: { state: "writing" } });
    const file = handle.kind === "file" ? handle : await handle.getFileHandle(filename, { create: true });
    const writable = await file.createWritable();
    try {
      await writable.write(JSON.stringify(snapshot, null, 2));
      await writable.close();
    } catch (error) {
      try { await writable.abort(); } catch (_) { /* Already closed or aborted. */ }
      throw error;
    }
    await chrome.storage.local.set({ [statusKey]: {
      state: "complete", at: new Date().toISOString(), path: handle.kind === "file" ? handle.name : `${handle.name}/${filename}`
    } });
  } catch (error) {
    await chrome.storage.local.set({ [statusKey]: { state: "error", error: error.message || String(error) } });
    throw error;
  }
}

async function syncFile() {
  const stored = await chrome.storage.local.get([SYNC_KEY, STORAGE_KEY]);
  const settings = stored[SYNC_KEY];
  if (!settings?.enabled) return;
  if (!["directory", "file"].includes(settings.mode)) {
    const error = new Error("请打开同步设置，选择记录文件并授权");
    await chrome.storage.local.set({ [STATUS_KEY]: { state: "error", error: error.message } });
    throw error;
  }
  const state = stored[STORAGE_KEY] || { version: 1, totalXp: 0, days: {}, achievements: {} };
  const exports = [{ key: "directory", filename: "history.json", snapshot: state, statusKey: STATUS_KEY }];
  if (settings.todayEnabled) exports.push({ key: "today", filename: "today.json", snapshot: todaySnapshot(state), statusKey: TODAY_STATUS_KEY });
  const errors = [];
  for (const item of exports) {
    try {
      const handle = await FileSyncDirectory.get(item.key);
      await writeSnapshot(handle, item.filename, item.snapshot, item.statusKey);
    } catch (error) {
      await chrome.storage.local.set({ [item.statusKey]: { state: "error", error: error.message || String(error) } });
      errors.push(error);
    }
  }
  if (errors.length) throw errors[0];
}

function enqueueSync() {
  // Serial writes prevent older snapshots from overwriting a newer snapshot.
  const result = syncQueue.catch(() => {}).then(syncFile);
  syncQueue = result.catch(() => {});
  return result;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[STORAGE_KEY] || changes[SYNC_KEY])) enqueueSync().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => enqueueSync().catch(() => {}));
chrome.runtime.onInstalled.addListener(() => enqueueSync().catch(() => {}));
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "xrq:open-sync-settings") {
    chrome.runtime.openOptionsPage().then(() => sendResponse({ ok: true }), error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type !== "xrq:sync-file") return;
  enqueueSync().then(() => sendResponse({ ok: true }), error => sendResponse({ ok: false, error: error.message }));
  return true;
});

// Refresh today.json at UTC midnight, even if no new replies are sent.
async function scheduleDayRollover() {
  const nextDay = new Date();
  nextDay.setUTCHours(24, 0, 0, 0);
  await chrome.alarms.create("xrq:day-rollover", { when: nextDay.getTime(), periodInMinutes: 1440 });
}
chrome.runtime.onInstalled.addListener(() => scheduleDayRollover().catch(console.error));
chrome.runtime.onStartup.addListener(() => scheduleDayRollover().catch(console.error));
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "xrq:day-rollover") {
    enqueueSync().catch(() => {});
    updateBadge().catch(console.error);
  }
});
