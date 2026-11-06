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
  assert.ok(limits.includes('and since API 1.24 a server stop of one may too'))
  assert.ok(
    limits.includes(
      'since API 1.23 a browser stop of a nested App Router app may lie in a workspace library',
    ),
  )
})

// protects=API 1.25 is served and the 1.19 note names the five reasons as additive; fails_when=the version or a reason of the note drifts; no_claim=the behavior behind the reasons
test('API_VERSION is 1.25 and its note names the five library-stop reasons', async () => {
  // Arrange
  const constants = await readPackaged('src', 'constants.ts')
  // Act
  const note =
    constants
      .split('\n')
      .find((line) => line.startsWith(' * 1.19 is additive')) ?? ''
  // Assert
  assert.equal(API_VERSION, '1.32')
  for (const [reason] of LIBRARY_REASONS)
    assert.ok(note.includes(`\`${reason}\``), reason)
  assert.ok(note.includes('`details.cause`'))
})

// protects=skill 1.0.74 carries the library-stop sentence (declare a library server stop, tell the learner which build to run on library-build-stale, never run it) and names no sample app or function; fails_when=the sentence changes or a sample name enters the skill; no_claim=how a chat follows it
test('the bundled skill 1.0.74 tells the chat to name the build and never run it', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  // Act / Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.80"\n'))
  assert.ok(
    skill.includes(
      "A question that leads from an Example of a nested Next Pages app into the checked-out library may declare a server stop in the library's source, but only when `codebook_status` reports API 1.19 or later; on an older API tell the learner to update Codebook instead of following the `outside-package` fix. When the run refuses with `library-build-stale`, tell the learner which build to run, and never run it yourself; for `library-build-unmapped` read `details.cause` and the help section for it.",
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
test('the README states the library-stop rule in the nested-app section with API 1.19 and skill 1.0.71', async () => {
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
  assert.ok(readme.includes('with **MCP API 1.31**'))
  assert.ok(readme.includes('(1.0.68).**'))
  assert.ok(readme.includes('updates to **1.0.80**'))
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

// protects=the help names browser library stops of a nested Pages app, keeps App Router, root and version 2 refused, and says a browser stop declares afterOperation from 1 with the two routes to entry-load library code (D13); fails_when=the rule keeps saying browser-side library stops stay outside the range or drops the afterOperation limit or either route; no_claim=that the run pauses (libraryBrowserStop tests)
test('the help rule names browser library stops of a nested Pages app and the afterOperation limit', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const { rule } = help.nextPackageRoot.libraryStops
  const limits = help.nextPackageRoot.limits.join('\n')
  // Act / Assert
  for (const phrase of [
    'since API 1.22 a browser stop',
    'a packageRoot other than "."',
    'entry chunks of the route and _app',
    'library-not-in-build',
    'declares afterOperation from 1 (afterOperation 0 is refused)',
    'observed through a server library stop, or after a client navigation',
    'study format 9 with no new field',
    'A library stop of an app with both routers keeps the outside-package refusal; a root app (packageRoot absent or ".") has no files outside the app and a version 2 configuration cannot carry packageRoot, so the app readers refuse such a stop as not in the code the page loads at start',
  ])
    assert.ok(rule.includes(phrase), phrase)
  assert.ok(limits.includes('or since API 1.22 a browser stop'))
  assert.equal(limits.includes('browser-side library stops'), false)
})

// protects=each library refusal entry words both participants and none still says a library stop is server-only; fails_when=a stale, unmapped, not-in-build or changed entry names only the server; no_claim=which participant a run refuses for
test('each library refusal entry covers browser library stops with one anchor per reason', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const { refusals } = help.nextPackageRoot
  // Act / Assert
  for (const [reason] of LIBRARY_REASONS)
    assert.equal(
      refusals[reason]?.anchor,
      `codebook://help/repository-browser#${reason}`,
      reason,
    )
  assert.ok(refusals['library-build-stale']?.meaning.includes('a browser stop'))
  assert.ok(
    refusals['library-build-unmapped']?.meaning.includes('a browser stop'),
  )
  assert.ok(
    refusals['library-not-in-build']?.meaning.includes(
      'a library module the page loads later (next/dynamic, a lazy import) or never loads',
    ),
  )
  assert.ok(
    refusals['library-build-changed']?.meaning.includes(
      'announced again under a new script id',
    ),
  )
  assert.ok(
    refusals['outside-package']?.fix.includes('a browser stop since API 1.22'),
  )
})

// protects=the README and the skill state that a browser stop of a nested Next Pages app may lie in a workspace library, with the afterOperation limit; fails_when=a sentence or the version leaves either file; no_claim=native behavior
test('the README and the skill state browser library stops of a nested Next Pages app with the afterOperation limit', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  const skill = await readPackaged('skills/codebook/SKILL.md')
  // Act / Assert
  for (const phrase of [
    'Since API 1.22 a browser stop of a nested Pages app may lie in such a library too',
    'A browser stop declares `afterOperation` from 1',
    'API 1.22 is additive: it adds browser stops in the checked-out source of a workspace library that a nested Next Pages app imports',
    '(1.0.71).**',
  ])
    assert.ok(readme.includes(phrase), phrase)
  assert.ok(
    skill.includes(
      'With API 1.22 or later a browser stop of a nested Next Pages app may lie in such a library too; it declares `afterOperation` from 1',
    ),
  )
})

// protects=the skill no longer says every stop file must lie inside packageRoot, and names the supported library exception inside the repository; fails_when=the old sentence returns or the exception drops out; no_claim=what a run does
test('the skill lets a supported workspace-library stop lie outside packageRoot but inside the repository', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  // Act / Assert
  assert.equal(skill.includes('and must lie inside it)'), false)
  assert.ok(
    skill.includes(
      'app-local files lie inside `packageRoot`, and only a supported workspace-library stop',
    ),
  )
  assert.ok(skill.includes('but it must stay inside the repository)'))
  assert.ok(
    skill.includes(
      'a root app has no files outside the app and a version 2 configuration cannot carry `packageRoot`, so the app readers refuse such a stop as not in the code the page loads at start',
    ),
  )
})

// protects=root apps and version 2 are not said to keep the outside-package refusal in any packaged text; fails_when=the wrong claim returns in the API note, the help, the skill or the README; no_claim=refusal behavior
test('no packaged text says root apps and version 2 keep the outside-package refusal', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const texts = [
    JSON.stringify(help),
    await readPackaged('README.md'),
    await readPackaged('skills/codebook/SKILL.md'),
    await readPackaged('src', 'constants.ts'),
  ]
  // Act / Assert
  for (const text of texts)
    assert.equal(
      /root apps and version 2 configurations keep/.test(text),
      false,
    )
  assert.ok(
    (await readPackaged('README.md')).includes(
      'a library stop of a root app or a version 2 configuration is refused as not in the code the page loads at start',
    ),
  )
})

