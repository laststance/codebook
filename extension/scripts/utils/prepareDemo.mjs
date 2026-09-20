import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DEMO_ASSET_PATHS } from '../../dist/constants.js';

/** Prepares a complete asset set before the build replaces the runtime demo directory. @example await prepareDemo(templateRoot, '/extension/dist/demo') */
export async function prepareDemo(templateRoot, outputRoot, renamePath = rename) {
  await mkdir(dirname(outputRoot), { recursive: true });
  const temporary = await mkdtemp(join(dirname(outputRoot), '.codebook-demo-'));
  const next = join(temporary, 'next'), previous = join(temporary, 'previous');
  let previousMoved = false, keepRecovery = false;
  try {
    // A failed read leaves the entire previous asset set untouched.
    for (const file of DEMO_ASSET_PATHS) {
      const input = join(templateRoot, file), output = join(next, file);
      if (!(await lstat(input)).isFile()) throw new Error(`Expected demo file: ${file}`);
      const bytes = await readFile(input); await mkdir(dirname(output), { recursive: true }); await writeFile(output, bytes);
    }
    const current = await lstat(outputRoot).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (current && !current.isDirectory()) throw new Error('The demo output must be an owned directory, not a symlink or file.');
    if (current) { await renamePath(outputRoot, previous); previousMoved = true; }
    try { await renamePath(next, outputRoot); }
    catch (error) {
      // Preserve the old bytes for explicit recovery if the filesystem rejects rollback too.
      if (previousMoved) {
        try { await renamePath(previous, outputRoot); }
        catch (recovery) { keepRecovery = true; throw new AggregateError([error, recovery], `Demo restore failed; previous assets remain at ${previous}`); }
      }
      throw error;
    }
  } finally { if (!keepRecovery) await rm(temporary, { recursive: true, force: true }); }
}
