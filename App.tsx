import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Menu, X } from 'lucide-react';
import WebcamFeed from './components/WebcamFeed';
import Instructions from './components/Instructions';
import { EyeTracker, type TrackerFrame } from './tracker';
import { GazeModel, type Sample } from './gazeModel';
import { GazeFilter } from './gazeFilter';
import { fontFor, renderStroke, type LineStyle, type Point, type RenderStyle, type Stroke, type TextAngle } from './strokes';

// Calibration: per target, ignore the first SETTLE_MS (eyes landing), then collect until COLLECT_MS.
const SETTLE_MS = 350;
const COLLECT_MS = 1200;
const MIN_SAMPLES_PER_TARGET = 8;
const INSET = 0.08;
const CALIBRATION_TARGETS = [
  { x: 0.5, y: 0.5 },
  { x: INSET, y: INSET }, { x: 0.5, y: INSET }, { x: 1 - INSET, y: INSET },
  { x: 1 - INSET, y: 0.5 }, { x: 1 - INSET, y: 1 - INSET }, { x: 0.5, y: 1 - INSET },
  { x: INSET, y: 1 - INSET }, { x: INSET, y: 0.5 },
  { x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }, { x: 0.75, y: 0.75 }, { x: 0.25, y: 0.75 },
];

// A point drops the moment a blink starts. Keeping the eyes closed for LIFT_BLINK_MS
// takes that point back and lifts the pen instead.
const LIFT_BLINK_MS = 1000;
// The point is the median gaze over this window before the blink, skipping the last
// moments where the closing lids drag the estimate downward.
const PRE_BLINK_WINDOW = { from: 400, to: 80 };
// A point this close to the previous one is treated as the same point.
const MIN_VERTEX_GAP = 30;

// Layout: corner buttons are BOX px square, EDGE px from the screen edge.
const BOX = 36;
const EDGE = 20;
const NARROW_WIDTH = 640; // below this, phone layout
const CROWDED_WIDTH = 760; // below this, menu and info can't both be open

const YELLOW = 'bg-[#FFD400]';

// Text styling controls.
const FONT_SIZES = { min: 8, max: 72, step: 2, initial: 16 };
const TRAIL = { min: 0, max: 120, initial: 8 };

// Camera icon with square corners, to match the boxy UI.
const CameraIcon: React.FC = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="miter">
    <rect x="2.5" y="6.5" width="13" height="11" />
    <path d="M15.5 10.5 L21.5 7 V17 L15.5 13.5" />
  </svg>
);

type Status = 'idle' | 'starting' | 'calibrating' | 'ready' | 'error';
type DrawingStatus = 'drawing' | 'paused';
type RedoEntry = { stroke: Stroke; point: Point; removedStroke: boolean };

const cameraErrorMessage = (error: unknown) => {
  const name = (error as { name?: string })?.name;
  if (name === 'NotAllowedError') return 'Camera access was blocked. Allow the camera for this site, then retry.';
  if (name === 'NotFoundError') return 'No camera found. Connect one, then retry.';
  if (name === 'NotReadableError') return 'Camera is in use by another app. Close it, then retry.';
  return `Could not start the eye tracker: ${(error as Error)?.message ?? error}`;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const useViewport = () => {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
};

const isTouchDevice = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;

// --- UI Components ---

const IconButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }> = ({
  children, active, className = '', style, ...props
}) => (
  <button
    {...props}
    style={{ width: BOX, height: BOX, ...style }}
    className={`absolute flex items-center justify-center border border-black ${active ? YELLOW : 'bg-white hover:bg-[#f5f5f5]'} ${className}`}
  >
    {children}
  </button>
);

const PanelButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ children, className = '', ...props }) => (
  <button
    {...props}
    className={`h-7 px-1 bg-[#e5e5e5] hover:bg-[#d4d4d4] text-xs whitespace-nowrap disabled:opacity-40 disabled:hover:bg-[#e5e5e5] ${className}`}
  >
    {children}
  </button>
);

