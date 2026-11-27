import type { BlipKind, HudPlayer, MinimapBlip } from './hudModel';

/**
 * Player-centred, heading-up minimap (T0016 §3.8) on a 2D canvas.
 *
 * The static map (ground, water, roads, buildings) is drawn once into an off-screen
 * canvas; each frame only blits the visible part of it rotated around the player and
 * draws the blips on top, so a frame costs one drawImage plus a few paths.
 *
 * World axes: +X is east (screen right), -Z is north (screen up), matching the
 * chase camera, so the minimap is never mirrored relative to the 3D view.
 */

/** Axis-aligned rectangle given by its centre and its size along X (w) and Z (d), in metres. */
export interface MapRect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface MapRoad {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Surface width in metres. */
  width: number;
}

export interface MapArea extends MapRect {
  kind: 'sand' | 'water' | 'park' | 'plaza';
}

/** Everything static the minimap draws. Built by the world (demo scene now, RoadGraph city later). */
export interface MinimapMap {
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** What lies beyond the bounds: open sea or plain land. */
  outside: 'water' | 'land';
  areas: MapArea[];
  roads: MapRoad[];
  buildings: MapRect[];
}

export interface MinimapView {
  /** Centre of the map (the player) in world metres. */
  cx: number;
  cz: number;
  /** atan2(forward.x, forward.z) of the player; the map turns so this direction points up. */
  heading: number;
  /** World metres from the centre to the rim. */
  radius: number;
  /** Diameter in CSS pixels. */
  size: number;
}

/** Canvas rotation that puts the player's heading at the top of the minimap. */
export function mapRotation(heading: number): number {
  return heading - Math.PI;
}

/**
 * World point -> minimap pixel offset from the centre (screen y grows downwards).
 * Uses the same rotation as the canvas transform, so blips sit exactly on the map.
 */
export function worldToMinimap(view: MinimapView, x: number, z: number): { sx: number; sy: number } {
  const k = view.size / 2 / view.radius;
  const th = mapRotation(view.heading);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const dx = x - view.cx;
  const dz = z - view.cz;
  return { sx: (dx * c - dz * s) * k, sy: (dx * s + dz * c) * k };
}

/** Keeps a blip inside a disc of radius `r` px; far objectives stick to the rim. */
export function clampToDisc(sx: number, sy: number, r: number): { sx: number; sy: number; clamped: boolean } {
  const d = Math.hypot(sx, sy);
  if (d <= r) return { sx, sy, clamped: false };
  return { sx: (sx / d) * r, sy: (sy / d) * r, clamped: true };
}

/** Zoom radius (m) for a speed: close in town, further out at speed so you can see turns coming. */
export function zoomRadius(speedKmh: number): number {
  const t = Math.min(1, Math.max(0, Math.abs(speedKmh) / 150));
  return 75 + t * 85;
}

const COLORS = {
  sea: '#1b4f78',
  land: '#2b3b30',
  ground: '#33473a',
  sand: '#a08b5e',
  water: '#1f6290',
  park: '#36633d',
  plaza: '#5a5a66',
  road: '#d4d6de',
  building: '#625775',
  buildingEdge: '#7d7093',
};

const BLIP_COLORS: Record<BlipKind, string> = {
  objective: '#ffd23f',
  police: '#4d7cff',
  vehicle: '#e8e8e8',
  poi: '#57e389',
};

/** Pixels per metre for the cached map image: sharp, but never larger than 4096 px. */
export function mapImageScale(map: MinimapMap): number {
  const span = Math.max(map.bounds.maxX - map.bounds.minX, map.bounds.maxZ - map.bounds.minZ, 1);
  return Math.min(2, 4096 / span);
}

