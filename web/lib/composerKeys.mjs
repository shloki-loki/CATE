// Keyboard behaviour of the chat box (pure, unit-tested in web/tests/composerKeys.test.mjs).
// - Enter sends (except while an IME is composing a character).
// - Shift+Enter is left to the browser: it inserts a plain newline. No list numbering or bullets
//   are ever added, whatever the line before it looks like ("1. one", "- item", "- [ ] task").
// Returns 'send' when the composer should submit; otherwise null, and the caller must not call
// preventDefault, so the textarea's native behaviour applies.
export function composerKeyAction({ key, shiftKey, isComposing }) {
  if (key !== 'Enter' || isComposing) return null;
  return shiftKey ? null : 'send';
}

// Earlier builds stored a list-continuation preference under this key. It is no longer read;
// the composer removes it so an old "on" value cannot bring the behaviour back.
export const LEGACY_AUTO_LIST_KEY = 'cate:auto-lists';
