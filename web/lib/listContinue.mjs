// Markdown-style list continuation for the chat box (pure function, unit-tested in web/tests).
// Shift+Enter at the end of "1. text" inserts "\n2. ", after "- text" inserts "\n- ".
// Shift+Enter on an empty item ("2. " with nothing after it) removes the marker and leaves the list.
// "- - -" and "***" are horizontal rules, not lists. Returns null when the line is not a list item,
// so the caller falls back to a plain newline.

export function continueList(value, caret) {
  const start = value.lastIndexOf('\n', caret - 1) + 1;
  const line = value.slice(start, caret);
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return null;
  const m = line.match(/^(\s*)(?:([-*+•])|(\d{1,9})([.)]))\s+(\[[ xX]\]\s+)?/);
  if (!m) return null;
  const [marker, indent, bullet, num, punct, box] = m;
  if (line.trim() === marker.trim()) {
    return { value: value.slice(0, start) + value.slice(caret), caret: start };
  }
  const next = bullet ? `${indent}${bullet} ` : `${indent}${Number(num) + 1}${punct} `;
  const insert = `\n${next}${box ? '[ ] ' : ''}`;
  return { value: value.slice(0, caret) + insert + value.slice(caret), caret: caret + insert.length };
}

// Kept in this browser: lets someone turn list continuation off from the composer.
export const AUTO_LIST_KEY = 'cate:auto-lists';
