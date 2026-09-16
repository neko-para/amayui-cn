import { readFileSync } from 'node:fs';
import { parseMoc } from '../live2d/moc.js';
const f = process.argv[2]!;
try {
  const m = parseMoc(new Uint8Array(readFileSync(f)));
  console.log('OK', m.canvasWidth, m.canvasHeight, m.params.length, m.stats);
} catch (e) {
  console.log('ERR', (e as Error).message);
}