// protects=the 1.22 note names all three library-build-changed paths of a browser stop and keeps the 1.19 server description apart; fails_when=arming, the new script id or the pause drops out of the note, or the note stops separating browser from server; no_claim=the runtime behavior
test('the API 1.22 note names the arming, new script id and pause paths of library-build-changed for a browser stop', async () => {
  // Arrange
  const constants = await readPackaged('src', 'constants.ts')
  // Act
  const note =
    constants
      .split('\n')
      .find((line) => line.startsWith(' * 1.22 is additive')) ?? ''
  // Assert
  assert.ok(
    note.includes(
      'for a browser stop only, bytes that differ at arming, a rebuild or hot update announced under a new script id, and bytes that differ at the pause',
    ),
  )
  assert.ok(note.includes('the server-stop description of 1.19 is unchanged'))
})

// protects=Cycle 0080 Task 4: the help rule and limits say a browser stop of a nested App Router app may lie in a workspace library, with the checked-out library file in the native debugger, the entry-chunk rule and the library-not-in-build refusal, and keep the both-routers refusal; fails_when=the rule or limits drop the App Router browser stop, the checked-out file statement or the both-routers refusal; no_claim=that the run pauses
test('the help names browser library stops of a nested App Router app and keeps the both-routers library stop refused', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const { rule } = help.nextPackageRoot.libraryStops
  const limits = help.nextPackageRoot.limits.join('\n')
  // Act / Assert
  for (const phrase of [
    'Since API 1.23 a browser stop of a nested App Router app may lie in a workspace library too',
    'the .js chunks of its client-reference manifest',
    'so a module loaded later is refused as library-not-in-build',
    "the native debugger shows the checked-out library file with the library's values, not the built file",
    'A library stop of an app with both routers keeps the outside-package refusal',
  ])
    assert.ok(rule.includes(phrase), phrase)
  assert.ok(
    limits.includes(
      'a library stop of an app with both routers or of a root app',
    ),
  )
  assert.ok(
    limits.includes(
      'the native debugger shows the checked-out library file there',
    ),
  )
})

