const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup() {
  const data = { xReplyQuestState: { days: { '2026-10-28': { replies: [{ targetHandle: '测试' }] } } } };
  const writes = [];
  const event = () => ({ addListener() {}, removeListener() {} });
  let permission = 'granted', fail = false, aborted = 0, active = 0, maxActive = 0;
  const handle = { kind: 'directory', name: 'x-reply-quest-extension', async queryPermission() { return permission; }, async getFileHandle(name, options) {
    assert.equal(name, 'history.json'); assert.equal(options.create, true);
    return { async createWritable() { active++; maxActive = Math.max(maxActive, active); let content;
      return { async write(value) { if (fail) throw new Error('disk full'); content = value; await new Promise(resolve => setTimeout(resolve, 5)); }, async close() { writes.push(JSON.parse(content)); active--; }, async abort() { aborted++; active--; } };
    } };
  } };
  const chrome = {
    storage: { local: { async get() { return structuredClone(data); }, async set(value) { Object.assign(data, value); } }, onChanged: event() },
    action: {}, runtime: { onInstalled: event(), onStartup: event(), onMessage: event() }
  };
  const context = vm.createContext({ chrome, importScripts() {}, FileSyncDirectory: { async get() { return handle; } } });
  vm.runInContext(fs.readFileSync('service-worker.js', 'utf8'), context);
  return { data, writes, run: code => vm.runInContext(code, context), async useFile() { const file = await handle.getFileHandle('history.json', { create: true }); handle.kind = 'file'; handle.name = 'history.json'; handle.createWritable = file.createWritable; handle.getFileHandle = () => { throw new Error('Must not request directory access'); }; }, setPermission(value) { permission = value; }, setFailure(value) { fail = value; }, get aborted() { return aborted; }, get maxActive() { return maxActive; } };
}
function enable(s) { s.data.xReplyQuestFileSync = { enabled: true, mode: 'directory', directoryName: 'x-reply-quest-extension' }; }
test('disabled sync never writes; enabled sync writes full Unicode history and reports completion', async () => {
  const s = setup(); await s.run('enqueueSync()'); assert.equal(s.writes.length, 0);
  enable(s); await s.run('enqueueSync()');
  assert.deepEqual(s.writes[0], s.data.xReplyQuestState);
  assert.equal(s.data.xReplyQuestFileSyncStatus.state, 'complete');
  assert.equal(s.data.xReplyQuestFileSyncStatus.path, 'x-reply-quest-extension/history.json');
});
test('expired permission and legacy settings report actionable errors without altering reply data', async () => {
  const s = setup(); const original = structuredClone(s.data.xReplyQuestState);
  enable(s); s.setPermission('prompt');
  await assert.rejects(s.run('enqueueSync()'), /重新授权/); assert.equal(s.writes.length, 0);
  s.data.xReplyQuestFileSync = { enabled: true, path: 'old.json' };
  await assert.rejects(s.run('enqueueSync()'), /选择记录文件/);
  assert.equal(s.data.xReplyQuestFileSyncStatus.state, 'error'); assert.deepEqual(s.data.xReplyQuestState, original);
});
test('write errors abort output and preserve browser data; queue recovers on retry', async () => {
  const s = setup(); enable(s); s.setFailure(true); const original = structuredClone(s.data.xReplyQuestState);
  await assert.rejects(s.run('enqueueSync()'), /disk full/);
  assert.equal(s.aborted, 1); assert.equal(s.writes.length, 0); assert.deepEqual(s.data.xReplyQuestState, original);
  s.setFailure(false); await s.run('enqueueSync()'); assert.equal(s.writes.length, 1);
});
test('concurrent sync requests serialize writes; clearing records updates snapshot', async () => {
  const s = setup(); enable(s);
  await Promise.all([s.run('enqueueSync()'), s.run('enqueueSync()')]); assert.equal(s.maxActive, 1);
  s.data.xReplyQuestState.days = {}; await s.run('enqueueSync()'); assert.deepEqual(s.writes.at(-1).days, {});
});

test('single-file authorization syncs without requesting directory access', async () => {
  const s = setup(); await s.useFile(); s.data.xReplyQuestFileSync = { enabled: true, mode: 'file', fileName: 'history.json' };
  await s.run('enqueueSync()');
  assert.deepEqual(s.writes[0], s.data.xReplyQuestState);
  assert.equal(s.data.xReplyQuestFileSyncStatus.path, 'history.json');
  s.setPermission('denied'); await assert.rejects(s.run('enqueueSync()'), /重新授权/);
  assert.equal(s.writes.length, 1);
});
