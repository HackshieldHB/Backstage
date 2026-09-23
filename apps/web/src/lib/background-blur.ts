'use client';

/**
 * Client-side background blur for a camera track, powered by MediaPipe Selfie
 * Segmentation. The model + wasm are loaded lazily from a CDN the first time
 * blur is switched on, so there is no build-time dependency and no cost for
 * users who never enable it.
 *
 * Usage: `const out = await processor.start(rawCameraTrack)` returns a NEW video
 * track (a canvas capture) that renders the person sharp over a blurred copy of
 * the background. Call `stop()` to tear the pipeline down. The raw input track is
 * left untouched (the caller owns stopping it).
 */

const MEDIAPIPE_VERSION = '0.1.1675465747';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@${MEDIAPIPE_VERSION}`;

interface SelfieSegmentationResults {
  image: CanvasImageSource;
  segmentationMask: CanvasImageSource;
}
interface SelfieSegmentationLike {
  setOptions(o: { modelSelection: number; selfieMode?: boolean }): void;
  onResults(cb: (r: SelfieSegmentationResults) => void): void;
  send(input: { image: HTMLVideoElement }): Promise<void>;
  close(): Promise<void>;
}
type SelfieSegmentationCtor = new (config: { locateFile: (file: string) => string }) => SelfieSegmentationLike;

let scriptPromise: Promise<SelfieSegmentationCtor> | null = null;

/** Injects the MediaPipe UMD bundle once and resolves the global constructor. */
function loadMediaPipe(): Promise<SelfieSegmentationCtor> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  const existing = (window as unknown as { SelfieSegmentation?: SelfieSegmentationCtor }).SelfieSegmentation;
  if (existing) return Promise.resolve(existing);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<SelfieSegmentationCtor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${CDN_BASE}/selfie_segmentation.js`;
    script.crossOrigin = 'anonymous';
    script.async = true;
    script.onload = () => {
      const ctor = (window as unknown as { SelfieSegmentation?: SelfieSegmentationCtor }).SelfieSegmentation;
      if (ctor) resolve(ctor);
      else reject(new Error('SelfieSegmentation global missing after load'));
    };
    script.onerror = () => {
      scriptPromise = null; // allow a later retry
      reject(new Error('Failed to load MediaPipe from CDN'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** True when the browser can run the segmentation pipeline at all. */
export function backgroundBlurSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

export type BackgroundKind = 'blur' | 'image';

export class BackgroundBlurProcessor {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private seg: SelfieSegmentationLike | null = null;
  private output: MediaStream | null = null;
  private raf = 0;
  private stopped = false;
  private kind: BackgroundKind = 'blur';
  private image: HTMLImageElement | null = null;

  /** Change the background live (blur ⇄ image) without rebuilding the pipeline. */
  setBackground(kind: BackgroundKind, image?: HTMLImageElement | null) {
    this.kind = kind;
    if (image !== undefined) this.image = image;
  }

  /** Build the pipeline from a raw camera track; returns the processed track. */
  async start(
    inputTrack: MediaStreamTrack,
    opts: { kind?: BackgroundKind; image?: HTMLImageElement | null } = {},
  ): Promise<MediaStreamTrack> {
    this.kind = opts.kind ?? 'blur';
    this.image = opts.image ?? null;
    const Ctor = await loadMediaPipe();
    this.stopped = false;

    const settings = inputTrack.getSettings();
    const width = settings.width ?? 640;
    const height = settings.height ?? 480;

    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([inputTrack]);
    await video.play().catch(() => undefined);
    this.video = video;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    const seg = new Ctor({ locateFile: (file) => `${CDN_BASE}/${file}` });
    seg.setOptions({ modelSelection: 1, selfieMode: false });
    seg.onResults((results) => this.draw(results, width, height));
    this.seg = seg;

    // Serialized pump: schedule the next send only after the current one resolves,
    // so the model is never called re-entrantly.
    const pump = async () => {
      if (this.stopped) return;
      if (this.video && this.video.readyState >= 2) {
        try {
          await seg.send({ image: this.video });
        } catch {
          /* transient — try again next frame */
        }
      }
      this.raf = requestAnimationFrame(pump);
    };
    this.raf = requestAnimationFrame(pump);

    this.output = canvas.captureStream(30);
    const track = this.output.getVideoTracks()[0];
    if (!track) throw new Error('canvas.captureStream produced no video track');
    return track;
  }

  private draw(results: SelfieSegmentationResults, w: number, h: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    // 1) draw the segmentation mask, 2) keep only the person where the mask is,
    // 3) paint the chosen background behind them (blurred frame, or a cover-fit image).
    ctx.drawImage(results.segmentationMask, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(results.image, 0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-over';
    if (this.kind === 'image' && this.image && this.image.complete && this.image.naturalWidth) {
      this.drawCover(ctx, this.image, w, h);
    } else {
      ctx.filter = 'blur(10px)';
      ctx.drawImage(results.image, 0, 0, w, h);
    }
    ctx.restore();
  }

  /** Draw an image so it covers the whole canvas (object-fit: cover), centered. */
  private drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
    const ir = img.naturalWidth / img.naturalHeight;
    const cr = w / h;
    let dw = w;
    let dh = h;
    if (ir > cr) {
      dh = h;
      dw = h * ir;
    } else {
      dw = w;
      dh = w / ir;
    }
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  stop() {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.output?.getTracks().forEach((t) => t.stop());
    this.output = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.canvas = null;
    this.ctx = null;
    // close() releases the wasm graph; ignore errors on teardown.
    this.seg?.close().catch(() => undefined);
    this.seg = null;
  }
}
