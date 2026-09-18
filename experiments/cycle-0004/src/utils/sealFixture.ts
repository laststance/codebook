import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SealedSource } from 'codebook-cycle-0001/dist/inspect';
import type { ParticipantName, Scenario } from '../constants';

/** Copies fixed build bytes into an immutable run directory before {@link PairedRun} launches either debugger. @example await sealFixture(template, directory, runId, 'normal') */
export async function sealFixture(template: string, directory: string, runId: string, scenario: Scenario): Promise<Record<ParticipantName, SealedSource>> {
  await mkdir(join(directory, 'fixture'), { recursive: true });
  await mkdir(join(directory, 'build'), { recursive: true });
  const seals: Partial<Record<ParticipantName, SealedSource>> = {};
  for (const name of ['server', 'client', 'constants']) {
    const source = await readFile(join(template, `fixture/${name}.mts`), 'utf8');
    const javascript = await readFile(join(template, `build/${name}.mjs`), 'utf8');
    const sourceMap = await readFile(join(template, `build/${name}.mjs.map`), 'utf8');
    const sourcePath = join(directory, `fixture/${name}.mts`);
    await writeFile(sourcePath, source);
    await writeFile(join(directory, `build/${name}.mjs`), javascript + (name === 'server' && scenario === 'stale-server' ? '\n// Injected stale server deployment.\n' : ''));
    await writeFile(join(directory, `build/${name}.mjs.map`), sourceMap);
    if (name !== 'constants') {
      const breakpointLine = source.split('\n').findIndex(line => line.includes('CODEBOOK_') && line.includes('_STOP')) + 1;
      if (!breakpointLine) throw new Error('Fixture study stop marker missing');
      seals[name === 'server' ? 'server' : 'browser'] = { sourcePath, source, javascript, sourceMap, breakpointLine };
    }
  }
  const html = await readFile(join(template, 'fixture/index.html'), 'utf8');
  await writeFile(join(directory, 'index.html'), html.replace('RUN_ID', runId).replace('SCENARIO', scenario));
  await writeFile(join(directory, 'fixture-config.json'), JSON.stringify({ runId, scenario }));
  if (!seals.server || !seals.browser) throw new Error('Missing sealed participant');
  return { server: seals.server, browser: seals.browser };
}
