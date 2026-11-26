/** Tiny logger: the only place that writes to the console. debug/info are dev-only. */
const dev = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

export const log = {
  debug: (...a: unknown[]): void => {
    if (dev) console.debug('[neon]', ...a);
  },
  info: (...a: unknown[]): void => {
    if (dev) console.info('[neon]', ...a);
  },
  warn: (...a: unknown[]): void => console.warn('[neon]', ...a),
  error: (...a: unknown[]): void => console.error('[neon]', ...a),
};
