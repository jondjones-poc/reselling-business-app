import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DatePicker from 'react-datepicker';
import { jsPDF } from 'jspdf';
import 'react-datepicker/dist/react-datepicker.css';
import '../react-datepicker-dark.css';
import { apiFetch } from '../utils/apiBase';
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
type PostageCarrier = 'dpd' | 'royal-mail' | 'evri';
type ReceiptScannerPanel = 'create' | 'uploaded';

type ReceiptUploadRow = {
  id: number;
  file_name: string;
  storage_path: string;
  content_type: string;
  doc_type: string | null;
  receipt_date: string | null;
  byte_size: number | null;
  created_at: string;
  download_url: string | null;
};

const MIN_CROP_PX = 24;

const POSTAGE_CARRIERS: PostageCarrier[] = ['dpd', 'royal-mail', 'evri'];

const POSTAGE_CARRIER_LABELS: Record<PostageCarrier, string> = {
  dpd: 'DPD',
  'royal-mail': 'Royal Mail',
  evri: 'Evri',
};

function nextPostageCarrier(current: PostageCarrier): PostageCarrier {
  const idx = POSTAGE_CARRIERS.indexOf(current);
  return POSTAGE_CARRIERS[(idx + 1) % POSTAGE_CARRIERS.length];
}

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

