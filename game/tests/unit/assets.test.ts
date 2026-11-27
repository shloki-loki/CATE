import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AssetRegistry, parseManifest } from '../../src/assets';

describe('asset manifest', () => {
  it('the shipped public/assets/manifest.json is valid', () => {
    const raw = JSON.parse(
      readFileSync(new URL('../../public/assets/manifest.json', import.meta.url), 'utf8'),
    );
    expect(() => parseManifest(raw)).not.toThrow();
  });

  it('rejects bad ids and entries', () => {
    expect(() => parseManifest({ version: 1, assets: { 'Bad Id': { url: 'x', type: 'gltf' } } })).toThrow(
      /bad id/,
    );
    expect(() => parseManifest({ version: 1, assets: { 'vehicle.a': { type: 'gltf' } } })).toThrow(/url/);
    expect(() => parseManifest({ version: 2, assets: {} })).toThrow(/version/);
  });

  it('resolves urls against the base and throws for unknown ids', async () => {
    const reg = new AssetRegistry('./', {
      version: 1,
      assets: { 'vehicle.sports01': { url: '/assets/vehicles/sports01.glb', type: 'gltf' } },
    });
    await reg.init();
    expect(reg.has('vehicle.sports01')).toBe(true);
    expect(reg.url('vehicle.sports01')).toBe('./assets/vehicles/sports01.glb');
    expect(() => reg.url('vehicle.nope')).toThrow(/unknown asset/);
  });
});
