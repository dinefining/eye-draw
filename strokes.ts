// Stroke model and rendering. A stroke stores the points placed by blinks and is rendered
// as straight segments or a smooth curve through them, stamped with the motif text.

export type Point = { x: number; y: number };
export type LineStyle = 'smooth' | 'sharp';
export type TextAngle = 'sit' | 'tilt';

export interface Stroke {
  motif: string;
  points: Point[];
}

export interface RenderStyle {
  lineStyle: LineStyle;
  textAngle: TextAngle; // sit: always upright; tilt: rotated to follow the line
  fontSize: number;
  trail: number; // extra gap between repeats of the text, px
}

export const FONT_FAMILY = '"JetBrains Mono"';
export const fontFor = (size: number) => `${size}px ${FONT_FAMILY}`;

// A stroke ending this close to its start is treated as a closed shape.
const CLOSE_DISTANCE = 70;

// Centripetal Catmull-Rom through the vertices: passes through every point without
// the loops/overshoot the uniform variant makes when points are unevenly spaced.
const catmullRom = (pts: Point[], closed: boolean, samplesPerSegment = 24): Point[] => {
  if (pts.length < 3) return pts;
  // Closed shapes wrap their control points so the curve has no kink where it meets itself.
  const ext = closed
    ? [pts[pts.length - 2], ...pts, pts[1]]
    : [pts[0], ...pts, pts[pts.length - 1]];
  const out: Point[] = [pts[0]];
  const tj = (ti: number, a: Point, b: Point) => ti + Math.max(Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)), 1e-4);

  for (let i = 0; i < ext.length - 3; i++) {
    const [p0, p1, p2, p3] = [ext[i], ext[i + 1], ext[i + 2], ext[i + 3]];
    const t0 = 0;
    const t1 = tj(t0, p0, p1);
    const t2 = tj(t1, p1, p2);
    const t3 = tj(t2, p2, p3);
    for (let s = 1; s <= samplesPerSegment; s++) {
      const t = t1 + ((t2 - t1) * s) / samplesPerSegment;
      const lerp = (a: Point, b: Point, ta: number, tb: number) => ({
        x: ((tb - t) * a.x + (t - ta) * b.x) / (tb - ta),
        y: ((tb - t) * a.y + (t - ta) * b.y) / (tb - ta),
      });
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2);
      const b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  return out;
};

const drawMotif = (ctx: CanvasRenderingContext2D, motif: string, p: Point, angle: number) => {
  if (angle === 0) {
    ctx.fillText(motif, p.x, p.y);
    return;
  }
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  ctx.fillText(motif, 0, 0);
  ctx.restore();
};

// Stamp the motif at even spacing along a polyline.
const stampPolyline = (
  ctx: CanvasRenderingContext2D,
  motif: string,
  path: Point[],
  closed: boolean,
  style: RenderStyle
) => {
  ctx.font = fontFor(style.fontSize);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const tilt = style.textAngle === 'tilt';
  let spacing = Math.max(ctx.measureText(motif).width + style.trail, 4);
  // On a closed shape, even out the spacing so the last stamp doesn't crowd the first.
  let stampsLeft = Infinity;
  if (closed) {
    let total = 0;
    for (let i = 1; i < path.length; i++) total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    const count = Math.max(Math.round(total / spacing), 1);
    spacing = total / count;
    stampsLeft = count - 1; // the first stamp is drawn below; the end point is the start again
  }
  const segAngle = (a: Point, b: Point) => (tilt ? Math.atan2(b.y - a.y, b.x - a.x) : 0);

  drawMotif(ctx, motif, path[0], path.length > 1 ? segAngle(path[0], path[1]) : 0);
  let carry = 0; // distance travelled since the last stamp
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const angle = segAngle(a, b);
    let d = spacing - carry;
    while (d <= len && stampsLeft > 0) {
      stampsLeft--;
      const t = d / len;
      drawMotif(ctx, motif, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, angle);
      d += spacing;
    }
    carry = len - (d - spacing);
  }
};

export const renderStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke, style: RenderStyle) => {
  let pts = stroke.points;
  if (pts.length === 0) return;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const closed = pts.length >= 4 && Math.hypot(last.x - first.x, last.y - first.y) < CLOSE_DISTANCE;
  // Snap the end onto the start so closed shapes actually meet.
  if (closed) pts = [...pts.slice(0, -1), first];
  const path = style.lineStyle === 'smooth' ? catmullRom(pts, closed) : pts;
  stampPolyline(ctx, stroke.motif, path, closed, style);
};
