import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { RepositorySourceService } from '../../repositorySource';

const executeFile = promisify(execFile);

/** Gives source/book regressions real Git membership and independent tracked bytes; cleanup removes only the owned temporary root. @example const { sources, track } = await repositoryHarness(context) */
export async function repositoryHarness(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-source-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await executeFile('git', ['init', '--quiet', directory]);
  const track = async (path: string, text: string | Buffer = 'export const price = 24;\n') => {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), text);
    await executeFile('git', ['add', '--force', '--', path], { cwd: directory });
  };
  return { directory, sources: new RepositorySourceService(directory), track };
}
