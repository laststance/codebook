import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { API_VERSION } from '../constants'
import { libraryRecoveryOf } from '../nextRefusals'
import { readResource } from '../resources'

import { createHarness } from './helpers'

/** The library-stop refusal reasons with the code each answers and the side effects the help states. */
const LIBRARY_REASONS = [
  [
    'library-build-stale',
    'NEXT_STOP_NOT_SEALED',
    'details.sideEffects is none',
  ],
  [
    'library-build-unmapped',
    'NEXT_STOP_NOT_SEALED',
    'details.sideEffects is none',
  ],
  [
    'library-not-in-build',
    'NEXT_STOP_NOT_SEALED',
    'details.sideEffects is unknown',
  ],
  [
    'library-place-ambiguous',
    'NEXT_STOP_NOT_SEALED',
    'details.sideEffects is unknown',
  ],
  ['library-build-changed', 'RUNTIME_FAILED', 'details.sideEffects is unknown'],
] as const

type LibraryHelp = {
  nextPackageRoot: {
    libraryStops: { anchor: string; rule: string; reasons: string[] }
    refusals: Record<
      string,
      { anchor: string; code: string; meaning: string; fix: string }
    >
    limits: string[]
  }
}

/**
 * Reads the served repository-browser help as an agent does.
 * @param context - Test context that closes the harness.
 * @returns The parsed help.
 */
async function readHelp(context: TestContext): Promise<LibraryHelp> {
  const harness = await createHarness()
  context.after(() => harness.close())
  const resource = await readResource(
    harness.service,
    'codebook://help/repository-browser',
  )
  return JSON.parse('text' in resource ? resource.text : '{}') as LibraryHelp
}

/**
 * Reads a packaged file relative to the extension folder.
 * @param segments - Path segments below `extension/`.
 * @returns The file text.
 */
function readPackaged(...segments: string[]): Promise<string> {
  return readFile(join(__dirname, '..', '..', ...segments), 'utf8')
}

// protects=the help gives one anchor, the code and the side effects for each of the five library-stop refusals, and states that the learner runs the build; fails_when=a reason, its code, its side-effects statement or the never-builds rule leaves the help; no_claim=that a run emits these reasons (the run lanes' tests prove that)
test('the help has one anchor per library-stop refusal with its code and side effects', async (context) => {
  // Arrange
  const help = await readHelp(context)
  // Act
  const refusals = help.nextPackageRoot.refusals
  // Assert
  assert.deepEqual(
    help.nextPackageRoot.libraryStops.reasons,
    LIBRARY_REASONS.map(([reason]) => reason),
  )
  for (const [reason, code, sideEffects] of LIBRARY_REASONS) {
    assert.equal(
      refusals[reason]?.anchor,
      `codebook://help/repository-browser#${reason}`,
    )
    assert.equal(refusals[reason]?.code, code)
    assert.ok(refusals[reason]?.meaning.includes(sideEffects), reason)
  }
  assert.ok(
    refusals['library-build-stale']?.fix.includes('Codebook never builds'),
  )
  assert.ok(
    refusals['library-build-unmapped']?.meaning.includes('no-content') &&
      refusals['library-build-unmapped']?.meaning.includes('deadline'),
  )
})

// protects=the help says which library stops run, that Codebook never builds, and that the native debugger may show the built file (D7); the old sentence that every library stays outside the stop range is gone; fails_when=the rule loses one of those statements or the old sentence returns; no_claim=native debugger behavior
test('the help states the library-stop rule and no longer says every library stays outside the stop range', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const { rule, anchor } = help.nextPackageRoot.libraryStops
  // Act
  const limits = help.nextPackageRoot.limits.join('\n')
  // Assert
  assert.equal(anchor, 'codebook://help/repository-browser#library-stops')
  for (const phrase of [
    'checked-out source of a workspace library',
    'sourcesContent equal to the checked-out source',
    'Codebook never builds',
    "The native debugger may show the library's built file",
  ])
    assert.ok(rule.includes(phrase), phrase)
  assert.equal(
    limits.includes('Library or shared packages the app imports'),
    false,
  )
  assert.ok(limits.includes('transpilePackages'))
  assert.ok(limits.includes('browser-side library stops'))
  assert.ok(limits.includes('App Router Examples'))
})

