import type { AssetAPI, AssetManifest } from './AssetAPI';

const ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9_]+)+$/;

/** Validate a manifest object (from JSON). Throws with a precise message on the first problem. */
export function parseManifest(data: unknown): AssetManifest {
  if (typeof data !== 'object' || data === null) throw new Error('manifest: not an object');
  const m = data as Record<string, unknown>;
  if (m.version !== 1) throw new Error(`manifest: unsupported version ${String(m.version)}`);
  if (typeof m.assets !== 'object' || m.assets === null) throw new Error('manifest: "assets" missing');
  for (const [id, e] of Object.entries(m.assets as Record<string, unknown>)) {
    if (!ID_PATTERN.test(id))
      throw new Error(`manifest: bad id "${id}" (want lowercase dotted, e.g. vehicle.sports01)`);
    const entry = e as Record<string, unknown> | null;
    if (!entry || typeof entry.url !== 'string' || typeof entry.type !== 'string')
      throw new Error(`manifest: entry "${id}" needs url and type`);
  }
  return data as AssetManifest;
}

/** Registry backed by public/assets/manifest.json (or an in-memory manifest in tests). */
export class AssetRegistry implements AssetAPI {
  private manifest: AssetManifest = { version: 1, assets: {} };

  constructor(
    private readonly baseUrl: string,
    private readonly source: AssetManifest | null = null,
  ) {}

  async init(): Promise<void> {
    if (this.source) {
      this.manifest = parseManifest(this.source);
      return;
    }
    const res = await fetch(`${this.baseUrl}assets/manifest.json`);
    if (!res.ok) throw new Error(`asset manifest: HTTP ${res.status}`);
    this.manifest = parseManifest(await res.json());
  }

  has(id: string): boolean {
    return id in this.manifest.assets;
  }

  url(id: string): string {
    const e = this.manifest.assets[id];
    if (!e) throw new Error(`unknown asset id "${id}"`);
    return /^(https?:)?\/\//.test(e.url) ? e.url : `${this.baseUrl}${e.url.replace(/^\//, '')}`;
  }

  ids(): string[] {
    return Object.keys(this.manifest.assets);
  }
}
