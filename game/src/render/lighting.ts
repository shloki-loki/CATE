import { Color, DirectionalLight, Fog, HemisphereLight, type Scene } from 'three';

/**
 * Base lighting: one shadow-casting sun plus a sky/ground hemisphere light, with
 * fog and background colour driven by time of day. The day/night follow-up task
 * replaces the colours with a Sky shader, cascaded shadows and emissive night lights.
 */
export class Lighting {
  readonly sun = new DirectionalLight(0xffffff, 3);
  readonly hemi = new HemisphereLight(0xbfe3ff, 0x6b5a3a, 1.5);
  private readonly dayColor = new Color(0x8fd3ff);
  private readonly duskColor = new Color(0xff8a5c);
  private readonly nightColor = new Color(0x0b1026);
  private readonly tmp = new Color();
  readonly fog = new Fog(0x8fd3ff, 120, 650);

  constructor(private readonly scene: Scene) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -120;
    cam.right = cam.top = 120;
    cam.near = 1;
    cam.far = 500;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = this.fog;
    scene.background = this.tmp.clone();
  }

  setShadowMapSize(size: number): void {
    if (this.sun.shadow.mapSize.x === size) return;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  setTimeOfDay(hours: number): void {
    // Sun travels east -> west from 06:00 to 18:00.
    const t = ((hours - 6) / 12) * Math.PI;
    const elevation = Math.sin(t);
    this.sun.position.set(Math.cos(t) * 200, Math.max(elevation, 0.05) * 220 + 10, 80);
    this.sun.target.position.set(0, 0, 0);
    const day = Math.max(0, elevation);
    this.sun.intensity = 3 * Math.min(1, day * 2);
    this.hemi.intensity = 0.35 + 1.15 * day;

    const dusk = Math.max(0, 1 - Math.abs(elevation) * 4);
    this.tmp.copy(this.nightColor).lerp(this.dayColor, Math.min(1, day * 3));
    this.tmp.lerp(this.duskColor, dusk * 0.5);
    this.fog.color.copy(this.tmp);
    (this.scene.background as Color).copy(this.tmp);
  }
}
