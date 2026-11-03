import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

import type { ConfiguredStudy } from '../../configuredStudySchemas'
import { LearningLibrary } from '../../learningLibrary'

/** A shape a masked value must have before it is replaced by {@link MASK_MARKER}: a wrong type or a missing value fails the byte identity test instead of hiding behind the marker. */
type MaskShape = 'text' | 'iso-time' | 'duration' | 'sha256' | 'uri'

/** What replaces a masked value; the recorded fixtures hold it. */
const MASK_MARKER = '<run-specific>'

/**
 * The only paths whose values differ between two runs of one flow, with the shape each must have.
 * A path lists keys from the saved file's root; `*` stands for any array index. A key at any other path is compared as it is, so a changed value there fails the test.
 */
const MASKED_PATHS: ReadonlyMap<string, MaskShape> = new Map([
  ['id', 'text'],
  ['instanceId', 'text'],
  ['runId', 'text'],
  ['createdAt', 'iso-time'],
  ['savedAt', 'iso-time'],
  ['materialSignature', 'sha256'],
  ['operation.id', 'text'],
  ['operations.*.atMs', 'duration'],
  ['observations.*.id', 'text'],
  ['observations.*.snapshotUri', 'uri'],
  ['observations.*.capturedAt', 'iso-time'],
  ['observations.*.elapsedMs', 'duration'],
  ['observations.*.source.javascriptHash', 'sha256'],
  ['observations.*.source.mapHash', 'sha256'],
])

/**
 * Whether a value has the shape its masked path promises.
 * @param shape - The shape of the path.
 * @param value - The parsed value found there.
 * @returns True when the value is a string or number of that shape.
 * @example hasMaskShape('sha256', 'a'.repeat(64)) // => true
 */
function hasMaskShape(shape: MaskShape, value: unknown): boolean {
  switch (shape) {
    case 'text':
      return typeof value === 'string' && value.length > 0
    case 'uri':
      return (
        typeof value === 'string' && /^[a-z][a-z0-9+.-]*:\/\/.+/i.test(value)
      )
    case 'iso-time':
      return (
        typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)
      )
    case 'duration':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0
    case 'sha256':
      return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
  }
}

/**
 * Replaces the run-specific values of a parsed study by {@link MASK_MARKER}, keeping key order, after asserting each has its {@link MaskShape}, so two runs compare byte for byte on everything else.
 * @param value - A parsed study or a part of it.
 * @param path - The keys from the root to `value`, with `*` for array indices.
 * @returns The same structure with the masked values replaced.
 * @throws When a masked path holds a value of the wrong shape (an absent key is not visited, so the comparison with the recorded fixture fails on it).
 * @example maskRunSpecificValues({ runId: 'a', title: 'x' }, []) // => { runId: '<run-specific>', title: 'x' }
 */
function maskRunSpecificValues(
  value: unknown,
  path: readonly string[],
): unknown {
  // Array members share their parent's path, with `*` for the index.
  if (Array.isArray(value))
    return value.map((member) => maskRunSpecificValues(member, [...path, '*']))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, member]) => {
      const memberPath = [...path, key]
      const shape = MASKED_PATHS.get(memberPath.join('.'))
      // Unmasked paths are compared as they are.
      if (shape === undefined)
        return [key, maskRunSpecificValues(member, memberPath)]
      if (!hasMaskShape(shape, member))
        throw new Error(
          `${memberPath.join('.')} must be a ${shape} before it is masked, got ${JSON.stringify(member)}`,
        )
      return [key, MASK_MARKER]
    }),
  )
}

/**
 * Saves a study through {@link LearningLibrary} and gives the bytes of the archive file it wrote with the run-specific values masked.
 * Used by the byte identity tests of formats 7 and 8 (AC 6) and, at commit 09859e5d, to record the fixtures they compare with. Only the paths of {@link MASKED_PATHS} are masked, each after a shape check.
 * @param context - The running test, which owns the temporary library folder.
 * @param study - The study to save.
 * @returns The archive's file name and its text: pretty-printed JSON of the saved file, key order kept, run-specific values masked.
 * @throws When a masked value does not have its shape.
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
    text: `${JSON.stringify(maskRunSpecificValues(parsed, []), null, 2)}\n`,
  }
}