export class Minimap {
  private readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly resizeObserver: ResizeObserver | null = null;
  private image: HTMLCanvasElement | null = null;
  private map: MinimapMap | null = null;
  private ppm = 1;
  private cssSize = 0;
  private dpr = 1;
  private radius = zoomRadius(0);
  private shown = false;
  /** Last drawn centre, for tests and DevTools. */
  readonly centre = { x: 0, z: 0, heading: 0, radius: 0 };

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud-minimap';
    this.el.hidden = true;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-label', 'Minimap');
    this.canvas.setAttribute('role', 'img');
    this.el.appendChild(this.canvas);
    parent.appendChild(this.el);
    this.ctx = this.canvas.getContext('2d');
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.measure());
      this.resizeObserver.observe(this.el);
    }
  }

  /** Sets the static map. Call again when the world changes (e.g. a new city). */
  setMap(map: MinimapMap): void {
    this.map = map;
    this.ppm = mapImageScale(map);
    this.image = this.renderMapImage(map);
  }

  update(player: HudPlayer | null, blips: readonly MinimapBlip[], dt: number): void {
    const ok =
      player !== null &&
      this.ctx !== null &&
      Number.isFinite(player.x) &&
      Number.isFinite(player.z) &&
      Number.isFinite(player.heading);
    if (!ok) {
      if (this.shown) this.el.hidden = true;
      this.shown = false;
      return;
    }
    if (!this.shown) {
      this.el.hidden = false;
      this.shown = true;
      this.measure();
    }
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== this.dpr) this.measure();
    if (this.cssSize <= 0) return;

    const target = zoomRadius(player.speedKmh);
    this.radius += (target - this.radius) * (1 - Math.exp(-Math.max(0, dt) * 1.5));
    this.draw(this.ctx, player, blips);
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.el.remove();
  }

  /** Matches the canvas backing store to its CSS size and the device pixel ratio (crisp on HiDPI). */
  private measure(): void {
    this.dpr = window.devicePixelRatio || 1;
    const css = this.el.clientWidth;
    if (css <= 0) return;
    this.cssSize = css;
    const px = Math.round(css * this.dpr);
    if (this.canvas.width !== px) this.canvas.width = px;
    if (this.canvas.height !== px) this.canvas.height = px;
  }

  private draw(ctx: CanvasRenderingContext2D, p: HudPlayer, blips: readonly MinimapBlip[]): void {
    const size = this.cssSize;
    const half = size / 2;
    const rim = half - 3;
    const view: MinimapView = { cx: p.x, cz: p.z, heading: p.heading, radius: this.radius, size };
    this.centre.x = p.x;
    this.centre.z = p.z;
    this.centre.heading = p.heading;
    this.centre.radius = this.radius;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, rim, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = this.map?.outside === 'land' ? COLORS.land : COLORS.sea;
    ctx.fillRect(0, 0, size, size);

    if (this.image && this.map) {
      const k = half / this.radius; // CSS px per metre
      ctx.save();
      ctx.translate(half, half);
      ctx.rotate(mapRotation(p.heading));
      ctx.scale(k / this.ppm, k / this.ppm);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        this.image,
        -(p.x - this.map.bounds.minX) * this.ppm,
        -(p.z - this.map.bounds.minZ) * this.ppm,
      );
      ctx.restore();
    }

    // Blips: objectives last so they are on top; off-map ones stick to the rim.
    for (const pass of [false, true]) {
      for (const b of blips) {
        if ((b.kind === 'objective') !== pass || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
        const w = worldToMinimap(view, b.x, b.z);
        const c = clampToDisc(w.sx, w.sy, rim - 7);
        this.drawBlip(ctx, half + c.sx, half + c.sy, b, c.clamped);
      }
    }

    // The player: an arrow at the centre, always pointing up (the map turns instead).
    ctx.beginPath();
    ctx.moveTo(half, half - 8);
    ctx.lineTo(half + 6, half + 6);
    ctx.lineTo(half, half + 3);
    ctx.lineTo(half - 6, half + 6);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0b1026';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fill();
    ctx.restore();

    // Rim and the north marker riding on it.
    ctx.beginPath();
    ctx.arc(half, half, rim, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
    const n = worldToMinimap(view, p.x, p.z - this.radius);
    const nd = Math.hypot(n.sx, n.sy) || 1;
    const nx = half + (n.sx / nd) * rim;
    const ny = half + (n.sy / nd) * rim;
    ctx.beginPath();
    ctx.arc(nx, ny, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#0b1026';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 0.5);
  }

  private drawBlip(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    b: MinimapBlip,
    clamped: boolean,
  ): void {
    ctx.fillStyle = b.color ?? BLIP_COLORS[b.kind];
    ctx.strokeStyle = '#0b1026';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (b.kind === 'objective') {
      ctx.arc(x, y, clamped ? 5 : 6, 0, Math.PI * 2);
    } else if (b.kind === 'vehicle') {
      ctx.rect(x - 3, y - 3, 6, 6);
    } else {
      ctx.arc(x, y, 4, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.fill();
  }

  private renderMapImage(map: MinimapMap): HTMLCanvasElement | null {
    const { minX, minZ, maxX, maxZ } = map.bounds;
    const ppm = this.ppm;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil((maxX - minX) * ppm));
    c.height = Math.max(1, Math.ceil((maxZ - minZ) * ppm));
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const rx = (x: number): number => (x - minX) * ppm;
    const rz = (z: number): number => (z - minZ) * ppm;
    const rect = (r: MapRect): void =>
      ctx.fillRect(rx(r.x - r.w / 2), rz(r.z - r.d / 2), r.w * ppm, r.d * ppm);

    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, 0, c.width, c.height);
    for (const a of map.areas) {
      ctx.fillStyle = COLORS[a.kind];
      rect(a);
    }
    ctx.strokeStyle = COLORS.road;
    ctx.lineCap = 'square';
    for (const r of map.roads) {
      ctx.lineWidth = Math.max(1.5, r.width * ppm);
      ctx.beginPath();
      ctx.moveTo(rx(r.ax), rz(r.az));
      ctx.lineTo(rx(r.bx), rz(r.bz));
      ctx.stroke();
    }
    ctx.fillStyle = COLORS.building;
    ctx.strokeStyle = COLORS.buildingEdge;
    ctx.lineWidth = Math.max(1, ppm);
    for (const b of map.buildings) {
      rect(b);
      ctx.strokeRect(rx(b.x - b.w / 2), rz(b.z - b.d / 2), b.w * ppm, b.d * ppm);
    }
    return c;
  }
}
