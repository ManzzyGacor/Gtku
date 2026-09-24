/**
 * Bridge from the pure `Pixmap` art pipeline to Three.js textures.
 *
 * Colour management is switched **off** for the whole renderer: the palette in `src/art/palette.ts`
 * is hand-picked, and we want those exact bytes on screen rather than an sRGB round-trip
 * (docs/OVERHAUL.md §3). Everything is nearest-filtered with no mipmaps, which is what keeps the
 * pixels hard-edged.
 */
import * as THREE from 'three';
import type { Pixmap } from '../art/pixmap';

export interface PixmapTextureOpts {
  /**
   * Flip the rows while uploading. Needed for ground planes: `Pixmap` row 0 is north, while a
   * plane rotated flat has v = 1 at north. We flip the bytes instead of relying on `flipY`, which
   * is not applied to data textures on every driver.
   */
  flipRows?: boolean;
  /** Tile the texture instead of clamping (needed when the shader scales UVs per instance). */
  tile?: boolean;
  /**
   * Filter smoothly instead of nearest. Only for data that is *lighting* rather than art —
   * a baked light pool should be soft; a texel-sharp pool would look like a stencil.
   */
  smooth?: boolean;
}

export function pixmapTexture(pm: Pixmap, opts: PixmapTextureOpts = {}): THREE.DataTexture {
  const src = pm.data;
  let data: Uint8Array;
  if (opts.flipRows) {
    data = new Uint8Array(src.length);
    const stride = pm.w * 4;
    for (let y = 0; y < pm.h; y++) {
      const from = (pm.h - 1 - y) * stride;
      data.set(src.subarray(from, from + stride), y * stride);
    }
  } else {
    data = new Uint8Array(src);
  }
  const tex = new THREE.DataTexture(data, pm.w, pm.h, THREE.RGBAFormat, THREE.UnsignedByteType);
  const filter = opts.smooth ? THREE.LinearFilter : THREE.NearestFilter;
  tex.magFilter = filter;
  tex.minFilter = filter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  if (opts.tile) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.needsUpdate = true;
  return tex;
}
