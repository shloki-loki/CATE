import type { StatusHud } from './hudModel';

/** Health below this fraction turns the bar red and pulses it. */
export const LOW_HEALTH = 0.25;

/**
 * Player status (T0028, above the minimap): health bar, armour bar (only when the
 * player has armour) and the wanted stars. Plain DOM; each property is written only
 * when it changes, so the browser does no work while nothing happens.
 */
export class StatusPanel {
  readonly el: HTMLDivElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpText: HTMLSpanElement;
  private readonly armorBar: HTMLDivElement;
  private readonly armorFill: HTMLDivElement;
  private readonly starsEl: HTMLDivElement;
  private stars: HTMLSpanElement[] = [];
  private readonly last = new Map<string, string | number | boolean>();
  private revision = -1;
  private shown = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud-status';
    this.el.hidden = true;
    this.el.innerHTML =
      '<div class="hud-wanted" role="img" aria-label="Wanted level 0"></div>' +
      '<div class="hud-health"><span class="hud-health-icon" aria-hidden="true">+</span>' +
      '<div class="hud-bar"><div class="hud-bar-fill hud-hp"></div></div>' +
      '<span class="hud-health-text">100</span></div>' +
      '<div class="hud-health hud-armor-row" hidden><span class="hud-health-icon" aria-hidden="true">◆</span>' +
      '<div class="hud-bar"><div class="hud-bar-fill hud-armor"></div></div><span class="hud-health-text"></span></div>';
    this.starsEl = this.el.querySelector('.hud-wanted')!;
    this.hpFill = this.el.querySelector('.hud-hp')!;
    this.hpText = this.el.querySelector('.hud-health-text')!;
    this.armorBar = this.el.querySelector('.hud-armor-row')!;
    this.armorFill = this.el.querySelector('.hud-armor')!;
    parent.appendChild(this.el);
  }

  /** The star count currently drawn (for tests and DevTools). */
  get wantedShown(): number {
    return this.stars.filter((s) => s.classList.contains('hud-star-on')).length;
  }

  update(m: StatusHud | null): void {
    if (!m) {
      if (this.shown) this.el.hidden = true;
      this.shown = false;
      return;
    }
    if (!this.shown) this.el.hidden = false;
    this.shown = true;

    const hp = clamp01(m.health);
    if (this.changed('hp', Math.round(hp * 1000))) {
      this.hpFill.style.width = `${(hp * 100).toFixed(1)}%`;
      this.hpFill.classList.toggle('hud-low', hp < LOW_HEALTH);
    }
    if (this.changed('hpText', Math.ceil(hp * 100))) this.hpText.textContent = String(Math.ceil(hp * 100));
    const armor = clamp01(m.armor);
    if (this.changed('armor', Math.round(armor * 1000))) {
      this.armorBar.hidden = armor <= 0;
      this.armorFill.style.width = `${(armor * 100).toFixed(1)}%`;
    }

    if (this.stars.length !== m.maxWanted) this.buildStars(m.maxWanted);
    const n = Math.max(0, Math.min(m.maxWanted, Math.round(m.wanted)));
    if (this.changed('wanted', n)) {
      this.stars.forEach((s, i) => s.classList.toggle('hud-star-on', i < n));
      this.starsEl.setAttribute('aria-label', `Wanted level ${n}`);
    }
    if (this.changed('fading', m.wantedFading && n > 0))
      this.starsEl.classList.toggle('hud-wanted-fading', m.wantedFading && n > 0);
    if (m.wantedRevision !== this.revision) {
      if (this.revision !== -1 && m.wantedRevision > this.revision) this.flash();
      this.revision = m.wantedRevision;
    }
  }

  dispose(): void {
    this.el.remove();
  }

  private buildStars(count: number): void {
    this.starsEl.replaceChildren();
    this.stars = [];
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.className = 'hud-star';
      this.stars.push(s);
      this.starsEl.appendChild(s);
    }
    this.last.delete('wanted');
  }

  private flash(): void {
    this.starsEl.classList.remove('hud-wanted-flash');
    void this.starsEl.offsetWidth; // restart the CSS animation
    this.starsEl.classList.add('hud-wanted-flash');
  }

  private changed(key: string, v: string | number | boolean): boolean {
    if (this.last.get(key) === v) return false;
    this.last.set(key, v);
    return true;
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}
