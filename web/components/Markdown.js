// A small, safe Markdown renderer (no HTML injection): headings, lists, code blocks, bold, italics, code, links.

function inline(text, key = 0) {
  const parts = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) parts.push(<strong key={`${key}-${m.index}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) parts.push(<code key={`${key}-${m.index}`}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) parts.push(<a key={`${key}-${m.index}`} href={m[2]} target="_blank" rel="noreferrer">{t.slice(1, t.indexOf(']'))}</a>);
    else parts.push(<em key={`${key}-${m.index}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function Markdown({ text }) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const body = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) { body.push(lines[i]); i += 1; }
      i += 1;
      out.push(<pre key={i}><code>{body.join('\n')}</code></pre>);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { const Tag = `h${Math.min(4, h[1].length + 1)}`; out.push(<Tag key={i}>{inline(h[2], i)}</Tag>); i += 1; continue; }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(<li key={i}>{inline(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ''), i)}</li>);
        i += 1;
      }
      out.push(ordered ? <ol key={`l${i}`}>{items}</ol> : <ul key={`l${i}`}>{items}</ul>);
      continue;
    }
    if (!line.trim()) { i += 1; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*•]|\d+[.)])\s+)/.test(lines[i])) { para.push(lines[i]); i += 1; }
    out.push(<p key={`p${i}`}>{para.map((p, j) => <span key={j}>{j ? <br /> : null}{inline(p, `${i}-${j}`)}</span>)}</p>);
  }
  return <div className="prose">{out}</div>;
}
