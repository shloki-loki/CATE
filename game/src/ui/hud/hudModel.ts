import type { SpeedoModel } from './speedometer';

/**
 * The HUD's whole input (T0016 §3.8): a plain snapshot that the game fills once per
 * render frame. The UI only reads it, so it never imports game modules (rule 4).
 */
export interface HudModel {
  /** The car the player drives, or null on foot. */
  vehicle: SpeedoModel | null;
  /** Where the player is, or null when there is no player yet. */
  player: HudPlayer | null;
  /** The active objective, or null in free roam. */
  mission: MissionHud | null;
  /** Extra points of interest for the minimap (police, shops, ...). */
  blips: MinimapBlip[];
  /** Player health and wanted level (T0028), or null before the game has a player record. */
  status: StatusHud | null;
}

export interface StatusHud {
  /** Player health and armour, 0..1 of their maximum. */
  health: number;
  armor: number;
  /** Wanted stars, 0..maxWanted. */
  wanted: number;
  maxWanted: number;
  /** Bumped whenever the star count goes up, so the stars flash once. */
  wantedRevision: number;
  /** True in the last seconds before a star is lost (the lit stars blink). */
  wantedFading: boolean;
}

export interface HudPlayer {
  x: number;
  z: number;
  /** Yaw of the player's forward direction: atan2(forward.x, forward.z), so 0 faces +Z and PI faces -Z. */
  heading: number;
  /** Horizontal speed in km/h (zooms the minimap out at speed). */
  speedKmh: number;
}

export interface MissionHud {
  /** Bumped by the game whenever the objective changes, so the panel can flash once. */
  revision: number;
  title: string;
  objective: string;
  /** 1-based step and total steps, or 0 when the mission has no numbered steps. */
  step: number;
  steps: number;
  /** World position of the current objective, drawn on the minimap and used for the distance. */
  target: { x: number; z: number } | null;
  /** Seconds since the mission started, or null to hide the timer. */
  elapsed: number | null;
  /** A short result banner ("LAP COMPLETE 1:12.4"), shown while non-null. */
  banner: string | null;
}

export type BlipKind = 'objective' | 'police' | 'vehicle' | 'poi';

export interface MinimapBlip {
  x: number;
  z: number;
  kind: BlipKind;
  /** CSS colour; a default per kind is used when absent. */
  color?: string;
}

export function emptyHudModel(): HudModel {
  return { vehicle: null, player: null, mission: null, blips: [], status: null };
}
