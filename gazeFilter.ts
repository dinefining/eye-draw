// Gaze smoothing: a short median window knocks out single-frame tracking spikes,
// then a One Euro filter smooths heavily while the eyes are still and loosens up
// during fast movements so the line doesn't lag behind big saccades.

// Tuning knobs. Lower MIN_CUTOFF = smoother but laggier when fixating.
// Higher BETA = snappier on fast movements.
const MEDIAN_WINDOW = 5;
const MIN_CUTOFF = 0.4; // Hz
const BETA = 0.004;
const D_CUTOFF = 1.0; // Hz

const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

class OneEuro {
  private x: number | null = null;
  private dx = 0;

  filter(value: number, dt: number): number {
    if (this.x === null) {
      this.x = value;
      return value;
    }
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(D_CUTOFF, dt) * (rawDx - this.dx);
    const cutoff = MIN_CUTOFF + BETA * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset() {
    this.x = null;
    this.dx = 0;
  }
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

export class GazeFilter {
  private xs: number[] = [];
  private ys: number[] = [];
  private fx = new OneEuro();
  private fy = new OneEuro();
  private lastTime: number | null = null;

  push(x: number, y: number, time = performance.now()): { x: number; y: number } {
    this.xs.push(x);
    this.ys.push(y);
    if (this.xs.length > MEDIAN_WINDOW) {
      this.xs.shift();
      this.ys.shift();
    }

    const dt = this.lastTime === null ? 1 / 30 : Math.max((time - this.lastTime) / 1000, 1e-3);
    this.lastTime = time;

    return {
      x: this.fx.filter(median(this.xs), dt),
      y: this.fy.filter(median(this.ys), dt),
    };
  }

  reset() {
    this.xs = [];
    this.ys = [];
    this.fx.reset();
    this.fy.reset();
    this.lastTime = null;
  }
}
