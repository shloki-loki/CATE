/**
 * Asset registry contract (T0016 §3.9). Code asks for assets by id
 * (`assets.url('vehicle.sports01')`), never by raw path. T0018 finalises the
 * manifest schema and adds the glTF/KTX2 loader with reference counting.
 */
export type AssetType = 'gltf' | 'texture' | 'audio' | 'json';

export interface AssetEntry {
  url: string;
  type: AssetType;
  bytes?: number;
  lodLevels?: number;
}

export interface AssetManifest {
  version: 1;
  assets: Record<string, AssetEntry>;
}

export interface AssetAPI {
  /** Load the manifest. Safe to call when it lists no assets. */
  init(): Promise<void>;
  has(id: string): boolean;
  /** Resolved URL for an asset id. Throws for unknown ids so typos fail loudly. */
  url(id: string): string;
  ids(): string[];
}
