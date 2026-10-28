// IndexedDB persists file and legacy directory handles; chrome.storage cannot.
globalThis.FileSyncDirectory = {
  async access(mode, handle) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("xReplyQuestFiles", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("handles");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction("handles", mode);
        const store = transaction.objectStore("handles");
        const request = mode === "readwrite" ? store.put(handle, "directory") : store.get("directory");
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error || request.error);
        transaction.onabort = () => reject(transaction.error || new Error("文件夹设置保存失败"));
      });
    } finally { db.close(); }
  },
  get() { return this.access("readonly"); },
  set(handle) { return this.access("readwrite", handle); }
};
