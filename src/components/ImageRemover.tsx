import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import './ImageRemover.css';

/*
 * Bulk listing-image preparation: cut the garment out of its background, drop it
 * on a neutral grey gradient, and add a brand logo.
 *
 * The cutout model only ever produces an alpha mask — every later step is plain
 * canvas compositing. Nothing repaints, recolours or reshapes the garment, so the
 * item stays an honest representation of what is being sold. That matters:
 * marketplaces require accurate photos, and a generative "tidy up" would breach
 * that. Any hanger or stand the model leaves in the mask is kept as-is.
 *
 * Model choice is constrained by licensing rather than quality. The popular
 * RMBG-1.4/2.0 weights are non-commercial only, and @imgly/background-removal is
 * AGPL-3.0, which would force this app's source to be published. ORMBG is
 * Apache-2.0 and, being a CNN rather than a transformer, avoids the browser
 * out-of-memory failures that BiRefNet hits at full resolution.
 */

const MODEL_ID = 'onnx-community/ormbg-ONNX';
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js';
const LOGO_STORAGE_KEY = 'imageRemover.logoDataUrl';
const LOGO_NAME_STORAGE_KEY = 'imageRemover.logoName';

/** Fraction of canvas height the logo may occupy. The brief caps this at 12%. */
const LOGO_MAX_HEIGHT_FRACTION = 0.12;
/** Clear space kept on every edge, as a fraction of canvas size. */
const EDGE_MARGIN_FRACTION = 0.06;
/** Breathing room between the logo band and the garment. */
const LOGO_GAP_FRACTION = 0.03;

type OutputFormat = 'jpeg' | 'png';

type JobStatus = 'queued' | 'processing' | 'done' | 'error';

type Job = {
  id: string;
  file: File;
  status: JobStatus;
  /** Object URL of the finished image, for preview and download. */
  resultUrl: string | null;
  resultBlob: Blob | null;
  error: string | null;
};

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

function loadTransformers(): Promise<any> {
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

function loadSegmenter(onProgress?: (msg: string) => void): Promise<any> {
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

function loadImageElement(src: string): Promise<HTMLImageElement> {
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
function rawImageToCanvas(raw: any): HTMLCanvasElement {
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

type Bounds = { left: number; top: number; width: number; height: number };

/**
 * Tightest box around non-transparent pixels, so the garment can be scaled up to
 * fill the frame instead of being padded out by the original photo's empty space.
 */
function findOpaqueBounds(canvas: HTMLCanvasElement): Bounds | null {
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

/** White spotlight on the garment; edges stay noticeably greyer. */
function drawStudioGradient(
  ctx: CanvasRenderingContext2D,
  size: number,
  focalX: number,
  focalY: number
): void {
  const gradient = ctx.createRadialGradient(
    focalX,
    focalY,
    0,
    focalX,
    focalY,
    size * 0.68
  );
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.22, '#f2f2f2');
  gradient.addColorStop(0.48, '#dcdcdc');
  gradient.addColorStop(0.78, '#c4c4c4');
  gradient.addColorStop(1, '#aeaeae');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
}

/**
 * Clean up the bottom cutout edge: white halos, shadow fringe, and narrow smudges
 * (e.g. stand remnants). Fully opaque garment pixels are never altered.
 */
function cleanCutoutBottomEdge(canvas: HTMLCanvasElement, bounds: Bounds): void {
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

type ComposeOptions = {
  size: number;
  logo: HTMLImageElement | null;
  format: OutputFormat;
};

function composeListingImage(
  cutout: HTMLCanvasElement,
  { size, logo, format }: ComposeOptions
): Promise<Blob> {
  const bounds =
    findOpaqueBounds(cutout) ?? {
      left: 0,
      top: 0,
      width: cutout.width,
      height: cutout.height,
    };
  cleanCutoutBottomEdge(cutout, bounds);

  const cleanedBounds = findOpaqueBounds(cutout) ?? bounds;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser.');

  const margin = size * EDGE_MARGIN_FRACTION;
  const logoHeight = logo && logo.naturalWidth > 0 ? size * LOGO_MAX_HEIGHT_FRACTION : 0;
  const logoWidth =
    logo && logo.naturalWidth > 0
      ? logoHeight * (logo.naturalWidth / logo.naturalHeight)
      : 0;
  const garmentTop = margin + logoHeight + (logoHeight > 0 ? size * LOGO_GAP_FRACTION : 0);

  const availableWidth = size - margin * 2;
  const availableHeight = size - garmentTop - margin;

  const scale = Math.min(
    availableWidth / cleanedBounds.width,
    availableHeight / cleanedBounds.height
  );
  const drawWidth = cleanedBounds.width * scale;
  const drawHeight = cleanedBounds.height * scale;
  const drawX = (size - drawWidth) / 2;
  const drawY = garmentTop + (availableHeight - drawHeight) / 2;

  const focalX = drawX + drawWidth / 2;
  const focalY = drawY + drawHeight * 0.42;
  drawStudioGradient(ctx, size, focalX, focalY);

  if (logo && logo.naturalWidth > 0) {
    ctx.drawImage(logo, (size - logoWidth) / 2, margin, logoWidth, logoHeight);
  }

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

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))),
      format === 'png' ? 'image/png' : 'image/jpeg',
      format === 'png' ? undefined : 0.92
    );
  });
}

