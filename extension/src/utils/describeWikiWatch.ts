import * as nodePath from 'node:path'

import {
  WIKI_MANIFEST_FILE,
  WIKI_PUBLISH_JOURNAL_SUFFIX,
  WIKI_PUBLISH_LOCK_SUFFIX,
  WIKI_UPDATE_RUN_MARKER_SUFFIX,
} from '../constants'

import { escapeGlobCharacters } from './escapeGlobCharacters'

/** What the LLM Wiki view's file watcher stands on: the glob it hands the editor and the absolute paths whose events refresh the view. */
export type WikiWatchPlan = {
  /** A glob relative to the watched folder, with forward slashes. */
  glob: string
  /** The folders between the watched folder and the Wiki output (the output included) and the four files, as absolute paths in the spelling of the path module. */
  paths: string[]
}

/** The files the view watches beside the output folder, as the endings of the output's path (the manifest lies inside it, the markers beside it). */
const WATCHED_ENDINGS = [
  `/${WIKI_MANIFEST_FILE}`,
  WIKI_UPDATE_RUN_MARKER_SUFFIX,
  WIKI_PUBLISH_LOCK_SUFFIX,
  WIKI_PUBLISH_JOURNAL_SUFFIX,
] as const

/**
 * Plans what the LLM Wiki view's watcher listens to: the Wiki folder itself and every folder not made yet between the watched folder and it (so a deleted or moved folder is seen even when the editor reports only the folder), the manifest and the three markers.
 *
 * Why: the editor may report only the delete of a folder, not of each file inside; a glob of the four files alone then never fires. Different drives give no relative path at all, which would make a glob that matches nothing.
 * Trigger: {@link createLlmWikiView} when it makes or moves its watcher.
 *
 * @param watchedFolder - The existing folder the watcher stands on.
 * @param outputDirectory - The resolved Wiki folder.
 * @param pathApi - The path module of the system the paths belong to; tests pass `path.win32`.
 * @returns The plan, or `undefined` when the output does not lie below the watched folder (another drive, or a folder above it), where no glob can match.
 * @example
 * describeWikiWatch('/repo', '/repo/.codebook/wiki')?.glob // => '{.codebook,.codebook/wiki,.codebook/wiki/codebook-wiki.json,.codebook/wiki.update-run.json,.codebook/wiki.publish-lock.json,.codebook/wiki.publish-journal.json}'
 * describeWikiWatch('C:\\repo', 'D:\\wiki', nodePath.win32) // => undefined
 */
export function describeWikiWatch(
  watchedFolder: string,
  outputDirectory: string,
  pathApi: Pick<
    typeof nodePath,
    'relative' | 'isAbsolute' | 'sep' | 'join'
  > = nodePath,
): WikiWatchPlan | undefined {
  const outputFromFolder = pathApi.relative(watchedFolder, outputDirectory)
  const segments = outputFromFolder.split(pathApi.sep)
  // An empty, absolute (another drive) or upward path lies outside the watched folder.
  if (
    outputFromFolder === '' ||
    pathApi.isAbsolute(outputFromFolder) ||
    segments[0] === '..'
  )
    return undefined
  // Every folder from the first below the watched one down to the output.
  const folders = segments.map((_segment, index) =>
    segments.slice(0, index + 1).join('/'),
  )
  const outputInGlob = segments.join('/')
  const entries = [
    ...folders,
    ...WATCHED_ENDINGS.map((ending) => `${outputInGlob}${ending}`),
  ]
  return {
    glob: `{${entries.map((entry) => escapeGlobCharacters(entry)).join(',')}}`,
    paths: entries.map((entry) =>
      pathApi.join(watchedFolder, ...entry.split('/')),
    ),
  }
}
