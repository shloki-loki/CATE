/** Full-screen error message, used for unsupported browsers and boot failures. Text only, no HTML injection. */
export function showFatal(parent: HTMLElement, title: string, detail: string): void {
  let box = parent.querySelector<HTMLDivElement>('.fatal');
  if (!box) {
    box = document.createElement('div');
    box.className = 'fatal';
    box.setAttribute('role', 'alert');
    parent.appendChild(box);
  }
  box.replaceChildren();
  const h = document.createElement('h1');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = detail;
  box.append(h, p);
}
