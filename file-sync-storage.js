// IndexedDB persists file and legacy directory handles; chrome.storage cannot.
globalThis.FileSyncDirectory = {
  async access(mode, handle, key = "directory") {
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
        const request = mode === "readwrite" ? store.put(handle, key) : store.get(key);
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error || request.error);
        transaction.onabort = () => reject(transaction.error || new Error("文件夹设置保存失败"));
      });
    } finally { db.close(); }
  },
  get(key = "directory") { return this.access("readonly", undefined, key); },
  set(handle, key = "directory") { return this.access("readwrite", handle, key); }
};
