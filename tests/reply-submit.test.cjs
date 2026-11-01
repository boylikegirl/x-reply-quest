const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const pending = [], recorded = [];
  const source = fs.readFileSync('content-script.js', 'utf8');
  const context = vm.createContext({
    setTimeout(callback) { pending.push(callback); }
  });
  const hook = `
    detectReplyFromEvent = () => ({ targetHandle: "someone", textPreview: "hello" });
    recordReply = (payload, source) => globalThis.recorded.push({ payload, source });
    globalThis.testApi = { isSubmitButton, handleClick };
  `;
  context.recorded = recorded;
  assert.ok(source.includes('  init();'));
  vm.runInContext(source.replace('  init();', hook), context);
  return { ...context.testApi, pending, recorded };
}
function button(id, label, attributes = {}) {
  return {
    innerText: label, disabled: false,
    getAttribute(name) { return ({ 'data-testid': id, 'aria-label': label, ...attributes })[name] || null; }
  };
}
function click(api, control) {
  api.handleClick({ target: { closest(selector) { assert.equal(selector, 'button'); return control; } } });
}

test('timeline reply bubble never queues a record, even with reply counts in its label', () => {
  const api = setup();
  for (const label of ['回复', 'Reply', '3 Replies. Reply', '3 条回复。回复', '发布', 'Send']) {
    click(api, button('reply', label));
  }
  assert.equal(api.pending.length, 0); assert.equal(api.recorded.length, 0);
});
test('only exact composer submit IDs queue a reply from clicks on nested icons or text', () => {
  const api = setup();
  for (const id of ['tweetButton', 'tweetButtonInline']) click(api, button(id, '回复'));
  assert.equal(api.pending.length, 2);
  api.pending.forEach(callback => callback());
  assert.equal(api.recorded.length, 2); assert.equal(api.recorded[0].source, 'auto');
});
test('disabled, unrelated, missing and partially matching controls are ignored', () => {
  const api = setup();
  click(api, null);
  click(api, { ...button('tweetButton', '回复'), disabled: true });
  click(api, button('tweetButtonInline', 'Reply', { 'aria-disabled': 'true' }));
  for (const id of ['', 'retweet', 'reply', 'not-tweetButton', 'tweetButtonPreview']) click(api, button(id, 'Reply'));
  assert.equal(api.pending.length, 0);
});
