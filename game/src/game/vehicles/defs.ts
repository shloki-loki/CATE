/**
 * Vehicle definitions (T0016 §3.5): plain data, so handling is tuned here and not in code.
 * All units SI: kg, m, N, N*m, rad, rpm. Chassis space: +X left, +Y up, +Z forward,
 * origin on the ground between the axles (T0016 §3.8 asset conventions).
 *
 * The models are original placeholders ("Neon Coast" content rule); no real-world
 * or third-party vehicle names or designs.
 */
export type Drivetrain = 'fwd' | 'rwd' | 'awd';
export type BodyStyle = 'compact' | 'sports' | 'sedan' | 'van' | 'police';

export interface VehicleDef {
  id: string;
  name: string;
  style: BodyStyle;
  color: number;
  mass: number;
  /** Outer body size, used for the collider and the placeholder model. */
  length: number;
  width: number;
  height: number;
  /** Gap between the ground and the bottom of the body at rest. */
  groundClearance: number;
  /** Height of the centre of mass above the ground. Lower = harder to roll over. */
  comHeight: number;
  wheelbase: number;
  track: number;
  wheelRadius: number;
  wheelWidth: number;
  suspension: {
    restLength: number;
    maxTravel: number;
    /** Mass-scaled spring rate (Bullet/Rapier convention); static sag is about g / (4 * stiffness). */
    stiffness: number;
    compression: number;
    relaxation: number;
    maxForce: number;
  };
  tyres: {
    /**
     * Tyre friction (Rapier frictionSlip). It caps the combined tyre impulse, so it sets
     * both braking/traction and cornering grip: about 0.8 x grip in g when cornering.
     */
    grip: number;
    /** Lateral grip relative to longitudinal, front and rear (rear < front gives understeer). */
    sideFront: number;
    sideRear: number;
    /** Rear lateral grip multiplier while the handbrake is held (lets the tail slide). */
    handbrakeSideGrip: number;
  };
  engine: {
    idleRpm: number;
    redlineRpm: number;
    /** [rpm, torque N*m] points, linearly interpolated. */
    torqueCurve: [number, number][];
    /** Engine braking torque at redline with the throttle closed (N*m). */
    engineBrakeTorque: number;
  };
  gearbox: {
    ratios: number[];
    reverse: number;
    finalDrive: number;
    efficiency: number;
    shiftUpRpm: number;
    shiftDownRpm: number;
    /** Seconds without drive while changing gear. */
    shiftTime: number;
  };
  drivetrain: Drivetrain;
  brakes: {
    /** Total brake force at full pedal (N), split front/rear by frontBias. */
    maxForce: number;
    frontBias: number;
    /** Rear-only handbrake force (N). */
    handbrakeForce: number;
  };
  steering: {
    /** Max road-wheel angle at standstill (rad). */
    maxAngle: number;
    /** Speed (m/s) at which the steering lock is halved. */
    halfLockSpeed: number;
    /** How fast the wheels turn towards the input (rad/s) and back to centre. */
    rate: number;
    returnRate: number;
  };
  aero: {
    /** Drag coefficient times frontal area (m^2). */
    dragArea: number;
    rollingResistance: number;
  };
  /** Collision impulse (N*s) per tick that a hit must exceed before it causes damage. */
  damageThreshold: number;
  maxHealth: number;
}

const base = {
  suspension: {
    restLength: 0.32,
    maxTravel: 0.22,
    stiffness: 38,
    compression: 3.4,
    relaxation: 4.2,
    maxForce: 60_000,
  },
  tyres: { grip: 1.1, sideFront: 1.0, sideRear: 0.97, handbrakeSideGrip: 0.35 },
  damageThreshold: 450,
  maxHealth: 1000,
} as const;

