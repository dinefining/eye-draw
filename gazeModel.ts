// Maps tracker features to screen coordinates with ridge regression,
// fitted from samples collected while the user looks at calibration targets.

// Higher = more regularisation (stabler, less precise). Features are standardised first.
const RIDGE_LAMBDA = 0.5;

// Add a few quadratic iris terms so the mapping can bend near screen edges.
const expand = (f: number[]) => {
  const h = (f[0] + f[2]) / 2;
  const v = (f[1] + f[3]) / 2;
  return [...f, h * h, v * v, h * v];
};

// Solve A x = b (A square) by Gaussian elimination with partial pivoting.
const solve = (A: number[][], b: number[]): number[] => {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / d;
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
};

export interface Sample {
  features: number[];
  x: number;
  y: number;
}

export class GazeModel {
  private mean: number[] = [];
  private std: number[] = [];
  private wx: number[] = [];
  private wy: number[] = [];
  private bx = 0;
  private by = 0;
  fitted = false;

  fit(samples: Sample[]) {
    const X = samples.map(s => expand(s.features));
    const n = X.length;
    const d = X[0].length;

    this.mean = Array.from({ length: d }, (_, j) => X.reduce((a, r) => a + r[j], 0) / n);
    this.std = Array.from({ length: d }, (_, j) =>
      Math.sqrt(X.reduce((a, r) => a + (r[j] - this.mean[j]) ** 2, 0) / n) || 1
    );
    const Z = X.map(r => r.map((v, j) => (v - this.mean[j]) / this.std[j]));

    this.bx = samples.reduce((a, s) => a + s.x, 0) / n;
    this.by = samples.reduce((a, s) => a + s.y, 0) / n;

    const ZtZ = Array.from({ length: d }, (_, i) =>
      Array.from({ length: d }, (_, j) => Z.reduce((a, r) => a + r[i] * r[j], 0) + (i === j ? RIDGE_LAMBDA * n * 0.01 : 0))
    );
    const Zty = (target: number[]) =>
      Array.from({ length: d }, (_, i) => Z.reduce((a, r, k) => a + r[i] * target[k], 0));

    this.wx = solve(ZtZ, Zty(samples.map(s => s.x - this.bx)));
    this.wy = solve(ZtZ, Zty(samples.map(s => s.y - this.by)));
    this.fitted = true;
  }

  predict(features: number[]): { x: number; y: number } {
    const z = expand(features).map((v, j) => (v - this.mean[j]) / this.std[j]);
    return {
      x: this.bx + z.reduce((a, v, j) => a + v * this.wx[j], 0),
      y: this.by + z.reduce((a, v, j) => a + v * this.wy[j], 0),
    };
  }
}
