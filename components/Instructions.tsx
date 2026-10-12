import React from 'react';

interface InstructionsProps {
  isCalibrated: boolean;
  isTouch: boolean;
  onCalibrate: () => void;
  style?: React.CSSProperties;
}

const Mark: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <span className={`bg-[#FFD400] px-0.5 ${className}`}>{children}</span>
);

const GreenMark: React.FC<{ children: React.ReactNode; href?: string }> = ({ children, href }) =>
  href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="bg-[#22c55e] px-0.5 hover:bg-black hover:text-[#22c55e]">
      {children}
    </a>
  ) : (
    <span className="bg-[#22c55e] px-0.5">{children}</span>
  );

// JetBrains Mono has no ⌫ glyph, and the fallback font draws it tiny.
const SYMBOL = 'text-sm leading-none';

const Instructions: React.FC<InstructionsProps> = ({ isCalibrated, isTouch, onCalibrate, style }) => (
  <div
    className="absolute z-[60] bg-white border border-black font-mono text-xs leading-5 p-4 overflow-y-auto"
    style={style}
  >
    <p><GreenMark>EYE DRAW</GreenMark> is a tool to draw trails of text with your eyes.</p>

    <p className="mt-3">
      <button onClick={onCalibrate} className="bg-[#FFD400] px-0.5 underline underline-offset-2 hover:bg-black hover:text-[#FFD400]">
        {isCalibrated ? 'Recalibrate' : 'Calibrate'}
      </button>{' '}
      and follow the instructions. The closer you sit to the screen, the more accurate it is, as long as your
      whole face stays in the camera view.
    </p>

    <p className="mt-3">
      After calibration, type in the text you want to draw. The cursor follows your gaze but draws nothing on its
      own. Blink to drop a point where you were looking; each new point joins the last with a trail of your text.
    </p>

    <p className="mt-3">
      Size the text with <Mark>−</Mark> <Mark>+</Mark> and space it out with the <Mark>trail</Mark> slider. Toggle
      between <Mark>Sharp</Mark> or <Mark>Smooth</Mark> corners, and let the text <Mark>Sit</Mark> upright or{' '}
      <Mark>Tilt</Mark> along the line. And <Mark>Save</Mark> your art once you're satisfied.
    </p>

    {isTouch ? (
      <p className="mt-3">
        Use <Mark>Undo</Mark>, <Mark>Redo</Mark> and <Mark>New line</Mark> in the menu to fix points or start a
        separate line.
      </p>
    ) : (
      <>
        <p className="mt-3 font-bold">Shortcuts</p>
        <ul>
          <li><Mark>Space</Mark> draw / pause</li>
          <li><Mark>Z</Mark> or <Mark className={SYMBOL}>⌫</Mark> undo last point</li>
          <li><Mark>Shift</Mark> + <Mark>Z</Mark> redo</li>
          <li><Mark>Esc</Mark> lift pen</li>
        </ul>
      </>
    )}

    <p className="mt-3">
      A <GreenMark href="https://maybemachines.com">Maybe Machine</GreenMark> by{' '}
      <GreenMark href="https://ravipopat.info">Ravi Popat</GreenMark>.
    </p>
  </div>
);

export default Instructions;
