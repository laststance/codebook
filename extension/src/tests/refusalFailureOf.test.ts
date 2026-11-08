import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  libraryBuildChangedFailure,
  libraryFailureText,
  libraryNotInBuildRefusal,
  libraryPlaceAmbiguousRefusal,
} from '../nextRefusals'
import { formatRefusalFailure } from '../utils/formatRefusalFailure'
import { refusalFailureOf } from '../utils/refusalFailureOf'
import {
  viteLibraryBuildChangedFailure,
  viteLibraryFailureText,
  viteLibraryRefusal,
} from '../viteLibraryRefusals'

// Value: protects=a Vite run's timer failures keep restoring exactly as before the registry (code + message, no override); fails_when=the registry drops a Vite code, cuts the message differently or adds a recovery override; why_new=Cycle 0065 one refusal registry replaces viteFailureOf in the service; seam=none
test('every Vite refusal code restores from a failure text with its code and message, as before the registry', () => {
  // Arrange
  const cases = [
    [
      'ADAPTER_MISROUTE: use adapter "vite-dev".',
      'ADAPTER_MISROUTE',
      'use adapter "vite-dev".',
    ],
    [
      'VITE_UNSUPPORTED: Vite 7.1.0 is installed.',
      'VITE_UNSUPPORTED',
      'Vite 7.1.0 is installed.',
    ],
    [
      'VITE_LAUNCHER_FAILED: The config failed.',
      'VITE_LAUNCHER_FAILED',
      'The config failed.',
    ],
    [
      'VITE_SETUP_DEADLINE: Repository setup deadline (90 s) exceeded while sealing the declared stops.',
      'VITE_SETUP_DEADLINE',
      'Repository setup deadline (90 s) exceeded while sealing the declared stops.',
    ],
    [
      'VITE_SEAL_FAILED: Declared stop src/main.ts:3 cannot be sealed.',
      'VITE_SEAL_FAILED',
      'Declared stop src/main.ts:3 cannot be sealed.',
    ],
    [
      'VITE_PAGE_RELOADED: The page reloaded.',
      'VITE_PAGE_RELOADED',
      'The page reloaded.',
    ],
    [
      'VITE_PAGE_UNSTABLE: The page kept reloading.',
      'VITE_PAGE_UNSTABLE',
      'The page kept reloading.',
    ],
    [
      'VITE_PORT_UNAVAILABLE: Port 5173 is in use.',
      'VITE_PORT_UNAVAILABLE',
      'Port 5173 is in use.',
    ],
  ] as const
  for (const [text, code, message] of cases)
    // Act / Assert
    assert.deepEqual(refusalFailureOf(text), { code, message }, code)
})

// Value: protects=a Vite code keeps today's reader, which knows no variant, so no Vite behavior changes; fails_when=a Vite text with a parenthesized variant starts restoring as a coded error; why_new=Cycle 0065 registry; seam=none
test('a Vite code led by a variant restores nothing, as before the registry', () => {
  // Act
  const restored = refusalFailureOf(
    'VITE_SETUP_DEADLINE(router-absent): Repository setup deadline (90 s) exceeded.',
  )
  // Assert
  assert.equal(restored, undefined)
})

