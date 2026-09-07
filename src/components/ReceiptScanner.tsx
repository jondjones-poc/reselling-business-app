import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DatePicker from 'react-datepicker';
import { jsPDF } from 'jspdf';
import 'react-datepicker/dist/react-datepicker.css';
import '../react-datepicker-dark.css';
import './ReceiptScanner.css';

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ReceiptItem = {
  id: string;
  file: File;
  objectUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  crop: CropRect;
  greyscale: boolean;
};

type DragMode =
  | 'move'
  | 'nw'
  | 'ne'
  | 'sw'
  | 'se'
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | null;

type ReceiptDocType = 'charity' | 'postage';

const MIN_CROP_PX = 24;

function isMobileUploadDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const narrow = window.matchMedia('(max-width: 800px)').matches;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  return coarse || narrow || mobileUa;
}

function formatReceiptDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${dd}-${mm}-${yyyy}`;
}

function buildDownloadBaseName(docType: ReceiptDocType, date: Date | null): string | null {
  if (!date) return null;
  const label = docType === 'postage' ? 'Postage' : 'Charity Shop';
  return `${label} - ${formatReceiptDate(date)}`;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode that image.'));
    img.src = src;
  });
}

function defaultCrop(width: number, height: number): CropRect {
  const insetX = Math.round(width * 0.08);
  const insetY = Math.round(height * 0.08);
  return {
    x: insetX,
    y: insetY,
    width: Math.max(MIN_CROP_PX, width - insetX * 2),
    height: Math.max(MIN_CROP_PX, height - insetY * 2),
  };
}

function clampCrop(crop: CropRect, imageWidth: number, imageHeight: number): CropRect {
  let { x, y, width, height } = crop;
  width = Math.max(MIN_CROP_PX, Math.min(width, imageWidth));
  height = Math.max(MIN_CROP_PX, Math.min(height, imageHeight));
  x = Math.max(0, Math.min(x, imageWidth - width));
  y = Math.max(0, Math.min(y, imageHeight - height));
  return { x, y, width, height };
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

async function renderCroppedCanvas(
  item: ReceiptItem,
  forceGreyscale?: boolean
): Promise<HTMLCanvasElement> {
  const img = await loadImageElement(item.objectUrl);
  const crop = clampCrop(item.crop, item.naturalWidth, item.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.width));
  canvas.height = Math.max(1, Math.round(crop.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser.');

  ctx.drawImage(
    img,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const useGrey = forceGreyscale ?? item.greyscale;
  if (useGrey) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = imageData;
    for (let i = 0; i < data.length; i += 4) {
      const grey = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      data[i] = grey;
      data[i + 1] = grey;
      data[i + 2] = grey;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  return canvas;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode PNG.'))),
      'image/png'
    );
  });
}

const HANDLE_MODES: Exclude<DragMode, 'move' | null>[] = [
  'nw',
  'ne',
  'sw',
  'se',
  'n',
  's',
  'e',
  'w',
];

const ReceiptScanner: React.FC = () => {
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receiptDate, setReceiptDate] = useState<Date | null>(null);
  const [docType, setDocType] = useState<ReceiptDocType>('charity');
  const [dragActive, setDragActive] = useState(false);
  const [showCameraOption, setShowCameraOption] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    origin: CropRect;
    scaleX: number;
    scaleY: number;
  } | null>(null);

  const activeItem = useMemo(
    () => items.find((item) => item.id === activeId) ?? null,
    [items, activeId]
  );

  useEffect(() => {
    setShowCameraOption(isMobileUploadDevice());
    const coarse = window.matchMedia('(pointer: coarse)');
    const narrow = window.matchMedia('(max-width: 800px)');
    const sync = () => setShowCameraOption(isMobileUploadDevice());
    coarse.addEventListener('change', sync);
    narrow.addEventListener('change', sync);
    return () => {
      coarse.removeEventListener('change', sync);
      narrow.removeEventListener('change', sync);
    };
  }, []);

  useEffect(
    () => () => {
      items.forEach((item) => URL.revokeObjectURL(item.objectUrl));
    },
    // Only revoke on unmount; live replaces revoke individually.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const getDisplayScale = useCallback(() => {
    const imgEl = imageRef.current;
    if (!imgEl || !imgEl.naturalWidth || !imgEl.naturalHeight) {
      return { scaleX: 1, scaleY: 1 };
    }
    return {
      scaleX: imgEl.clientWidth / imgEl.naturalWidth,
      scaleY: imgEl.clientHeight / imgEl.naturalHeight,
    };
  }, []);

  const updateActiveCrop = useCallback((next: CropRect) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === activeId
          ? {
              ...item,
              crop: clampCrop(next, item.naturalWidth, item.naturalHeight),
            }
          : item
      )
    );
  }, [activeId]);

  const addFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files || (Array.isArray(files) ? files.length === 0 : files.length === 0)) return;
    const list = Array.isArray(files) ? files : Array.from(files);
    const picked = list.filter((f) => f.type.startsWith('image/'));
    if (picked.length === 0) {
      setError('Those files are not images.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const created: ReceiptItem[] = [];
      for (let i = 0; i < picked.length; i += 1) {
        const file = picked[i];
        const objectUrl = URL.createObjectURL(file);
        try {
          const img = await loadImageElement(objectUrl);
          created.push({
            id: `${Date.now()}-${i}-${file.name}`,
            file,
            objectUrl,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            crop: defaultCrop(img.naturalWidth, img.naturalHeight),
            greyscale: true,
          });
        } catch {
          URL.revokeObjectURL(objectUrl);
          setError(`Could not open ${file.name}.`);
        }
      }
      if (created.length > 0) {
        setItems((prev) => [...prev, ...created]);
        setActiveId((prev) => prev ?? created[0].id);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const onDropZoneDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    if (event.dataTransfer.types.includes('Files')) {
      setDragActive(true);
    }
  }, []);

  const onDropZoneDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }, []);

  const onDropZoneDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDropZoneDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setDragActive(false);
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) void addFiles(files);
    },
    [addFiles]
  );

  const removeItem = useCallback(
    (id: string) => {
      setItems((prev) => {
        const target = prev.find((item) => item.id === id);
        if (target) URL.revokeObjectURL(target.objectUrl);
        const next = prev.filter((item) => item.id !== id);
        setActiveId((current) => {
          if (current !== id) return current;
          return next[0]?.id ?? null;
        });
        return next;
      });
    },
    []
  );

  const clearAll = useCallback(() => {
    setItems((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.objectUrl));
      return [];
    });
    setActiveId(null);
    setError(null);
  }, []);

  const toggleGreyscale = useCallback(() => {
    if (!activeId) return;
    setItems((prev) =>
      prev.map((item) =>
        item.id === activeId ? { ...item, greyscale: !item.greyscale } : item
      )
    );
  }, [activeId]);

  const resetCrop = useCallback(() => {
    if (!activeItem) return;
    updateActiveCrop(defaultCrop(activeItem.naturalWidth, activeItem.naturalHeight));
  }, [activeItem, updateActiveCrop]);

  const onPointerDown = useCallback(
    (mode: DragMode, event: React.PointerEvent) => {
      if (!activeItem || !mode) return;
      event.preventDefault();
      event.stopPropagation();
      const { scaleX, scaleY } = getDisplayScale();
      dragRef.current = {
        mode,
        startX: event.clientX,
        startY: event.clientY,
        origin: { ...activeItem.crop },
        scaleX,
        scaleY,
      };
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    },
    [activeItem, getDisplayScale]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || !activeItem) return;
      event.preventDefault();

      const dx = (event.clientX - drag.startX) / drag.scaleX;
      const dy = (event.clientY - drag.startY) / drag.scaleY;
      const o = drag.origin;
      let next: CropRect = { ...o };

      if (drag.mode === 'move') {
        next = { ...o, x: o.x + dx, y: o.y + dy };
      } else if (drag.mode === 'nw') {
        next = {
          x: o.x + dx,
          y: o.y + dy,
          width: o.width - dx,
          height: o.height - dy,
        };
      } else if (drag.mode === 'ne') {
        next = {
          x: o.x,
          y: o.y + dy,
          width: o.width + dx,
          height: o.height - dy,
        };
      } else if (drag.mode === 'sw') {
        next = {
          x: o.x + dx,
          y: o.y,
          width: o.width - dx,
          height: o.height + dy,
        };
      } else if (drag.mode === 'se') {
        next = {
          x: o.x,
          y: o.y,
          width: o.width + dx,
          height: o.height + dy,
        };
      } else if (drag.mode === 'n') {
        next = { ...o, y: o.y + dy, height: o.height - dy };
      } else if (drag.mode === 's') {
        next = { ...o, height: o.height + dy };
      } else if (drag.mode === 'w') {
        next = { ...o, x: o.x + dx, width: o.width - dx };
      } else if (drag.mode === 'e') {
        next = { ...o, width: o.width + dx };
      }

      updateActiveCrop(next);
    },
    [activeItem, updateActiveCrop]
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const downloadBaseName = useMemo(
    () => buildDownloadBaseName(docType, receiptDate),
    [docType, receiptDate]
  );

  const requireReceiptDate = useCallback((): string | null => {
    if (!downloadBaseName) {
      setError('Choose a date before downloading.');
      return null;
    }
    setError(null);
    return downloadBaseName;
  }, [downloadBaseName]);

  const downloadActivePng = useCallback(async () => {
    if (!activeItem) return;
    const baseName = requireReceiptDate();
    if (!baseName) return;
    setBusy(true);
    setError(null);
    try {
      const canvas = await renderCroppedCanvas(activeItem);
      const blob = await canvasToPngBlob(canvas);
      triggerDownload(blob, `${baseName}.png`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download PNG.');
    } finally {
      setBusy(false);
    }
  }, [activeItem, requireReceiptDate]);

  const downloadAllPdf = useCallback(async () => {
    if (items.length === 0) return;
    const baseName = requireReceiptDate();
    if (!baseName) return;
    setBusy(true);
    setError(null);
    try {
      let pdf: jsPDF | null = null;
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const canvas = await renderCroppedCanvas(item);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        const widthMm = (canvas.width * 25.4) / 96;
        const heightMm = (canvas.height * 25.4) / 96;
        const orientation = widthMm >= heightMm ? 'landscape' : 'portrait';

        if (!pdf) {
          pdf = new jsPDF({
            orientation,
            unit: 'mm',
            format: [widthMm, heightMm],
            compress: true,
          });
        } else {
          pdf.addPage([widthMm, heightMm], orientation);
        }

        pdf.addImage(dataUrl, 'JPEG', 0, 0, widthMm, heightMm, undefined, 'FAST');
      }

      if (!pdf) return;
      pdf.save(`${baseName}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build PDF.');
    } finally {
      setBusy(false);
    }
  }, [items, requireReceiptDate]);

  // Re-render crop box when the image finishes laying out / resizing.
  const [layoutTick, setLayoutTick] = useState(0);
  useEffect(() => {
    const onResize = () => setLayoutTick((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const cropStyle = useMemo(() => {
    void layoutTick;
    if (!activeItem) return undefined;
    const imgEl = imageRef.current;
    const sx =
      imgEl && imgEl.clientWidth
        ? imgEl.clientWidth / activeItem.naturalWidth
        : 1;
    const sy =
      imgEl && imgEl.clientHeight
        ? imgEl.clientHeight / activeItem.naturalHeight
        : 1;
    return {
      left: activeItem.crop.x * sx,
      top: activeItem.crop.y * sy,
      width: activeItem.crop.width * sx,
      height: activeItem.crop.height * sy,
    };
  }, [activeItem, layoutTick]);

  return (
    <section className="receipt-scanner" aria-label="Receipt Scanner">
      <div className="receipt-scanner-controls">
        <button
          type="button"
          className="receipt-scanner-button receipt-scanner-button--primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
        >
          Add receipts
        </button>
        {showCameraOption && (
          <button
            type="button"
            className="receipt-scanner-button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={busy}
          >
            Use camera
          </button>
        )}
        <DatePicker
          selected={receiptDate}
          onChange={(date) => setReceiptDate(date)}
          dateFormat="dd-MM-yyyy"
          placeholderText="Select date"
          className="receipt-scanner-date-input"
          calendarClassName="date-picker-calendar"
          wrapperClassName="receipt-scanner-date-wrapper"
          disabled={busy}
          isClearable
        />
        <button
          type="button"
          className={
            'receipt-scanner-button receipt-scanner-type-toggle' +
            (docType === 'postage' ? ' receipt-scanner-type-toggle--postage' : '')
          }
          onClick={() =>
            setDocType((prev) => (prev === 'charity' ? 'postage' : 'charity'))
          }
          disabled={busy}
          aria-pressed={docType === 'postage'}
          title="Toggle between Charity Shop and Postage Label"
        >
          {docType === 'postage' ? 'Postage Label' : 'Charity Shop'}
        </button>
        <div className="receipt-scanner-controls-end">
          <button
            type="button"
            className="receipt-scanner-button"
            onClick={() => void downloadAllPdf()}
            disabled={busy || items.length === 0 || !receiptDate}
            title={!receiptDate ? 'Select a date first' : undefined}
          >
            Download all as PDF ({items.length})
          </button>
          <button
            type="button"
            className="receipt-scanner-button receipt-scanner-button--quiet"
            onClick={clearAll}
            disabled={busy || items.length === 0}
          >
            Clear
          </button>
        </div>
      </div>

      {error && <div className="receipt-scanner-error">{error}</div>}

      <div className="receipt-scanner-layout">
        <div className="receipt-scanner-sidebar">
          <div
            className={
              'receipt-scanner-dropzone' +
              (dragActive ? ' receipt-scanner-dropzone--active' : '')
            }
            onDragEnter={onDropZoneDragEnter}
            onDragLeave={onDropZoneDragLeave}
            onDragOver={onDropZoneDragOver}
            onDrop={onDropZoneDrop}
            onClick={() => !busy && fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            aria-label="Drop receipt images here or click to browse"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="receipt-scanner-file-input"
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="receipt-scanner-file-input"
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <strong className="receipt-scanner-dropzone-title">
              {dragActive ? 'Drop to upload' : 'Drag & drop'}
            </strong>
            <span className="receipt-scanner-dropzone-hint">
              {showCameraOption
                ? 'or browse / use camera'
                : 'or click to browse'}
            </span>
            {showCameraOption && (
              <button
                type="button"
                className="receipt-scanner-button receipt-scanner-button--small receipt-scanner-dropzone-camera"
                onClick={(e) => {
                  e.stopPropagation();
                  cameraInputRef.current?.click();
                }}
                disabled={busy}
              >
                Use camera
              </button>
            )}
          </div>

          {items.length > 0 && (
            <ul className="receipt-scanner-queue">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={
                      'receipt-scanner-queue-item' +
                      (item.id === activeId ? ' receipt-scanner-queue-item--active' : '')
                    }
                    onClick={() => setActiveId(item.id)}
                  >
                    <div className="receipt-scanner-queue-thumb">
                      <img src={item.objectUrl} alt="" />
                    </div>
                    <span className="receipt-scanner-queue-name" title={item.file.name}>
                      {item.file.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div
            className={
              'receipt-scanner-filename-preview' +
              (!downloadBaseName ? ' receipt-scanner-filename-preview--missing' : '')
            }
            title={downloadBaseName ?? 'Select a date to set the finished file name'}
          >
            <span className="receipt-scanner-control-label">Finished file name</span>
            <span className="receipt-scanner-filename-value">
              {downloadBaseName ?? 'Select a date'}
            </span>
          </div>
        </div>

        {activeItem ? (
          <div className="receipt-scanner-editor">
            <div className="receipt-scanner-editor-toolbar">
              <span className="receipt-scanner-editor-title" title={activeItem.file.name}>
                {activeItem.file.name}
              </span>
              <button
                type="button"
                className={
                  'receipt-scanner-button receipt-scanner-button--small' +
                  (activeItem.greyscale ? ' receipt-scanner-button--active' : '')
                }
                onClick={toggleGreyscale}
                disabled={busy}
              >
                {activeItem.greyscale ? 'Greyscale on' : 'Greyscale off'}
              </button>
              <button
                type="button"
                className="receipt-scanner-button receipt-scanner-button--small"
                onClick={resetCrop}
                disabled={busy}
              >
                Reset crop
              </button>
              <button
                type="button"
                className="receipt-scanner-button receipt-scanner-button--small receipt-scanner-button--primary"
                onClick={() => void downloadActivePng()}
                disabled={busy || !receiptDate}
                title={!receiptDate ? 'Select a date first' : undefined}
              >
                Download PNG
              </button>
              <button
                type="button"
                className="receipt-scanner-button receipt-scanner-button--small receipt-scanner-button--quiet"
                onClick={() => removeItem(activeItem.id)}
                disabled={busy}
              >
                Remove
              </button>
            </div>

            <div
              className="receipt-scanner-stage-wrap"
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <div className="receipt-scanner-stage">
                <img
                  ref={imageRef}
                  className={
                    'receipt-scanner-stage-image' +
                    (activeItem.greyscale ? ' receipt-scanner-stage-image--grey' : '')
                  }
                  src={activeItem.objectUrl}
                  alt={activeItem.file.name}
                  onLoad={() => setLayoutTick((n) => n + 1)}
                  draggable={false}
                />
                <div
                  className="receipt-scanner-crop"
                  style={cropStyle}
                  onPointerDown={(e) => onPointerDown('move', e)}
                >
                  {HANDLE_MODES.map((mode) => (
                    <span
                      key={mode}
                      className={`receipt-scanner-handle receipt-scanner-handle--${mode}`}
                      onPointerDown={(e) => onPointerDown(mode, e)}
                    />
                  ))}
                </div>
              </div>
            </div>

            <p className="receipt-scanner-hint">
              Drag the box to move it, or drag a corner/edge handle to resize. Touch works the same
              way. Greyscale is applied when you download.
            </p>
          </div>
        ) : (
          <div className="receipt-scanner-editor receipt-scanner-editor--empty" />
        )}
      </div>
    </section>
  );
};

export default ReceiptScanner;
