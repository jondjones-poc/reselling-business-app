import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import './ListingImageRefresh.css';
import { apiFetch } from '../utils/apiBase';
import {
  autoLevels,
  composeLightenedImage,
  composeRefreshedImage,
  lightenBackground,
  loadImageElement,
  loadSegmenter,
  rawImageToCanvas,
  refreshedFileName,
  rotateImageToCanvas,
  toCompressedDataUrl,
  triggerDownload,
  type RefreshExportFormat,
} from '../utils/listingImagePipeline';

/*
 * Refresh photos on an old marketplace listing without re-shooting the item:
 * a straighten control, and either a neutral studio background with crop/
 * centring (the same treatment as Listing Image Creator) or — for sellers
 * who already like their own shot and shoot on a deliberate dark backdrop —
 * keeping the exact original framing and background, just brightened 5%
 * (no crop, no recompose, only the backdrop's pixels change). Both share the
 * same background-removal model (../utils/listingImagePipeline.ts), used
 * only to tell item pixels from background pixels. Nothing here repaints,
 * hides or removes any condition detail.
 *
 * The first photo added defaults to the studio background (unchanged from
 * before); every photo after that defaults to the lighten-only treatment,
 * since a seller adding several photos in one go is presumably shooting them
 * all on the same backdrop. A per-photo toggle (shown once there's more than
 * one photo) lets either be overridden.
 *
 * Two optional extras:
 *  - "Analyse Photo Set" calls the app's existing Gemini integration (same
 *    GEMINI_API_KEY/pattern as /api/gemini/identify-item) to recommend a main
 *    image and viewing order, and flag (never remove) photos that show
 *    condition/damage worth keeping.
 *  - "Listing Details" makes no API call at all — it builds an Ask AI
 *    prompt (title/description + "hasn't sold in N months, reword without
 *    changing facts") for the user to paste into whatever AI chat tool they
 *    already use, then lets them paste the reply back in. Free, and mirrors
 *    the existing manual "Ask AI" prompt-builders in Stock.tsx.
 */

type JobStatus = 'queued' | 'processing' | 'done' | 'error';

/** 'studio' = replace background with the neutral gradient (as before). 'lighten' = keep the photo's own background, just 5% brighter. */
type BackgroundMode = 'studio' | 'lighten';

type RefreshJob = {
  id: string;
  file: File;
  originalUrl: string;
  status: JobStatus;
  straightenDeg: number;
  backgroundMode: BackgroundMode;
  resultUrl: string | null;
  resultBlob: Blob | null;
  resultFormat: RefreshExportFormat | null;
  error: string | null;
};

const LIGHTEN_PERCENT_OPTIONS = [5, 10, 15, 20];

type PhotoSetNote = { index: number; keep: boolean; reason: string };

type PhotoSetAnalysis = {
  mainImageIndex: number;
  order: number[];
  notes: PhotoSetNote[];
};

/**
 * Vinted displays listing photos in a 4:5 portrait frame and recommends
 * 1080x1350px for a sharp result — these presets keep that same 4:5 ratio at
 * a few sizes. Used as the studio-background canvas size directly; for
 * "Lighten" mode (which never crops/reshapes the original photo) only the
 * longer edge is used, as a cap on how large the export gets.
 */
const OUTPUT_SIZE_PRESETS: { label: string; width: number; height: number }[] = [
  { label: '1080 × 1350 (Vinted recommended)', width: 1080, height: 1350 },
  { label: '1200 × 1500', width: 1200, height: 1500 },
  { label: '900 × 1125 (smaller)', width: 900, height: 1125 },
];
const MAX_STRAIGHTEN_DEG = 15;

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      response.ok ? 'The server returned an unreadable response.' : text || `Request failed (${response.status}).`
    );
  }
  if (!response.ok) {
    throw new Error([data.error, data.details].filter(Boolean).join(' — ') || `Request failed (${response.status}).`);
  }
  return data as T;
}

