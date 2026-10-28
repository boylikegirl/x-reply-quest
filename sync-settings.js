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
  autoSync.checked = Boolean(settings.enabled && settings.mode === "directory");
  autoSync.disabled = !directory;
  authorizeButton.disabled = !directory;
  syncNow.disabled = !directory || !autoSync.checked || status.state === "writing";
  document.getElementById("directoryLabel").textContent = directory ? `保存位置：所选 ${directory.name} 文件夹 / history.json` : "尚未选择插件文件夹";
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
    if (!window.showDirectoryPicker) throw new Error("当前浏览器不支持文件夹授权，请使用新版 Edge 或 Chrome");
    const selected = await window.showDirectoryPicker({ id: "xrq-plugin-directory", mode: "readwrite" });
    const manifestFile = await selected.getFileHandle("manifest.json");
    const manifest = JSON.parse(await (await manifestFile.getFile()).text());
    if (manifest.name !== "X Reply Quest") throw new Error("请选择 X Reply Quest 插件文件夹（包含 manifest.json）");
    await FileSyncDirectory.set(selected);
    directory = selected;
    await chrome.storage.local.set({ [SYNC_KEY]: { enabled: true, mode: "directory", directoryName: selected.name } });
    await sync();
  } catch (error) {
    if (error.name !== "AbortError") statusElement.textContent = error.message;
  }
});

authorizeButton.addEventListener("click", async () => {
  try {
    if (await directory.requestPermission({ mode: "readwrite" }) !== "granted") throw new Error("未获得写入权限，请重新选择文件夹并允许写入");
    if (autoSync.checked) await sync();
    else await renderSettings();
  } catch (error) { statusElement.textContent = error.message; }
});

autoSync.addEventListener("change", async () => {
  try {
    await chrome.storage.local.set({ [SYNC_KEY]: { enabled: autoSync.checked, mode: "directory", directoryName: directory.name } });
    await renderSettings();
  } catch (error) { statusElement.textContent = error.message; }
});
syncNow.addEventListener("click", () => sync().catch(error => { statusElement.textContent = error.message; }));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[SYNC_KEY] || changes[STATUS_KEY])) renderSettings().catch(error => { statusElement.textContent = error.message; });
});
FileSyncDirectory.get().then(handle => { directory = handle; return renderSettings(); }).catch(error => { statusElement.textContent = error.message; });
