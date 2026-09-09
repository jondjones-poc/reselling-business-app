/*
 * Shared client-side image pipeline for the two "listing photo" tools
 * (Listing Image Creator / ImageRemover.tsx, and Listing Image Refresh /
 * ListingImageRefresh.tsx).
 *
 * The cutout model only ever produces an alpha mask — every later step here is
 * plain canvas compositing. Nothing repaints, recolours or reshapes the subject,
 * so the item stays an honest representation of what is being sold.
 *
 * Model choice is constrained by licensing rather than quality. The popular
 * RMBG-1.4/2.0 weights are non-commercial only, and @imgly/background-removal is
 * AGPL-3.0, which would force this app's source to be published. ORMBG is
 * Apache-2.0 and, being a CNN rather than a transformer, avoids the browser
 * out-of-memory failures that BiRefNet hits at full resolution.
 */

const MODEL_ID = 'onnx-community/ormbg-ONNX';
const TRANSFORMERS_URL =
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js';

/*
 * transformers.js is loaded from a CDN at runtime rather than bundled. This app is
 * on Create React App 5 with TypeScript 4.9, which cannot process the library's
 * modern ESM and its ONNX/WASM assets without ejecting the webpack config.
 * `new Function` is what keeps webpack from rewriting the import into a bundle
 * request; a plain `import()` would be transformed even with webpackIgnore.
 */
// eslint-disable-next-line no-new-func -- the only way to reach a native dynamic import that webpack won't rewrite
const runtimeImport = new Function('url', 'return import(url)') as (
  url: string
) => Promise<any>;

let transformersPromise: Promise<any> | null = null;

export function loadTransformers(): Promise<any> {
  if (!transformersPromise) {
    transformersPromise = runtimeImport(TRANSFORMERS_URL).then((mod) => {
      // Weights come from the Hugging Face hub; there are no models served locally.
      if (mod?.env) mod.env.allowLocalModels = false;
      return mod;
    });
  }
  return transformersPromise;
}

let segmenterPromise: Promise<any> | null = null;

export function loadSegmenter(onProgress?: (msg: string) => void): Promise<any> {
  if (!segmenterPromise) {
    segmenterPromise = loadTransformers().then((mod) =>
      mod.pipeline('background-removal', MODEL_ID, {
        // WASM runs everywhere; WebGPU support is still uneven across browsers.
        device: 'wasm',
        progress_callback: (p: any) => {
          if (p?.status === 'progress' && typeof p.progress === 'number') {
            onProgress?.(`Downloading cutout model… ${Math.round(p.progress)}%`);
          } else if (p?.status === 'ready') {
            onProgress?.('Cutout model ready.');
          }
        },
      })
    );
  }
  return segmenterPromise;
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode that image.'));
    img.src = src;
  });
}

/**
 * transformers.js returns its own RawImage type. Newer builds can hand back a
 * canvas directly; older ones only expose the raw channel data.
 */
export function rawImageToCanvas(raw: any): HTMLCanvasElement {
  if (raw && typeof raw.toCanvas === 'function') {
    return raw.toCanvas();
  }

  const { data, width, height, channels } = raw ?? {};
  if (!data || !width || !height) {
    throw new Error('The cutout model returned an unreadable image.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser.');

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const s = i * channels;
    if (channels === 4) {
      rgba[i * 4] = data[s];
      rgba[i * 4 + 1] = data[s + 1];
      rgba[i * 4 + 2] = data[s + 2];
      rgba[i * 4 + 3] = data[s + 3];
    } else if (channels === 3) {
      rgba[i * 4] = data[s];
      rgba[i * 4 + 1] = data[s + 1];
      rgba[i * 4 + 2] = data[s + 2];
      rgba[i * 4 + 3] = 255;
    } else {
      // Single channel: a bare mask, so treat the value as opacity.
      rgba[i * 4] = data[s];
      rgba[i * 4 + 1] = data[s];
      rgba[i * 4 + 2] = data[s];
      rgba[i * 4 + 3] = data[s];
    }
  }
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
}

export type Bounds = { left: number; top: number; width: number; height: number };

/**
 * Tightest box around non-transparent pixels, so the item can be scaled up to
 * fill the frame instead of being padded out by the original photo's empty space.
 */