const ListingImageRefresh: React.FC = () => {
  const [jobs, setJobs] = useState<RefreshJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputPresetIndex, setOutputPresetIndex] = useState(0);
  const outputPreset = OUTPUT_SIZE_PRESETS[outputPresetIndex];
  const [format, setFormat] = useState<RefreshExportFormat>('webp');
  const [lightenPercent, setLightenPercent] = useState(5);
  const [dragActive, setDragActive] = useState(false);

  const [analysis, setAnalysis] = useState<PhotoSetAnalysis | null>(null);
  const [analysisJobIds, setAnalysisJobIds] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [vintedId, setVintedId] = useState('');
  const [vintedFetching, setVintedFetching] = useState(false);
  const [vintedError, setVintedError] = useState<string | null>(null);
  const [vintedPending, setVintedPending] = useState<{
    title: string;
    description: string;
    uploadedAgo: string;
    files: File[];
    previewUrls: string[];
  } | null>(null);

  const [existingTitle, setExistingTitle] = useState('');
  const [existingDescription, setExistingDescription] = useState('');
  const [unsoldPeriod, setUnsoldPeriod] = useState('over 3 months');
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [improvedTitle, setImprovedTitle] = useState('');
  const [improvedDescription, setImprovedDescription] = useState('');
  const [listingError, setListingError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const dragDepthRef = useRef(0);
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(
    () => () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    []
  );

  const vintedPendingRef = useRef(vintedPending);
  vintedPendingRef.current = vintedPending;
  useEffect(
    () => () => {
      vintedPendingRef.current?.previewUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    []
  );

  const doneJobs = useMemo(() => jobs.filter((j) => j.status === 'done'), [jobs]);

  const addFiles = useCallback((files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (picked.length === 0) {
      setError('Those files are not images.');
      return;
    }
    setError(null);
    setJobs((prev) => [
      ...prev,
      ...picked.map((file, i) => {
        const originalUrl = URL.createObjectURL(file);
        objectUrlsRef.current.push(originalUrl);
        // The very first photo overall keeps the studio background; every
        // photo after that defaults to lightening the seller's own backdrop.
        const isFirstPhotoOverall = prev.length === 0 && i === 0;
        return {
          id: `${Date.now()}-${i}-${file.name}`,
          file,
          originalUrl,
          status: 'queued' as JobStatus,
          straightenDeg: 0,
          backgroundMode: (isFirstPhotoOverall ? 'studio' : 'lighten') as BackgroundMode,
          resultUrl: null,
          resultBlob: null,
          resultFormat: null,
          error: null,
        };
      }),
    ]);
    setAnalysis(null);
    setAnalysisJobIds([]);
  }, []);

  const fetchVintedListing = useCallback(async () => {
    const id = vintedId.trim();
    if (!id) {
      setVintedError('Enter a Vinted item ID first.');
      return;
    }
    setVintedFetching(true);
    setVintedError(null);
    setVintedPending(null);
    try {
      const response = await apiFetch(
        `/api/vinted/listing-export-pack?vinted_id=${encodeURIComponent(id)}`
      );
      if (!response.ok) {
        const text = await response.text();
        let message = 'Could not fetch that Vinted listing.';
        try {
          const data = JSON.parse(text) as { error?: string; details?: string };
          message = data.details || data.error || message;
        } catch {
          message = text || message;
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const zip = await JSZip.loadAsync(blob);

      const listingTextEntry = zip.file('listing.txt');
      const listingText = listingTextEntry ? await listingTextEntry.async('string') : '';
      const titleMatch = listingText.match(/TITLE:\n(.+)\n/);
      const descriptionMatch = listingText.match(
        /DESCRIPTION:\n([\s\S]*?)(?:\n\n(?:ITEM DETAILS[^\n]*:|SOURCE:)|$)/
      );
      const uploadedMatch = listingText.match(/^Uploaded:\s*(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : '';
      const description = descriptionMatch ? descriptionMatch[1].trim() : '';
      const uploadedAgo = uploadedMatch ? uploadedMatch[1].trim() : '';

      const imageFilenames = Object.keys(zip.files)
        .filter((name) => name.startsWith('images/') && !zip.files[name].dir)
        .sort();

      const files = await Promise.all(
        imageFilenames.map(async (name) => {
          const entryBlob = await zip.files[name].async('blob');
          const base = name.split('/').pop() || `${id}.jpg`;
          return new File([entryBlob], `vinted-${id}-${base}`, {
            type: entryBlob.type || 'image/jpeg',
          });
        })
      );

      if (files.length === 0) {
        throw new Error('That listing had no photos to import.');
      }

      const previewUrls = files.map((file) => URL.createObjectURL(file));
      setVintedPending({ title, description, uploadedAgo, files, previewUrls });
    } catch (err) {
      setVintedError(err instanceof Error ? err.message : 'Could not fetch that Vinted listing.');
    } finally {
      setVintedFetching(false);
    }
  }, [vintedId]);

  const confirmVintedImport = useCallback(() => {
    if (!vintedPending) return;
    addFiles(vintedPending.files);
    if (vintedPending.title) setExistingTitle(vintedPending.title);
    if (vintedPending.description) setExistingDescription(vintedPending.description);
    if (vintedPending.uploadedAgo) {
      // Vinted only exposes a relative age ("4 months ago") on the public
      // page, never an exact date — strip the trailing "ago" so it reads
      // naturally in "listed on Vinted for {period} without selling".
      setUnsoldPeriod(vintedPending.uploadedAgo.replace(/\s*ago\s*$/i, '').trim());
    }
    vintedPending.previewUrls.forEach((url) => URL.revokeObjectURL(url));
    setVintedPending(null);
    setVintedId('');
  }, [vintedPending, addFiles]);

  const discardVintedImport = useCallback(() => {
    setVintedPending((prev) => {
      prev?.previewUrls.forEach((url) => URL.revokeObjectURL(url));
      return null;
    });
  }, []);

  const onDropZoneDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    if (event.dataTransfer.types.includes('Files')) setDragActive(true);
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
      addFiles(event.dataTransfer?.files ?? null);
    },
    [addFiles]
  );

  const setStraighten = useCallback((id: string, deg: number) => {
    setJobs((prev) =>
      prev.map((j) =>
        j.id === id
          ? {
              ...j,
              straightenDeg: deg,
              // A changed angle invalidates any previous result for this photo.
              status: j.status === 'done' || j.status === 'error' ? 'queued' : j.status,
              resultUrl: null,
              resultBlob: null,
              resultFormat: null,
              error: null,
            }
          : j
      )
    );
  }, []);

  const setBackgroundMode = useCallback((id: string, mode: BackgroundMode) => {
    setJobs((prev) =>
      prev.map((j) =>
        j.id === id
          ? {
              ...j,
              backgroundMode: mode,
              // A changed background mode invalidates any previous result for this photo.
              status: j.status === 'done' || j.status === 'error' ? 'queued' : j.status,
              resultUrl: null,
              resultBlob: null,
              resultFormat: null,
              error: null,
            }
          : j
      )
    );
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

      for (let i = 0; i < pending.length; i += 1) {
        if (cancelRef.current) break;
        const job = pending[i];
        setStatusMessage(`Refreshing ${i + 1} of ${pending.length}: ${job.file.name}`);
        setJobs((prev) =>
          prev.map((j) => (j.id === job.id ? { ...j, status: 'processing', error: null } : j))
        );

        let rotatedUrl: string | null = null;
        try {
          const image = await loadImageElement(job.originalUrl);
          const rotatedCanvas = rotateImageToCanvas(image, job.straightenDeg);
          const rotatedBlob: Blob = await new Promise((resolve, reject) => {
            rotatedCanvas.toBlob(
              (blob) => (blob ? resolve(blob) : reject(new Error('Could not prepare the photo.'))),
              'image/png'
            );
          });
          rotatedUrl = URL.createObjectURL(rotatedBlob);

          const output = await segmenter(rotatedUrl);
          const raw = Array.isArray(output) ? output[0] : output;
          const cutout = rawImageToCanvas(raw);

          let composed: { blob: Blob; format: RefreshExportFormat };
          if (job.backgroundMode === 'lighten') {
            // Brighten the ORIGINAL (rotated) photo's own pixels, using `cutout`
            // only as a mask of which pixels are background — never as a
            // source of colour (see lightenBackground's comment for why).
            lightenBackground(rotatedCanvas, cutout, 1 + lightenPercent / 100);
            composed = await composeLightenedImage(rotatedCanvas, {
              maxDimension: Math.max(outputPreset.width, outputPreset.height),
              format,
            });
          } else {
            autoLevels(cutout);
            composed = await composeRefreshedImage(cutout, {
              width: outputPreset.width,
              height: outputPreset.height,
              format,
              paddingFraction: 0.09,
            });
          }
          const { blob, format: actualFormat } = composed;
          const resultUrl = URL.createObjectURL(blob);
          objectUrlsRef.current.push(resultUrl);
          setJobs((prev) =>
            prev.map((j) =>
              j.id === job.id
                ? { ...j, status: 'done', resultBlob: blob, resultUrl, resultFormat: actualFormat }
                : j
            )
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Processing failed.';
          setJobs((prev) =>
            prev.map((j) => (j.id === job.id ? { ...j, status: 'error', error: message } : j))
          );
        } finally {
          if (rotatedUrl) URL.revokeObjectURL(rotatedUrl);
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
  }, [jobs, outputPreset, format, lightenPercent]);

  const removeJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setAnalysis(null);
    setAnalysisJobIds([]);
  }, []);

  const clearAll = useCallback(() => {
    setJobs([]);
    setStatusMessage(null);
    setError(null);
    setAnalysis(null);
    setAnalysisJobIds([]);
  }, []);

  const analyzePhotoSet = useCallback(async () => {
    if (doneJobs.length === 0) {
      setAnalysisError('Refresh at least one photo first.');
      return;
    }
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const images = await Promise.all(
        doneJobs.map((job) => toCompressedDataUrl(job.resultBlob as Blob))
      );
      const response = await apiFetch('/api/gemini/analyze-photo-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images }),
      });
      const data = await parseJsonResponse<PhotoSetAnalysis>(response);
      setAnalysis(data);
      setAnalysisJobIds(doneJobs.map((j) => j.id));
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Could not analyse the photo set.');
    } finally {
      setAnalyzing(false);
    }
  }, [doneJobs]);

  const askAiPrompt = useMemo(() => {
    const title = existingTitle.trim() || '(no title yet)';
    const description = existingDescription.trim() || '(no description yet)';
    const period = unsoldPeriod.trim() || 'a while';
    return [
      `This item has been listed on Vinted for ${period} without selling.`,
      'Refresh the listing to improve its appeal, search visibility, readability, and chance of selling.',
      'This should be a meaningful rewrite, not just a few word substitutions.',
      '',
      'Accuracy Rules',
      'Do not change, remove, assume, or invent any facts.',
      'Preserve all factual information from the original listing, including:',
      '',
      '* Brand',
      '* Product type',
      '* Gender',
      '* Tagged size',
      '* Measurements',
      '* Condition',
      '* Flaws or damage',
      '* Material',
      '* Colour',
      '* Model',
      '* Product codes',
      '* Age or estimated age',
      '* Manufacturing information',
      '* Logos and branding',
      '* Any uncertainty stated in the original',
      '',
      'If the original says "appears to", "believed to", "estimated", "approx." or similar wording, preserve that uncertainty.',
      'Never make an item sound like it is in better condition than described.',
      '',
      'Title Refresh',
      'Create a substantially restructured title rather than simply changing a few words.',
      '',
      '* Keep the strongest accurate search terms.',
      '* Put the most useful buyer search terms earlier.',
      '* Remove weak, repetitive, or unnecessary wording where useful.',
      '* Change the word order and structure from the old title.',
      '* Use natural marketplace search language.',
      '* Do not keyword-stuff.',
      '* Do not add search terms that cannot be supported by the listing.',
      "* Keep within Vinted's title length limit.",
      '',
      'Description Refresh',
      'Rewrite and restructure the full description.',
      '',
      '* Keep every important fact.',
      '* Make the opening more appealing and easier to scan.',
      "* Lead with the item's strongest genuine selling points.",
      '* Change the sentence structure and order where useful.',
      '* Reduce repetition.',
      '* Keep useful search terms naturally within the description.',
      '* Preserve all measurements, condition details and flaws.',
      '* Keep the tone suitable for a second-hand marketplace.',
      '* Do not exaggerate rarity, value, age, collectability or condition.',
      '* Keep postage and bundle information where supplied.',
      '',
      'The new description should feel like a genuinely refreshed listing while remaining completely accurate to the original.',
      '',
      'Output',
      'Return:',
      'Title:',
      '[New title]',
      'Description:',
      '[New description]',
      'Analysis:',
      'After the listing, provide a short seller analysis containing:',
      'What changed: Explain the main changes made to the title and description.',
      'Why it may help: Explain which changes could improve search visibility, buyer interest or readability.',
      "Possible reason it hasn't sold: Based only on the information provided, identify likely issues such as title quality, niche demand, sizing, condition, seasonality or presentation. Do not invent marketplace performance data.",
      'Price: If no current price or market data has been supplied, state that price cannot be assessed from the information provided rather than guessing.',
      'Refresh score: Score the original listing from 1-10 for title/search quality and 1-10 for description quality, with a brief reason for each.',
      "Next action: Give the single most useful next step if the refreshed listing still does not sell.",
      '',
      'Current title:',
      title,
      'Current description:',
      description,
    ].join('\n');
  }, [existingTitle, existingDescription, unsoldPeriod]);

  const copyAskAiPrompt = useCallback(async () => {
    setPromptExpanded(true);
    try {
      await navigator.clipboard.writeText(askAiPrompt);
      setStatusMessage('Prompt copied — paste it into your AI chat of choice.');
    } catch {
      setListingError('Could not copy to the clipboard — copy the text below manually.');
    }
  }, [askAiPrompt]);

  const buildListingPackText = useCallback((): string => {
    const title = improvedTitle.trim() || existingTitle.trim() || '(no title)';
    const description = improvedDescription.trim() || existingDescription.trim() || '(no description)';
    const lines = ['LISTING REFRESH', '', 'TITLE:', title, '', 'DESCRIPTION:', description];
    lines.push('', 'IMAGES:', 'See the images/ folder in this zip (use in the order given).');
    return `${lines.join('\n')}\n`;
  }, [improvedTitle, improvedDescription, existingTitle, existingDescription]);

  const downloadListingPack = useCallback(async () => {
    const finished = jobs.filter((j) => j.status === 'done' && j.resultBlob && j.resultFormat);
    if (finished.length === 0) {
      setError('Refresh at least one photo first.');
      return;
    }
    const order = analysis?.order?.length === analysisJobIds.length ? analysis.order : null;
    const orderedJobs = order
      ? order
          .map((idx) => analysisJobIds[idx])
          .map((id) => finished.find((j) => j.id === id))
          .filter((j): j is RefreshJob => Boolean(j))
      : finished;
    // Any job outside the analysed set (e.g. added after analysis ran) still goes in.
    const remaining = finished.filter((j) => !orderedJobs.includes(j));
    const allOrdered = [...orderedJobs, ...remaining];

    const zip = new JSZip();
    zip.file('listing.txt', buildListingPackText());
    allOrdered.forEach((job, i) => {
      const ext = job.resultFormat === 'webp' ? 'webp' : 'jpg';
      zip.file(`images/${String(i + 1).padStart(2, '0')}.${ext}`, job.resultBlob as Blob);
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    triggerDownload(blob, `listing-refresh-pack-${new Date().toISOString().slice(0, 10)}.zip`);
  }, [jobs, analysis, analysisJobIds, buildListingPackText]);

  const analysisById = useMemo(() => {
    if (!analysis) return null;
    const map = new Map<string, { isMain: boolean; order: number; note: PhotoSetNote | null }>();
    analysisJobIds.forEach((id, index) => {
      const orderPos = analysis.order.indexOf(index);
      map.set(id, {
        isMain: analysis.mainImageIndex === index,
        order: orderPos >= 0 ? orderPos + 1 : index + 1,
        note: analysis.notes.find((n) => n.index === index) ?? null,
      });
    });
    return map;
  }, [analysis, analysisJobIds]);

  return (
    <section className="listing-refresh" aria-label="Listing Image Refresh">
      <div className="listing-refresh-section listing-refresh-vinted-import">
        <div className="listing-refresh-section-header listing-refresh-section-header--center">
          <h3>Import from Vinted</h3>
        </div>
        <div className="listing-refresh-vinted-row listing-refresh-vinted-row--center">
          <input
            type="text"
            className="listing-refresh-vinted-input listing-refresh-vinted-input--compact"
            value={vintedId}
            onChange={(e) => setVintedId(e.target.value)}
            placeholder="Vinted item ID"
            disabled={vintedFetching}
          />
          <button
            type="button"
            className="listing-refresh-button listing-refresh-button--primary"
            onClick={() => void fetchVintedListing()}
            disabled={vintedFetching || !vintedId.trim()}
          >
            {vintedFetching ? 'Fetching…' : 'Fetch listing'}
          </button>
          <div className="listing-refresh-control">
            <label className="listing-refresh-control-label" htmlFor="listing-refresh-size">
              Output size
            </label>
            <select
              id="listing-refresh-size"
              className="listing-refresh-select"
              value={outputPresetIndex}
              onChange={(e) => setOutputPresetIndex(Number(e.target.value))}
              disabled={busy}
            >
              {OUTPUT_SIZE_PRESETS.map((preset, i) => (
                <option key={preset.label} value={i}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>
          <div className="listing-refresh-control">
            <label className="listing-refresh-control-label" htmlFor="listing-refresh-format">
              Format
            </label>
            <select
              id="listing-refresh-format"
              className="listing-refresh-select"
              value={format}
              onChange={(e) => setFormat(e.target.value as RefreshExportFormat)}
              disabled={busy}
            >
              <option value="webp">WebP (smaller)</option>
              <option value="jpeg">JPEG</option>
            </select>
          </div>
          <div className="listing-refresh-control">
            <label className="listing-refresh-control-label" htmlFor="listing-refresh-lightness">
              Lightness
            </label>
            <select
              id="listing-refresh-lightness"
              className="listing-refresh-select"
              value={lightenPercent}
              onChange={(e) => setLightenPercent(Number(e.target.value))}
              disabled={busy}
            >
              {LIGHTEN_PERCENT_OPTIONS.map((pct) => (
                <option key={pct} value={pct}>
                  {pct}%{pct === 5 ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        {vintedError && <div className="listing-refresh-error">{vintedError}</div>}

        {vintedPending && (
          <div className="listing-refresh-vinted-confirm">
            <p className="listing-refresh-vinted-confirm-title">
              Found {vintedPending.files.length} photo{vintedPending.files.length === 1 ? '' : 's'}
              {vintedPending.title ? ` for "${vintedPending.title}"` : ''}. Add these to the queue?
            </p>
            {vintedPending.description && (
              <p className="listing-refresh-vinted-confirm-desc">{vintedPending.description}</p>
            )}
            {vintedPending.uploadedAgo && (
              <p className="listing-refresh-vinted-confirm-desc">
                Uploaded {vintedPending.uploadedAgo} — used for the Ask AI prompt below.
              </p>
            )}
            <div className="listing-refresh-vinted-thumbs">
              {vintedPending.previewUrls.map((url, i) => (
                <img key={url} src={url} alt={`Vinted item ${i + 1}`} />
              ))}
            </div>
            <div className="listing-refresh-card-actions">
              <button
                type="button"
                className="listing-refresh-button listing-refresh-button--primary"
                onClick={confirmVintedImport}
              >
                Use these photos
              </button>
              <button
                type="button"
                className="listing-refresh-button listing-refresh-button--quiet"
                onClick={discardVintedImport}
              >
                Discard
              </button>
            </div>
          </div>
        )}

      </div>

      <div
        className={'listing-refresh-dropzone' + (dragActive ? ' listing-refresh-dropzone--active' : '')}
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
        aria-label="Drop listing photos here or click to browse"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="listing-refresh-file-input"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <strong className="listing-refresh-dropzone-title">
          {dragActive ? 'Drop to upload' : 'Drag & drop photos'}
        </strong>
        <span className="listing-refresh-dropzone-hint">or click to browse — add the whole set at once</span>
      </div>

      <div className="listing-refresh-actions">
        <button
          type="button"
          className="listing-refresh-button listing-refresh-button--primary"
          onClick={() => void processQueue()}
          disabled={busy || jobs.length === 0}
        >
          {busy ? 'Refreshing…' : 'Process Images'}
        </button>
        {busy && (
          <button
            type="button"
            className="listing-refresh-button"
            onClick={() => {
              cancelRef.current = true;
            }}
          >
            Stop
          </button>
        )}
        <div className="listing-refresh-actions-right">
        <button
          type="button"
          className="listing-refresh-button listing-refresh-button--primary"
          onClick={() => void downloadListingPack()}
          disabled={busy || doneJobs.length === 0}
          title="One zip: refreshed images (in the analysed order, if you've run Analyse Photo Set) plus a listing.txt with the title/description"
        >
          Download Images &amp; Text ({doneJobs.length})
        </button>
        <button
          type="button"
          className="listing-refresh-button listing-refresh-button--quiet"
          onClick={clearAll}
          disabled={busy || jobs.length === 0}
        >
          Clear
        </button>
        </div>
      </div>

      {error && <div className="listing-refresh-error">{error}</div>}
      {statusMessage && <div className="listing-refresh-status">{statusMessage}</div>}

      {jobs.length === 0 ? (
        <p className="listing-refresh-empty">
          No photos yet. Add the full set for a listing — refreshing works one photo at a
          time so the browser stays responsive.
        </p>
      ) : (
        <ul className="listing-refresh-grid">
          {jobs.map((job) => {
            const meta = analysisById?.get(job.id) ?? null;
            return (
              <li key={job.id} className={`listing-refresh-card listing-refresh-card--${job.status}`}>
                <div className="listing-refresh-thumbs">
                  <div className="listing-refresh-thumb">
                    <img src={job.originalUrl} alt={`Original ${job.file.name}`} />
                    <span className="listing-refresh-thumb-label">Before</span>
                  </div>
                  <div className="listing-refresh-thumb">
                    {job.resultUrl ? (
                      <img src={job.resultUrl} alt={`Refreshed ${job.file.name}`} />
                    ) : (
                      <span className="listing-refresh-thumb-placeholder">
                        {job.status === 'processing' ? 'Working…' : 'Not refreshed yet'}
                      </span>
                    )}
                    <span className="listing-refresh-thumb-label">After</span>
                  </div>
                </div>

                {meta && (
                  <div className="listing-refresh-badges">
                    {meta.isMain && <span className="listing-refresh-badge listing-refresh-badge--main">Main image</span>}
                    <span className="listing-refresh-badge">Order {meta.order}</span>
                    {meta.note && !meta.note.keep && (
                      <span className="listing-refresh-badge listing-refresh-badge--muted">{meta.note.reason}</span>
                    )}
                    {meta.note && meta.note.keep && (
                      <span className="listing-refresh-badge listing-refresh-badge--keep">Keep — {meta.note.reason}</span>
                    )}
                  </div>
                )}

                <div className="listing-refresh-card-body">
                  <span className="listing-refresh-filename" title={job.file.name}>
                    {job.file.name}
                  </span>
                  {job.error && <span className="listing-refresh-card-error">{job.error}</span>}

                  <div className="listing-refresh-bg-toggle" role="radiogroup" aria-label="Background treatment">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={job.backgroundMode === 'studio'}
                      className={
                        'listing-refresh-bg-toggle-option' +
                        (job.backgroundMode === 'studio' ? ' listing-refresh-bg-toggle-option--active' : '')
                      }
                      onClick={() => setBackgroundMode(job.id, 'studio')}
                      disabled={busy}
                    >
                      White gradient
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={job.backgroundMode === 'lighten'}
                      className={
                        'listing-refresh-bg-toggle-option' +
                        (job.backgroundMode === 'lighten' ? ' listing-refresh-bg-toggle-option--active' : '')
                      }
                      onClick={() => setBackgroundMode(job.id, 'lighten')}
                      disabled={busy}
                    >
                      Lighten dark background
                    </button>
                  </div>

                  <label className="listing-refresh-straighten">
                    Straighten
                    <input
                      type="range"
                      min={-MAX_STRAIGHTEN_DEG}
                      max={MAX_STRAIGHTEN_DEG}
                      step={0.5}
                      value={job.straightenDeg}
                      onChange={(e) => setStraighten(job.id, Number(e.target.value))}
                      disabled={busy}
                    />
                    <span className="listing-refresh-straighten-value">{job.straightenDeg.toFixed(1)}°</span>
                  </label>

                  <div className="listing-refresh-card-actions">
                    {job.resultBlob && job.resultFormat && (
                      <button
                        type="button"
                        className="listing-refresh-button listing-refresh-button--small"
                        onClick={() =>
                          triggerDownload(
                            job.resultBlob as Blob,
                            refreshedFileName(job.file.name, job.resultFormat as RefreshExportFormat)
                          )
                        }
                      >
                        Download
                      </button>
                    )}
                    <button
                      type="button"
                      className="listing-refresh-button listing-refresh-button--small listing-refresh-button--quiet"
                      onClick={() => removeJob(job.id)}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="listing-refresh-section">
        <div className="listing-refresh-section-header">
          <h3>Photo set</h3>
          <button
            type="button"
            className="listing-refresh-button"
            onClick={() => void analyzePhotoSet()}
            disabled={analyzing || doneJobs.length === 0}
          >
            {analyzing ? 'Analysing…' : 'Analyse Photo Set'}
          </button>
        </div>
        <p className="listing-refresh-section-hint">
          Recommends the strongest main image and a viewing order, and flags any photo that
          shows a fault or condition detail worth keeping. It never removes a photo for you.
        </p>
        {analysisError && <div className="listing-refresh-error">{analysisError}</div>}
      </div>

      <div className="listing-refresh-section">
        <div className="listing-refresh-section-header listing-refresh-section-header--center">
          <h3>Listing Details</h3>
        </div>

        <div className="listing-refresh-listing-form">
            <label className="listing-refresh-field">
              Current title
              <input
                type="text"
                value={existingTitle}
                onChange={(e) => setExistingTitle(e.target.value)}
                placeholder="Paste the current listing title, if any"
              />
            </label>
            <label className="listing-refresh-field">
              Current description
              <textarea
                value={existingDescription}
                onChange={(e) => setExistingDescription(e.target.value)}
                placeholder="Paste the current listing description, if any"
                rows={3}
              />
            </label>
            <button type="button" className="listing-refresh-button listing-refresh-button--primary" onClick={() => void copyAskAiPrompt()}>
              Ask AI To Refine Listing
            </button>
            {listingError && <div className="listing-refresh-error">{listingError}</div>}
            {promptExpanded && (
              <textarea className="listing-refresh-prompt-preview" value={askAiPrompt} readOnly rows={8} />
            )}

            <div className="listing-refresh-draft">
              <p className="listing-refresh-section-hint">
                Paste the AI's reply back in here — these are what get used in the listing
                pack zip.
              </p>
              <label className="listing-refresh-field">
                Improved title
                <input
                  type="text"
                  value={improvedTitle}
                  onChange={(e) => setImprovedTitle(e.target.value)}
                  placeholder="Paste the AI's improved title here"
                />
              </label>
              <label className="listing-refresh-field">
                Improved description
                <textarea
                  value={improvedDescription}
                  onChange={(e) => setImprovedDescription(e.target.value)}
                  placeholder="Paste the AI's improved description here"
                  rows={5}
                />
              </label>
            </div>
        </div>
      </div>
    </section>
  );
};

export default ListingImageRefresh;
