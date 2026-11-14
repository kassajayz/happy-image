// main.ts - copies the contest entry (entry.png, beside this file) into the
// output directory given by MAKEFUN_OUTPUT_DIR, falling back to /output.
// Byte-for-byte copy, so running it twice writes identical output.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const source = path.join(import.meta.dirname, 'entry.png');
if (!existsSync(source)) {
  console.error(`entry.png not found next to main.ts: ${source}`);
  process.exit(1);
}

const target = path.join(process.env.MAKEFUN_OUTPUT_DIR ?? '/output', 'entry.png');
mkdirSync(path.dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`copied ${source} -> ${target}`);
