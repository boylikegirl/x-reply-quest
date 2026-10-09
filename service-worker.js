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
