/**
 * Three.js WebGLRenderer needs WebGL2 (WebGL1 support was removed in r163), so
 * check before creating it and show a clear message instead of a crash.
 */
export function hasWebGL2(doc: Document = document): boolean {
  try {
    const c = doc.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
