import { CROSS_RUNTIME_STUDY_VERSION } from '../constants'

/** The archive name of a study in a numbered format, `<id>.study.v<n>.json`; a catalog sidecar (`.study.meta.v<n>.json`) does not match. */
const NUMBERED_STUDY_ARCHIVE = /^(.+)\.study\.v(\d+)\.json$/

/**
 * Recognises the archive of a study that a newer Codebook saved, by its file name; called by {@link LearningLibrary} when it lists the library directory, so such a study is listed, counted and never replaced by an older file of the same study.
 * @param name - A file name of the library directory.
 * @returns
 * - the study id and the format number, for `<id>.study.v<n>.json` with a number above the formats this Codebook reads
 * - `undefined` for every other name, also for a known format and for a catalog sidecar
 * @example
 * newerStudyArchive('a_b.study.v5.json')      // => { id: 'a_b', version: 5 }
 * newerStudyArchive('a_b.study.v4.json')      // => undefined
 * newerStudyArchive('a_b.study.meta.v5.json') // => undefined
 */
export function newerStudyArchive(
  name: string,
): { id: string; version: number } | undefined {
  const [, id, number] = NUMBERED_STUDY_ARCHIVE.exec(name) ?? []
  if (id === undefined || number === undefined) return undefined
  const version = Number(number)
  return Number.isSafeInteger(version) && version > CROSS_RUNTIME_STUDY_VERSION
    ? { id, version }
    : undefined
}
