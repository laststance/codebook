import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatRefusalFailure } from '../utils/formatRefusalFailure'
import { refusalFailureOf } from '../utils/refusalFailureOf'

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
