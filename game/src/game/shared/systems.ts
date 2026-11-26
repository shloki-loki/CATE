import { syncView } from '../../render';
import type { GameSystem } from '../../services';
import { PrevTransform, RigidBody, Transform, View } from '../components';

/** physics phase: advance the physics world by one fixed tick. */
export const PhysicsStepSystem: GameSystem = {
  name: 'physicsStep',
  phase: 'physics',
  update(_world, s, dt) {
    s.physics.step(dt);
  },
};

/** postSim phase: save last tick's transform, then read the new one from physics. */
export const PhysicsSyncSystem: GameSystem = {
  name: 'physicsSync',
  phase: 'postSim',
  update(world, s) {
    for (const e of world.query(RigidBody, Transform)) {
      const t = world.require(e, Transform);
      const prev = world.get(e, PrevTransform);
      if (prev) {
        prev.position.copy(t.position);
        prev.quaternion.copy(t.quaternion);
      }
      s.physics.getTransform(world.require(e, RigidBody).handle, t);
    }
  },
};

/** render phase: move each view to the interpolated transform. */
export const ViewSyncSystem: GameSystem = {
  name: 'viewSync',
  phase: 'render',
  update(world, s) {
    for (const e of world.query(View, Transform)) {
      const v = world.require(e, View).object3D;
      const t = world.require(e, Transform);
      const prev = world.get(e, PrevTransform) ?? t;
      syncView(v, prev, t, s.clock.alpha);
    }
  },
};

/** gameplay phase: advance the game clock and tell the renderer. */
export const TimeOfDaySystem: GameSystem = {
  name: 'timeOfDay',
  phase: 'gameplay',
  update(_world, s, dt) {
    s.time.advance(dt);
    s.render.setTimeOfDay(s.time.hours);
  },
};
