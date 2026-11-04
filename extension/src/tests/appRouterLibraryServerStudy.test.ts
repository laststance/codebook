import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import {
  evidenceFormatOfStudy,
  studyFormatOfConfiguration,
} from '../utils/studyFormatOfConfiguration'

import { replaySavedServerStop } from './utils/replaySavedServerStop'

const FIXTURES = resolve(__dirname, '../../src/tests/fixtures')
const SERVER_STUDY_PATH = join(
  FIXTURES,
  'app-router-library-server-study-v0.2.82.0/server-library-stop.study.v9.json',
)
const BROWSER_STUDY_PATH = join(
  FIXTURES,
  'app-router-library-browser-study-v0.2.81.0/browser-library-stop.study.v9.json',
)
const PAGES_SERVER_GOLDEN_PATH = join(
  FIXTURES,
  'pages-server-study-v0.2.74.0/pages-server-entry-load.study.v8.json',
)

/**
 * Reads the fixture study: a format 9 study of a nested Next App Router app whose server stop lies in `packages/lib/src/core.ts`.
 *
 * It was generated once at Cycle 0081 from the scripted App Router server library run of `libraryAppRouterServerStop.test.ts` (an entry-render stop on `return doubled`, paused in the library's `(rsc)` module) hosted in a service and saved through the service writer ({@link captureStudy}, as `captureLibraryRun` does for a Pages run). The run continued past the stop to completion before the capture: the study reads `state: "completed"`. The one-off generator is not part of the product or the suite.
 *
 * @returns The study as saved, before decoding.
 */
async function readServerStudy(): Promise<ConfiguredStudy> {
  return JSON.parse(await readFile(SERVER_STUDY_PATH, 'utf8'))
}

/** Reads a fixture file as parsed JSON. @example await readJson(BROWSER_STUDY_PATH) */
async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8'))
}

/**
 * Lists every key path of a parsed value, array members merged under `[]`, so two values compare by shape and not by content.
 * The `values` record of an observation is a leaf: its keys are the stop's value names, which differ between runs.
 * @param value - A parsed JSON value.
 * @returns The sorted, de-duplicated key paths.
 * @example keyPathsOf({ a: [{ b: 1 }] }) // => ['a', 'a[].b']
 */
function keyPathsOf(value: unknown): string[] {
  const paths = new Set<string>()
  const walk = (member: unknown, path: string): void => {
    // Arrays share one path for all members.
    if (Array.isArray(member)) {
      for (const item of member) walk(item, `${path}[]`)
      return
    }
    if (typeof member !== 'object' || member === null) return
    for (const [key, child] of Object.entries(member)) {
      const childPath = path ? `${path}.${key}` : key
      paths.add(childPath)
      // `values` keys are value names, not format fields.
      if (key !== 'values') walk(child, childPath)
    }
  }
  walk(value, '')
  return [...paths].sort()
}

// protects=AC 6 format: the golden is a format 9 study whose evidence follows the format 8 rules, records the library file's repository-relative path, the checked-out hash, the paused line, the recorded value and the server-render fields (execution, declaredIndex, executionIndex, attribution entry-load), and is the finished run; fails_when=the version, the evidence format, the library path, hash or line, or any server-render field of the server observation changes, or the golden was saved while paused; no_claim=a study written by a live Next run (the fixture comes from the scripted App Router server library run saved through the service writer)
test('the App Router server library golden is a format 9 study with format 8 evidence and a complete library server observation', async () => {
  // Arrange
  const raw = await readServerStudy()
  // Act
  const decoded = decodeConfiguredStudy(raw, raw.workspaceKey)
  const observation = decoded.observations[0]
  // Assert
  assert.equal(decoded.version, 9)
  assert.equal(studyFormatOfConfiguration(decoded.configuration), 9)
  assert.equal(evidenceFormatOfStudy(decoded), 8)
  assert.equal(decoded.configuration.source.path, 'packages/lib/src/core.ts')
  assert.equal(
    decoded.configuration.source.hash,
    'a8106b1601e84d7525e84ed95ade45c3d88e68bd54af34a5103beef8c3063858',
  )
  assert.equal(decoded.observations.length, 1)
  assert.equal(observation?.participant, 'server')
  assert.equal(observation?.source.line, 3)
  assert.equal(
    observation?.source.hash,
    'a8106b1601e84d7525e84ed95ade45c3d88e68bd54af34a5103beef8c3063858',
  )
  assert.equal(observation?.execution, 'server-render')
  assert.equal(observation?.declaredIndex, 0)
  assert.equal(observation?.executionIndex, 0)
  assert.equal(observation?.attribution, 'entry-load')
  assert.deepEqual(observation?.values, { 'value:doubled': 6 })
  // The golden is the finished run, not the paused one.
  assert.equal(decoded.state, 'completed')
})

// protects=AC 6 key sets: the server observation of the golden has the same key set, nested included, as the Cycle 0074 Pages server golden's, and its library source fields equal those of the Cycle 0081 App Router browser golden; fails_when=the observation gains or loses a key (or one of its nested keys), or the library source keys (configuration source, descriptor source, observation source) differ from the browser golden's; no_claim=equal values (only key sets are compared; the value names, which depend on the stop, are not keys of the format)
test('the App Router server library golden adds no observation field to the Pages server golden and no library source field to the browser golden', async () => {
  // Arrange
  const server = await readServerStudy()
  const pagesGolden = await readJson(PAGES_SERVER_GOLDEN_PATH)
  const browserGolden = await readJson(BROWSER_STUDY_PATH)
  // Act
  const observationKeys = keyPathsOf(server.observations[0])
  // Assert
  assert.deepEqual(observationKeys, keyPathsOf(pagesGolden.observations[0]))
  assert.ok(observationKeys.includes('attribution'))
  assert.ok(observationKeys.includes('source.binding.declaredLine'))
  assert.deepEqual(
    keyPathsOf(server.configuration.source),
    keyPathsOf(browserGolden.configuration.source),
  )
  assert.deepEqual(
    keyPathsOf(server.descriptor?.sources[0]),
    keyPathsOf(browserGolden.descriptor.sources[0]),
  )
  assert.deepEqual(
    keyPathsOf(server.observations[0]?.source),
    keyPathsOf(browserGolden.observations[0].source),
  )
})

// protects=AC 6 replay: the replay of the saved golden reopens at the library line with the recorded value, from the saved study alone, after the app has stopped; fails_when=the replay loses the recorded frame, line, doubled = 6 or the library source text, or shows a source other than the recorded one; no_claim=the editor's native debugger (the replay debug adapter is driven directly) and that the replay never reads the repository (replaySavedServerStop saves the study in its own temp folder and takes no repository path)
test('an App Router server library stop replays at its library line with doubled = 6 from the saved study alone', async (context) => {
  // Arrange
  const study = await readServerStudy()
  // Act
  const replayed = await replaySavedServerStop(context, study)
  // Assert
  assert.equal(replayed.study.version, 9)
  assert.equal(replayed.topFrameName, 'double')
  assert.equal(replayed.topFrameLine, 3)
  assert.deepEqual(replayed.variables, [{ name: 'doubled', value: '6' }])
  assert.deepEqual(replayed.study.observations[0]?.values, {
    'value:doubled': 6,
  })
  assert.equal(
    replayed.shownSourceText,
    'export function double(count: number): number {\n  const doubled = count * 2\n  return doubled\n}\n',
  )
  assert.equal(replayed.shownSourceHash, study.observations[0]?.source.hash)
})
