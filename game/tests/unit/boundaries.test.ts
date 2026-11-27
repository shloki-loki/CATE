/**
 * Enforces the module-boundary rules of the architecture (T0016 §4.2) by resolving
 * every import in src/. Runs in `npm test`, so a PR that breaks a rule fails CI.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');

/** three exports that are pure maths (no scene objects); allowed anywhere except core/ restrictions. */
const THREE_MATHS = new Set([
  'Vector2',
  'Vector3',
  'Vector4',
  'Quaternion',
  'Euler',
  'Matrix3',
  'Matrix4',
  'MathUtils',
  'Box2',
  'Box3',
  'Sphere',
  'Ray',
  'Plane',
  'Line3',
  'Triangle',
  'Spherical',
  'Cylindrical',
  'Color',
]);

interface ImportRef {
  spec: string;
  typeOnly: boolean;
  names: { name: string; typeOnly: boolean }[];
}

export function parseImports(source: string): ImportRef[] {
  const out: ImportRef[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(re)) {
    const clause = m[3] ?? '';
    const names: ImportRef['names'] = [];
    const braces = clause.match(/\{([\s\S]*)\}/);
    if (braces) {
      for (const part of braces[1]!.split(',')) {
        const t = part.trim();
        if (!t) continue;
        const typeOnly = t.startsWith('type ');
        const name = t
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]!
          .trim();
        names.push({ name, typeOnly });
      }
    }
    const def = clause
      .replace(/\{[\s\S]*\}/, '')
      .replace(/,/g, ' ')
      .trim();
    if (def && def !== '*' && !def.startsWith('* as')) names.push({ name: 'default', typeOnly: false });
    if (def.startsWith('* as') || def === '*') names.push({ name: '*', typeOnly: false });
    out.push({ spec: m[4]!, typeOnly: Boolean(m[2]), names });
  }
  for (const m of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    out.push({ spec: m[1]!, typeOnly: false, names: [{ name: '*', typeOnly: false }] });
  }
  for (const m of source.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) {
    out.push({ spec: m[1]!, typeOnly: false, names: [] });
  }
  return out;
}

/** Module key: top-level folder under src/, or game/<feature> for gameplay features. */
export function moduleOf(rel: string): string {
  const parts = rel.split('/');
  if (parts.length === 1) return '(root)';
  if (parts[0] === 'game') return parts.length === 2 ? 'game' : `game/${parts[1]}`;
  return parts[0]!;
}

function isIndexOf(rel: string): boolean {
  return /(^|\/)index\.ts$/.test(rel);
}

function sceneObjectsAllowed(rel: string): boolean {
  return (
    rel.startsWith('render/') ||
    rel.startsWith('assets/') ||
    rel === 'game/world/cityMesher.ts' ||
    /View\.ts$/.test(rel)
  );
}

/**
 * Check one file. `rel` is its path relative to src/ (posix), `resolveRel` maps a
 * relative import spec to a src-relative target path (or null if it leaves src/).
 */