export function findOpaqueBounds(canvas: HTMLCanvasElement): Bounds | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);

  // Ignore near-transparent fringe pixels, which would otherwise inflate the box.
  const alphaFloor = 12;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > alphaFloor) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }

  if (right < 0 || bottom < 0) return null;
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** White spotlight on the item; edges stay noticeably greyer. */
export function drawStudioGradient(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  focalX: number,
  focalY: number
): void {
  const radius = Math.max(width, height) * 0.68;
  const gradient = ctx.createRadialGradient(focalX, focalY, 0, focalX, focalY, radius);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.22, '#f2f2f2');
  gradient.addColorStop(0.48, '#dcdcdc');
  gradient.addColorStop(0.78, '#c4c4c4');
  gradient.addColorStop(1, '#aeaeae');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

/**
 * Clean up the bottom cutout edge: white halos, shadow fringe, and narrow smudges
 * (e.g. stand remnants). Fully opaque item pixels are never altered.
 */
export function cleanCutoutBottomEdge(canvas: HTMLCanvasElement, bounds: Bounds): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width } = canvas;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;

  const bandTop = bounds.top + Math.floor(bounds.height * 0.86);
  const bandBottom = bounds.top + bounds.height;
  const minWideSpan = bounds.width * 0.36;
  const narrowSpan = bounds.width * 0.16;

  for (let y = bandTop; y < bandBottom; y += 1) {
    for (let x = bounds.left; x < bounds.left + bounds.width; x += 1) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3];
      if (alpha < 12 || alpha >= 245) continue;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);

      // Grey/white matte halo left by the cutout model.
      if (lum > 188 && sat < 42 && alpha < 235) {
        data[i + 3] = 0;
        continue;
      }

      // Dark shadow fringe — only when not fully opaque.
      if (lum < 78 && alpha < 210) {
        data[i + 3] = 0;
      }
    }
  }

  // Drop narrow protrusions below the main hem (stand smudges, stray pixels).
  const rowSpans: number[] = [];
  for (let y = bandTop; y < bandBottom; y += 1) {
    let left = bounds.left + bounds.width;
    let right = bounds.left;
    for (let x = bounds.left; x < bounds.left + bounds.width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 36) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    rowSpans.push(right >= left ? right - left + 1 : 0);
  }

  let hemIdx = -1;
  for (let i = rowSpans.length - 1; i >= 0; i -= 1) {
    if (rowSpans[i] >= minWideSpan) {
      hemIdx = i;
      break;
    }
  }

  if (hemIdx >= 0) {
    for (let i = hemIdx + 1; i < rowSpans.length; i += 1) {
      if (rowSpans[i] === 0) continue;
      if (rowSpans[i] >= narrowSpan) continue;
      const y = bandTop + i;
      for (let x = bounds.left; x < bounds.left + bounds.width; x += 1) {
        const alphaIdx = (y * width + x) * 4 + 3;
        if (data[alphaIdx] > 12) data[alphaIdx] = 0;
      }
    }
  }

  // Last-resort: opaque dark specks in the very bottom strip (shadow blobs).
  const smudgeTop = bounds.top + Math.floor(bounds.height * 0.975);
  for (let y = smudgeTop; y < bandBottom; y += 1) {
    let left = bounds.left + bounds.width;
    let right = bounds.left;
    for (let x = bounds.left; x < bounds.left + bounds.width; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i + 3] > 160 && 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 55) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    const darkSpan = right >= left ? right - left + 1 : 0;
    if (darkSpan > 0 && darkSpan < bounds.width * 0.12) {
      for (let x = bounds.left; x < bounds.left + bounds.width; x += 1) {
        const i = (y * width + x) * 4;
        if (data[i + 3] > 160 && 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 55) {
          data[i + 3] = 0;
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Auto brightness/exposure/contrast/white-balance: a per-channel histogram
 * stretch (clipped at the 1st/99th percentile so a few stray bright or dark
 * pixels can't skew the whole image). Only pixels above the alpha floor are
 * read or rewritten — the fully transparent background at this stage is about
 * to be discarded anyway, and including it would bias the stretch toward
 * whatever garbage colour data sits behind it.
 *
 * This never touches which pixels are opaque, only the colour of ones that
 * already are — it brightens/corrects tone, it does not repaint the item.
 */
export function autoLevels(canvas: HTMLCanvasElement, alphaFloor = 12): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const pixelCount = width * height;

  const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let sampled = 0;

  for (let i = 0; i < pixelCount; i += 1) {
    const base = i * 4;
    if (data[base + 3] <= alphaFloor) continue;
    histograms[0][data[base]] += 1;
    histograms[1][data[base + 1]] += 1;
    histograms[2][data[base + 2]] += 1;
    sampled += 1;
  }

  // Too few opaque pixels to build a reliable histogram — leave the image alone.
  if (sampled < 64) return;

  const clipFraction = 0.01;
  const clipCount = Math.max(1, Math.round(sampled * clipFraction));

  const channelRanges = histograms.map((hist) => {
    let lo = 0;
    let seen = 0;
    for (; lo < 255; lo += 1) {
      seen += hist[lo];
      if (seen > clipCount) break;
    }
    let hi = 255;
    seen = 0;
    for (; hi > 0; hi -= 1) {
      seen += hist[hi];
      if (seen > clipCount) break;
    }
    return hi > lo ? { lo, hi } : { lo: 0, hi: 255 };
  });

  for (let i = 0; i < pixelCount; i += 1) {
    const base = i * 4;
    if (data[base + 3] <= alphaFloor) continue;
    for (let c = 0; c < 3; c += 1) {
      const { lo, hi } = channelRanges[c];
      const value = data[base + c];
      const stretched = ((value - lo) * 255) / (hi - lo);
      data[base + c] = Math.max(0, Math.min(255, Math.round(stretched)));
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Rotate a source image by a small angle (a manual "straighten" control — see
 * the Listing Image Refresh plan for why this isn't auto-detected) onto a new
 * canvas sized to fit the full rotated bounding box, so no corners are clipped.
 * The corners exposed by rotation are filled white; at the small angles this
 * control is meant for, that area is tiny and far from the subject, and the
 * background-removal model treats it as background like the rest of the shot.
 */
export function rotateImageToCanvas(image: HTMLImageElement, degrees: number): HTMLCanvasElement {
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;

  if (!degrees) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(image, 0, 0, w, h);
    return canvas;
  }

  const radians = (degrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const newWidth = Math.round(w * cos + h * sin);
  const newHeight = Math.round(w * sin + h * cos);

  const canvas = document.createElement('canvas');
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, newWidth, newHeight);
  ctx.translate(newWidth / 2, newHeight / 2);
  ctx.rotate(radians);
  ctx.drawImage(image, -w / 2, -h / 2, w, h);
  return canvas;
}

export type RefreshExportFormat = 'jpeg' | 'webp';

export type RefreshComposeOptions = {
  /** Output canvas dimensions — Vinted displays listing photos in a 4:5 portrait frame. */
  width: number;
  height: number;
  format: RefreshExportFormat;
  /** Fraction of the canvas kept clear on every edge. */
  paddingFraction: number;
};

/**
 * Centre the cleaned-up cutout on the studio gradient with consistent padding,
 * at a fixed marketplace-friendly size (default a 4:5 portrait — Vinted's own
 * recommended listing-photo shape, so photos aren't cropped oddly in the
 * feed). Encodes as WebP where the browser genuinely supports encoding it,
 * falling back to JPEG otherwise (toBlob can silently hand back a PNG
 * instead of failing when a MIME type isn't supported for encoding, so the
 * actual blob type is checked rather than trusted).
 */
export async function composeRefreshedImage(
  cutout: HTMLCanvasElement,
  { width: targetWidth, height: targetHeight, format, paddingFraction }: RefreshComposeOptions
): Promise<{ blob: Blob; format: RefreshExportFormat }> {
  const bounds = findOpaqueBounds(cutout) ?? {
    left: 0,
    top: 0,
    width: cutout.width,
    height: cutout.height,
  };
  cleanCutoutBottomEdge(cutout, bounds);
  const cleanedBounds = findOpaqueBounds(cutout) ?? bounds;

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser.');

  const marginX = targetWidth * paddingFraction;
  const marginY = targetHeight * paddingFraction;
  const availableWidth = targetWidth - marginX * 2;
  const availableHeight = targetHeight - marginY * 2;
  const scale = Math.min(availableWidth / cleanedBounds.width, availableHeight / cleanedBounds.height);
  const drawWidth = cleanedBounds.width * scale;
  const drawHeight = cleanedBounds.height * scale;
  const drawX = (targetWidth - drawWidth) / 2;
  const drawY = (targetHeight - drawHeight) / 2;

  drawStudioGradient(ctx, targetWidth, targetHeight, targetWidth / 2, targetHeight * 0.42);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    cutout,
    cleanedBounds.left,
    cleanedBounds.top,
    cleanedBounds.width,
    cleanedBounds.height,
    drawX,
    drawY,
    drawWidth,
    drawHeight
  );

  const encode = (mime: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), mime, quality));

  if (format === 'webp') {
    const webpBlob = await encode('image/webp', 0.9);
    if (webpBlob && webpBlob.type === 'image/webp') {
      return { blob: webpBlob, format: 'webp' };
    }
  }

  const jpegBlob = await encode('image/jpeg', 0.92);
  if (!jpegBlob) throw new Error('Could not encode the image.');
  return { blob: jpegBlob, format: 'jpeg' };
}

/**
 * For a deliberate dark-backdrop setup: brighten only the background, using
 * the segmentation model's output purely as a mask of *which* pixels are
 * background — never as a source of colour.
 *
 * This mutates `targetCanvas` (the original, un-segmented photo — real
 * colours everywhere, guaranteed) using alpha values read from
 * `maskCanvas` (the model's own output canvas, same pixel dimensions,
 * produced by rawImageToCanvas). Nothing else in this app has ever needed
 * to read *background*-region colour data out of the model's output — every
 * existing use (findOpaqueBounds, cleanCutoutBottomEdge, the studio
 * composite) only ever samples the tight item bounding box. The model's job
 * is foreground extraction; what it leaves behind in background pixels'
 * colour channels isn't guaranteed to be the real backdrop, so reading it
 * (an earlier version of this function did exactly that) produced whatever
 * placeholder data the model happened to leave there instead of an actual
 * lightened photo. Working from the original photo's own pixels sidesteps
 * that assumption entirely.
 */
export function lightenBackground(
  targetCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  factor = 1.05,
  alphaFloor = 12
): void {
  const targetCtx = targetCanvas.getContext('2d');
  const maskCtx = maskCanvas.getContext('2d');
  if (!targetCtx || !maskCtx) return;
  const { width, height } = targetCanvas;
  const targetImageData = targetCtx.getImageData(0, 0, width, height);
  const target = targetImageData.data;
  const mask = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
  const pixelCount = width * height;

  for (let i = 0; i < pixelCount; i += 1) {
    const base = i * 4;
    if (mask[base + 3] <= alphaFloor) {
      target[base] = Math.min(255, Math.round(target[base] * factor));
      target[base + 1] = Math.min(255, Math.round(target[base + 1] * factor));
      target[base + 2] = Math.min(255, Math.round(target[base + 2] * factor));
    }
    // Never let anything, item or background, come out non-opaque — this
    // mode produces a normal flat photo, not a cutout.
    target[base + 3] = 255;
  }

  targetCtx.putImageData(targetImageData, 0, 0);
}

export type LightenComposeOptions = {
  /** Longest edge of the output — the photo is scaled down to fit, never cropped or zoomed. */
  maxDimension: number;
  format: RefreshExportFormat;
};

/**
 * Keeps the photo exactly as framed — same crop, same composition, same
 * aspect ratio — and just re-encodes it at a consistent marketplace-friendly
 * size, after lightenBackground() has already brightened the backdrop. No
 * cropping or zooming: this mode exists for sellers who already like their
 * own shot and only want the backdrop a touch brighter, not swapped or
 * recomposed. Encodes the same way as composeRefreshedImage (WebP where
 * truly supported, else JPEG).
 */
export async function composeLightenedImage(
  cutout: HTMLCanvasElement,
  { maxDimension, format }: LightenComposeOptions
): Promise<{ blob: Blob; format: RefreshExportFormat }> {
  const scale = Math.min(1, maxDimension / Math.max(cutout.width, cutout.height));
  const width = Math.max(1, Math.round(cutout.width * scale));
  const height = Math.max(1, Math.round(cutout.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cutout, 0, 0, cutout.width, cutout.height, 0, 0, width, height);

  const encode = (mime: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), mime, quality));

  if (format === 'webp') {
    const webpBlob = await encode('image/webp', 0.9);
    if (webpBlob && webpBlob.type === 'image/webp') {
      return { blob: webpBlob, format: 'webp' };
    }
  }

  const jpegBlob = await encode('image/jpeg', 0.92);
  if (!jpegBlob) throw new Error('Could not encode the image.');
  return { blob: jpegBlob, format: 'jpeg' };
}

export function refreshedFileName(original: string, format: RefreshExportFormat): string {
  const base = original.replace(/\.[^.]+$/, '') || 'listing-photo';
  const stamp = new Date().toISOString().slice(0, 10);
  return `${base}-refreshed-${stamp}.${format === 'webp' ? 'webp' : 'jpg'}`;
}

/**
 * Downscale + re-encode an image client-side before sending it to the Gemini
 * endpoints — keeps request payloads small and consistent regardless of the
 * original photo's resolution. Mirrors the resizing approach already used by
 * ScoutItemIdentify.tsx for the existing /api/gemini/identify-item call.
 */
export function toCompressedDataUrl(
  source: File | Blob,
  maxDim = 1280,
  quality = 0.75
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Canvas is unavailable in this browser.'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode that image.'));
    };
    img.src = url;
  });
}
