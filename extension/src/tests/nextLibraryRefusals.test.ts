import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ERROR_RECOVERY } from '../errors'
import {
  nextLibraryRedirectNotAppliedRefusal,
  nextLibraryStopUnsupportedRefusal,
} from '../nextRefusals'
import { refusalFailureOf } from '../utils/refusalFailureOf'

// Value: protects=a stop in the checked-out library's source on a Next library run is refused with a named reason before anything starts; fails_when=the code, reason, library, file or the "none" side effects change; no_claim=that the run raises it at the right place
test('a Next library stop refusal names the library, the file and that nothing started', () => {
  // Arrange
  const error = nextLibraryStopUnsupportedRefusal(
    'react-redux',
    'src/hooks/useSelector.ts',
  )
  // Act
  const described = error.describe()
  // Assert
  assert.equal(described.code, 'NEXT_STOP_NOT_SEALED')
  assert.deepEqual(described.details, {
    reason: 'library-stop-unsupported',
    library: 'react-redux',
    file: 'src/hooks/useSelector.ts',
    sideEffects: 'none',
  })
  assert.ok(
    described.message.includes(
      "stops in the library's own source are not supported on the Next library route in this version",
    ),
  )
  assert.ok(described.message.includes("Stop in the Example's source instead"))
})

// Value: protects=the chat reads recovery text for the library stop reason that says where to stop instead, not the generic one; fails_when=the library stop refusal falls back to the code's static recovery; no_claim=that the chat follows it
test('a Next library stop refusal tells the chat to stop in the Example or run without library', () => {
  // Arrange
  const error = nextLibraryStopUnsupportedRefusal('lib', 'src/a.ts')
  // Act
  const recovery = error.describe().recovery
  // Assert
  assert.notEqual(recovery, ERROR_RECOVERY.NEXT_STOP_NOT_SEALED)
  assert.ok(recovery.includes("Example's own source"))
  assert.ok(recovery.includes('start the run without library'))
  assert.ok(recovery.includes('details.sideEffects is none'))
})

// Value: protects=a library redirect that a Next compiler did not take is refused as partial side effects and names the compilers; fails_when=the code, reason, compilers, library or "partial" side effects change; no_claim=that the preload reports the compilers
test('a Next library redirect refusal names the missing compilers and that the server was stopped', () => {
  // Arrange
  const error = nextLibraryRedirectNotAppliedRefusal('react-redux', [
    'server',
    'edge-server',
  ])
  // Act
  const described = error.describe()
  // Assert
  assert.equal(described.code, 'NEXT_UNSUPPORTED_SETTING')
  assert.deepEqual(described.details, {
    reason: 'library-redirect-not-applied',
    library: 'react-redux',
    compilers: ['server', 'edge-server'],
    sideEffects: 'partial',
  })
  assert.ok(described.message.includes('for the server, edge-server compilers'))
  assert.ok(described.message.includes('no request was sent'))
})

// Value: protects=the preload's error line reaches the chat as details.cause, cut to a bound; fails_when=the cause is dropped or left unbounded; no_claim=the wording of the preload's own message
test('a Next library redirect refusal quotes the preload error cut to 300 characters', () => {
  // Arrange
  const error = nextLibraryRedirectNotAppliedRefusal(
    'lib',
    [],
    `boom ${'x'.repeat(400)}`,
  )
  // Act
  const cause = error.details?.cause
  // Assert
  assert.equal(typeof cause, 'string')
  assert.equal(String(cause).length, 300)
  assert.ok(String(cause).startsWith('boom xxx'))
  assert.deepEqual(error.details?.compilers, [])
})

// Value: protects=the library redirect reason never sends the chat to the basePath/i18n recovery of the same code; fails_when=the refusal uses the static NEXT_UNSUPPORTED_SETTING recovery; no_claim=that the static recovery stays right for its own reasons (the ERROR_RECOVERY tests hold that)
test('a Next library redirect refusal recovers by running without library, not by removing basePath', () => {
  // Arrange
  const error = nextLibraryRedirectNotAppliedRefusal('lib', ['client'])
  // Act
  const recovery = error.describe().recovery
  // Assert
  assert.notEqual(recovery, ERROR_RECOVERY.NEXT_UNSUPPORTED_SETTING)
  assert.equal(/basePath|i18n/.test(recovery), false)
  assert.ok(recovery.includes('cannot take the library route in this version'))
  assert.ok(recovery.includes('start again once without library'))
  assert.ok(recovery.includes('details.sideEffects is partial'))
})

// Value: protects=the static recovery of NEXT_UNSUPPORTED_SETTING keeps its basePath and i18n guidance for its existing reasons; fails_when=the library case rewrites the shared text; no_claim=nothing about the library reason
test('the shared NEXT_UNSUPPORTED_SETTING recovery still speaks of basePath and i18n routing', () => {
  // Arrange / Act
  const recovery = ERROR_RECOVERY.NEXT_UNSUPPORTED_SETTING
  // Assert
  assert.ok(recovery.includes('basePath or i18n routing'))
})

// Value: protects=a refusal the run records as failure text restores its code and its message sentence for the service; fails_when=a library refusal's text stops leading with its code or loses its sentence; no_claim=that details survive the text (the thrown error carries them)
test('both Next library refusals survive the failure-text round trip with their code and message', () => {
  // Arrange
  const errors = [
    nextLibraryStopUnsupportedRefusal('lib', 'src/a.ts'),
    nextLibraryRedirectNotAppliedRefusal('lib', ['server']),
  ]
  // Act
  const restored = errors.map((error) =>
    refusalFailureOf(`${error.code}: ${error.message}`),
  )
  // Assert
  assert.deepEqual(
    restored.map((failure) => failure?.code),
    ['NEXT_STOP_NOT_SEALED', 'NEXT_UNSUPPORTED_SETTING'],
  )
  assert.deepEqual(
    restored.map((failure) => failure?.message),
    errors.map((error) => error.message),
  )
})
