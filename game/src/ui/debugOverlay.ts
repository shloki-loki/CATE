/** Snapshot the debug overlay reads each frame. UI never imports game modules (T0016 §4.2 rule 4). */
export interface DebugStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  bodies: number;
  entities: number;
  timeOfDay: number;
  quality: string;
}

/** F3 debug overlay (T0016 §3.10): plain DOM, updated a few times per second. */
export class DebugOverlay {
  private readonly el: HTMLDivElement;
  private visible: boolean;
  private acc = 0;

  constructor(parent: HTMLElement, visible = true) {
    this.el = document.createElement('div');
    this.el.className = 'debug-overlay';
    this.el.setAttribute('aria-live', 'off');
    parent.appendChild(this.el);
    this.visible = visible;
    this.el.hidden = !visible;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
  }

  update(dt: number, s: DebugStats): void {
    this.acc += dt;
    if (!this.visible || this.acc < 0.25) return;
    this.acc = 0;
    const h = Math.floor(s.timeOfDay);
    const m = Math.floor((s.timeOfDay - h) * 60);
    this.el.textContent =
      `${s.fps.toFixed(0)} fps | ${s.drawCalls} draws | ${(s.triangles / 1000).toFixed(1)}k tris\n` +
      `${s.bodies} bodies | ${s.entities} entities | ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} | ${s.quality}\n` +
      `WASD: move | Shift: sprint | Space: jump | F: enter/use\n` +
      `click: mouse look (Esc frees) | wheel: zoom | F3: hide`;
  }

  dispose(): void {
    this.el.remove();
  }
}
