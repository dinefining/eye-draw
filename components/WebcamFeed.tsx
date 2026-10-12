import React, { useEffect, useRef } from 'react';
import { EyeTracker, EYE_CONTOURS, IRIS_A, IRIS_B } from '../tracker';

const GREEN = '#22c55e';
const RED = '#ef4444';

// Small outlined box in the top-right corner with vertically stretched text.
export const drawStatusLabel = (ctx: CanvasRenderingContext2D, text: string, color: string, canvasWidth: number) => {
  const STRETCH = 3.2;
  const PAD = 3;
  ctx.save();
  ctx.font = '700 9px "JetBrains Mono", monospace';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const m = ctx.measureText(text);
  const capHeight = m.actualBoundingBoxAscent;
  const boxW = m.width + PAD * 2;
  const boxH = capHeight * STRETCH + PAD * 2;
  const x = canvasWidth - 6 - boxW - 1;
  const y = 6;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, boxW, boxH);

  ctx.fillStyle = color;
  ctx.translate(x + PAD + 0.5, y + PAD + 0.5 + capHeight * STRETCH);
  ctx.scale(1, STRETCH);
  ctx.fillText(text, 0, 0);
  ctx.restore();
};

interface WebcamFeedProps {
  tracker: EyeTracker;
  width: number;
  height: number;
}

const WebcamFeed: React.FC<WebcamFeedProps> = ({ tracker, width: WIDTH, height: HEIGHT }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let rafId = 0;
    const render = () => {
      rafId = requestAnimationFrame(render);
      const video = tracker.video;
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      if (!video.videoWidth) return;

      // Cover-fit and mirror so it behaves like a mirror.
      const scale = Math.max(WIDTH / video.videoWidth, HEIGHT / video.videoHeight);
      const dw = video.videoWidth * scale;
      const dh = video.videoHeight * scale;
      const ox = (WIDTH - dw) / 2;
      const oy = (HEIGHT - dh) / 2;

      ctx.save();
      ctx.translate(WIDTH, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, ox, oy, dw, dh);
      ctx.restore();

      const { landmarks, blinking } = tracker.latest;
      if (landmarks) {
        const pt = (i: number) => ({
          x: WIDTH - (ox + landmarks[i].x * dw),
          y: oy + landmarks[i].y * dh,
        });

        ctx.strokeStyle = 'rgba(34, 197, 94, 0.7)';
        ctx.lineWidth = 1;
        for (const contour of EYE_CONTOURS) {
          ctx.beginPath();
          contour.forEach((i, k) => {
            const p = pt(i);
            k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
          });
          ctx.closePath();
          ctx.stroke();
        }

        if (!blinking) {
          for (const iris of [IRIS_A, IRIS_B]) {
            const c = pt(iris[0]);
            const radius =
              iris.slice(1).reduce((a, i) => {
                const p = pt(i);
                return a + Math.hypot(p.x - c.x, p.y - c.y);
              }, 0) / 4;
            ctx.beginPath();
            ctx.arc(c.x, c.y, Math.max(radius, 1.5), 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = GREEN;
            ctx.fillRect(c.x - 1, c.y - 1, 2, 2);
          }
        }
      }

      if (!landmarks) drawStatusLabel(ctx, 'NO FACE', RED, WIDTH);
      else if (blinking) drawStatusLabel(ctx, 'BLINK', GREEN, WIDTH);
    };

    render();
    return () => cancelAnimationFrame(rafId);
  }, [tracker, WIDTH, HEIGHT]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: WIDTH, height: HEIGHT }}
      className="block bg-black pointer-events-none"
    />
  );
};

export default WebcamFeed;
