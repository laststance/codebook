import { fileURLToPath } from 'node:url';
import { prepareDemo } from './utils/prepareDemo.mjs';

await prepareDemo(fileURLToPath(new URL('../../experiments/cycle-0004/', import.meta.url)), fileURLToPath(new URL('../dist/demo', import.meta.url)));