// protects=API 1.20 is served and its note names the five reasons as additive; fails_when=the version or a reason of the note drifts; no_claim=the behavior behind the reasons
test('API_VERSION is 1.20 and its note names the five library-stop reasons', async () => {
  // Arrange
  const constants = await readPackaged('src', 'constants.ts')
  // Act
  const note =
    constants
      .split('\n')
      .find((line) => line.startsWith(' * 1.19 is additive')) ?? ''
  // Assert
  assert.equal(API_VERSION, '1.20')
  for (const [reason] of LIBRARY_REASONS)
    assert.ok(note.includes(`\`${reason}\``), reason)
  assert.ok(note.includes('`details.cause`'))
})

// protects=skill 1.0.68 carries the library-stop sentence (declare a library server stop, tell the learner which build to run on library-build-stale, never run it) and names no sample app or function; fails_when=the sentence changes or a sample name enters the skill; no_claim=how a chat follows it
test('the bundled skill 1.0.69 tells the chat to name the build and never run it', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  // Act / Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.69"\n'))
  assert.ok(
    skill.includes(
      "A question that leads from an Example into the checked-out library may declare a server stop in the library's source, but only when `codebook_status` reports API 1.19 or later; on an older API tell the learner to update Codebook instead of following the `outside-package` fix. When the run refuses with `library-build-stale`, tell the learner which build to run, and never run it yourself; for `library-build-unmapped` read `details.cause` and the help section for it.",
    ),
  )
  for (const sample of [
    'tanstack',
    'query-core',
    'fetchQuery',
    'prefetchQuery',
  ])
    assert.equal(
      skill.toLowerCase().includes(sample.toLowerCase()),
      false,
      sample,
    )
})

// protects=the README carries the library-stop rule in the nested-app section, the five reasons, and the 1.19 and 1.0.68 version mentions; fails_when=a reason, the never-builds rule or a version leaves the README; no_claim=native behavior
test('the README states the library-stop rule in the nested-app section with API 1.19 and skill 1.0.69', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  const start = readme.indexOf('## Run a Next app below the repository root')
  const section = readme.slice(
    start,
    readme.indexOf('## Set up editor AI chat'),
  )
  // Act / Assert
  for (const phrase of [
    "A server stop in the checked-out source of a workspace library the app reaches through links inside the repository (directly or through other workspace libraries) pauses when the library's build carries source maps with `sourcesContent` equal to the checked-out source.",
    'Codebook never builds',
    "The native debugger may show the library's built file at the pause",
    'a rebuild of the library, run by you, fixes it',
    '`details.cause` and the help say whether a rebuild can help',
    ...LIBRARY_REASONS.map(([reason]) => `\`${reason}\``),
  ])
    assert.ok(section.includes(phrase), phrase)
  assert.ok(readme.includes('with **MCP API 1.20**'))
  assert.ok(readme.includes('(1.0.68).**'))
  assert.ok(readme.includes('updates to **1.0.69**'))
})

// protects=the help describes every bound and deadline cause of library-build-unmapped with the real limits, and says a transpilePackages library is refused as library-build-unmapped, not outside-package; fails_when=the bound text drops the entry, byte or unfinished-scan limits, hard-codes a stale number, or the limits sentence claims outside-package for transpilePackages; no_claim=that the run emits these causes (libraryBuildStop tests)
test('the help describes every bound and deadline cause with the real limits and the transpilePackages outcome', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const meaning =
    help.nextPackageRoot.refusals['library-build-unmapped']?.meaning ?? ''
  // Act
  const limits = help.nextPackageRoot.limits.join('\n')
  // Assert
  for (const phrase of [
    'more than 2000 build maps',
    'more than 50000 entries in the build folders',
    'a map larger than 16 MiB',
    'more than 128 MiB read in total',
    'a search that did not finish',
    "the smaller of 5 s and what is left of the run's 30 s discovery time",
  ])
    assert.ok(meaning.includes(phrase), phrase)
  assert.ok(
    limits.includes(
      'transpilePackages has no build of its own to match: when no build map names the stop file, the stop is refused as library-build-unmapped (cause no-map)',
    ),
  )
})

// protects=every library-stop recovery refers to its own per-reason help anchor, so an agent opens the section of the reason; fails_when=a recovery links the general NEXT_STOP_NOT_SEALED section again; no_claim=the help body
test('each library-stop refusal recovery links its own help section', () => {
  // Arrange
  const reasons = LIBRARY_REASONS.map(([reason]) => reason)
  // Act
  const anchors = reasons.map(
    (reason) => libraryRecoveryOf(reason).match(/#([a-z-]+)\.$/)?.[1],
  )
  // Assert
  assert.deepEqual(anchors, [...reasons])
})
