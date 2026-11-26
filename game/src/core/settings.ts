/**
 * Player settings (T0016 §3.1): quality preset, volume, mouse sensitivity.
 * Persisted to localStorage when it exists (browser), in memory otherwise (Node tests).
 */
export type Quality = 'low' | 'medium' | 'high';

export interface SettingsData {
  quality: Quality;
  masterVolume: number;
  mouseSensitivity: number;
  invertY: boolean;
}

export const DEFAULT_SETTINGS: Readonly<SettingsData> = Object.freeze({
  quality: 'medium',
  masterVolume: 0.8,
  mouseSensitivity: 1,
  invertY: false,
});

const KEY = 'neon-coast.settings.v1';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class Settings {
  private data: SettingsData;
  private readonly listeners = new Set<(s: Readonly<SettingsData>) => void>();

  constructor(private readonly store: KeyValueStore | null = Settings.defaultStore()) {
    this.data = { ...DEFAULT_SETTINGS, ...Settings.sanitize(this.read()) };
  }

  get values(): Readonly<SettingsData> {
    return this.data;
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    const next = { ...this.data, [key]: value };
    this.data = { ...DEFAULT_SETTINGS, ...Settings.sanitize(next) };
    this.store?.setItem(KEY, JSON.stringify(this.data));
    for (const fn of this.listeners) fn(this.data);
  }

  onChange(fn: (s: Readonly<SettingsData>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private read(): unknown {
    try {
      const raw = this.store?.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {}; // corrupt or blocked storage: fall back to defaults
    }
  }

  /** Keep only valid fields, so a bad stored value can never break boot. */
  static sanitize(input: unknown): Partial<SettingsData> {
    if (typeof input !== 'object' || input === null) return {};
    const o = input as Record<string, unknown>;
    const out: Partial<SettingsData> = {};
    if (o.quality === 'low' || o.quality === 'medium' || o.quality === 'high') out.quality = o.quality;
    if (typeof o.masterVolume === 'number' && Number.isFinite(o.masterVolume))
      out.masterVolume = Math.min(1, Math.max(0, o.masterVolume));
    if (typeof o.mouseSensitivity === 'number' && Number.isFinite(o.mouseSensitivity))
      out.mouseSensitivity = Math.min(5, Math.max(0.1, o.mouseSensitivity));
    if (typeof o.invertY === 'boolean') out.invertY = o.invertY;
    return out;
  }

  private static defaultStore(): KeyValueStore | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  }
}
