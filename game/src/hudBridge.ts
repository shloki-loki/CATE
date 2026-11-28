import { Vector3 } from 'three';
import {
  Blip,
  findPlayer,
  getVehicleDef,
  Health,
  MAX_WANTED_STARS,
  MissionStatus,
  PlayerRecord,
  Transform,
  Vehicle,
  VehicleTelemetry,
  WantedLevel,
} from './game';
import type { GameWorld } from './services';
import type { BlipKind, HudModel, MinimapBlip, StatusHud } from './ui';
import { emptyHudModel } from './ui';

/** The lit stars blink during the last seconds before one is lost. */
const WANTED_BLINK_SECONDS = 4;
const BLIP_KINDS = new Set<BlipKind>(['objective', 'police', 'vehicle', 'poi']);

/**
 * Builds the HUD snapshot from the world once per render frame (T0016 §3.8). It lives
 * outside game/ and ui/ because it joins them: game modules never see the HUD, and the
 * HUD never sees game modules. Reuses its objects, so it allocates nothing per frame
 * except when the blip count grows.
 */
export function createHudReader(world: GameWorld): (out?: HudModel) => HudModel {
  const model = emptyHudModel();
  const vehicle = { speedKmh: 0, gear: 1, rpm: 0, redlineRpm: 1, health: 1 };
  const player = { x: 0, z: 0, heading: 0, speedKmh: 0 };
  const objectiveBlip: MinimapBlip = { x: 0, z: 0, kind: 'objective' };
  const fwd = new Vector3();
  const pool: MinimapBlip[] = [];
  const playerStatus: StatusHud = {
    health: 1,
    armor: 0,
    wanted: 0,
    maxWanted: MAX_WANTED_STARS,
    wantedRevision: 0,
    wantedFading: false,
  };

  return (out = model) => {
    const p = findPlayer(world);
    if (!p) {
      out.player = null;
      out.vehicle = null;
    } else {
      fwd.set(0, 0, 1).applyQuaternion(p.transform.quaternion);
      player.x = p.transform.position.x;
      player.z = p.transform.position.z;
      // A car on its roof or side has a near-vertical forward vector; keep the last heading then.
      if (Math.hypot(fwd.x, fwd.z) > 0.2) player.heading = Math.atan2(fwd.x, fwd.z);
      const tel = p.inVehicle ? world.get(p.entity, VehicleTelemetry) : undefined;
      const v = p.inVehicle ? world.get(p.entity, Vehicle) : undefined;
      if (tel && v) {
        vehicle.speedKmh = tel.speed * 3.6;
        vehicle.gear = tel.drive.gear;
        vehicle.rpm = tel.drive.rpm;
        vehicle.redlineRpm = getVehicleDef(v.defId).engine.redlineRpm;
        vehicle.health = v.health / v.maxHealth;
        player.speedKmh = Math.hypot(tel.velocity.x, tel.velocity.z) * 3.6;
        out.vehicle = vehicle;
      } else {
        player.speedKmh = 0;
        out.vehicle = null;
      }
      out.player = player;
    }

    const rec = world.query(PlayerRecord, Health)[0];
    const wantedE = world.query(WantedLevel)[0];
    if (rec === undefined && wantedE === undefined) {
      out.status = null;
    } else {
      if (rec !== undefined) {
        const h = world.require(rec, Health);
        const r = world.require(rec, PlayerRecord);
        playerStatus.health = r.maxHp > 0 ? h.hp / r.maxHp : 0;
        playerStatus.armor = r.maxArmor > 0 ? h.armor / r.maxArmor : 0;
      }
      if (wantedE !== undefined) {
        const w = world.require(wantedE, WantedLevel);
        playerStatus.wanted = w.stars;
        playerStatus.wantedRevision = w.revision;
        playerStatus.wantedFading = w.coolDownIn !== null && w.coolDownIn <= WANTED_BLINK_SECONDS;
      }
      out.status = playerStatus;
    }

    let n = 0;
    const blips = out.blips;
    const status = world.query(MissionStatus)[0];
    const mission = status === undefined ? null : world.require(status, MissionStatus);
    out.mission = mission;
    if (mission?.target) {
      objectiveBlip.x = mission.target.x;
      objectiveBlip.z = mission.target.z;
      blips[n++] = objectiveBlip;
    }
    for (const e of world.query(Blip, Transform)) {
      if (p && e === p.entity) continue;
      const b = world.require(e, Blip);
      const t = world.require(e, Transform);
      const slot = (pool[n] ??= { x: 0, z: 0, kind: 'poi' });
      slot.x = t.position.x;
      slot.z = t.position.z;
      slot.kind = BLIP_KINDS.has(b.icon as BlipKind) ? (b.icon as BlipKind) : 'poi';
      slot.color = b.color || undefined;
      blips[n++] = slot;
    }
    blips.length = n;
    return out;
  };
}
