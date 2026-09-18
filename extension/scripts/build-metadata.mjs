import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const repository = resolve('..');
const hashes = [];
for (const name of ['extension', 'experiments/cycle-0001', 'experiments/cycle-0004']) {
  const directory = join(repository, name);
  const files = ['package.json', 'pnpm-lock.yaml', 'tsconfig.json', ...(name === 'extension' ? ['pnpm-workspace.yaml'] : [])];
  for (const part of ['src', ...(name !== 'extension' ? ['fixture'] : ['scripts', 'patches'])]) {
    for (const file of await readdir(join(directory, part), { recursive: true, withFileTypes: true })) {
      if (file.isFile()) files.push(join(file.parentPath, file.name).slice(directory.length + 1));
    }
  }
  for (const file of files.sort()) hashes.push(`${name}/${file}:${createHash('sha256').update(await readFile(join(directory, file))).digest('hex')}`);
}
const metadata = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim()),
  sourceHash: createHash('sha256').update(hashes.join('\n')).digest('hex'), sourceHashes: hashes };
await writeFile('dist/build.json', JSON.stringify(metadata, null, 2));