function outputFileName(original: string, format: OutputFormat): string {
  const base = original.replace(/\.[^.]+$/, '') || 'listing';
  return `${base}-listing.${format === 'png' ? 'png' : 'jpg'}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const ImageRemover: React.FC = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputSize, setOutputSize] = useState(1600);
  const [format, setFormat] = useState<OutputFormat>('jpeg');
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoName, setLogoName] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  // Kept for cleanup so previews don't leak object URLs when the tab unmounts.
  const resultUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LOGO_STORAGE_KEY);
      if (saved) {
        setLogoDataUrl(saved);
        setLogoName(window.localStorage.getItem(LOGO_NAME_STORAGE_KEY));
      }
    } catch {
      // Private browsing can block storage; the logo just won't be remembered.
    }
  }, []);

  useEffect(
    () => () => {
      resultUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    []
  );

  const doneCount = useMemo(() => jobs.filter((j) => j.status === 'done').length, [jobs]);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (picked.length === 0) {
      setError('Those files are not images.');
      return;
    }
    setError(null);
    setJobs((prev) => [
      ...prev,
      ...picked.map((file, i) => ({
        id: `${Date.now()}-${i}-${file.name}`,
        file,
        status: 'queued' as JobStatus,
        resultUrl: null,
        resultBlob: null,
        error: null,
      })),
    ]);
  }, []);

  const handleLogoPick = useCallback((files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('The logo needs to be an image file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setLogoDataUrl(dataUrl);
      setLogoName(file.name);
      try {
        window.localStorage.setItem(LOGO_STORAGE_KEY, dataUrl);
        window.localStorage.setItem(LOGO_NAME_STORAGE_KEY, file.name);
      } catch {
        setStatusMessage('Logo loaded, but it was too large to remember for next time.');
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const clearLogo = useCallback(() => {
    setLogoDataUrl(null);
    setLogoName(null);
    try {
      window.localStorage.removeItem(LOGO_STORAGE_KEY);
      window.localStorage.removeItem(LOGO_NAME_STORAGE_KEY);
    } catch {
      // Nothing to do; the in-memory logo is already cleared.
    }
  }, []);

  const processQueue = useCallback(async () => {
    const pending = jobs.filter((j) => j.status === 'queued' || j.status === 'error');
    if (pending.length === 0) {
      setError('Add some photos first.');
      return;
    }

    setBusy(true);
    setError(null);
    cancelRef.current = false;

    try {
      setStatusMessage('Loading cutout model… the first run downloads it once.');
      const segmenter = await loadSegmenter(setStatusMessage);

      const logo = logoDataUrl ? await loadImageElement(logoDataUrl) : null;

      for (let i = 0; i < pending.length; i += 1) {
        if (cancelRef.current) break;
        const job = pending[i];
        setStatusMessage(`Processing ${i + 1} of ${pending.length}: ${job.file.name}`);
        setJobs((prev) =>
          prev.map((j) => (j.id === job.id ? { ...j, status: 'processing', error: null } : j))
        );

        const sourceUrl = URL.createObjectURL(job.file);
        try {
          const output = await segmenter(sourceUrl);
          const raw = Array.isArray(output) ? output[0] : output;
          const cutout = rawImageToCanvas(raw);
          const blob = await composeListingImage(cutout, { size: outputSize, logo, format });
          const resultUrl = URL.createObjectURL(blob);
          resultUrlsRef.current.push(resultUrl);
          setJobs((prev) =>
            prev.map((j) =>
              j.id === job.id ? { ...j, status: 'done', resultBlob: blob, resultUrl } : j
            )
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Processing failed.';
          setJobs((prev) =>
            prev.map((j) => (j.id === job.id ? { ...j, status: 'error', error: message } : j))
          );
        } finally {
          URL.revokeObjectURL(sourceUrl);
        }
      }

      setStatusMessage(cancelRef.current ? 'Stopped.' : 'Finished.');
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not start the cutout model: ${err.message}`
          : 'Could not start the cutout model.'
      );
      setStatusMessage(null);
    } finally {
      setBusy(false);
    }
  }, [jobs, logoDataUrl, outputSize, format]);

  const downloadAllAsZip = useCallback(async () => {
    const finished = jobs.filter((j) => j.status === 'done' && j.resultBlob);
    if (finished.length === 0) return;

    const zip = new JSZip();
    finished.forEach((job) => {
      zip.file(outputFileName(job.file.name, format), job.resultBlob as Blob);
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    triggerDownload(blob, `listing-images-${new Date().toISOString().slice(0, 10)}.zip`);
  }, [jobs, format]);

  const removeJob = useCallback((id: string) => {
    setJobs((prev) => {
      const target = prev.find((j) => j.id === id);
      if (target?.resultUrl) URL.revokeObjectURL(target.resultUrl);
      return prev.filter((j) => j.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    setJobs((prev) => {
      prev.forEach((j) => j.resultUrl && URL.revokeObjectURL(j.resultUrl));
      return [];
    });
    setStatusMessage(null);
    setError(null);
  }, []);

  return (
    <section className="image-remover" aria-label="Image Remover">
      <div className="image-remover-controls">
        <div className="image-remover-control">
          <span className="image-remover-control-label">Photos</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="image-remover-file-input"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="image-remover-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            Add photos
          </button>
        </div>

        <div className="image-remover-control">
          <span className="image-remover-control-label">Logo</span>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            className="image-remover-file-input"
            onChange={(e) => {
              handleLogoPick(e.target.files);
              e.target.value = '';
            }}
          />
          <div className="image-remover-logo-row">
            {logoDataUrl && (
              <img className="image-remover-logo-preview" src={logoDataUrl} alt="Chosen logo" />
            )}
            <button
              type="button"
              className="image-remover-button"
              onClick={() => logoInputRef.current?.click()}
              disabled={busy}
            >
              {logoDataUrl ? 'Change logo' : 'Choose logo'}
            </button>
            {logoDataUrl && (
              <button
                type="button"
                className="image-remover-button image-remover-button--quiet"
                onClick={clearLogo}
                disabled={busy}
              >
                Remove
              </button>
            )}
          </div>
          <span className="image-remover-hint">
            {logoName
              ? `${logoName} — remembered for next time. A tall, narrow logo works best.`
              : 'Optional. A tall, narrow logo works best; it is capped at 12% of image height.'}
          </span>
        </div>

        <div className="image-remover-control">
          <label className="image-remover-control-label" htmlFor="image-remover-size">
            Output size
          </label>
          <select
            id="image-remover-size"
            className="image-remover-select"
            value={outputSize}
            onChange={(e) => setOutputSize(Number(e.target.value))}
            disabled={busy}
          >
            <option value={1200}>1200 × 1200</option>
            <option value={1600}>1600 × 1600</option>
            <option value={2000}>2000 × 2000</option>
          </select>
        </div>

        <div className="image-remover-control">
          <label className="image-remover-control-label" htmlFor="image-remover-format">
            Format
          </label>
          <select
            id="image-remover-format"
            className="image-remover-select"
            value={format}
            onChange={(e) => setFormat(e.target.value as OutputFormat)}
            disabled={busy}
          >
            <option value="jpeg">JPEG (smaller)</option>
            <option value="png">PNG (lossless)</option>
          </select>
        </div>
      </div>

      <div className="image-remover-actions">
        <button
          type="button"
          className="image-remover-button image-remover-button--primary"
          onClick={() => void processQueue()}
          disabled={busy || jobs.length === 0}
        >
          {busy ? 'Processing…' : `Process ${jobs.length || ''}`.trim()}
        </button>
        {busy && (
          <button
            type="button"
            className="image-remover-button"
            onClick={() => {
              cancelRef.current = true;
            }}
          >
            Stop
          </button>
        )}
        <button
          type="button"
          className="image-remover-button"
          onClick={() => void downloadAllAsZip()}
          disabled={busy || doneCount === 0}
        >
          Download all ({doneCount})
        </button>
        <button
          type="button"
          className="image-remover-button image-remover-button--quiet"
          onClick={clearAll}
          disabled={busy || jobs.length === 0}
        >
          Clear
        </button>
      </div>

      {error && <div className="image-remover-error">{error}</div>}
      {statusMessage && <div className="image-remover-status">{statusMessage}</div>}

      {jobs.length === 0 ? (
        <p className="image-remover-empty">
          No photos yet. Add as many as you like — they are processed one at a time to keep the
          browser responsive.
        </p>
      ) : (
        <ul className="image-remover-grid">
          {jobs.map((job) => (
            <li key={job.id} className={`image-remover-card image-remover-card--${job.status}`}>
              <div className="image-remover-thumb">
                {job.resultUrl ? (
                  <img src={job.resultUrl} alt={`Processed ${job.file.name}`} />
                ) : (
                  <span className="image-remover-thumb-placeholder">
                    {job.status === 'processing' ? 'Working…' : 'Queued'}
                  </span>
                )}
              </div>
              <div className="image-remover-card-body">
                <span className="image-remover-filename" title={job.file.name}>
                  {job.file.name}
                </span>
                {job.error && <span className="image-remover-card-error">{job.error}</span>}
                <div className="image-remover-card-actions">
                  {job.resultBlob && (
                    <button
                      type="button"
                      className="image-remover-button image-remover-button--small"
                      onClick={() =>
                        triggerDownload(
                          job.resultBlob as Blob,
                          outputFileName(job.file.name, format)
                        )
                      }
                    >
                      Download
                    </button>
                  )}
                  <button
                    type="button"
                    className="image-remover-button image-remover-button--small image-remover-button--quiet"
                    onClick={() => removeJob(job.id)}
                    disabled={busy}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default ImageRemover;