function buildDownloadBaseName(
  docType: ReceiptDocType,
  carrier: PostageCarrier,
  date: Date | null
): string | null {
  if (!date) return null;
  if (docType === 'postage') {
    return `Postage Receipts - ${POSTAGE_CARRIER_LABELS[carrier]} - ${formatReceiptDate(date)}`;
  }
  return `Charity Shop - ${formatReceiptDate(date)}`;
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

async function buildReceiptPdfBlob(items: ReceiptItem[]): Promise<Blob> {
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

  if (!pdf) throw new Error('No pages to export.');
  return pdf.output('blob');
}

function formatUploadTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatByteSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Why export/save is blocked — shown as a hover tip on a wrapper (disabled buttons skip native title). */
function exportBlockedHint(opts: {
  busy?: boolean;
  saving?: boolean;
  hasItems: boolean;
  hasDate: boolean;
}): string | null {
  if (opts.busy || opts.saving) return 'Wait for the current action to finish.';
  if (!opts.hasItems) return 'Add at least one receipt image first.';
  if (!opts.hasDate) return 'Select a date first — it sets the finished file name.';
  return null;
}

type HintWrapProps = {
  hint: string | null;
  /** Show tip below the button (better for top toolbars). */
  place?: 'above' | 'below';
  children: React.ReactNode;
};

function HintWrap({ hint, place = 'above', children }: HintWrapProps) {
  if (!hint) return <>{children}</>;
  return (
    <span
      className={
        'receipt-scanner-hint-wrap' +
        (place === 'below' ? ' receipt-scanner-hint-wrap--below' : '')
      }
      data-hint={hint}
      title={hint}
    >
      {children}
    </span>
  );
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
  const [panel, setPanel] = useState<ReceiptScannerPanel>('create');
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receiptDate, setReceiptDate] = useState<Date | null>(null);
  const [docType, setDocType] = useState<ReceiptDocType>('charity');
  const [postageCarrier, setPostageCarrier] = useState<PostageCarrier>('dpd');
  const [dragActive, setDragActive] = useState(false);
  const [showCameraOption, setShowCameraOption] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [uploads, setUploads] = useState<ReceiptUploadRow[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [uploadsError, setUploadsError] = useState<string | null>(null);
  const [uploadBusyId, setUploadBusyId] = useState<number | null>(null);
  const [savingToCloud, setSavingToCloud] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
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

  const stopCameraStream = useCallback(() => {
    const stream = cameraStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    const video = cameraVideoRef.current;
    if (video) {
      video.srcObject = null;
    }
  }, []);

  const closeCamera = useCallback(() => {
    stopCameraStream();
    setCameraOpen(false);
    setCameraStarting(false);
  }, [stopCameraStream]);

  const openCamera = useCallback(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera is not supported in this browser. Try Chrome or Safari.');
      return;
    }
    setError(null);
    setCameraStarting(true);
    setCameraOpen(true);
  }, []);

  useEffect(() => {
    if (!cameraOpen) return undefined;
    let cancelled = false;

    const start = async () => {
      if (cameraStreamRef.current) {
        const video = cameraVideoRef.current;
        if (video && video.srcObject !== cameraStreamRef.current) {
          video.srcObject = cameraStreamRef.current;
          video.setAttribute('playsinline', 'true');
          video.muted = true;
          try {
            await video.play();
          } catch {
            /* ignore brief autoplay failures */
          }
        }
        if (!cancelled) setCameraStarting(false);
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true,
          });
        }
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        cameraStreamRef.current = stream;
        const video = cameraVideoRef.current;
        if (video) {
          video.srcObject = stream;
          video.setAttribute('playsinline', 'true');
          video.muted = true;
          await video.play();
        }
      } catch (err) {
        if (cancelled) return;
        stopCameraStream();
        setCameraOpen(false);
        const message =
          err instanceof Error && /NotAllowedError|Permission/i.test(err.name + err.message)
            ? 'Camera permission denied. Allow camera access for this site and try again.'
            : err instanceof Error
              ? `Could not open camera: ${err.message}`
              : 'Could not open camera.';
        setError(message);
      } finally {
        if (!cancelled) setCameraStarting(false);
      }
    };

    void start();
    return () => {
      cancelled = true;
    };
  }, [cameraOpen, stopCameraStream]);

  useEffect(
    () => () => {
      stopCameraStream();
    },
    [stopCameraStream]
  );

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

  const captureFromCamera = useCallback(async () => {
    const video = cameraVideoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError('Camera is still starting — wait a moment and try again.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setError('Canvas is unavailable in this browser.');
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error('Could not capture photo.'))),
          'image/jpeg',
          0.92
        );
      });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = new File([blob], `camera-${stamp}.jpg`, { type: 'image/jpeg' });
      closeCamera();
      await addFiles([file]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not capture photo.');
    }
  }, [addFiles, closeCamera]);

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
    () => buildDownloadBaseName(docType, postageCarrier, receiptDate),
    [docType, postageCarrier, receiptDate]
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
      const blob = await buildReceiptPdfBlob(items);
      triggerDownload(blob, `${baseName}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build PDF.');
    } finally {
      setBusy(false);
    }
  }, [items, requireReceiptDate]);

  const loadUploads = useCallback(async () => {
    setUploadsLoading(true);
    setUploadsError(null);
    try {
      const response = await apiFetch('/api/receipt-uploads');
      const text = await response.text();
      let data: { rows?: ReceiptUploadRow[]; error?: string; hint?: string } = {};
      try {
        data = text ? (JSON.parse(text) as typeof data) : {};
      } catch {
        throw new Error(text || 'Could not load uploaded files.');
      }
      if (!response.ok) {
        throw new Error(
          [data.error, data.hint].filter(Boolean).join(' — ') ||
            `Could not load uploaded files (${response.status}).`
        );
      }
      setUploads(Array.isArray(data.rows) ? data.rows : []);
    } catch (err) {
      setUploads([]);
      setUploadsError(err instanceof Error ? err.message : 'Could not load uploaded files.');
    } finally {
      setUploadsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (panel === 'uploaded') {
      void loadUploads();
    }
  }, [panel, loadUploads]);

  const savePdfToCloud = useCallback(async () => {
    if (items.length === 0) return;
    const baseName = requireReceiptDate();
    if (!baseName) return;
    setSavingToCloud(true);
    setBusy(true);
    setError(null);
    try {
      const blob = await buildReceiptPdfBlob(items);
      const pdfFile = new File([blob], `${baseName}.pdf`, { type: 'application/pdf' });
      const formData = new FormData();
      formData.append('file', pdfFile);
      formData.append('fileName', `${baseName}.pdf`);
      formData.append('docType', docType);
      if (docType === 'postage') {
        formData.append('carrier', postageCarrier);
      }
      if (receiptDate) {
        const yyyy = receiptDate.getFullYear();
        const mm = String(receiptDate.getMonth() + 1).padStart(2, '0');
        const dd = String(receiptDate.getDate()).padStart(2, '0');
        formData.append('receiptDate', `${yyyy}-${mm}-${dd}`);
      }

      const response = await apiFetch('/api/receipt-uploads', {
        method: 'POST',
        body: formData,
      });
      const text = await response.text();
      let data: ReceiptUploadRow & { error?: string; hint?: string; details?: string } =
        {} as ReceiptUploadRow & { error?: string; hint?: string; details?: string };
      try {
        data = text ? (JSON.parse(text) as typeof data) : data;
      } catch {
        throw new Error(text || 'Upload failed.');
      }
      if (!response.ok) {
        throw new Error(
          [data.error, data.details || data.hint].filter(Boolean).join(' — ') ||
            `Upload failed (${response.status}).`
        );
      }

      setPanel('uploaded');
      setUploads((prev) => [data, ...prev.filter((r) => r.id !== data.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save to cloud.');
    } finally {
      setSavingToCloud(false);
      setBusy(false);
    }
  }, [items, requireReceiptDate, docType, postageCarrier, receiptDate]);

  const downloadUploadedFile = useCallback(async (row: ReceiptUploadRow) => {
    if (!row.download_url) {
      setUploadsError('No download link for that file. Try refreshing the list.');
      return;
    }
    setUploadBusyId(row.id);
    setUploadsError(null);
    try {
      const response = await fetch(row.download_url);
      if (!response.ok) {
        throw new Error(`Download failed (${response.status}).`);
      }
      const blob = await response.blob();
      triggerDownload(blob, row.file_name || 'receipt.pdf');
    } catch (err) {
      // Signed URL may be cross-origin; fall back to opening the link.
      try {
        window.open(row.download_url, '_blank', 'noopener,noreferrer');
      } catch {
        setUploadsError(err instanceof Error ? err.message : 'Could not download file.');
      }
    } finally {
      setUploadBusyId(null);
    }
  }, []);

  const deleteUploadedFile = useCallback(async (row: ReceiptUploadRow) => {
    const label = row.file_name || `receipt #${row.id}`;
    if (!window.confirm(`Delete “${label}” from cloud storage? This cannot be undone.`)) {
      return;
    }
    setUploadBusyId(row.id);
    setUploadsError(null);
    try {
      const response = await apiFetch(`/api/receipt-uploads/${row.id}`, { method: 'DELETE' });
      const text = await response.text();
      let data: { error?: string; details?: string } = {};
      try {
        data = text ? (JSON.parse(text) as typeof data) : {};
      } catch {
        /* empty */
      }
      if (!response.ok) {
        throw new Error(
          [data.error, data.details].filter(Boolean).join(' — ') ||
            `Delete failed (${response.status}).`
        );
      }
      setUploads((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      setUploadsError(err instanceof Error ? err.message : 'Could not delete file.');
    } finally {
      setUploadBusyId(null);
    }
  }, []);

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

  const pdfExportHint = exportBlockedHint({
    busy,
    saving: savingToCloud,
    hasItems: items.length > 0,
    hasDate: !!receiptDate,
  });
  const downloadPdfHint = exportBlockedHint({
    busy,
    hasItems: items.length > 0,
    hasDate: !!receiptDate,
  });
  const downloadPngHint = exportBlockedHint({
    busy,
    hasItems: !!activeItem,
    hasDate: !!receiptDate,
  });

  return (
    <section className="receipt-scanner" aria-label="Receipt Scanner">
      <div className="receipt-scanner-subtabs" role="tablist" aria-label="Receipt Scanner sections">
        <button
          type="button"
          role="tab"
          id="receipt-scanner-tab-create"
          aria-selected={panel === 'create'}
          aria-controls="receipt-scanner-panel-create"
          className={
            'receipt-scanner-subtab' + (panel === 'create' ? ' receipt-scanner-subtab--active' : '')
          }
          onClick={() => setPanel('create')}
        >
          Create
        </button>
        <button
          type="button"
          role="tab"
          id="receipt-scanner-tab-uploaded"
          aria-selected={panel === 'uploaded'}
          aria-controls="receipt-scanner-panel-uploaded"
          className={
            'receipt-scanner-subtab' +
            (panel === 'uploaded' ? ' receipt-scanner-subtab--active' : '')
          }
          onClick={() => setPanel('uploaded')}
        >
          Uploaded files
          {uploads.length > 0 ? ` (${uploads.length})` : ''}
        </button>
      </div>

      {panel === 'uploaded' ? (
        <div
          id="receipt-scanner-panel-uploaded"
          role="tabpanel"
          aria-labelledby="receipt-scanner-tab-uploaded"
          className="receipt-scanner-uploads"
        >
          <div className="receipt-scanner-uploads-toolbar">
            <button
              type="button"
              className="receipt-scanner-button"
              onClick={() => void loadUploads()}
              disabled={uploadsLoading}
            >
              {uploadsLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {uploadsError && <div className="receipt-scanner-error">{uploadsError}</div>}

          {uploadsLoading && uploads.length === 0 ? (
            <p className="receipt-scanner-uploads-empty">Loading uploaded files…</p>
          ) : uploads.length === 0 ? (
            <p className="receipt-scanner-uploads-empty">
              No files in cloud storage yet. Create a receipt and use Save PDF to cloud.
            </p>
          ) : (
            <ul className="receipt-scanner-uploads-list">
              {uploads.map((row) => {
                const busyRow = uploadBusyId === row.id;
                return (
                  <li key={row.id} className="receipt-scanner-uploads-row">
                    <div className="receipt-scanner-uploads-meta">
                      <span className="receipt-scanner-uploads-name" title={row.file_name}>
                        {row.file_name}
                      </span>
                      <span className="receipt-scanner-uploads-sub">
                        {formatUploadTimestamp(row.created_at)}
                        {row.byte_size != null ? ` · ${formatByteSize(row.byte_size)}` : ''}
                        {row.doc_type === 'postage'
                          ? ' · Postage Receipts'
                          : row.doc_type === 'charity'
                            ? ' · Charity Shop'
                            : ''}
                      </span>
                    </div>
                    <div className="receipt-scanner-uploads-actions">
                      <button
                        type="button"
                        className="receipt-scanner-button receipt-scanner-button--small receipt-scanner-button--primary"
                        onClick={() => void downloadUploadedFile(row)}
                        disabled={busyRow || !row.download_url}
                      >
                        {busyRow ? 'Working…' : 'Download'}
                      </button>
                      <button
                        type="button"
                        className="receipt-scanner-button receipt-scanner-button--small receipt-scanner-button--quiet"
                        onClick={() => void deleteUploadedFile(row)}
                        disabled={busyRow}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <div
          id="receipt-scanner-panel-create"
          role="tabpanel"
          aria-labelledby="receipt-scanner-tab-create"
        >
      <div className="receipt-scanner-controls">
        <button
          type="button"
          className="receipt-scanner-button receipt-scanner-button--primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || cameraOpen}
        >
          Add Receipt Image
        </button>
        {showCameraOption && (
          <button
            type="button"
            className="receipt-scanner-button"
            onClick={() => void openCamera()}
            disabled={busy || cameraOpen}
          >
            Add Receipt From Camera
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
          title="Toggle between Charity Shop and Postage Receipts"
        >
          {docType === 'postage' ? 'Postage Receipts' : 'Charity Shop'}
        </button>
        {docType === 'postage' && (
          <button
            type="button"
            className="receipt-scanner-button receipt-scanner-carrier-toggle"
            onClick={() => setPostageCarrier((prev) => nextPostageCarrier(prev))}
            disabled={busy}
            title="Toggle courier: DPD, Royal Mail, Evri"
          >
            {POSTAGE_CARRIER_LABELS[postageCarrier]}
          </button>
        )}
        <div className="receipt-scanner-controls-end">
          <HintWrap hint={downloadPdfHint} place="below">
            <button
              type="button"
              className="receipt-scanner-button"
              onClick={() => void downloadAllPdf()}
              disabled={!!downloadPdfHint}
            >
              Download all as PDF ({items.length})
            </button>
          </HintWrap>
          <HintWrap hint={pdfExportHint} place="below">
            <button
              type="button"
              className="receipt-scanner-button receipt-scanner-button--primary"
              onClick={() => void savePdfToCloud()}
              disabled={!!pdfExportHint}
            >
              {savingToCloud ? 'Saving…' : 'Save PDF to cloud'}
            </button>
          </HintWrap>
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
            <strong className="receipt-scanner-dropzone-title">
              {dragActive ? 'Drop to upload' : 'Drag & drop'}
            </strong>
            <span className="receipt-scanner-dropzone-hint">
              {showCameraOption
                ? 'or browse / take a photo'
                : 'or click to browse'}
            </span>
            {showCameraOption && (
              <button
                type="button"
                className="receipt-scanner-button receipt-scanner-button--small receipt-scanner-dropzone-camera"
                onClick={(e) => {
                  e.stopPropagation();
                  void openCamera();
                }}
                disabled={busy || cameraOpen}
              >
                Add Receipt From Camera
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
              <HintWrap hint={downloadPngHint}>
                <button
                  type="button"
                  className="receipt-scanner-button receipt-scanner-button--small receipt-scanner-button--primary"
                  onClick={() => void downloadActivePng()}
                  disabled={!!downloadPngHint}
                >
                  Download PNG
                </button>
              </HintWrap>
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
        </div>
      )}

      {cameraOpen && (
        <div className="receipt-scanner-camera-overlay" role="dialog" aria-modal="true" aria-label="Camera">
          <div className="receipt-scanner-camera-panel">
            <video
              ref={cameraVideoRef}
              className="receipt-scanner-camera-video"
              autoPlay
              playsInline
              muted
            />
            {cameraStarting && (
              <p className="receipt-scanner-camera-status">Starting camera…</p>
            )}
            <div className="receipt-scanner-camera-actions">
              <button
                type="button"
                className="receipt-scanner-button receipt-scanner-button--quiet"
                onClick={closeCamera}
              >
                Cancel
              </button>
              <button
                type="button"
                className="receipt-scanner-button receipt-scanner-button--primary"
                onClick={() => void captureFromCamera()}
                disabled={cameraStarting}
              >
                Take photo
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default ReceiptScanner;
