import type { HudModel } from './hudModel';
import { Minimap, type MinimapMap } from './minimap';
import { MissionPanel } from './missionPanel';
import { Speedometer } from './speedometer';

/**
 * The in-game HUD (T0016 §3.8): speedometer (bottom right, in a car), minimap
 * (bottom left) and mission indicator (top centre). It is read-only toward gameplay:
 * `update()` takes a HudModel snapshot once per render frame.
 */
export class Hud {
  readonly root: HTMLDivElement;
  readonly speedometer: Speedometer;
  readonly minimap: Minimap;
  readonly mission: MissionPanel;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    parent.appendChild(this.root);
    this.speedometer = new Speedometer(this.root);
    this.minimap = new Minimap(this.root);
    this.mission = new MissionPanel(this.root);
  }

  setMap(map: MinimapMap): void {
    this.minimap.setMap(map);
  }

  update(m: HudModel, dt: number): void {
    this.speedometer.update(m.vehicle);
    this.minimap.update(m.player, m.blips, dt);
    this.mission.update(m.mission, m.player);
  }

  dispose(): void {
    this.speedometer.dispose();
    this.minimap.dispose();
    this.mission.dispose();
    this.root.remove();
  }
}
