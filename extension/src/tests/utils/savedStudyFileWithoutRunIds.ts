import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

import type { ConfiguredStudy } from '../../configuredStudySchemas'
import { LearningLibrary } from '../../learningLibrary'

/** The keys whose values are run ids, times or hashes of generated code of the run's temporary folder, which differ from run to run. */
const RUN_ID_OR_TIME_KEYS = new Set([
  'javascriptHash',
  'mapHash',
  'id',
  'instanceId',
  'runId',
  'snapshotUri',
  'createdAt',
  'savedAt',
  'capturedAt',
  'elapsedMs',
  'atMs',
  'materialSignature',
])

/**
 * Replaces every run id and time of a parsed study by a fixed word, keeping key order, so two runs compare byte for byte on everything else.
 * @param value - A parsed study or a part of it.
 * @returns The same structure with those values replaced.
 * @example maskRunIdsAndTimes({ runId: 'a', title: 'x' }) // => { runId: '<run-specific>', title: 'x' }
 */
function maskRunIdsAndTimes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskRunIdsAndTimes)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, member]) => [
      key,
      RUN_ID_OR_TIME_KEYS.has(key)
        ? '<run-specific>'
        : maskRunIdsAndTimes(member),
    ]),
  )
}

/**
 * Saves a study through {@link LearningLibrary} and gives the bytes of the archive file it wrote with run ids and times masked.
 * Used by the byte identity tests of formats 7 and 8 (AC 6) and, at commit 09859e5d, to record the fixtures they compare with.
 * @param context - The running test, which owns the temporary library folder.
 * @param study - The study to save.
 * @returns The archive's file name and its text: pretty-printed JSON of the saved file, key order kept, run ids and times masked.
 * @example const { fileName } = await savedStudyFileWithoutRunIds(context, study) // fileName === '<id>.study.v7.json' becomes '<run-specific>.study.v7.json'
 */
export async function savedStudyFileWithoutRunIds(
  context: TestContext,
  study: ConfiguredStudy,
): Promise<{ fileName: string; text: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-saved-bytes-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  await new LearningLibrary(directory, study.workspaceKey).saveStudy(study)
  const archiveName = (await readdir(directory)).find(
    (name) => /\.study\.v\d+\.json$/.test(name) && !name.includes('.meta.'),
  )
  if (!archiveName) throw new Error('The library wrote no study archive.')
  const parsed: unknown = JSON.parse(
    await readFile(join(directory, archiveName), 'utf8'),
  )
  return {
    fileName: archiveName.replace(study.id, '<run-specific>'),
    text: `${JSON.stringify(maskRunIdsAndTimes(parsed), null, 2)}\n`,
  }
}
