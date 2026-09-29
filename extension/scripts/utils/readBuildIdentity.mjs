import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { BUILD_PACKAGES, PACKAGE_COMMAND_OUTPUT_BYTES, PACKAGE_COMMAND_TIMEOUT_MS } from './packageConstants.mjs';

/** Captures source provenance for metadata and {@link buildPackage}; the final check excludes only its owned untracked scratch. @example await readBuildIdentity(repository) // { revision, dirty, sourceHash, sourceHashes } */
export async function readBuildIdentity(repository, ownedScratchDirectory) {
  // Ignore ambient Git overrides and replacement objects: recorded revisions must name their stored source tree.
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
  const gitOptions = { cwd: repository, env: environment, encoding: 'utf8', timeout: PACKAGE_COMMAND_TIMEOUT_MS, maxBuffer: PACKAGE_COMMAND_OUTPUT_BYTES };
  const revision = execFileSync('git', ['--no-replace-objects', 'rev-parse', 'HEAD'], gitOptions).trim();
  const objectFormat = execFileSync('git', ['--no-replace-objects', 'rev-parse', '--show-object-format'], gitOptions).trim();
  if (!['sha1', 'sha256'].includes(objectFormat)) throw new Error(`Unsupported Git object format: ${objectFormat}`);
  const headInputs = new Map();
  for (const entry of execFileSync('git', ['--no-replace-objects', 'ls-tree', '-r', '-z', '--full-tree', revision, '--', ...BUILD_PACKAGES], gitOptions).split('\0')) {
    if (!entry) continue;
    const separator = entry.indexOf('\t'), [mode, type, object] = entry.slice(0, separator).split(' ');
    headInputs.set(entry.slice(separator + 1), type === 'blob' && ['100644', '100755'].includes(mode) ? object : undefined);
  }
  const sourceHashes = []; let selectedInputsDifferFromHead = false;
  for (const name of BUILD_PACKAGES) {
    const directory = join(repository, name);
    const files = ['package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'pnpm-workspace.yaml', 'README.md'];
    const parts = ['src', 'scripts', 'patches', 'skills'];
    for (const part of parts) {
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
      const path = `${name}/${file.split('\\').join('/')}`, bytes = await readFile(input);
      sourceHashes.push(`${path}:${createHash('sha256').update(bytes).digest('hex')}`);
      // Hash every actual input, even ignored files, and compare its raw blob bytes to the exact recorded revision.
      const object = createHash(objectFormat).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (headInputs.get(path) !== object) selectedInputsDifferFromHead = true;
      headInputs.delete(path);
    }
    // Deleted recursive inputs can also be hidden by index hints; surviving HEAD paths make the snapshot dirty.
    if ([...headInputs.keys()].some(path => parts.some(part => path.startsWith(`${name}/${part}/`)))) selectedInputsDifferFromHead = true;
  }
  // Ignore only this publication's untracked scratch; tracked changes and other untracked files still count.
  const scratchPrefix = ownedScratchDirectory === undefined ? undefined : `?? ${relative(await realpath(repository), await realpath(ownedScratchDirectory)).split('\\').join('/')}/`;
  // Reading provenance must not refresh the index or leave an optional write lock after interruption.
  const status = execFileSync('git', ['--no-optional-locks', '--no-replace-objects', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], gitOptions);
  const dirty = selectedInputsDifferFromHead || status.split('\0').some(entry => entry && !(scratchPrefix && entry.startsWith(scratchPrefix)));
  return {
    revision,
    dirty,
    sourceHash: createHash('sha256').update(sourceHashes.join('\n')).digest('hex'), sourceHashes,
  };
}