// protects=API 1.23 is served and its note names the App Router browser library stop, its reuse of the 1.19 reasons and the statement that an App Router server library stop stayed refused until 1.24; fails_when=the version or a statement of the 1.23 note drifts; no_claim=the behavior behind the note
test('API_VERSION is 1.25 and its 1.23 note adds browser library stops of a nested App Router app', async () => {
  // Arrange
  const constants = await readPackaged('src', 'constants.ts')
  // Act
  const note =
    constants
      .split('\n')
      .find((line) => line.startsWith(' * 1.23 is additive')) ?? ''
  // Assert
  assert.equal(API_VERSION, '1.32')
  for (const phrase of [
    'of an App Router app may lie in the checked-out source of a workspace library',
    "The native debugger shows the checked-out library file with the library's values",
    'a saved study gains no field',
    'A server stop in a workspace library of an App Router app stayed refused as `outside-package` until 1.24, and a library stop of an app with both routers still is',
  ])
    assert.ok(note.includes(phrase), phrase)
})

// protects=the skill 1.0.73 tells the chat that a browser stop of a nested App Router app may lie in a workspace library, gated on API 1.23, and the README says the same with its version mentions; fails_when=the sentence, the API gate or either version leaves the skill or README; no_claim=how a chat follows it
test('the skill 1.0.73 and the README state browser library stops of a nested Next App Router app', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  const skill = await readPackaged('skills/codebook/SKILL.md')
  // Act / Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.80"\n'))
  assert.ok(
    skill.includes(
      'With API 1.23 or later a browser stop of a nested Next App Router app may lie in a workspace library too, as for a nested Pages or Vite app, and the native debugger shows the checked-out library file there. With API 1.24 or later a server stop of a nested Next App Router app may lie in a workspace library too, and the native debugger shows the checked-out library file there; a library stop of an app with both routers keeps the `outside-package` refusal',
    ),
  )
  for (const phrase of [
    'Since API 1.23 a browser stop of a nested App Router app may lie in such a library too',
    "the native debugger shows the checked-out library file with the library's values",
    'API 1.23 is additive: it adds browser stops in the checked-out source of a workspace library that a nested Next App Router app imports',
    '(1.0.72), and a server stop there (1.0.73).**',
  ])
    assert.ok(readme.includes(phrase), phrase)
})

