import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readVsixEntries } from './utils/readVsixEntries.mjs';
import { verifyPackageContent } from './utils/verifyPackageContent.mjs';

const [path, ...extra] = process.argv.slice(2);
if (!path || extra.length) throw new Error('Usage: pnpm package:check /path/to/codebook.vsix');
const checked = await verifyPackageContent(await readVsixEntries(path));
const bytes = await readFile(path);
console.log(JSON.stringify({ ...checked, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }, null, 2));
