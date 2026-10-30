/**
 * Earth texture download and decode, kept off the main thread.
 *
 * `THREE.TextureLoader` hands WebGL an `<img>`, which the browser decodes
 * synchronously inside `texImage2D`: about 0.15 s for a 4k map and 0.7 s for
 * each 8k map, freezing the page. `createImageBitmap` decodes on a worker
 * thread, leaving only a short GPU copy for the caller.
 */

declare global {
  interface Window {
    /** Blob requests started by the inline script in `index.html`, keyed by absolute URL. */
    __earthPrefetch?: Record<string, Promise<Blob>>;
  }
}

/** A decoded image ready for `new THREE.Texture()`, already flipped for WebGL. */
export interface DecodedImage {
  image: ImageBitmap | HTMLImageElement;
  /** Value for `texture.flipY`; ImageBitmaps are flipped while decoding. */
  flipY: boolean;
  /** Release the decoded pixels once they are on the GPU. */
  release: () => void;
}

const absoluteUrl = (url: string) => new URL(url, document.baseURI).href;

async function fetchBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.blob();
}

/** Reuse the request `index.html` started before the scripts downloaded. */
function earthImageBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const prefetched = window.__earthPrefetch?.[absoluteUrl(url)];
  return prefetched ? prefetched.catch(() => fetchBlob(url, signal)) : fetchBlob(url, signal);
}

async function decodeWithImageElement(blob: Blob): Promise<DecodedImage> {
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.src = objectUrl;
  try {
    await image.decode();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return { image, flipY: true, release: () => {} };
}

export async function loadEarthImage(url: string, signal?: AbortSignal): Promise<DecodedImage> {
  const blob = await earthImageBlob(url, signal);
  if (typeof createImageBitmap !== "function") return decodeWithImageElement(blob);
  try {
    const image = await createImageBitmap(blob, {
      imageOrientation: "flipY",
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    return { image, flipY: false, release: () => image.close() };
  } catch {
    // Older Safari rejects some ImageBitmap options.
    return decodeWithImageElement(blob);
  }
}

/** Resolve after the browser has painted at least one more frame. */
export const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Resolve when the page is idle, so optional downloads do not slow startup. */
export const whenIdle = (timeoutMs = 2000) =>
  new Promise<void>((resolve) => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: timeoutMs });
    else setTimeout(resolve, 300);
  });

/** Skip optional 8k downloads when the user asked the browser to save data. */
export function prefersReducedData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

/** Fade out the startup overlay from `index.html` once the globe can be drawn. */
export function hideBootSplash(): void {
  const splash = document.getElementById("boot-splash");
  if (!splash || splash.dataset.state === "done") return;
  splash.dataset.state = "done";
  setTimeout(() => splash.remove(), 400);
}

/** Show startup progress on the overlay, e.g. "地球を読み込み中 2/3". */
export function setBootSplashStatus(text: string): void {
  const status = document.getElementById("boot-splash-status");
  if (status) status.textContent = text;
}
