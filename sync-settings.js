const SYNC_KEY = "xReplyQuestFileSync";
const STATUS_KEY = "xReplyQuestFileSyncStatus";
const TODAY_STATUS_KEY = "xReplyQuestTodayFileSyncStatus";
let directory, todayFile;
const statusElement = document.getElementById("settingsStatus");
const autoSync = document.getElementById("autoSync");
const todaySync = document.getElementById("todaySync");

function statusText(status, enabled) {
  if (!enabled) return "自动同步未开启";
  if (status.state === "error") return `同步失败：${status.error}`;
  if (status.state === "writing") return "正在保存…";
  return status.at ? `上次同步：${new Date(status.at).toLocaleString("zh-CN")}` : "等待同步";
}
async function renderSettings() {
  const stored = await chrome.storage.local.get([SYNC_KEY, STATUS_KEY, TODAY_STATUS_KEY]);
  const settings = stored[SYNC_KEY] || {};
  autoSync.checked = Boolean(settings.enabled && ["directory", "file"].includes(settings.mode));
  autoSync.disabled = !directory;
  document.getElementById("authorizeDirectory").disabled = !directory;
  document.getElementById("syncNow").disabled = !directory || !autoSync.checked || stored[STATUS_KEY]?.state === "writing";
  document.getElementById("directoryLabel").textContent = directory ? (directory.kind === "file" ? `历史文件：${directory.name}` : `历史文件：${directory.name}/history.json`) : "尚未选择历史记录文件";
  statusElement.textContent = statusText(stored[STATUS_KEY] || {}, autoSync.checked);
  document.getElementById("chooseToday").disabled = !directory;
  document.getElementById("authorizeToday").disabled = !todayFile;
  todaySync.checked = Boolean(settings.todayEnabled);
  todaySync.disabled = !todayFile;
  document.getElementById("todayLabel").textContent = todayFile ? `当天文件：${todayFile.name}` : "尚未选择当天记录文件";
  document.getElementById("todayStatus").textContent = statusText(stored[TODAY_STATUS_KEY] || {}, autoSync.checked && settings.todayEnabled);
}
async function saveSettings(patch) {
  const stored = await chrome.storage.local.get(SYNC_KEY);
  await chrome.storage.local.set({ [SYNC_KEY]: { ...(stored[SYNC_KEY] || {}), ...patch } });
}
async function sync() {
  const result = await chrome.runtime.sendMessage({ type: "xrq:sync-file" });
  await renderSettings();
  if (!result?.ok) throw new Error(result?.error || "同步失败");
}
async function chooseFile(isToday) {
  const filename = isToday ? "today.json" : "history.json";
  const feedback = isToday ? document.getElementById("todayStatus") : statusElement;
  try {
    if (!window.showSaveFilePicker) throw new Error("当前浏览器不支持文件授权，请使用新版 Edge 或 Chrome");
    const selected = await window.showSaveFilePicker({
      id: isToday ? "xrq-today-file" : "xrq-history-file", suggestedName: filename,
      types: [{ description: "JSON 回复记录", accept: { "application/json": [".json"] } }], excludeAcceptAllOption: true
    });
    if (selected.name !== filename) throw new Error(`请使用文件名 ${filename}，避免覆盖其他文件`);
    const other = isToday ? directory : todayFile;
    if (other?.kind === "file" && await selected.isSameEntry(other)) throw new Error("当天文件与历史文件必须分开");
    await FileSyncDirectory.set(selected, isToday ? "today" : "directory");
    if (isToday) {
      todayFile = selected;
      await saveSettings({ todayEnabled: true, todayFileName: filename });
    } else {
      directory = selected;
      await saveSettings({ enabled: true, mode: "file", fileName: filename });
    }
    await sync();
  } catch (error) {
    feedback.textContent = error.name === "AbortError" ? "已取消或浏览器拒绝了该位置；如被拦截，请选择普通数据文件夹。" : error.message;
  }
}
async function authorize(handle, feedback) {
  try {
    if (await handle.requestPermission({ mode: "readwrite" }) !== "granted") throw new Error("未获得写入权限，请重新选择记录文件并允许写入");
    if (autoSync.checked) await sync(); else await renderSettings();
  } catch (error) { feedback.textContent = error.message; }
}
document.getElementById("chooseDirectory").addEventListener("click", () => chooseFile(false));
document.getElementById("chooseToday").addEventListener("click", () => chooseFile(true));
document.getElementById("authorizeDirectory").addEventListener("click", () => authorize(directory, statusElement));
document.getElementById("authorizeToday").addEventListener("click", () => authorize(todayFile, document.getElementById("todayStatus")));
autoSync.addEventListener("change", () => saveSettings({ enabled: autoSync.checked }).then(renderSettings).catch(error => { statusElement.textContent = error.message; }));
todaySync.addEventListener("change", () => saveSettings({ todayEnabled: todaySync.checked }).then(renderSettings).catch(error => { document.getElementById("todayStatus").textContent = error.message; }));
document.getElementById("syncNow").addEventListener("click", () => sync().catch(error => { statusElement.textContent = error.message; }));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[SYNC_KEY] || changes[STATUS_KEY] || changes[TODAY_STATUS_KEY])) renderSettings().catch(error => { statusElement.textContent = error.message; });
});
Promise.all([FileSyncDirectory.get(), FileSyncDirectory.get("today")]).then(([history, today]) => {
  directory = history; todayFile = today; return renderSettings();
}).catch(error => { statusElement.textContent = error.message; });
