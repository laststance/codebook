import { lstat, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { BUILD_PACKAGES } from './packageConstants.mjs';

/** Binds build metadata and package snapshots to every source/configuration input before and after compilation. @example await readBuildIdentity(repository) // { revision, dirty, sourceHash, sourceHashes } */
export async function readBuildIdentity(repository) {
  const sourceHashes = [];
  for (const name of BUILD_PACKAGES) {
    const directory = join(repository, name);
    const files = ['package.json', 'pnpm-lock.yaml', 'tsconfig.json', ...(name === 'extension' ? ['pnpm-workspace.yaml', 'README.md'] : [])];
    for (const part of ['src', ...(name === 'extension' ? ['scripts', 'patches'] : ['fixture'])]) {
      const inputDirectory = join(directory, part);
      if (!(await lstat(inputDirectory)).isDirectory()) throw new Error(`Expected source directory: ${name}/${part}`);
      for (const entry of await readdir(inputDirectory, { recursive: true, withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error(`Source symlinks are not package inputs: ${name}/${part}/${entry.name}`);
        if (entry.isFile()) files.push(relative(directory, join(entry.parentPath, entry.name)));
      }
    }
    for (const file of files.sort()) {
      const input = join(directory, file);
      if (!(await lstat(input)).isFile()) throw new Error(`Expected source file: ${name}/${file}`);
      sourceHashes.push(`${name}/${file.split('\\').join('/')}:${createHash('sha256').update(await readFile(input)).digest('hex')}`);
    }
  }
  return {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim()),
    sourceHash: createHash('sha256').update(sourceHashes.join('\n')).digest('hex'), sourceHashes,
  };
}
