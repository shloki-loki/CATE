import { describe, expect, it } from 'vitest';
import {
  createDriveState,
  driveStep,
  getVehicleDef,
  makeWheelControls,
  MAX_REVERSE_SPEED,
  steerLock,
  torqueAt,
  VEHICLE_DEFS,
  wheelRpm,
} from '../../src/game';

const dt = 1 / 60;
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false };

describe('DriveController (pure)', () => {
  const def = getVehicleDef('sedan');

  it('interpolates the torque curve and clamps at the ends', () => {
    const c = def.engine.torqueCurve;
    expect(torqueAt(def, 0)).toBe(c[0]![1]);
    expect(torqueAt(def, 99_999)).toBe(c[c.length - 1]![1]);
    const [r0, t0] = c[1]!;
    const [r1, t1] = c[2]!;
    expect(torqueAt(def, (r0 + r1) / 2)).toBeCloseTo((t0 + t1) / 2, 6);
  });

  it('throttle drives only the driven wheels, forward', () => {
    const st = createDriveState(def);
    const out = makeWheelControls();
    for (let i = 0; i < 10; i++) driveStep(def, { ...idle, throttle: 1 }, 0, 4, st, dt, out);
    expect(def.drivetrain).toBe('rwd');
    expect(out[0]!.engineForce).toBe(0);
    expect(out[1]!.engineForce).toBe(0);
    expect(out[2]!.engineForce).toBeGreaterThan(1000);
    expect(out[3]!.engineForce).toBe(out[2]!.engineForce);
    expect(out.every((w) => w.brakeForce === 0)).toBe(true);

    const fwd = getVehicleDef('compact');
    const s2 = createDriveState(fwd);
    driveStep(fwd, { ...idle, throttle: 1 }, 0, 4, s2, dt, out);
    expect(out[0]!.engineForce).toBeGreaterThan(0);
    expect(out[2]!.engineForce).toBe(0);
  });

  it('shifts up with speed and down when slowing', () => {
    const st = createDriveState(def);
    const out = makeWheelControls();
    const gears: number[] = [];
    for (let v = 0; v <= 80; v += 0.25) {
      driveStep(def, { ...idle, throttle: 1 }, v, 4, st, dt, out);
      st.shiftTimer = 0; // skip the torque cut for the sweep
      gears.push(st.gear);
    }
    expect(gears[0]).toBe(1);
    expect(Math.max(...gears)).toBe(def.gearbox.ratios.length);
    for (let i = 1; i < gears.length; i++) expect(gears[i]!).toBeGreaterThanOrEqual(gears[i - 1]!);
    for (let v = 80; v >= 2; v -= 0.25) {
      driveStep(def, idle, v, 4, st, dt, out);
      st.shiftTimer = 0;
    }
    expect(st.gear).toBe(1);
  });

  it('cuts drive at the rev limiter and while shifting', () => {
    const st = createDriveState(def);
    const out = makeWheelControls();
    const top = def.gearbox.ratios.length;
    st.gear = top;
    const overRev =
      (((def.engine.redlineRpm * 1.05) / 60) * 2 * Math.PI * def.wheelRadius) /
      (def.gearbox.ratios[top - 1]! * def.gearbox.finalDrive);
    expect(wheelRpm(def, overRev, top)).toBeGreaterThan(def.engine.redlineRpm);
    driveStep(def, { ...idle, throttle: 1 }, overRev, 4, st, dt, out);
    expect(Math.abs(out[2]!.engineForce)).toBe(0);
    const s2 = createDriveState(def);
    s2.shiftTimer = 0.2;
    driveStep(def, { ...idle, throttle: 1 }, 5, 4, s2, dt, out);
    expect(out[2]!.engineForce).toBe(0);
  });

  it('brake while moving brakes all wheels (front-biased) and cuts drive', () => {
    const st = createDriveState(def);
    const out = makeWheelControls();
    driveStep(def, { ...idle, brake: 1 }, 20, 4, st, dt, out);
    expect(st.gear).toBeGreaterThan(0); // still a forward gear: no reverse while moving
    const total = out.reduce((a, w) => a + w.brakeForce, 0);
    expect(total).toBeCloseTo(def.brakes.maxForce, 0);
    expect(out[0]!.brakeForce).toBeGreaterThan(out[2]!.brakeForce);
    expect(out.every((w) => w.engineForce === 0)).toBe(true);
  });

  it('holding brake at a standstill selects reverse; throttle selects drive again', () => {
    const st = createDriveState(def);
    const out = makeWheelControls();
    driveStep(def, { ...idle, brake: 1 }, 0, 4, st, dt, out);
    expect(st.gear).toBe(-1);
    for (let i = 0; i < 10; i++) driveStep(def, { ...idle, brake: 1 }, -1, 4, st, dt, out);
    expect(out[2]!.engineForce).toBeLessThan(0);
    // Reverse is speed-limited.
    driveStep(def, { ...idle, brake: 1 }, -MAX_REVERSE_SPEED - 0.5, 4, st, dt, out);
    expect(Math.abs(out[2]!.engineForce)).toBe(0);
    // In reverse, throttle brakes the backwards motion, then selects drive.
    driveStep(def, { ...idle, throttle: 1 }, -5, 4, st, dt, out);
    expect(st.gear).toBe(-1);
    expect(out[0]!.brakeForce).toBeGreaterThan(0);
    driveStep(def, { ...idle, throttle: 1 }, -0.2, 4, st, dt, out);
    expect(st.gear).toBe(1);
  });

  it('steering is rate-limited, speed-sensitive, returns to centre and uses Ackermann geometry', () => {
    const st = createDriveState(def);
    const out = makeWheelControls();
    driveStep(def, { ...idle, steer: 1 }, 0, 4, st, dt, out);
    expect(Math.abs(st.steerAngle)).toBeCloseTo(def.steering.rate * dt, 6);
    for (let i = 0; i < 120; i++) driveStep(def, { ...idle, steer: 1 }, 0, 4, st, dt, out);
    // +steer (right) is a negative road-wheel angle (Rapier: + turns left).
    expect(st.steerAngle).toBeCloseTo(-def.steering.maxAngle, 6);
    // Turning right: the right wheel (index 1) is the inner one and turns more.
    expect(Math.abs(out[1]!.steering)).toBeGreaterThan(Math.abs(out[0]!.steering));
    expect(out[2]!.steering).toBe(0);
    expect(steerLock(def, 30)).toBeLessThan(def.steering.maxAngle / 2);
    for (let i = 0; i < 120; i++) driveStep(def, idle, 0, 4, st, dt, out);
    expect(st.steerAngle).toBe(0);
  });

  it('handbrake locks the rear, declutches it and reduces rear side grip', () => {
    const st = createDriveState(def);
    const out = makeWheelControls();
    driveStep(def, { ...idle, throttle: 1, handbrake: true }, 15, 4, st, dt, out);
    expect(out[2]!.brakeForce).toBeGreaterThan(0);
    expect(out[2]!.engineForce).toBe(0);
    expect(out[2]!.sideGrip).toBeLessThan(1);
    expect(out[0]!.sideGrip).toBe(1);
  });

  it('a wrecked vehicle has no drive; a stopped car with no input holds a parking brake', () => {
    const st = createDriveState(def);
    st.wrecked = true;
    const out = makeWheelControls();
    driveStep(def, { ...idle, throttle: 1 }, 3, 4, st, dt, out);
    expect(out.every((w) => w.engineForce === 0)).toBe(true);
    const s2 = createDriveState(def);
    driveStep(def, idle, 0, 4, s2, dt, out);
    expect(out.every((w) => w.brakeForce > 0)).toBe(true);
  });

  it('every def is complete and plausible', () => {
    for (const d of Object.values(VEHICLE_DEFS)) {
      expect(d.mass).toBeGreaterThan(500);
      expect(d.comHeight).toBeLessThan(d.height / 2);
      expect(d.gearbox.ratios.length).toBeGreaterThanOrEqual(4);
      for (let i = 1; i < d.gearbox.ratios.length; i++)
        expect(d.gearbox.ratios[i]!).toBeLessThan(d.gearbox.ratios[i - 1]!);
      expect(d.gearbox.shiftUpRpm).toBeLessThan(d.engine.redlineRpm);
      expect(d.brakes.frontBias).toBeGreaterThan(0.5);
      expect(Number.isFinite(torqueAt(d, 3000))).toBe(true);
    }
  });
});