export const VEHICLE_DEFS: Record<string, VehicleDef> = {
  compact: {
    id: 'compact',
    name: 'Sol Compact',
    style: 'compact',
    color: 0x3fb7c9,
    mass: 1050,
    length: 3.9,
    width: 1.7,
    height: 1.45,
    groundClearance: 0.2,
    comHeight: 0.42,
    wheelbase: 2.45,
    track: 1.46,
    wheelRadius: 0.3,
    wheelWidth: 0.2,
    suspension: { ...base.suspension },
    tyres: { ...base.tyres, grip: 1.05 },
    engine: {
      idleRpm: 850,
      redlineRpm: 6500,
      torqueCurve: [
        [800, 95],
        [2000, 125],
        [4200, 150],
        [5600, 140],
        [6500, 118],
      ],
      engineBrakeTorque: 35,
    },
    gearbox: {
      ratios: [3.45, 1.95, 1.32, 1.0, 0.8],
      reverse: 3.2,
      finalDrive: 4.05,
      efficiency: 0.86,
      shiftUpRpm: 6100,
      shiftDownRpm: 2300,
      shiftTime: 0.25,
    },
    drivetrain: 'fwd',
    brakes: { maxForce: 11_500, frontBias: 0.68, handbrakeForce: 5_000 },
    steering: { maxAngle: 0.6, halfLockSpeed: 22, rate: 2.4, returnRate: 3.6 },
    aero: { dragArea: 0.68, rollingResistance: 0.013 },
    damageThreshold: base.damageThreshold,
    maxHealth: base.maxHealth,
  },
  sports: {
    id: 'sports',
    name: 'Vela GT',
    style: 'sports',
    color: 0xe0245e,
    mass: 1350,
    length: 4.4,
    width: 1.9,
    height: 1.2,
    groundClearance: 0.15,
    comHeight: 0.38,
    wheelbase: 2.6,
    track: 1.6,
    wheelRadius: 0.33,
    wheelWidth: 0.26,
    suspension: { ...base.suspension, restLength: 0.28, stiffness: 48, compression: 4.0, relaxation: 4.8 },
    tyres: { ...base.tyres, grip: 1.25 },
    engine: {
      idleRpm: 950,
      redlineRpm: 7500,
      torqueCurve: [
        [900, 220],
        [2500, 360],
        [5000, 450],
        [6800, 410],
        [7500, 360],
      ],
      engineBrakeTorque: 70,
    },
    gearbox: {
      ratios: [3.1, 2.1, 1.55, 1.2, 0.97, 0.8],
      reverse: 3.0,
      finalDrive: 3.4,
      efficiency: 0.86,
      shiftUpRpm: 7100,
      shiftDownRpm: 3200,
      shiftTime: 0.18,
    },
    drivetrain: 'rwd',
    brakes: { maxForce: 17_000, frontBias: 0.62, handbrakeForce: 6_500 },
    steering: { maxAngle: 0.55, halfLockSpeed: 26, rate: 2.8, returnRate: 4.2 },
    aero: { dragArea: 0.7, rollingResistance: 0.012 },
    damageThreshold: base.damageThreshold,
    maxHealth: base.maxHealth,
  },
  sedan: {
    id: 'sedan',
    name: 'Marlin Sedan',
    style: 'sedan',
    color: 0xf2e2b6,
    mass: 1450,
    length: 4.8,
    width: 1.85,
    height: 1.45,
    groundClearance: 0.2,
    comHeight: 0.45,
    wheelbase: 2.8,
    track: 1.56,
    wheelRadius: 0.32,
    wheelWidth: 0.22,
    suspension: { ...base.suspension, stiffness: 34, compression: 3.2, relaxation: 3.9 },
    tyres: { ...base.tyres, grip: 1.1 },
    engine: {
      idleRpm: 800,
      redlineRpm: 6200,
      torqueCurve: [
        [800, 160],
        [2000, 230],
        [4000, 260],
        [5400, 240],
        [6200, 205],
      ],
      engineBrakeTorque: 50,
    },
    gearbox: {
      ratios: [3.6, 2.1, 1.4, 1.0, 0.75],
      reverse: 3.3,
      finalDrive: 3.6,
      efficiency: 0.85,
      shiftUpRpm: 5800,
      shiftDownRpm: 2200,
      shiftTime: 0.3,
    },
    drivetrain: 'rwd',
    brakes: { maxForce: 14_500, frontBias: 0.66, handbrakeForce: 6_000 },
    steering: { maxAngle: 0.58, halfLockSpeed: 22, rate: 2.2, returnRate: 3.4 },
    aero: { dragArea: 0.72, rollingResistance: 0.013 },
    damageThreshold: base.damageThreshold,
    maxHealth: base.maxHealth,
  },
  van: {
    id: 'van',
    name: 'Pelican Van',
    style: 'van',
    color: 0xf7f7f2,
    mass: 2100,
    length: 5.0,
    width: 2.0,
    height: 2.2,
    groundClearance: 0.24,
    comHeight: 0.62,
    wheelbase: 3.0,
    track: 1.72,
    wheelRadius: 0.35,
    wheelWidth: 0.22,
    suspension: { ...base.suspension, restLength: 0.34, stiffness: 32, compression: 3.4, relaxation: 4.0 },
    tyres: { ...base.tyres, grip: 1.0, sideRear: 1.0 },
    engine: {
      idleRpm: 750,
      redlineRpm: 5000,
      torqueCurve: [
        [750, 200],
        [1800, 280],
        [3000, 300],
        [4200, 270],
        [5000, 230],
      ],
      engineBrakeTorque: 60,
    },
    gearbox: {
      ratios: [4.0, 2.3, 1.5, 1.0, 0.8],
      reverse: 3.8,
      finalDrive: 3.9,
      efficiency: 0.84,
      shiftUpRpm: 4600,
      shiftDownRpm: 1800,
      shiftTime: 0.35,
    },
    drivetrain: 'rwd',
    brakes: { maxForce: 19_000, frontBias: 0.62, handbrakeForce: 8_000 },
    steering: { maxAngle: 0.56, halfLockSpeed: 18, rate: 1.9, returnRate: 3.0 },
    aero: { dragArea: 1.25, rollingResistance: 0.015 },
    damageThreshold: 650,
    maxHealth: 1300,
  },
  police: {
    id: 'police',
    name: 'Coast Patrol',
    style: 'police',
    color: 0x1b2440,
    mass: 1550,
    length: 4.9,
    width: 1.88,
    height: 1.5,
    groundClearance: 0.2,
    comHeight: 0.45,
    wheelbase: 2.85,
    track: 1.58,
    wheelRadius: 0.33,
    wheelWidth: 0.23,
    suspension: { ...base.suspension, stiffness: 40, compression: 3.6, relaxation: 4.4 },
    tyres: { ...base.tyres, grip: 1.2 },
    engine: {
      idleRpm: 800,
      redlineRpm: 6300,
      torqueCurve: [
        [800, 220],
        [2200, 320],
        [4200, 350],
        [5600, 320],
        [6300, 280],
      ],
      engineBrakeTorque: 60,
    },
    gearbox: {
      ratios: [3.4, 2.1, 1.45, 1.05, 0.8],
      reverse: 3.2,
      finalDrive: 3.5,
      efficiency: 0.85,
      shiftUpRpm: 5900,
      shiftDownRpm: 2400,
      shiftTime: 0.25,
    },
    drivetrain: 'rwd',
    brakes: { maxForce: 16_500, frontBias: 0.64, handbrakeForce: 6_500 },
    steering: { maxAngle: 0.57, halfLockSpeed: 24, rate: 2.5, returnRate: 3.8 },
    aero: { dragArea: 0.74, rollingResistance: 0.013 },
    damageThreshold: 550,
    maxHealth: 1200,
  },
};

