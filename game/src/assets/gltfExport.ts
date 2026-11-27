import type { Object3D } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

/**
 * Binary glTF 2.0 (`.glb`) export for code-built geometry (T0018 §5.5 step 3).
 * Works in the browser and in Node: GLTFExporter's binary path needs FileReader, which
 * Node does not have, so a minimal shim built on Blob.arrayBuffer() is installed only
 * when FileReader is missing (the T0018 §5.1 / §9 approach).
 */
export function ensureFileReader(): void {
  const g = globalThis as { FileReader?: unknown };
  if (typeof g.FileReader !== 'undefined') return;
  class BlobReader {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob): void {
      void blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
    readAsDataURL(blob: Blob): void {
      void blob.arrayBuffer().then((buf) => {
        let bin = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000)
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
        this.onloadend?.();
      });
    }
  }
  g.FileReader = BlobReader;
}

/** Exports `root` (and its children) as one `.glb`. `userData` becomes node `extras`. */
export async function exportGlb(root: Object3D): Promise<ArrayBuffer> {
  ensureFileReader();
  const out = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
  if (!(out instanceof ArrayBuffer)) throw new Error('exportGlb: exporter did not return binary data');
  return out;
}
