// Run with: cd web && npm test   (Node's built-in test runner, no dependencies)
import assert from 'node:assert/strict';
import test from 'node:test';
import { continueList } from '../lib/listContinue.mjs';

const at = (v) => continueList(v, v.length);

test('numbered lists continue with the next number', () => {
  assert.deepEqual(at('1. one'), { value: '1. one\n2. ', caret: 10 });
  assert.equal(at('a\n9) nine').value, 'a\n9) nine\n10) ');
  assert.equal(at('Steps:\n3. third').value, 'Steps:\n3. third\n4. ');
});

test('bullets continue with the same bullet and indent', () => {
  assert.equal(at('- item').value, '- item\n- ');
  assert.equal(at('  * nested').value, '  * nested\n  * ');
  assert.equal(at('• bullet').value, '• bullet\n• ');
  assert.equal(at('+ plus').value, '+ plus\n+ ');
});

test('task list items continue unchecked', () => {
  assert.equal(at('- [x] done').value, '- [x] done\n- [ ] ');
});

test('Shift+Enter on an empty item leaves the list', () => {
  assert.deepEqual(at('1. one\n2. '), { value: '1. one\n', caret: 7 });
  assert.deepEqual(at('- a\n- '), { value: '- a\n', caret: 4 });
});

test('plain text, rules and a marker without a space are left alone', () => {
  assert.equal(at('plain text'), null);
  assert.equal(at('- - -'), null);
  assert.equal(at('***'), null);
  assert.equal(at('1.5 million'), null);
  assert.equal(at('-dash'), null);
  assert.equal(at(''), null);
});

test('works in the middle of the text, using only the caret line', () => {
  const v = '1. one\n2. two\nafter';
  const caret = '1. one\n2. two'.length;
  assert.deepEqual(continueList(v, caret), { value: '1. one\n2. two\n3. \nafter', caret: caret + 4 });
});
