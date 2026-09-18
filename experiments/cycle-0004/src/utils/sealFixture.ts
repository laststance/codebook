import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SealedSource } from 'codebook-cycle-0001/dist/inspect';
import type { ProfileId, Scenario, StudyItemId } from '../constants';
import { STUDY_PROFILES } from '../profiles';

/** Copies fixed build bytes into an immutable run directory before {@link PairedRun} launches either debugger. @example await sealFixture(template, directory, runId, 'normal') */
export async function sealFixture(template: string, directory: string, runId: string, scenario: Scenario, profileId: ProfileId = 'paired-cart-demo'): Promise<Map<StudyItemId, SealedSource>> {
  await mkdir(join(directory, 'fixture'), { recursive: true });
  await mkdir(join(directory, 'build'), { recursive: true });
  const seals = new Map<StudyItemId, SealedSource>();
  for (const name of ['server', 'client', 'constants']) {
    const source = await readFile(join(template, `fixture/${name}.mts`), 'utf8');
    const javascript = await readFile(join(template, `build/${name}.mjs`), 'utf8');
    const sourceMap = await readFile(join(template, `build/${name}.mjs.map`), 'utf8');
    const sourcePath = join(directory, `fixture/${name}.mts`);
    await writeFile(sourcePath, source);
    await writeFile(join(directory, `build/${name}.mjs`), javascript + (name === 'server' && scenario === 'stale-server' ? '\n// Injected stale server deployment.\n' : ''));
    await writeFile(join(directory, `build/${name}.mjs.map`), sourceMap);
    // One source file may contain several learning stops; each seal keeps its exact bound line.
    for (const item of STUDY_PROFILES[profileId].items.filter(item => item.file === `${name}.mts`)) {
      const matches = source.split('\n').flatMap((line, index) => line.includes(item.marker) ? [index + 1] : []);
      if (matches.length !== 1) throw new Error(`Fixture study marker must occur exactly once: ${item.marker}`);
      seals.set(item.id, { sourcePath, source, javascript, sourceMap, breakpointLine: matches[0]! });
    }
  }
  const html = await readFile(join(template, 'fixture/index.html'), 'utf8');
  await writeFile(join(directory, 'index.html'), html.replace('RUN_ID', runId).replace('SCENARIO', scenario).replace('PROFILE_ID', profileId));
  await writeFile(join(directory, 'fixture-config.json'), JSON.stringify({ runId, scenario, profile: profileId }));
  if (seals.size !== STUDY_PROFILES[profileId].items.length) throw new Error('Missing sealed learning item');
  return seals;
}