export function getVehicleDef(id: string): VehicleDef {
  const d = VEHICLE_DEFS[id];
  if (!d) throw new Error(`unknown vehicle def '${id}'`);
  return d;
}

/** Wheel order used everywhere: front-left, front-right, rear-left, rear-right. */
export const WHEEL_NAMES = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'] as const;

export function isFront(i: number): boolean {
  return i < 2;
}
export function isLeft(i: number): boolean {
  return i % 2 === 0;
}
export function isDriven(def: VehicleDef, i: number): boolean {
  return def.drivetrain === 'awd' || (def.drivetrain === 'fwd') === isFront(i);
}

/** Static suspension sag (m) under the car's own weight: g / (4 * stiffness) for 4 wheels. */
export function staticSag(def: VehicleDef): number {
  return 9.81 / (4 * def.suspension.stiffness);
}

/**
 * Chassis-space suspension mount point of wheel i (+X left, +Z forward). Placed so that
 * at rest (sagged) the wheel centres are at wheelRadius and the origin is on the ground.
 */
export function wheelConnection(def: VehicleDef, i: number): { x: number; y: number; z: number } {
  return {
    x: (isLeft(i) ? 1 : -1) * (def.track / 2),
    y: def.wheelRadius + def.suspension.restLength - staticSag(def),
    z: (isFront(i) ? 1 : -1) * (def.wheelbase / 2),
  };
}