// protects=Cycle 0081 Task 4: the help rule and limits say a server stop of a nested App Router app may lie in a workspace library, pauses in the server render with the checked-out library file in the native debugger, and resumes pauses in another copy of the module or at a browser-only line; fails_when=the rule or the limits drop the server stop, its copy handling or the both-routers refusal; no_claim=that the server render pauses
test('the help names server library stops of a nested App Router app and the resumed copies', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const { rule } = help.nextPackageRoot.libraryStops
  const limits = help.nextPackageRoot.limits.join('\n')
  // Act / Assert
  for (const phrase of [
    'Since API 1.24 a server stop of a nested App Router app may lie in a workspace library too',
    "a module in the entry route's server code, the (rsc) layer",
    'details.router "app" under NEXT_STOP_NOT_SEALED',
    'it pauses in the server render of the entry route',
    "the native debugger shows the checked-out library file with the library's values, not the built file",
    'a pause in another copy of the module, or at a line only a browser stop declares',
    'is resumed and not recorded',
    'A library stop of an app with both routers keeps the outside-package refusal',
  ])
    assert.ok(rule.includes(phrase), phrase)
  assert.ok(
    limits.includes(
      'and since API 1.24 a server stop of one may too (it pauses in the server render',
    ),
  )
})

// protects=API 1.25 is served and its note adds server library stops of a nested App Router app with the resumed copies and the unchanged both-routers refusal; fails_when=the version or a statement of the 1.24 note drifts; no_claim=the behavior behind the note
test('API_VERSION is 1.25 and its note adds server library stops of a nested App Router app', async () => {
  // Arrange
  const constants = await readPackaged('src', 'constants.ts')
  // Act
  const note =
    constants
      .split('\n')
      .find((line) => line.startsWith(' * 1.24 is additive')) ?? ''
  // Assert
  assert.equal(API_VERSION, '1.32')
  for (const phrase of [
    'a server stop under `next-dev-webpack` with a nested `packageRoot`',
    'of an App Router app may lie in the checked-out source of a workspace library',
    'a saved study gains no field',
    "the native debugger shows the checked-out library file with the library's values",
    'a pause in another copy of the module, or at a line only a browser stop declares, is resumed and not recorded',
    'A library stop of an app with both routers',
  ])
    assert.ok(note.includes(phrase), phrase)
})

// protects=the skill 1.0.73 tells the chat that a server stop of a nested App Router app may lie in a workspace library, gated on API 1.24, and the README says the same with its version mentions; fails_when=the sentence, the API gate or either version leaves; no_claim=how a chat follows it
test('the skill 1.0.73 and the README state server library stops of a nested Next App Router app', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  const skill = await readPackaged('skills/codebook/SKILL.md')
  // Act / Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.80"\n'))
  assert.ok(
    skill.includes(
      'With API 1.24 or later a server stop of a nested Next App Router app may lie in a workspace library too, and the native debugger shows the checked-out library file there',
    ),
  )
  for (const phrase of [
    'Since API 1.24 a server stop of a nested App Router app may lie in such a library too',
    'it pauses in the server render of the entry route, and the native debugger shows the checked-out library file',
    'is resumed and not recorded',
    'API 1.24 is additive: it adds server stops in the checked-out source of a workspace library that a nested Next App Router app imports',
    'and a server stop there (1.0.73).**',
    'updates to **1.0.80**',
  ])
    assert.ok(readme.includes(phrase), phrase)
})

// protects=the help meanings of library-not-in-build and library-build-changed state the App Router server stop (API 1.24): the one (rsc) module, an (ssr) copy never counting, and a re-announcement with the sealed bytes being a coexisting instance; fails_when=either meaning loses the server-stop statement; no_claim=the behavior behind the text
test('the help words the App Router server library stop in library-not-in-build and library-build-changed', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const { refusals } = help.nextPackageRoot
  // Act
  const notInBuild = refusals['library-not-in-build']?.meaning ?? ''
  const buildChanged = refusals['library-build-changed']?.meaning ?? ''
  // Assert
  assert.ok(
    notInBuild.includes(
      "the one (rsc) module of the entry route's server chunk, server/<route>.js (a server stop, API 1.24 or later; an (ssr) copy of a module never counts)",
    ),
  )
  assert.ok(
    buildChanged.includes(
      'only differing bytes of a re-announced (rsc) module give it; a re-announcement with the sealed bytes is a coexisting instance, and the (ssr) and React copies of the module are journaled, never bound',
    ),
  )
})