// Range input styled as a filled bar with its label on top.
const SliderBar: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, onChange }) => (
  <label className="relative h-7 bg-[#e5e5e5] text-xs flex items-center justify-center overflow-hidden cursor-ew-resize">
    <div className="absolute inset-y-0 left-0 bg-[#c8c8c8]" style={{ width: `${((value - min) / (max - min)) * 100}%` }} />
    <span className="relative pointer-events-none whitespace-nowrap">{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
      aria-label={label}
    />
  </label>
);

interface MenuPanelProps {
  isTouch: boolean;
  drawingStatus: DrawingStatus;
  lineStyle: LineStyle;
  textAngle: TextAngle;
  fontSize: number;
  trail: number;
  activeMotif: string;
  style: React.CSSProperties;
  setActiveMotif: (motif: string) => void;
  onFontSize: (delta: number) => void;
  onTrail: (value: number) => void;
  onCalibrate: () => void;
  onToggleTracking: () => void;
  onToggleLines: () => void;
  onToggleAngle: () => void;
  onClear: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onLiftPen: () => void;
}

const MenuPanel: React.FC<MenuPanelProps> = ({
  isTouch, drawingStatus, lineStyle, textAngle, fontSize, trail, activeMotif, style, setActiveMotif,
  onFontSize, onTrail, onCalibrate, onToggleTracking, onToggleLines, onToggleAngle, onClear, onSave,
  onUndo, onRedo, onLiftPen,
}) => (
  <div className="absolute z-20 bg-white border border-black p-1.5 font-mono flex flex-col gap-1" style={style}>
    <div className="grid grid-cols-[1fr_1.75rem_1.75rem] gap-1">
      <input
        type="text"
        maxLength={10}
        value={activeMotif}
        onChange={e => setActiveMotif(e.target.value)}
        className="h-7 min-w-0 px-2 bg-[#ebebeb] text-xs focus:outline-none focus:ring-1 focus:ring-black"
        aria-label="Text to draw"
      />
      <PanelButton onClick={() => onFontSize(-1)} disabled={fontSize <= FONT_SIZES.min} aria-label="Smaller text">−</PanelButton>
      <PanelButton onClick={() => onFontSize(1)} disabled={fontSize >= FONT_SIZES.max} aria-label="Bigger text">+</PanelButton>
    </div>
    <div className="grid grid-cols-2 gap-1">
      <PanelButton onClick={onToggleTracking}>{drawingStatus === 'drawing' ? 'Pause' : 'Draw'}</PanelButton>
      <PanelButton onClick={onClear}>Clear</PanelButton>
    </div>
    <div className="grid grid-cols-3 gap-1">
      <SliderBar label={`trail ${trail}`} value={trail} min={TRAIL.min} max={TRAIL.max} onChange={onTrail} />
      {/* The button's own shape shows the corner style. */}
      <PanelButton onClick={onToggleLines} className={lineStyle === 'smooth' ? 'rounded-full' : ''}>
        {lineStyle === 'smooth' ? 'Smooth' : 'Sharp'}
      </PanelButton>
      <PanelButton onClick={onToggleAngle} title="Sit: text stays upright. Tilt: text follows the line">
        {textAngle === 'sit' ? 'Sit' : 'Tilt'}
      </PanelButton>
    </div>
    <div className="grid grid-cols-2 gap-1">
      <PanelButton onClick={onSave}>Save</PanelButton>
      <PanelButton onClick={onCalibrate} title="Recalibrate">Recal</PanelButton>
    </div>
    {isTouch && (
      <div className="grid grid-cols-3 gap-1">
        <PanelButton onClick={onUndo}>Undo</PanelButton>
        <PanelButton onClick={onRedo}>Redo</PanelButton>
        <PanelButton onClick={onLiftPen}>New line</PanelButton>
      </div>
    )}
  </div>
);

interface CalibrationTargetProps {
  x: number;
  y: number;
  collecting: boolean;
  onClick: () => void;
}

const CalibrationTarget: React.FC<CalibrationTargetProps> = ({ x, y, collecting, onClick }) => (
  <div className="fixed inset-0 z-40">
    <button
      onClick={onClick}
      disabled={collecting}
      className="absolute w-12 h-12 flex items-center justify-center -translate-x-1/2 -translate-y-1/2 cursor-pointer touch-manipulation"
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
      aria-label="Calibration target"
    >
      <div className="relative w-6 h-6 border-2 border-green-500 bg-white flex items-center justify-center">
        {/* Fills while samples are collected; keyed so the transition restarts per target. */}
        <div
          className="bg-green-500"
          style={{
            width: collecting ? '100%' : '0%',
            height: collecting ? '100%' : '0%',
            transition: collecting ? `width ${COLLECT_MS}ms linear, height ${COLLECT_MS}ms linear` : 'none',
          }}
        />
        <div className="absolute w-1 h-1 bg-black" />
      </div>
    </button>
  </div>
);

const App: React.FC = () => {
  const [status, setStatus] = useState<Status>('idle');
  const [drawingStatus, setDrawingStatus] = useState<DrawingStatus>('paused');
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [activeMotif, setActiveMotif] = useState<string>('|');
  const [message, setMessage] = useState<string | null>(null);
  const [tracker, setTracker] = useState<EyeTracker | null>(null);
  const [targetIndex, setTargetIndex] = useState(0);
  const [collecting, setCollecting] = useState(false);
  const [faceFound, setFaceFound] = useState(false);
  const [lineStyle, setLineStyle] = useState<LineStyle>('sharp');
  const [textAngle, setTextAngle] = useState<TextAngle>('sit');
  const [fontSize, setFontSize] = useState(FONT_SIZES.initial);
  const [trail, setTrail] = useState(TRAIL.initial);
  const [showInfo, setShowInfo] = useState(false);
  const [showMenu, setShowMenu] = useState(true);
  const [showFeed, setShowFeed] = useState(true);
  const [isTouch] = useState(isTouchDevice);
  const viewport = useViewport();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const cursorFillRef = useRef<HTMLDivElement>(null);

  const trackerRef = useRef<EyeTracker | null>(null);
  const modelRef = useRef(new GazeModel());
  const gazeFilterRef = useRef(new GazeFilter());

  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const redoStackRef = useRef<RedoEntry[]>([]);
  const isDrawingAllowedRef = useRef(false);
  const activeMotifRef = useRef(activeMotif);
  const renderStyleRef = useRef<RenderStyle>({ lineStyle, textAngle, fontSize, trail });
  const faceFoundRef = useRef(false);
  const blinkStartRef = useRef<number | null>(null);
  // The point placed by the current blink, so a long close can take it back.
  const blinkPointRef = useRef<{ stroke: Stroke; point: Point } | null>(null);
  const blinkLiftedRef = useRef(false);
  const gazeHistoryRef = useRef<{ t: number; x: number; y: number }[]>([]);
  const lastGazeRef = useRef<Point | null>(null);

  // Calibration sample collection state, read from the per-frame tracker callback.
  const samplesRef = useRef<Sample[]>([]);
  const collectRef = useRef<{ x: number; y: number; start: number; count: number } | null>(null);

  activeMotifRef.current = activeMotif;
  renderStyleRef.current = { lineStyle, textAngle, fontSize, trail };

  const isNarrow = viewport.width < NARROW_WIDTH;
  const feedSize = isNarrow ? { width: 144, height: 108 } : { width: 192, height: 144 };

  const redrawAll = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    strokesRef.current.forEach(s => renderStroke(ctx, s, renderStyleRef.current));
  }, []);

  // Size canvases at device pixel ratio so motifs render crisp on retina screens.
  const setupCanvas = useCallback(() => {
    const dpr = window.devicePixelRatio || 1;
    for (const canvas of [canvasRef.current, overlayRef.current]) {
      if (!canvas) continue;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    ctxRef.current = canvasRef.current?.getContext('2d') ?? null;
    redrawAll();
  }, [redrawAll]);

  useEffect(() => {
    setupCanvas();
    window.addEventListener('resize', setupCanvas);
    // Canvas text falls back to a default font until the web font has loaded; redraw once it has.
    document.fonts?.load(fontFor(FONT_SIZES.initial)).then(redrawAll).catch(() => {});
    return () => {
      window.removeEventListener('resize', setupCanvas);
      trackerRef.current?.stop();
    };
  }, [setupCanvas, redrawAll]);

  // Style controls apply to the whole drawing, so re-render whenever one changes.
  useEffect(redrawAll, [lineStyle, textAngle, fontSize, trail, redrawAll]);

  // Calibration done → show a short confirmation, then get out of the way.
  useEffect(() => {
    if (status !== 'ready' || !message) return;
    const id = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(id);
  }, [status, message]);

  const liftPen = useCallback(() => {
    currentStrokeRef.current = null;
  }, []);

  const addPoint = (p: Point): Stroke | null => {
    let stroke = currentStrokeRef.current;
    if (!stroke) {
      stroke = { motif: activeMotifRef.current, points: [] };
      strokesRef.current.push(stroke);
      currentStrokeRef.current = stroke;
    }
    const last = stroke.points[stroke.points.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < MIN_VERTEX_GAP) return null;
    stroke.points.push(p);
    redoStackRef.current = [];
    // Smooth curves reshape earlier segments as points arrive, so re-render everything.
    redrawAll();
    return stroke;
  };

  const drawOverlay = (gaze: Point | null) => {
    const canvas = overlayRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    const stroke = currentStrokeRef.current;
    if (!isDrawingAllowedRef.current || !stroke || stroke.points.length === 0) return;

    // Mark the active stroke's points and show where the next segment would go.
    ctx.fillStyle = '#22c55e';
    for (const p of stroke.points) ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    if (gaze) {
      const last = stroke.points[stroke.points.length - 1];
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(gaze.x, gaze.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };

  const flashCursor = () => {
    const fill = cursorFillRef.current;
    if (!fill) return;
    fill.style.transition = 'none';
    fill.style.transform = 'scale(1)';
    requestAnimationFrame(() => {
      fill.style.transition = 'transform 400ms ease-out';
      fill.style.transform = 'scale(0)';
    });
  };

  const handleBlinkStart = (start: number) => {
    blinkPointRef.current = null;
    blinkLiftedRef.current = false;
    if (!isDrawingAllowedRef.current) return;

    const recent = gazeHistoryRef.current.filter(
      s => s.t >= start - PRE_BLINK_WINDOW.from && s.t <= start - PRE_BLINK_WINDOW.to
    );
    if (recent.length < 3) return;
    const point = { x: median(recent.map(s => s.x)), y: median(recent.map(s => s.y)) };
    const stroke = addPoint(point);
    if (stroke) blinkPointRef.current = { stroke, point };
    flashCursor();
    drawOverlay(lastGazeRef.current);
  };

  // Eyes held shut: undo the point this blink placed and lift the pen.
  const handleLongClose = () => {
    blinkLiftedRef.current = true;
    if (!isDrawingAllowedRef.current) return;
    const placed = blinkPointRef.current;
    if (placed) {
      const i = placed.stroke.points.lastIndexOf(placed.point);
      if (i !== -1) placed.stroke.points.splice(i, 1);
      if (placed.stroke.points.length === 0) {
        strokesRef.current = strokesRef.current.filter(s => s !== placed.stroke);
      }
      blinkPointRef.current = null;
    }
    liftPen();
    redrawAll();
    drawOverlay(null);
  };

  const handleFrame = (frame: TrackerFrame) => {
    const now = performance.now();
    const found = !!frame.landmarks;
    if (found !== faceFoundRef.current) {
      faceFoundRef.current = found;
      setFaceFound(found);
    }

    if (frame.blinking) {
      if (blinkStartRef.current === null) {
        blinkStartRef.current = now;
        handleBlinkStart(now);
      } else if (!blinkLiftedRef.current && now - blinkStartRef.current >= LIFT_BLINK_MS) {
        handleLongClose();
      }
    } else if (found) {
      blinkStartRef.current = null;
    }

    const collect = collectRef.current;
    if (collect && frame.features && now - collect.start >= SETTLE_MS) {
      samplesRef.current.push({ features: frame.features, x: collect.x, y: collect.y });
      collect.count++;
    }

    if (!modelRef.current.fitted || !frame.features) return;

    const raw = modelRef.current.predict(frame.features);
    const clamped = {
      x: Math.min(Math.max(raw.x, 0), window.innerWidth),
      y: Math.min(Math.max(raw.y, 0), window.innerHeight),
    };
    const history = gazeHistoryRef.current;
    history.push({ t: now, ...clamped });
    while (history.length && history[0].t < now - 1500) history.shift();

    const gaze = gazeFilterRef.current.push(clamped.x, clamped.y);
    lastGazeRef.current = gaze;

    if (cursorRef.current) {
      cursorRef.current.style.transform = `translate(${gaze.x - 12}px, ${gaze.y - 12}px)`;
    }
    drawOverlay(gaze);
  };

  // The tracker holds one callback for its lifetime; route it to the latest render's handler.
  const handleFrameRef = useRef(handleFrame);
  handleFrameRef.current = handleFrame;

  const startTracker = async (): Promise<boolean> => {
    if (trackerRef.current) return true;
    setStatus('starting');
    setMessage('Starting camera and loading the face model…');
    const t = new EyeTracker();
    t.onFrame(frame => handleFrameRef.current(frame));
    try {
      await t.start();
    } catch (error) {
      console.error('Failed to start eye tracker:', error);
      t.stop();
      setMessage(cameraErrorMessage(error));
      setStatus('error');
      return false;
    }
    trackerRef.current = t;
    setTracker(t);
    setShowFeed(true);
    setMessage(null);
    setStatus(isCalibrated ? 'ready' : 'idle');
    return true;
  };

  const handleCalibrate = async () => {
    setShowInfo(false);
    isDrawingAllowedRef.current = false;
    liftPen();
    setDrawingStatus('paused');
    if (!(await startTracker())) return;
    samplesRef.current = [];
    collectRef.current = null;
    setTargetIndex(0);
    setCollecting(false);
    setShowFeed(true);
    setMessage(null);
    setStatus('calibrating');
  };

  const handleTargetClick = () => {
    const target = CALIBRATION_TARGETS[targetIndex];
    collectRef.current = {
      x: target.x * window.innerWidth,
      y: target.y * window.innerHeight,
      start: performance.now(),
      count: 0,
    };
    setCollecting(true);

    setTimeout(() => {
      const collected = collectRef.current?.count ?? 0;
      collectRef.current = null;
      setCollecting(false);

      if (collected < MIN_SAMPLES_PER_TARGET) {
        // Drop partial samples for this target and ask again.
        samplesRef.current = samplesRef.current.slice(0, samplesRef.current.length - collected);
        setMessage("Couldn't see your eyes clearly. Keep your face in view and click the square again.");
        return;
      }
      setMessage(null);

      if (targetIndex < CALIBRATION_TARGETS.length - 1) {
        setTargetIndex(targetIndex + 1);
        return;
      }

      const samples = samplesRef.current;
      const model = new GazeModel();
      model.fit(samples);
      modelRef.current = model;
      gazeFilterRef.current.reset();

      const err =
        samples.reduce((a, s) => {
          const p = model.predict(s.features);
          return a + Math.hypot(p.x - s.x, p.y - s.y);
        }, 0) / samples.length;

      setIsCalibrated(true);
      setShowMenu(true);
      setDrawingStatus('paused');
      setStatus('ready');
      setMessage(
        `Calibrated (avg error ~${Math.round(err)}px). ${isTouch ? 'Tap Draw' : 'Press Draw or Space'}, then look and blink to place points.`
      );
    }, COLLECT_MS);
  };

  const handleToggleTracking = () => {
    if (drawingStatus === 'drawing') {
      isDrawingAllowedRef.current = false;
      liftPen();
      drawOverlay(null);
      setDrawingStatus('paused');
    } else if (isCalibrated && status === 'ready') {
      liftPen();
      isDrawingAllowedRef.current = true;
      setMessage(null);
      setDrawingStatus('drawing');
    }
  };

  // Undo removes the most recent point anywhere in the drawing; an emptied stroke goes with it.
  const handleUndo = () => {
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    const point = stroke?.points.pop();
    if (!stroke || !point) return;
    const removedStroke = stroke.points.length === 0;
    if (removedStroke) {
      strokesRef.current.pop();
      if (currentStrokeRef.current === stroke) liftPen();
    }
    redoStackRef.current.push({ stroke, point, removedStroke });
    redrawAll();
    drawOverlay(lastGazeRef.current);
  };

  const handleRedo = () => {
    const entry = redoStackRef.current.pop();
    if (!entry) return;
    if (entry.removedStroke) strokesRef.current.push(entry.stroke);
    entry.stroke.points.push(entry.point);
    currentStrokeRef.current = entry.stroke;
    redrawAll();
    drawOverlay(lastGazeRef.current);
  };

  const handleLiftPen = () => {
    liftPen();
    drawOverlay(lastGazeRef.current);
  };

  const handleToggleLines = () => setLineStyle(v => (v === 'smooth' ? 'sharp' : 'smooth'));
  const handleToggleAngle = () => setTextAngle(v => (v === 'sit' ? 'tilt' : 'sit'));
  const handleFontSize = (direction: number) =>
    setFontSize(v => Math.min(Math.max(v + direction * FONT_SIZES.step, FONT_SIZES.min), FONT_SIZES.max));

  const handleMotifChange = (motif: string) => {
    // New text starts a new stroke rather than restyling the current one.
    liftPen();
    setActiveMotif(motif);
  };

  const handleClearCanvas = () => {
    strokesRef.current = [];
    redoStackRef.current = [];
    liftPen();
    redrawAll();
    drawOverlay(null);
  };

  const handleSaveJPEG = () => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;

    if (canvas && ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      const link = document.createElement('a');
      link.download = 'eye-draw.jpeg';
      link.href = dataUrl;
      link.click();

      ctx.restore();
      redrawAll();
    }
  };

  // When space is tight, the menu and info panel replace each other.
  const crowded = viewport.width < CROWDED_WIDTH;
  const toggleInfo = () => {
    if (!showInfo && crowded) setShowMenu(false);
    setShowInfo(!showInfo);
  };
  const toggleMenu = () => {
    if (!showMenu && crowded) setShowInfo(false);
    setShowMenu(!showMenu);
  };

  // Keyboard shortcuts, so you don't have to look away from the drawing to the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'Escape' && showInfo) {
        setShowInfo(false);
        return;
      }
      if (status !== 'ready' || !isCalibrated) return;

      if (e.key === ' ') {
        e.preventDefault();
        // Stop a focused button from also receiving the space press.
        (document.activeElement as HTMLElement | null)?.blur();
        handleToggleTracking();
      } else if ((e.key === 'z' || e.key === 'Z') && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      } else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') {
        e.preventDefault();
        handleUndo();
      } else if (e.key === 'Escape') {
        handleLiftPen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const isCalibrating = status === 'calibrating';
  const target = CALIBRATION_TARGETS[targetIndex];

  let toast = message;
  if (isCalibrating && !message) {
    toast = faceFound
      ? `Look at the green square and ${isTouch ? 'tap' : 'click'} it. Keep looking until it fills. (${targetIndex + 1}/${CALIBRATION_TARGETS.length})`
      : 'No face detected. Center your face in the camera view.';
  }
  // Keep the toast away from the current calibration target and, on phones, clear of the
  // corner controls by putting it under the camera feed.
  const feedBottom = EDGE + (tracker && showFeed ? feedSize.height : BOX) + 8;
  const toastAtTop = isCalibrating ? target.y > 0.5 : isNarrow;
  const toastStyle: React.CSSProperties = toastAtTop
    ? { top: isNarrow ? feedBottom : EDGE }
    : { bottom: EDGE };
  const feedObscuresTarget =
    isCalibrating &&
    target.x * viewport.width < EDGE + feedSize.width + 24 &&
    target.y * viewport.height < EDGE + feedSize.height + 24;

  // Panels sit flush against the corner button that opened them.
  const besideBox = EDGE + BOX - 1;
  // Fit panels between the two bottom corner buttons so neither covers the other.
  const panelMaxWidth = viewport.width - 2 * besideBox;

  return (
    <div className="fixed inset-0 overflow-hidden select-none font-mono bg-white">
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full" />
      <canvas ref={overlayRef} className="absolute top-0 left-0 w-full h-full pointer-events-none" />

      {/* Top left: webcam feed, or the button that opens it. */}
      {tracker && showFeed ? (
        <div
          className="absolute z-30 border border-black transition-opacity"
          style={{
            top: EDGE,
            left: EDGE,
            opacity: feedObscuresTarget ? 0.15 : 1,
            pointerEvents: feedObscuresTarget ? 'none' : 'auto',
          }}
        >
          <WebcamFeed tracker={tracker} width={feedSize.width} height={feedSize.height} />
          {!isCalibrating && (
            <button
              onClick={() => setShowFeed(false)}
              className="absolute -top-px -left-px flex items-center justify-center text-white"
              style={{ width: BOX, height: BOX }}
              aria-label="Hide camera"
            >
              <X size={22} strokeWidth={1.5} />
            </button>
          )}
        </div>
      ) : (
        !isCalibrating && (
          <IconButton
            className="z-30"
            style={{ top: EDGE, left: EDGE }}
            onClick={async () => {
              if (await startTracker()) setShowFeed(true);
            }}
            aria-label="Show camera"
          >
            <CameraIcon />
          </IconButton>
        )
      )}

      {isCalibrating && (
        <CalibrationTarget
          key={targetIndex}
          x={target.x}
          y={target.y}
          collecting={collecting}
          onClick={handleTargetClick}
        />
      )}

      {/* Gaze cursor; the inner dot flashes when a point is placed. */}
      <div
        ref={cursorRef}
        className="absolute top-0 left-0 w-6 h-6 border-2 border-green-500 pointer-events-none z-50 rounded-full"
        style={{ visibility: isCalibrated && status === 'ready' ? 'visible' : 'hidden' }}
      >
        <div ref={cursorFillRef} className="w-full h-full rounded-full bg-green-500/70" style={{ transform: 'scale(0)' }} />
      </div>

      {toast && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 z-[45] bg-white border border-black px-3 py-2 text-xs leading-4 ${
            status === 'error' ? 'text-red-600' : ''
          }`}
          style={{ ...toastStyle, width: 'max-content', maxWidth: `min(28rem, ${viewport.width - 2 * EDGE}px)` }}
        >
          {toast}
        </div>
      )}

      {!isCalibrating && (
        <>
          {/* Bottom left: info. */}
          <IconButton
            active={showInfo}
            className="z-[61] text-base"
            style={{ bottom: EDGE, left: EDGE }}
            onClick={toggleInfo}
            aria-label={showInfo ? 'Close info' : 'About EYE DRAW'}
          >
            {showInfo ? <X size={20} strokeWidth={1.5} /> : 'i'}
          </IconButton>
          {showInfo && (
            <Instructions
              isCalibrated={isCalibrated}
              isTouch={isTouch}
              onCalibrate={handleCalibrate}
              // Phones get a full-screen overlay; there's no room for a panel beside the button.
              fullScreen={isNarrow}
              style={
                isNarrow
                  ? { padding: `${EDGE}px ${EDGE}px ${EDGE + BOX + 16}px` }
                  : {
                      bottom: EDGE,
                      left: besideBox,
                      width: Math.min(384, panelMaxWidth),
                      maxHeight: viewport.height - 2 * EDGE - BOX - 8,
                    }
              }
            />
          )}

          {/* Bottom right: Calibrate until calibrated, then the menu. */}
          {!isCalibrated ? (
            <button
              onClick={handleCalibrate}
              disabled={status === 'starting'}
              className={`absolute z-[21] px-3 border border-black text-sm ${YELLOW} disabled:opacity-60`}
              style={{ bottom: EDGE, right: EDGE, height: BOX }}
            >
              {status === 'error' ? 'Retry' : status === 'starting' ? 'Starting…' : 'Calibrate'}
            </button>
          ) : (
            <>
              <IconButton
                active={showMenu}
                className="z-[21]"
                style={{ bottom: EDGE, right: EDGE }}
                onClick={toggleMenu}
                aria-label={showMenu ? 'Close menu' : 'Open menu'}
              >
                {showMenu ? <X size={20} strokeWidth={1.5} /> : <Menu size={22} strokeWidth={1.5} />}
              </IconButton>
              {showMenu && (
                <MenuPanel
                  isTouch={isTouch}
                  drawingStatus={drawingStatus}
                  lineStyle={lineStyle}
                  textAngle={textAngle}
                  fontSize={fontSize}
                  trail={trail}
                  activeMotif={activeMotif}
                  style={{ bottom: EDGE, right: besideBox, width: Math.min(300, panelMaxWidth) }}
                  setActiveMotif={handleMotifChange}
                  onFontSize={handleFontSize}
                  onTrail={setTrail}
                  onCalibrate={handleCalibrate}
                  onToggleTracking={handleToggleTracking}
                  onToggleLines={handleToggleLines}
                  onToggleAngle={handleToggleAngle}
                  onClear={handleClearCanvas}
                  onSave={handleSaveJPEG}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  onLiftPen={handleLiftPen}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

export default App;
