#!/usr/bin/env node
/**
 * Export the procedural city as a binary glTF 2.0 file and validate it (T0027).
 *
 *   npm run city:export -- [--seed 1986] [--grid 8] [--spacing 64] [--drop 0.2] [--out out/city-1986.glb]
 *
 * Loads the game's TypeScript through Vite's module runner (no extra build step), runs
 * generateCity + exportCityGlb, writes the file, then runs the Khronos glTF validator
 * and fails (exit 1) on any error. Node names follow T0018 §8: root `city`, chunks
 * `c_<x>_<z>`, buildings `b_<chunkX>_<chunkZ>_<index>`, materials `mat_*`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runnerImport } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '1986' },
    grid: { type: 'string' },
    spacing: { type: 'string' },
    drop: { type: 'string' },
    out: { type: 'string' },
  },
});
const opts = { seed: Number(values.seed) };
if (values.grid) opts.gridSize = Number(values.grid);
if (values.spacing) opts.spacing = Number(values.spacing);
if (values.drop) opts.dropChance = Number(values.drop);
const out = resolve(process.cwd(), values.out ?? `out/city-${opts.seed}.glb`);

const { module: world } = await runnerImport(resolve(root, 'src/game/world/index.ts'), {
  root,
  configFile: false,
  logLevel: 'error',
});
const t0 = performance.now();
const city = world.generateCity(opts);
const glb = await world.exportCityGlb(city);
const ms = performance.now() - t0;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, new Uint8Array(glb));

const validator = createRequire(import.meta.url)('gltf-validator');
const report = await validator.validateBytes(new Uint8Array(glb), { maxIssues: 100 });
const { numErrors, numWarnings, numInfos } = report.issues;
console.log(
  `wrote ${out}: ${glb.byteLength} bytes, seed ${city.seed}, ${city.buildings.length} buildings, ` +
    `${city.chunks.length} chunks (${city.chunks.join(' ')}), ${ms.toFixed(0)} ms`,
);
console.log(
  `glTF validator ${report.validatorVersion}: ${numErrors} errors, ${numWarnings} warnings, ${numInfos} infos`,
);
for (const m of report.issues.messages.filter((x) => x.severity <= 1))
  console.log(`  ${m.code}: ${m.message} (${m.pointer ?? ''})`);
process.exit(numErrors > 0 ? 1 : 0);
