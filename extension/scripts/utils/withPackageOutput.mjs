import { lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Publishes one validated VSIX by same-filesystem rename; failed preparation or rename preserves the previous artifact. @example await withPackageOutput(output, async ({ candidate }) => build(candidate)) */
export async function withPackageOutput(destination, prepare, renameFile = rename) {
  await mkdir(dirname(destination), { recursive: true });
  const directory = await mkdtemp(join(dirname(destination), '.codebook-package-'));
  const candidate = join(directory, 'candidate.vsix'), stage = join(directory, 'stage');
  try {
    await mkdir(stage);
    const receipt = await prepare({ directory, candidate, stage });
    if (!(await lstat(candidate)).isFile()) throw new Error('Prepared VSIX must be a regular file.');
    const previous = await lstat(destination).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (previous && !previous.isFile()) throw new Error('VSIX destination changed to a symlink or directory.');
    await renameFile(candidate, destination);
    return receipt;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
