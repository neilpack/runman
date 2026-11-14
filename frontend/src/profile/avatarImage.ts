// Turns a picked image into a small square avatar that fits in one Cognito attribute (≤ 2000 chars).
// Browser-only (canvas). A full-size picture would need S3, which needs an identity pool we don't have yet.

import { AVATAR_MAX_CHARS } from './profileModel';

export const AVATAR_INPUT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_INPUT_BYTES = 10_000_000;

/** zoom ≥ 1 crops tighter; panX/panY in [-1, 1] move the crop within the image. */
export interface AvatarCrop {
  zoom: number;
  panX: number;
  panY: number;
}

export const DEFAULT_CROP: AvatarCrop = { zoom: 1, panX: 0, panY: 0 };

export async function readAvatarFile(file: File): Promise<ImageBitmap> {
  if (!AVATAR_INPUT_TYPES.includes(file.type)) throw new Error('Choose a PNG, JPEG, WebP or GIF image.');
  if (file.size > MAX_INPUT_BYTES) throw new Error('Choose an image smaller than 10 MB.');
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error('That image could not be read. Try another file.');
  }
}

/** Draws the cropped square of `image` onto a new canvas of `size` px. */
export function drawAvatar(image: ImageBitmap, crop: AvatarCrop, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser cannot edit images.');
  const side = Math.min(image.width, image.height) / Math.max(1, crop.zoom);
  const sx = (image.width - side) / 2 + (crop.panX * (image.width - side)) / 2;
  const sy = (image.height - side) / 2 + (crop.panY * (image.height - side)) / 2;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff'; // flatten transparency so JPEG output doesn't go black
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(image, sx, sy, side, side, 0, 0, size, size);
  return canvas;
}

/** Largest/best-quality encoding that fits the attribute limit. */
export function encodeAvatar(image: ImageBitmap, crop: AvatarCrop): string {
  for (const size of [96, 80, 64, 56, 48, 40, 32]) {
    const canvas = drawAvatar(image, crop, size);
    for (const quality of [0.82, 0.7, 0.58, 0.46, 0.34]) {
      for (const type of ['image/webp', 'image/jpeg']) {
        const url = canvas.toDataURL(type, quality);
        // Browsers that can't encode WebP silently return PNG; skip those and try JPEG.
        if (url.startsWith(`data:${type};`) && url.length <= AVATAR_MAX_CHARS) return url;
      }
    }
  }
  throw new Error('That image is too detailed to fit. Try zooming in or a simpler picture.');
}