// Value: protects=every Next refusal recorded as a run's failure text reaches the agent with its code; fails_when=a NEXT_* code falls back to RUNTIME_FAILED; why_new=Cycle 0065 codes survive the async path; seam=none
test('every Next refusal code restores from a failure text with its code and message', () => {
  // Arrange
  const cases = [
    [
      'NEXT_UNSUPPORTED_SETTING: This project sets basePath.',
      'NEXT_UNSUPPORTED_SETTING',
      'This project sets basePath.',
    ],
    [
      'NEXT_ENTRY_REDIRECTED: Codebook loaded / and was redirected to /login.',
      'NEXT_ENTRY_REDIRECTED',
      'Codebook loaded / and was redirected to /login.',
    ],
    [
      'NEXT_ROUTE_NOT_COMPILED: The route / is not compiled.',
      'NEXT_ROUTE_NOT_COMPILED',
      'The route / is not compiled.',
    ],
    [
      'NEXT_ROUTE_CONFLICT: Both manifests list /.',
      'NEXT_ROUTE_CONFLICT',
      'Both manifests list /.',
    ],
    [
      'NEXT_ROUTE_NOT_FOUND: No Pages route matches /x.',
      'NEXT_ROUTE_NOT_FOUND',
      'No Pages route matches /x.',
    ],
    [
      'NEXT_SERVER_ONLY_STOP: src/pages/index.tsx:17 runs on the server.',
      'NEXT_SERVER_ONLY_STOP',
      'src/pages/index.tsx:17 runs on the server.',
    ],
    [
      'NEXT_STOP_NOT_SEALED: Codebook could not verify a browser source mapping.',
      'NEXT_STOP_NOT_SEALED',
      'Codebook could not verify a browser source mapping.',
    ],
    [
      'NEXT_SETUP_DEADLINE: Repository setup deadline (90 s) exceeded.',
      'NEXT_SETUP_DEADLINE',
      'Repository setup deadline (90 s) exceeded.',
    ],
  ] as const
  for (const [text, code, message] of cases)
    // Act / Assert
    assert.deepEqual(refusalFailureOf(text), { code, message }, code)
})

// Value: protects=a Fast Refresh of a sealed module ends the run as SOURCE_CHANGED for the agent, not RUNTIME_FAILED; fails_when=SOURCE_CHANGED is missing from the registry; why_new=Cycle 0065 mid-run module replacement; seam=none
test('a source change recorded as a run failure restores as SOURCE_CHANGED', () => {
  // Act
  const restored = refusalFailureOf(
    'SOURCE_CHANGED: src/pages/index.tsx changed during the run, so Codebook stopped it. Earlier captured observations remain readable.',
  )
  // Assert
  assert.deepEqual(restored, {
    code: 'SOURCE_CHANGED',
    message:
      'src/pages/index.tsx changed during the run, so Codebook stopped it. Earlier captured observations remain readable.',
  })
})

// Value: protects=a setup deadline's step chooses the exact static recovery the agent reads; fails_when=a variant restores no override, or another variant's text; why_new=Cycle 0065 step-specific recovery; seam=none
test('each Next setup deadline variant restores with its exact static recovery', () => {
  // Arrange
  const message =
    'Repository setup deadline (90 s) exceeded while loading the entry page.'
  const expected = {
    'before-browser':
      'Start once more with a new key (the first compile is warm after it); a second deadline means the project does not start in time for Codebook, so tell the learner the step the message names. Recovery: one retry, then the learner. The owned server was stopped; no browser was opened; no input was sent (read resourcesReleased in the run resource). See codebook://help/repository-browser#NEXT_SETUP_DEADLINE.',
    'browser-opened':
      'Start once more with a new key (the first compile of the page is warm after it); a second deadline means the entry page does not load in time, so tell the learner the step the message names. Recovery: one retry, then the learner. The browser Codebook opened was closed and no input or click was sent; Codebook stops the server it started (read resourcesReleased in the run resource). See codebook://help/repository-browser#NEXT_SETUP_DEADLINE.',
    'router-absent':
      'Tell the learner the page at entryPath is not a Next Pages page: it exposes no Next router. Set entryPath to the Pages page the question is about, then one new start; never retry with the same entryPath. Recovery: fix the configuration, then one new start. The browser Codebook opened was closed and no input or click was sent; Codebook stops the server it started (read resourcesReleased in the run resource). See codebook://help/repository-browser#NEXT_SETUP_DEADLINE.',
    'router-late':
      'Start once more with a new key (the first compile of the page is warm after it); a second deadline means the page router does not become ready in time, so tell the learner. Recovery: one retry, then the learner. The browser Codebook opened was closed and no input or click was sent; Codebook stops the server it started (read resourcesReleased in the run resource). See codebook://help/repository-browser#NEXT_SETUP_DEADLINE.',
    inputs:
      'Check the input selector the message names against the entry page, then start once more with a new key; a second deadline means the page does not take that input in time, so tell the learner. Recovery: one retry, then the learner. The inputs before the one the message names were written and no click was sent; the browser Codebook opened was closed and Codebook stops the server it started (read resourcesReleased in the run resource). See codebook://help/repository-browser#NEXT_SETUP_DEADLINE.',
    arming:
      'Start once more with a new key (the first compile of the page is warm after it); a second deadline means the page does not get ready in time to arm the first stop, so tell the learner. Recovery: one retry, then the learner. Every declared initial input was written (or there were none) and no click was sent; the browser Codebook opened was closed and Codebook stops the server it started (read resourcesReleased in the run resource). See codebook://help/repository-browser#NEXT_SETUP_DEADLINE.',
    'input-outcome-unknown':
      "Read the run's captured history before any new start: the reply to the input the message names was lost, so that input may have been written. Tell the learner, and start a new run only if the learner asks. Recovery: read, never resend. An input may have been written and no click was sent; the browser Codebook opened was closed and Codebook stops the server it started (read resourcesReleased in the run resource). See codebook://help/repository-browser#NEXT_SETUP_DEADLINE.",
  } as const
  for (const [variant, recoveryOverride] of Object.entries(expected)) {
    // Act
    const restored = refusalFailureOf(
      `NEXT_SETUP_DEADLINE(${variant}): ${message}`,
    )
    // Assert
    assert.deepEqual(
      restored,
      { code: 'NEXT_SETUP_DEADLINE', message, recoveryOverride },
      variant,
    )
  }
})

