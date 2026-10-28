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

async function syncFile() {
  const stored = await chrome.storage.local.get([SYNC_KEY, STORAGE_KEY]);
  const settings = stored[SYNC_KEY];
  if (!settings?.enabled) return;
  try {
    if (settings.mode !== "directory") throw new Error("请打开文件夹设置，选择插件文件夹并授权");
    const directory = await FileSyncDirectory.get();
    if (!directory) throw new Error("请先选择插件文件夹");
    if (await directory.queryPermission({ mode: "readwrite" }) !== "granted") {
      throw new Error("文件夹写入权限已失效，请打开文件夹设置，点击重新授权");
    }
    const state = stored[STORAGE_KEY] || { version: 1, totalXp: 0, days: {}, achievements: {} };
    const content = JSON.stringify(state, null, 2);
    await chrome.storage.local.set({ [STATUS_KEY]: { state: "writing" } });
    const file = await directory.getFileHandle("history.json", { create: true });
    const writable = await file.createWritable();
    try {
      await writable.write(content);
      await writable.close();
    } catch (error) {
      try { await writable.abort(); } catch (_) { /* Already closed or aborted. */ }
      throw error;
    }
    await chrome.storage.local.set({ [STATUS_KEY]: {
      state: "complete", at: new Date().toISOString(), path: `${directory.name}/history.json`
    } });
  } catch (error) {
    await chrome.storage.local.set({ [STATUS_KEY]: { state: "error", error: error.message || String(error) } });
    throw error;
  }
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
  if (message?.type !== "xrq:sync-file") return;
  enqueueSync().then(() => sendResponse({ ok: true }), error => sendResponse({ ok: false, error: error.message }));
  return true;
});
