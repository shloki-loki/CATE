/** What the speedometer shows. UI never imports game modules (T0016 §4.2 rule 4). */
export interface SpeedoModel {
  speedKmh: number;
  /** -1 reverse, 1..n forward. */
  gear: number;
  rpm: number;
  redlineRpm: number;
  /** 0..1 */
  health: number;
}

/** In-car speedometer, gear, rev bar and damage bar (plain DOM, bottom-right). */
export class Speedometer {
  private readonly el: HTMLDivElement;
  private readonly speed: HTMLSpanElement;
  private readonly gear: HTMLSpanElement;
  private readonly rev: HTMLDivElement;
  private readonly hp: HTMLDivElement;
  private shown = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'speedo';
    this.el.hidden = true;
    this.el.innerHTML =
      '<div class="speedo-main"><span class="speedo-speed">0</span><span class="speedo-unit">km/h</span>' +
      '<span class="speedo-gear">1</span></div>' +
      '<div class="speedo-bar"><div class="speedo-rev"></div></div>' +
      '<div class="speedo-bar speedo-hpbar"><div class="speedo-hp"></div></div>';
    this.speed = this.el.querySelector('.speedo-speed')!;
    this.gear = this.el.querySelector('.speedo-gear')!;
    this.rev = this.el.querySelector('.speedo-rev')!;
    this.hp = this.el.querySelector('.speedo-hp')!;
    parent.appendChild(this.el);
  }

  update(m: SpeedoModel | null): void {
    if (!m) {
      if (this.shown) this.el.hidden = true;
      this.shown = false;
      return;
    }
    if (!this.shown) this.el.hidden = false;
    this.shown = true;
    this.speed.textContent = String(Math.round(Math.abs(m.speedKmh)));
    this.gear.textContent = m.gear < 0 ? 'R' : String(m.gear);
    const r = Math.min(1, m.rpm / m.redlineRpm);
    this.rev.style.width = `${(r * 100).toFixed(1)}%`;
    this.rev.classList.toggle('speedo-redline', r > 0.92);
    const hp = Math.max(0, Math.min(1, m.health));
    this.hp.style.width = `${(hp * 100).toFixed(1)}%`;
    this.hp.classList.toggle('speedo-low', hp < 0.3);
  }

  dispose(): void {
    this.el.remove();
  }
}