// Value: protects=a Pages run's NEXT_ENTRY_REDIRECTED failure text keeps the Pages fields through the text, so the agent reads details router pages and sideEffects unknown for a redirect found after the readiness request ran the data function; fails_when=the pages variant restores no details, or any other variant, or none, restores them; no_claim=how the service forwards them (nextRefusalRunResource tests)
test('a NEXT_ENTRY_REDIRECTED text led by the pages variant restores the Pages details and no other text does', () => {
  // Arrange
  const message = 'The page left the entry path / for /login.'
  // Act
  const withVariant = refusalFailureOf(
    `NEXT_ENTRY_REDIRECTED(pages): ${message}`,
  )
  const withoutVariant = refusalFailureOf(`NEXT_ENTRY_REDIRECTED: ${message}`)
  const withOtherVariant = refusalFailureOf(
    `NEXT_ENTRY_REDIRECTED(app): ${message}`,
  )
  const otherCodeWithPagesVariant = refusalFailureOf(
    `NEXT_ROUTE_NOT_FOUND(pages): ${message}`,
  )
  // Assert
  assert.deepEqual(withVariant, {
    code: 'NEXT_ENTRY_REDIRECTED',
    message,
    pagesDetails: { router: 'pages', sideEffects: 'unknown' },
  })
  assert.deepEqual(withoutVariant, { code: 'NEXT_ENTRY_REDIRECTED', message })
  assert.deepEqual(withOtherVariant, { code: 'NEXT_ENTRY_REDIRECTED', message })
  assert.deepEqual(otherCodeWithPagesVariant, {
    code: 'NEXT_ROUTE_NOT_FOUND',
    message,
  })
})

// Value: protects=only text led by a known code becomes a coded error; fails_when=an uncoded failure, an unknown code or a code in the middle of a sentence restores a code; why_new=Cycle 0065 registry; seam=none
test('a failure text not led by a known code restores nothing', () => {
  // Arrange
  const texts = [
    'Repository setup deadline exceeded',
    'Selected module changed after sealing',
    'RUNTIME_FAILED: The run failed.',
    'NEXT_ROUTE_UNKNOWN: No such code.',
    'The run failed: NEXT_SETUP_DEADLINE: Repository setup deadline (90 s) exceeded.',
    'NEXT_SETUP_DEADLINE:Repository setup deadline (90 s) exceeded.',
    'NEXT_SETUP_DEADLINE(router-absent: Repository setup deadline (90 s) exceeded.',
  ]
  for (const text of texts)
    // Act / Assert
    assert.equal(refusalFailureOf(text), undefined, text)
})

