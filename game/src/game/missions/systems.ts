import type { Object3D } from 'three';
import type { Entity } from '../../core';
import type { GameSystem } from '../../services';
import { MissionStatus, type MissionStatusData } from '../components';
import { findPlayer } from '../shared';
import { CheckpointRun, type CheckpointRunDef, WARMUP_LAP } from './checkpointRun';
import { checkpointMarkerView } from './markerView';

/**
 * gameplay: runs a CheckpointRun for the car the player drives, keeps a MissionStatus entity up to
 * date for the HUD, emits mission events and moves the checkpoint beacon.
 */
export function CheckpointRunSystem(def: CheckpointRunDef = WARMUP_LAP): GameSystem {
  const run = new CheckpointRun(def);
  let statusEntity: Entity | null = null;
  let marker: Object3D | null = null;
  let markerShown = false;
  return {
    name: `mission.${def.id}`,
    phase: 'gameplay',
    init(world, s) {
      statusEntity = world.createEntity();
      world.add(statusEntity, MissionStatus, toStatus(run));
      marker = checkpointMarkerView(def.radius);
      marker.visible = false;
      s.render.addToWorld(marker, 'dynamic');
    },
    update(world, s, dt) {
      // A driving lap: it follows the car the player drives and ignores them on foot.
      const p = findPlayer(world);
      const pos = p?.inVehicle ? { x: p.transform.position.x, z: p.transform.position.z } : null;
      for (const ev of run.update(dt, pos)) {
        if (ev.kind === 'started') s.events.emit('missionStarted', { id: def.id });
        else if (ev.kind === 'step')
          s.events.emit('missionStep', { id: def.id, step: ev.step, steps: ev.steps });
        else s.events.emit('missionPassed', { id: def.id, time: ev.time, best: ev.best });
      }
      if (statusEntity !== null && world.isAlive(statusEntity)) {
        Object.assign(world.require(statusEntity, MissionStatus), toStatus(run));
      }
      if (marker) {
        const t = run.target;
        if (t) marker.position.set(t.x, 0, t.z);
        if (Boolean(t) !== markerShown) marker.visible = markerShown = Boolean(t);
      }
    },
  };
}

function toStatus(run: CheckpointRun): MissionStatusData {
  return {
    id: run.def.id,
    revision: run.revision,
    title: run.def.title,
    objective: run.objective,
    step: Math.min(run.index + 1, run.steps),
    steps: run.steps,
    target: run.target,
    elapsed: run.elapsed,
    banner: run.banner,
  };
}
