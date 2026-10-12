// Webcam eye tracker built on MediaPipe Face Landmarker (478 landmarks incl. irises).
// Each frame produces a feature vector describing where the irises sit inside the eyes
// plus head pose; gazeModel.ts maps those features to screen coordinates.

import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision';

// Relative to Vite's base so the app also works when hosted under a subpath.
const WASM_PATH = `${import.meta.env.BASE_URL}mediapipe/wasm`;
const MODEL_PATH = `${import.meta.env.BASE_URL}mediapipe/face_landmarker.task`;

// MediaPipe face mesh indices. a/b are the eye corners in image left-to-right order,
// so both eyes share the same axis direction and their features move together.
export const EYES = {
  right: { a: 33, b: 133, upper: 159, lower: 145 },
  left: { a: 362, b: 263, upper: 386, lower: 374 },
};
export const IRIS_A = [468, 469, 470, 471, 472]; // center first, then ring
export const IRIS_B = [473, 474, 475, 476, 477];
export const EYE_CONTOURS = [
  [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
];

// Blink detection is relative to a rolling baseline of the user's own eye openness
// (lid gap / eye width), so it catches quick partial blinks while slow changes, like
// looking down, just move the baseline. Hysteresis keeps a blink from flickering.
const BLINK_ENTER_RATIO = 0.6; // openness below baseline * this starts a blink
const BLINK_EXIT_RATIO = 0.75; // and above baseline * this ends it
const BASELINE_FRAMES = 45; // ~1.5s of open-eye frames

export interface TrackerFrame {
  landmarks: NormalizedLandmark[] | null;
  features: number[] | null; // null when no face or mid-blink
  blinking: boolean;
}

type Listener = (frame: TrackerFrame) => void;

type Point = { x: number; y: number };

export class EyeTracker {
  readonly video: HTMLVideoElement;
  latest: TrackerFrame = { landmarks: null, features: null, blinking: false };
  private opennessHistory: number[] = [];
  private inBlink = false;

  private landmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private listener: Listener | null = null;
  private rafId = 0;
  private lastVideoTime = -1;

  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
  }

  onFrame(listener: Listener) {
    this.listener = listener;
  }

  async start() {
    // Ask for the camera first so permission problems surface before the model download.
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: 'VIDEO' as const,
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
    });
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options('GPU'));
    } catch (e) {
      console.warn('GPU delegate unavailable, falling back to CPU:', e);
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options('CPU'));
    }

    this.loop();
  }

  stop() {
    cancelAnimationFrame(this.rafId);
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.landmarker?.close();
    this.landmarker = null;
  }

  private loop = () => {
    this.rafId = requestAnimationFrame(this.loop);
    if (!this.landmarker || this.video.readyState < 2) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, performance.now());
    const landmarks = result.faceLandmarks[0] ?? null;
    const matrix = result.facialTransformationMatrixes?.[0]?.data ?? null;

    let frame: TrackerFrame = { landmarks: null, features: null, blinking: false };
    if (landmarks && landmarks.length >= 478) {
      frame = { landmarks, ...this.extractFeatures(landmarks, matrix) };
    }
    this.latest = frame;
    this.listener?.(frame);
  };

  private updateBlink(openness: number): boolean {
    const history = this.opennessHistory;
    if (history.length < 10) {
      history.push(openness);
      return false;
    }
    const baseline = [...history].sort((a, b) => a - b)[Math.floor(history.length / 2)];
    this.inBlink = this.inBlink
      ? openness < baseline * BLINK_EXIT_RATIO
      : openness < baseline * BLINK_ENTER_RATIO;
    if (!this.inBlink) {
      history.push(openness);
      if (history.length > BASELINE_FRAMES) history.shift();
    }
    return this.inBlink;
  }

  private extractFeatures(lm: NormalizedLandmark[], matrix: ArrayLike<number> | null) {
    const w = this.video.videoWidth || 640;
    const h = this.video.videoHeight || 480;
    const px = (i: number): Point => ({ x: lm[i].x * w, y: lm[i].y * h });

    const irisCenters = [px(IRIS_A[0]), px(IRIS_B[0])];

    const eyeFeatures = (eye: typeof EYES.right) => {
      const a = px(eye.a);
      const b = px(eye.b);
      const upper = px(eye.upper);
      const lower = px(eye.lower);
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const width = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      // Axis along the eye and its perpendicular, so head roll cancels out.
      const ux = (b.x - a.x) / width;
      const uy = (b.y - a.y) / width;
      const vx = -uy;
      const vy = ux;

      // Whichever iris is nearer this eye belongs to it.
      const iris = irisCenters.reduce((a, b) =>
        Math.hypot(a.x - center.x, a.y - center.y) <= Math.hypot(b.x - center.x, b.y - center.y) ? a : b
      );
      const dx = iris.x - center.x;
      const dy = iris.y - center.y;
      return {
        h: (dx * ux + dy * uy) / width,
        v: (dx * vx + dy * vy) / width,
        openness: Math.hypot(upper.x - lower.x, upper.y - lower.y) / width,
      };
    };

    const r = eyeFeatures(EYES.right);
    const l = eyeFeatures(EYES.left);
    const blinking = this.updateBlink((r.openness + l.openness) / 2);
    if (blinking) return { features: null, blinking };

    // Head pose from the column-major 4x4 transform: rotation angles + translation.
    let yaw = 0, pitch = 0, tx = 0, ty = 0, tz = 0;
    if (matrix && matrix.length >= 16) {
      const R = (row: number, col: number) => matrix[col * 4 + row];
      yaw = Math.atan2(-R(2, 0), Math.hypot(R(2, 1), R(2, 2)));
      pitch = Math.atan2(R(2, 1), R(2, 2));
      tx = matrix[12];
      ty = matrix[13];
      tz = matrix[14];
    }

    // Eye openness tracks vertical gaze too (lids follow the eyes), so it's a useful feature.
    const openness = (r.openness + l.openness) / 2;
    return { features: [r.h, r.v, l.h, l.v, openness, yaw, pitch, tx, ty, tz], blinking };
  }
}