// Value: protects=a failure text whose variant was garbled still reaches the agent with its code and the code's general recovery, never a guessed one; fails_when=an unknown or empty variant restores nothing or selects an override, or a variant on a code without variants selects one; why_new=Cycle 0065 registry (a variant read back from text is untrusted); seam=none
test('a malformed variant restores the code with no recovery override', () => {
  // Arrange
  const texts = [
    [
      'NEXT_SETUP_DEADLINE(router-gone): The deadline passed.',
      'NEXT_SETUP_DEADLINE',
    ],
    ['NEXT_SETUP_DEADLINE(): The deadline passed.', 'NEXT_SETUP_DEADLINE'],
    [
      'NEXT_SETUP_DEADLINE(toString): The deadline passed.',
      'NEXT_SETUP_DEADLINE',
    ],
    [
      'NEXT_STOP_NOT_SEALED(router-absent): The deadline passed.',
      'NEXT_STOP_NOT_SEALED',
    ],
  ] as const
  for (const [text, code] of texts)
    // Act / Assert
    assert.deepEqual(
      refusalFailureOf(text),
      { code, message: 'The deadline passed.' },
      text,
    )
})

// Value: protects=the run writes the failure text in the one form the registry reads back; fails_when=the writer's lead differs from the reader's (a missing variant, another separator); why_new=Cycle 0065 failure-text format; seam=none
test('a written refusal failure reads back with its code, message and variant recovery', () => {
  // Act
  const deadline = formatRefusalFailure(
    'NEXT_SETUP_DEADLINE',
    'Repository setup deadline (90 s) exceeded while waiting for the page router to become ready before sending the declared input or click: the router did not become ready within 90 s.',
    'router-late',
  )
  const sourceChange = formatRefusalFailure(
    'SOURCE_CHANGED',
    'src/pages/index.tsx changed during the run, so Codebook stopped it.',
  )
  // Assert
  assert.equal(
    deadline,
    'NEXT_SETUP_DEADLINE(router-late): Repository setup deadline (90 s) exceeded while waiting for the page router to become ready before sending the declared input or click: the router did not become ready within 90 s.',
  )
  assert.equal(
    sourceChange,
    'SOURCE_CHANGED: src/pages/index.tsx changed during the run, so Codebook stopped it.',
  )
  assert.equal(refusalFailureOf(deadline)?.code, 'NEXT_SETUP_DEADLINE')
  assert.match(
    refusalFailureOf(deadline)?.recoveryOverride ?? '',
    /^Start once more with a new key \(the first compile of the page is warm after it\); a second deadline means the page router does not become ready in time/,
  )
  assert.deepEqual(refusalFailureOf(sourceChange), {
    code: 'SOURCE_CHANGED',
    message:
      'src/pages/index.tsx changed during the run, so Codebook stopped it.',
  })
})

// protects=a library refusal recorded by a pause or an event restores with the same static recovery the thrown error describes, so describe().recovery after the run is not the generic text; fails_when=refusalFailureOf restores a library variant without its recoveryOverride, or one that differs from the builder's; no_claim=how the service forwards it
test('a library refusal text restores the recovery its builder gives', () => {
  // Arrange
  const errors = [
    libraryPlaceAmbiguousRefusal('examples/app', 'lib', 'a.ts', 3, 'why'),
    libraryBuildChangedFailure('examples/app', 'lib', 'a.ts'),
  ]
  for (const error of errors) {
    // Act
    const text = libraryFailureText(error) ?? ''
    const restored = refusalFailureOf(text)
    // Assert
    assert.equal(restored?.recoveryOverride, error.describe().recovery, text)
    assert.ok(restored?.libraryDetails, text)
  }
})

