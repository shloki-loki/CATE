// Run with: cd web && npm test   (Node's built-in test runner, no dependencies)
// Simulates the chat box: a keydown runs the composer's handler; if the handler did not cancel the
// event, the browser's default action for Shift+Enter (insert "\n" at the caret) is applied.
import assert from 'node:assert/strict';
import test from 'node:test';
import { composerKeyAction } from '../lib/composerKeys.mjs';

// Mirrors Chat.js onKeyDown: only 'send' cancels the default action.
function press(value, { key = 'Enter', shiftKey = false, isComposing = false } = {}) {
  let prevented = false;
  let sent = false;
  const action = composerKeyAction({ key, shiftKey, isComposing });
  if (action === 'send') { prevented = true; sent = true; }
  const after = !prevented && key === 'Enter' ? `${value}\n` : value; // native newline
  return { value: after, prevented, sent };
}

const shiftEnter = (v) => press(v, { shiftKey: true });

test('Shift+Enter after a numbered item inserts only a plain newline', () => {
  for (const line of ['1. one', 'Steps:\n3. third', '9) nine', '1.5 million']) {
    const r = shiftEnter(line);
    assert.equal(r.value, `${line}\n`);
    assert.equal(r.prevented, false);
    assert.equal(r.sent, false);
  }
});

test('Shift+Enter after a bullet or checkbox inserts only a plain newline', () => {
  for (const line of ['- item', '  * nested', '• bullet', '+ plus', '- [ ] task', '- [x] done']) {
    const r = shiftEnter(line);
    assert.equal(r.value, `${line}\n`);
    assert.equal(r.prevented, false);
    assert.equal(r.sent, false);
  }
});

test('Shift+Enter on an empty item or plain text is also just a newline', () => {
  assert.equal(shiftEnter('1. one\n2. ').value, '1. one\n2. \n');
  assert.equal(shiftEnter('plain text').value, 'plain text\n');
  assert.equal(shiftEnter('').value, '\n');
});

test('Enter sends and does not insert a newline', () => {
  const r = press('1. one');
  assert.deepEqual(r, { value: '1. one', prevented: true, sent: true });
});

test('Enter during IME composition neither sends nor is cancelled', () => {
  const r = press('にほん', { isComposing: true });
  assert.equal(r.sent, false);
  assert.equal(r.prevented, false);
});

test('other keys are ignored', () => {
  assert.equal(composerKeyAction({ key: 'a', shiftKey: false, isComposing: false }), null);
  assert.equal(composerKeyAction({ key: 'Tab', shiftKey: true, isComposing: false }), null);
});