export function checkFile(
  rel: string,
  source: string,
  resolveRel: (spec: string) => string | null,
): string[] {
  const errors: string[] = [];
  const from = moduleOf(rel);
  for (const imp of parseImports(source)) {
    const where = `${rel}: import '${imp.spec}'`;
    if (imp.spec.startsWith('@dimforge/') && !rel.startsWith('physics/rapier/'))
      errors.push(`${where} — rule 2: only physics/rapier/ may import Rapier`);

    if (imp.spec === 'three' || imp.spec.startsWith('three/')) {
      if (!sceneObjectsAllowed(rel)) {
        if (imp.spec !== 'three' && !imp.typeOnly)
          errors.push(`${where} — rule 3: three addons only in render/, assets/, *View.ts`);
        for (const n of imp.names) {
          if (imp.typeOnly || n.typeOnly) continue;
          if (!THREE_MATHS.has(n.name))
            errors.push(
              `${where} — rule 3: '${n.name}' is a scene object; create it in render/ or a *View.ts`,
            );
        }
      }
      continue;
    }

    if (!imp.spec.startsWith('.')) {
      if (from === 'core' && !imp.typeOnly)
        errors.push(`${where} — rule 1: core/ may import only 'three' maths`);
      continue;
    }

    const target = resolveRel(imp.spec);
    if (target === null) {
      errors.push(`${where} — import leaves src/ or does not resolve`);
      continue;
    }
    if (target.endsWith('.css')) continue;
    const to = moduleOf(target);

    if (from === 'core' && to !== 'core')
      errors.push(`${where} — rule 1: core/ imports nothing outside core/`);
    if (from === 'ui' && (to === 'game' || to.startsWith('game/')))
      errors.push(`${where} — rule 4: ui/ never imports game/; read HudModel and emit events`);

    if (from !== to) {
      const sharedContract = target === 'game/components.ts' || target === 'game/events.ts';
      const fromGame = from === 'game' || from.startsWith('game/');
      if (fromGame && to.startsWith('game/') && from !== 'game' && to !== 'game/shared')
        errors.push(`${where} — rule 5: game features talk via components.ts/events.ts, not ${to}`);
      const okIndex =
        isIndexOf(target) && moduleOf(target) === to && target.split('/').length === to.split('/').length + 1;
      // src/services.ts is the Services/System contract every system needs (core/ still may not use it).
      const servicesContract = target === 'services.ts' && from !== 'core';
      if (!okIndex && !(fromGame && sharedContract) && !servicesContract)
        errors.push(`${where} — rule 7: import another module only through its index.ts (got ${target})`);
    }
  }
  return errors;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

function resolverFor(file: string): (spec: string) => string | null {
  return (spec) => {
    const base = resolve(dirname(file), spec);
    for (const c of [base, `${base}.ts`, join(base, 'index.ts')]) {
      if (existsSync(c) && statSync(c).isFile()) {
        const rel = relative(SRC, c).split(sep).join(posix.sep);
        return rel.startsWith('..') ? null : rel;
      }
    }
    return null;
  };
}

describe('module boundaries (T0016 §4.2)', () => {
  it('every file in src/ follows the rules', () => {
    const errors = walk(SRC).flatMap((f) =>
      checkFile(relative(SRC, f).split(sep).join(posix.sep), readFileSync(f, 'utf8'), resolverFor(f)),
    );
    expect(errors).toEqual([]);
  });

  it('the checker catches each kind of violation', () => {
    const r = (map: Record<string, string>) => (spec: string) => map[spec] ?? null;
    expect(
      checkFile('game/player/x.ts', "import RAPIER from '@dimforge/rapier3d-compat';", r({}))[0],
    ).toMatch(/rule 2/);
    expect(checkFile('game/player/x.ts', "import { Mesh, Vector3 } from 'three';", r({}))).toHaveLength(1);
    expect(checkFile('game/player/x.ts', "import { type Mesh, Vector3 } from 'three';", r({}))).toEqual([]);
    expect(checkFile('game/player/playerView.ts', "import { Mesh } from 'three';", r({}))).toEqual([]);
    expect(
      checkFile('core/a.ts', "import { x } from '../physics';", r({ '../physics': 'physics/index.ts' }))[0],
    ).toMatch(/rule 1/);
    expect(
      checkFile('ui/a.ts', "import { x } from '../game';", r({ '../game': 'game/index.ts' }))[0],
    ).toMatch(/rule 4/);
    expect(
      checkFile(
        'game/player/a.ts',
        "import { x } from '../vehicles';",
        r({ '../vehicles': 'game/vehicles/index.ts' }),
      )[0],
    ).toMatch(/rule 5/);
    expect(
      checkFile(
        'game/player/a.ts',
        "import { x } from '../components';",
        r({ '../components': 'game/components.ts' }),
      ),
    ).toEqual([]);
    expect(
      checkFile(
        'game/player/a.ts',
        "import { x } from '../../physics/rapier/RapierPhysics';",
        r({
          '../../physics/rapier/RapierPhysics': 'physics/rapier/RapierPhysics.ts',
        }),
      )[0],
    ).toMatch(/rule 7/);
  });
});