// protects=a Vite library build-change error never becomes Next text, so its package root, library and file survive and no Pages router field appears; fails_when=libraryFailureText accepts an error without details.router; no_claim=the run's own conversion order (viteLibraryStop tests)
test('a Vite library build-change error is not written as a Next library failure', () => {
  // Arrange
  const error = viteLibraryBuildChangedFailure({
    packageRoot: 'examples/app',
    library: '@scope/core',
    file: 'packages/core/src/a.ts',
  })
  // Act
  const text = libraryFailureText(error)
  // Assert
  assert.equal(text, undefined)
})

// protects=an unknown library variant restores the code alone, with no recovery override; fails_when=an unknown variant restores a recovery; no_claim=the known variants
test('an unknown library variant restores no recovery override', () => {
  // Act
  const restored = refusalFailureOf(
    'NEXT_STOP_NOT_SEALED(library-unknown): The build of library lib changed.',
  )
  // Assert
  assert.deepEqual(restored, {
    code: 'NEXT_STOP_NOT_SEALED',
    message: 'The build of library lib changed.',
  })
})

// protects=an App Router library build change recorded as failure text restores details.router "app" with the unchanged reason and sideEffects; fails_when=libraryFailureText drops the router from the text or libraryDetailsOfFailure always restores "pages"; no_claim=the service forwarding
test('an App Router library build-change text restores router app', () => {
  // Arrange
  const error = libraryBuildChangedFailure('examples/app', 'lib', 'a.ts', 'app')
  // Act
  const text = libraryFailureText(error) ?? ''
  const restored = refusalFailureOf(text)
  // Assert
  assert.ok(
    text.startsWith('RUNTIME_FAILED(library-build-changed app): '),
    text,
  )
  assert.equal(restored?.code, 'RUNTIME_FAILED')
  assert.deepEqual(restored?.libraryDetails, {
    reason: 'library-build-changed',
    router: 'app',
    sideEffects: 'unknown',
  })
})

// protects=a Pages library build change keeps its text byte for byte and still restores router pages; fails_when=the app variant suffix leaks into the Pages text or restore; no_claim=App Router texts
test('a Pages library build-change text stays unchanged and restores router pages', () => {
  // Arrange
  const error = libraryBuildChangedFailure('examples/app', 'lib', 'a.ts')
  // Act
  const text = libraryFailureText(error) ?? ''
  const restored = refusalFailureOf(text)
  // Assert
  assert.ok(text.startsWith('RUNTIME_FAILED(library-build-changed): '), text)
  assert.deepEqual(restored?.libraryDetails, {
    reason: 'library-build-changed',
    router: 'pages',
    sideEffects: 'unknown',
  })
})

// protects=an App Router library-place-ambiguous refusal recorded as text restores router app; fails_when=the app variant is applied to library-build-changed only; no_claim=the recovery wording
test('an App Router library-place-ambiguous text restores router app', () => {
  // Arrange
  const error = libraryPlaceAmbiguousRefusal(
    'examples/app',
    'lib',
    'a.ts',
    3,
    'why',
    'app',
  )
  // Act
  const text = libraryFailureText(error) ?? ''
  const restored = refusalFailureOf(text)
  // Assert
  assert.ok(
    text.startsWith('NEXT_STOP_NOT_SEALED(library-place-ambiguous app): '),
    text,
  )
  assert.equal(restored?.code, 'NEXT_STOP_NOT_SEALED')
  assert.deepEqual(restored?.libraryDetails, {
    reason: 'library-place-ambiguous',
    router: 'app',
    sideEffects: 'unknown',
  })
})

