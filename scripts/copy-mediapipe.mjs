// Copies MediaPipe's WebAssembly runtime into public/ so Vite serves it locally.
// Runs automatically after `npm install`.
import { cpSync, existsSync } from 'node:fs';

const from = 'node_modules/@mediapipe/tasks-vision/wasm';
const to = 'public/mediapipe/wasm';

if (!existsSync(from)) {
  console.error(`copy-mediapipe: ${from} not found. Run npm install first.`);
  process.exit(1);
}
cpSync(from, to, { recursive: true });
console.log(`copy-mediapipe: copied ${from} -> ${to}`);
