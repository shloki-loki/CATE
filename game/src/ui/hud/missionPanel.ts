import type { HudPlayer, MissionHud } from './hudModel';

/** "143 m" below a kilometre, "1.25 km" above. */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

/** m:ss.t, e.g. 1:05.3. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const tenths = Math.floor(s * 10);
  const m = Math.floor(tenths / 600);
  const rest = (tenths - m * 600) / 10;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}

/**
 * Mission indicator (top centre): title, step counter, timer, objective text and the
 * distance to the objective, plus a centred result banner. Plain DOM; each text node
 * is written only when its string changes, so nothing reflows every frame.
 */
export class MissionPanel {
  private readonly el: HTMLDivElement;
  private readonly title: HTMLSpanElement;
  private readonly step: HTMLSpanElement;
  private readonly timer: HTMLSpanElement;
  private readonly objective: HTMLDivElement;
  private readonly distance: HTMLSpanElement;
  private readonly banner: HTMLDivElement;
  private readonly last = new Map<HTMLElement, string>();
  private revision = -1;
  private shown = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud-mission';
    this.el.hidden = true;
    this.el.setAttribute('role', 'status');
    this.el.innerHTML =
      '<div class="hud-mission-head"><span class="hud-mission-title"></span>' +
      '<span class="hud-mission-step"></span><span class="hud-mission-timer"></span></div>' +
      '<div class="hud-mission-objective"></div>' +
      '<span class="hud-mission-distance"></span>';
    this.title = this.el.querySelector('.hud-mission-title')!;
    this.step = this.el.querySelector('.hud-mission-step')!;
    this.timer = this.el.querySelector('.hud-mission-timer')!;
    this.objective = this.el.querySelector('.hud-mission-objective')!;
    this.distance = this.el.querySelector('.hud-mission-distance')!;
    this.banner = document.createElement('div');
    this.banner.className = 'hud-banner';
    this.banner.hidden = true;
    parent.appendChild(this.el);
    parent.appendChild(this.banner);
  }

  update(m: MissionHud | null, player: HudPlayer | null): void {
    if (!m) {
      if (this.shown) this.el.hidden = true;
      this.shown = false;
      this.setBanner(null);
      return;
    }
    if (!this.shown) this.el.hidden = false;
    this.shown = true;
    this.set(this.title, m.title);
    this.set(this.step, m.steps > 0 ? `${m.step}/${m.steps}` : '');
    this.set(this.timer, m.elapsed === null ? '' : formatTime(m.elapsed));
    this.set(this.objective, m.objective);
    const d = m.target && player ? Math.hypot(m.target.x - player.x, m.target.z - player.z) : NaN;
    this.set(this.distance, formatDistance(d));
    if (m.revision !== this.revision) {
      if (this.revision !== -1) this.flash();
      this.revision = m.revision;
    }
    this.setBanner(m.banner);
  }

  dispose(): void {
    this.el.remove();
    this.banner.remove();
  }

  private set(el: HTMLElement, text: string): void {
    if (this.last.get(el) === text) return;
    this.last.set(el, text);
    el.textContent = text;
    el.hidden = text === '';
  }

  private setBanner(text: string | null): void {
    const t = text ?? '';
    if (this.last.get(this.banner) === t) return;
    this.set(this.banner, t);
    if (t && typeof this.banner.animate === 'function') {
      this.banner.animate(
        [
          { opacity: 0, transform: 'translate(-50%, -50%) scale(0.85)' },
          { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
        ],
        { duration: 260, easing: 'ease-out' },
      );
    }
  }

  /** One short highlight when the objective changes (Web Animations: no forced reflow). */
  private flash(): void {
    if (typeof this.el.animate !== 'function') return;
    this.el.animate(
      [{ boxShadow: '0 0 0 2px #ffd23f, 0 0 22px #ffd23f' }, { boxShadow: '0 0 0 0 rgba(255, 210, 63, 0)' }],
      { duration: 700, easing: 'ease-out' },
    );
  }
}