// protects=an App Router library-not-in-build recorded as failure text (a tracked activity such as a reseal after a hot update) restores the same App Router recovery the thrown refusal carries, naming the client chunks of the entry route's client reference manifest; fails_when=the restore picks the server-compile recovery of a Pages server stop; no_claim=which run path records the text (configuredBrowserRun's track() is not driven here)
test('an App Router library-not-in-build text restores the App Router recovery of the thrown refusal', () => {
  // Arrange
  const error = libraryNotInBuildRefusal(
    'examples/app',
    'lib',
    'packages/lib/src/core.ts',
    ['packages/lib/build/modern/core.js'],
    'app-pages-browser',
  )
  // Act
  const text = libraryFailureText(error) ?? ''
  const restored = refusalFailureOf(text)
  // Assert
  assert.ok(
    text.startsWith('NEXT_STOP_NOT_SEALED(library-not-in-build app): '),
    text,
  )
  assert.equal(restored?.recoveryOverride, error.recoveryOverride)
  assert.match(
    restored?.recoveryOverride ?? '',
    /^The client chunks of the entry route's client reference manifest do not hold exactly one built file/,
  )
})

// protects=an App Router server (rsc) library-not-in-build recorded as failure text restores the server-compile recovery of the thrown refusal, and an older text with the variant `app` alone still reads as the browser layer; fails_when=the restore gives an rsc seal the client-chunks wording, or an old ` app` text stops restoring the browser wording; no_claim=which run path records the text
test('an App Router server library-not-in-build text restores the rsc recovery and an older app text the browser one', () => {
  // Arrange
  const error = libraryNotInBuildRefusal(
    'examples/app',
    'lib',
    'packages/lib/src/core.ts',
    ['packages/lib/build/modern/core.js'],
    'rsc',
  )
  // Act
  const text = libraryFailureText(error) ?? ''
  const restored = refusalFailureOf(text)
  const older = refusalFailureOf(
    text.replace('library-not-in-build app rsc', 'library-not-in-build app'),
  )
  // Assert
  assert.ok(
    text.startsWith('NEXT_STOP_NOT_SEALED(library-not-in-build app rsc): '),
    text,
  )
  assert.equal(restored?.recoveryOverride, error.recoveryOverride)
  assert.match(
    restored?.recoveryOverride ?? '',
    /^The entry route's server compile does not hold exactly one `\(rsc\)` module/,
  )
  assert.equal(
    restored?.libraryDetails && 'router' in restored.libraryDetails
      ? restored.libraryDetails.router
      : undefined,
    'app',
  )
  assert.match(
    older?.recoveryOverride ?? '',
    /^The client chunks of the entry route's client reference manifest/,
  )
})

// protects=a Pages server library-not-in-build restored from text keeps the server-compile recovery it always had; fails_when=the router-aware selection changes the Pages recovery; no_claim=the Pages browser layer, whose text carries no layer (unchanged from Cycle 0079)
test('a Pages library-not-in-build text still restores the server-compile recovery', () => {
  // Arrange
  const error = libraryNotInBuildRefusal(
    'examples/app',
    'lib',
    'packages/lib/src/core.ts',
    ['packages/lib/build/modern/core.js'],
  )
  // Act
  const restored = refusalFailureOf(libraryFailureText(error) ?? '')
  // Assert
  assert.equal(restored?.recoveryOverride, error.recoveryOverride)
  assert.match(
    restored?.recoveryOverride ?? '',
    /^The page's server code does not hold exactly one built file/,
  )
})

// Value: protects=OCR2-2 a restored EXPO_WEB_SEAL_FAILED api-seal text carries the API recovery like the live refusal and the Vite restore; fails_when=the Expo restore returns details without recoveryOverride; no_claim=the run raising the seal
test('an EXPO_WEB_SEAL_FAILED api-seal text restores the API seal recovery', () => {
  // Arrange
  const sealText = formatRefusalFailure(
    'EXPO_WEB_SEAL_FAILED',
    'The API ran a different version.',
    'api-seal:source-drift:apps%2Fapi%2Fsrc%2Fhandler.ts',
  )
  // Act
  const restored = refusalFailureOf(sealText)
  // Assert
  assert.equal(restored?.code, 'EXPO_WEB_SEAL_FAILED')
  assert.equal(restored?.libraryDetails?.reason, 'source-drift')
  assert.match(
    restored?.recoveryOverride ?? '',
    /See codebook:\/\/help\/repository-browser#EXPO_WEB_SEAL_FAILED\.$/,
  )
})

