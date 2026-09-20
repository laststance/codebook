import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { buildPackage } from './utils/buildPackage.mjs';

const arguments_ = process.argv.slice(2);
if (arguments_.length && (arguments_.length !== 2 || arguments_[0] !== '--out')) throw new Error('Usage: pnpm package [--out /path/to/codebook.vsix]');
const repository = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const destination = arguments_[1] ? resolve(arguments_[1]) : join(repository, 'artifacts/packages', `codebook-${manifest.version}.vsix`);
console.log(JSON.stringify(await buildPackage(repository, destination), null, 2));
