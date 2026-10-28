const SYNC_KEY = "xReplyQuestFileSync";
const STATUS_KEY = "xReplyQuestFileSyncStatus";
let directory;
const statusElement = document.getElementById("settingsStatus");
const chooseButton = document.getElementById("chooseDirectory");
const authorizeButton = document.getElementById("authorizeDirectory");
const autoSync = document.getElementById("autoSync");
const syncNow = document.getElementById("syncNow");

async function renderSettings() {
  const stored = await chrome.storage.local.get([SYNC_KEY, STATUS_KEY]);
  const settings = stored[SYNC_KEY] || {};
  const status = stored[STATUS_KEY] || {};
  autoSync.checked = Boolean(settings.enabled && ["directory", "file"].includes(settings.mode));
  autoSync.disabled = !directory;
  authorizeButton.disabled = !directory;
  syncNow.disabled = !directory || !autoSync.checked || status.state === "writing";
  document.getElementById("directoryLabel").textContent = directory ? (directory.kind === "file" ? `已选择记录文件：${directory.name}` : `保存位置：所选 ${directory.name} 文件夹 / history.json`) : "尚未选择记录文件";
  statusElement.textContent = status.state === "error" ? `同步失败：${status.error}` :
    status.state === "writing" ? "正在保存…" :
    !autoSync.checked ? "自动同步未开启" :
    status.at ? `上次同步：${new Date(status.at).toLocaleString("zh-CN")}` : "等待同步";
}

async function sync() {
  const result = await chrome.runtime.sendMessage({ type: "xrq:sync-file" });
  if (!result?.ok) throw new Error(result?.error || "同步失败");
  await renderSettings();
}

chooseButton.addEventListener("click", async () => {
  try {
    if (!window.showSaveFilePicker) throw new Error("当前浏览器不支持文件授权，请使用新版 Edge 或 Chrome");
    const selected = await window.showSaveFilePicker({
      id: "xrq-history-file", suggestedName: "history.json",
      types: [{ description: "JSON 回复记录", accept: { "application/json": [".json"] } }],
      excludeAcceptAllOption: true
    });
    if (selected.name !== "history.json") throw new Error("请使用文件名 history.json，避免覆盖其他 JSON 文件");
    await FileSyncDirectory.set(selected);
    directory = selected;
    await chrome.storage.local.set({ [SYNC_KEY]: { enabled: true, mode: "file", fileName: selected.name } });
    await sync();
  } catch (error) {
    statusElement.textContent = error.name === "AbortError" ? "已取消或浏览器拒绝了该位置；请选择插件目录中的 history.json。如仍被拦截，请选择普通数据文件夹。" : error.message;
  }
});

authorizeButton.addEventListener("click", async () => {
  try {
    if (await directory.requestPermission({ mode: "readwrite" }) !== "granted") throw new Error("未获得写入权限，请重新选择记录文件并允许写入");
    if (autoSync.checked) await sync();
    else await renderSettings();
  } catch (error) { statusElement.textContent = error.message; }
});

autoSync.addEventListener("change", async () => {
  try {
    await chrome.storage.local.set({ [SYNC_KEY]: { enabled: autoSync.checked, mode: directory.kind === "file" ? "file" : "directory", directoryName: directory.name, fileName: directory.name } });
    await renderSettings();
  } catch (error) { statusElement.textContent = error.message; }
});
syncNow.addEventListener("click", () => sync().catch(error => { statusElement.textContent = error.message; }));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[SYNC_KEY] || changes[STATUS_KEY])) renderSettings().catch(error => { statusElement.textContent = error.message; });
});
FileSyncDirectory.get().then(handle => { directory = handle; return renderSettings(); }).catch(error => { statusElement.textContent = error.message; });