// Value: protects=test 52 (D30): a VITE_SEAL_FAILED api-seal text restores reason, participant, file, side effects and the API recovery, while the plain text and the lazy-import variant restore as before; fails_when=the api-seal variant degrades to the code alone, or the new branch captures a plain or lazy-import Vite seal text; no_claim=the run raising the seal
test('a VITE_SEAL_FAILED api-seal text restores its details while the plain and lazy-import texts restore as before', () => {
  // Arrange
  const sealText = formatRefusalFailure(
    'VITE_SEAL_FAILED',
    'The API ran a different version.',
    'api-seal:source-drift:apps%2Fapi%2Fsrc%2Fhandler.ts',
  )
  const lazyText = viteLibraryFailureText(
    viteLibraryRefusal({
      reason: 'library-build-unmapped',
      cause: 'lazy-import',
      packageRoot: 'app',
      library: '@scope/core',
      file: 'packages/core/src/a.ts',
    }),
  )
  // Act
  const restored = refusalFailureOf(sealText)
  const plain = refusalFailureOf(
    'VITE_SEAL_FAILED: Declared stop cannot be sealed.',
  )
  const lazy = refusalFailureOf(lazyText ?? '')
  // Assert
  assert.equal(
    sealText,
    'VITE_SEAL_FAILED(api-seal:source-drift:apps%2Fapi%2Fsrc%2Fhandler.ts): The API ran a different version.',
  )
  assert.equal(restored?.code, 'VITE_SEAL_FAILED')
  assert.equal(restored?.message, 'The API ran a different version.')
  assert.deepEqual(restored?.libraryDetails, {
    reason: 'source-drift',
    participant: 'apiServer',
    file: 'apps/api/src/handler.ts',
    sideEffects: 'partial',
  })
  assert.match(
    restored?.recoveryOverride ?? '',
    /See codebook:\/\/help\/repository-browser#VITE_SEAL_FAILED\.$/,
  )
  assert.deepEqual(plain, {
    code: 'VITE_SEAL_FAILED',
    message: 'Declared stop cannot be sealed.',
  })
  assert.deepEqual(lazy?.libraryDetails, {
    reason: 'library-build-unmapped',
    cause: 'lazy-import',
    packageRoot: 'app',
    library: '@scope/core',
    file: 'packages/core/src/a.ts',
    sideEffects: 'unknown',
  })
})

const MALFORMED_API_SEAL_VARIANTS = [
  'api-seal:source-drift',
  'api-seal:bogus:x',
  'api-seal:source-drift:',
  'api-seal:source-drift:%E0%A4%A',
] as const

// A malformed variant of a Vite seal is not a coded failure of this version (the Vite registry reads only the plain `CODE: ` lead), so it keeps the uncoded handling; an Expo one restores the code alone.
for (const [code, expectedRestore] of [
  ['VITE_SEAL_FAILED', 'uncoded'],
  ['EXPO_WEB_SEAL_FAILED', 'code alone'],
] as const)
  for (const variant of MALFORMED_API_SEAL_VARIANTS) {
    // Value: protects=L4 a malformed api-seal variant never throws and never invents API seal details; fails_when=a malformed variant throws or restores reason, participant or recovery; no_claim=the run raising the seal
    test(`${code}(${variant}) never throws and restores no API seal details (${expectedRestore})`, () => {
      // Arrange
      const text = `${code}(${variant}): The API ran a different version.`
      // Act
      const restored = refusalFailureOf(text)
      // Assert
      assert.deepEqual(
        restored,
        expectedRestore === 'uncoded'
          ? undefined
          : { code, message: 'The API ran a different version.' },
      )
    })
  }
