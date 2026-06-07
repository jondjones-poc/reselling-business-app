import React, { useRef, useState } from 'react';
import { apiUrl } from '../utils/apiBase';
import './ScoutItemIdentify.css';

type ScoutItemIdentifyProps = {
  onIdentified?: (name: string) => void;
};

function compressImage(
  file: File,
  maxWidth = 1920,
  maxHeight = 1920,
  quality = 0.8
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }
        } else if (height > maxHeight) {
          width = (width * maxHeight) / height;
          height = maxHeight;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to process image'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}

function normalizeItemName(raw: string): string {
  const firstLine = raw.trim().split(/\r?\n/)[0]?.trim() ?? '';
  return firstLine.replace(/^["'`]+|["'`]+$/g, '').trim();
}

const ScoutItemIdentify: React.FC<ScoutItemIdentifyProps> = ({ onIdentified }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identifiedName, setIdentifiedName] = useState<string | null>(null);

  const handleCopyResult = async () => {
    if (!identifiedName) return;
    try {
      await copyTextToClipboard(identifiedName);
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  };

  const identifyFromImage = async (imageDataUrl: string) => {
    setLoading(true);
    setError(null);
    setIdentifiedName(null);

    try {
      const response = await fetch(apiUrl('/api/gemini/identify-item'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageDataUrl }),
      });

      const text = await response.text();
      const trimmed = text.trim();

      if (!response.ok) {
        if (trimmed.startsWith('<')) {
          throw new Error('API not reachable — start the server with npm run dev.');
        }
        try {
          const errObj = JSON.parse(trimmed) as { error?: string; details?: string };
          const parts = [errObj.error, errObj.details].filter(Boolean);
          throw new Error(parts.length ? parts.join(' — ') : `HTTP ${response.status}`);
        } catch (parseErr) {
          if (parseErr instanceof SyntaxError) {
            throw new Error(trimmed || `HTTP ${response.status}`);
          }
          throw parseErr;
        }
      }

      const data = JSON.parse(trimmed) as { result?: string };
      const name = normalizeItemName(data.result ?? '');
      if (!name) {
        throw new Error('Could not identify the item — try a clearer photo.');
      }

      await copyTextToClipboard(name);
      setIdentifiedName(name);
      onIdentified?.(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to identify item');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file');
      return;
    }

    try {
      const compressed = await compressImage(file);
      await identifyFromImage(compressed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process photo');
    }
  };

  const handleCameraCapture = async () => {
    if (loading) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });

      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;

      const modal = document.createElement('div');
      modal.className = 'scout-item-identify-camera-modal';

      const videoContainer = document.createElement('div');
      videoContainer.className = 'scout-item-identify-camera-modal__video-wrap';
      video.className = 'scout-item-identify-camera-modal__video';

      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'scout-item-identify-camera-modal__actions';

      const captureButton = document.createElement('button');
      captureButton.type = 'button';
      captureButton.textContent = 'Capture';
      captureButton.className = 'scout-item-identify-camera-modal__capture';

      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.textContent = 'Cancel';
      cancelButton.className = 'scout-item-identify-camera-modal__cancel';

      const cleanup = () => {
        stream.getTracks().forEach((track) => track.stop());
        modal.remove();
      };

      captureButton.onclick = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup();
          setError('Failed to capture photo');
          return;
        }

        ctx.drawImage(video, 0, 0);
        canvas.toBlob(
          async (blob) => {
            cleanup();
            if (!blob) {
              setError('Failed to capture photo');
              return;
            }
            try {
              const file = new File([blob], 'camera-photo.jpg', { type: 'image/jpeg' });
              const compressed = await compressImage(file);
              await identifyFromImage(compressed);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed to process photo');
            }
          },
          'image/jpeg',
          0.9
        );
      };

      cancelButton.onclick = cleanup;

      videoContainer.appendChild(video);
      buttonContainer.appendChild(captureButton);
      buttonContainer.appendChild(cancelButton);
      modal.appendChild(videoContainer);
      modal.appendChild(buttonContainer);
      document.body.appendChild(modal);

      video.onloadedmetadata = () => {
        void video.play();
      };
    } catch (err) {
      setError('Unable to access camera — use Choose photo instead.');
      console.error('Camera access error:', err);
    }
  };

  return (
    <div className="ebay-search-container">
      <section className="scout-item-identify" aria-label="Image Lookup">
        <div className="scout-item-identify__header">
          <h3 className="scout-item-identify__title">Image Lookup</h3>
        </div>

        <div className="scout-item-identify__actions">
          <button
            type="button"
            className="scout-item-identify__button"
            onClick={handleCameraCapture}
            disabled={loading}
          >
            Take photo
          </button>
          <button
            type="button"
            className="scout-item-identify__button scout-item-identify__button--secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            Choose photo
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="scout-item-identify__file-input"
            onChange={handleFileChange}
          />
        </div>

        {loading && <p className="scout-item-identify__status">Identifying item…</p>}
        {identifiedName && (
          <div className="scout-item-identify__result" role="status">
            <span className="scout-item-identify__result-text">{identifiedName}</span>
            <button
              type="button"
              className="scout-item-identify__copy-btn"
              onClick={handleCopyResult}
              title="Copy to clipboard"
              aria-label="Copy to clipboard"
            >
              <span aria-hidden>📋</span>
            </button>
          </div>
        )}
        {error && (
          <p className="scout-item-identify__error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
};

export default ScoutItemIdentify;
