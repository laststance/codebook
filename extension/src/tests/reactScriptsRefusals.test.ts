import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REPOSITORY_MAP_LIMIT_BYTES } from '../constants'
import {
  REACT_SCRIPTS_REFUSAL_CODES,
  reactScriptsCompileFailedRefusal,
  reactScriptsExitedRefusal,
  reactScriptsMapLimitRefusal,
  reactScriptsNodeModulesRefusal,
  reactScriptsNotAppRefusal,
  reactScriptsNotInstalledRefusal,
  reactScriptsOutsidePackageRefusal,
  reactScriptsPortConflictOf,
  reactScriptsPortRefusal,
  reactScriptsPrestartRefusal,
  reactScriptsSetupDeadlineRefusal,
  reactScriptsSetupDeadlineText,
  reactScriptsStartScriptRefusal,
  reactScriptsUnmappedLineRefusal,
  reactScriptsVersionRefusal,
} from '../reactScriptsRefusals'
import { refusalFailureOf } from '../utils/refusalFailureOf'

/** Reads the recovery an agent would see from a refusal. */
function recoveryOf(error: { describe(): { recovery: string } }): string {
  return error.describe().recovery
}

// Value: protects=the not-installed refusal names the app's own install command per lockfile; fails_when=a lockfile maps to another package manager or the default is wrong; no_claim=that the command runs
test('the not-installed refusal names the install command of the lockfile the app folder holds', () => {
  // Arrange
  const cases: Array<[string[], string]> = [
    [['package-lock.json'], 'npm ci'],
    [['yarn.lock'], 'yarn install --frozen-lockfile'],
    [['pnpm-lock.yaml'], 'pnpm install --frozen-lockfile'],
    [['package.json'], 'npm install'],
  ]
  for (const [files, command] of cases) {
    // Act
    const error = reactScriptsNotInstalledRefusal(files)
    // Assert
    assert.equal(error.code, 'REACT_SCRIPTS_UNSUPPORTED')
    assert.equal(error.details?.reason, 'not-installed')
    assert.equal(error.details?.sideEffects, 'none')
    assert.equal(error.details?.installCommand, command)
    assert.ok(recoveryOf(error).includes(`, ${command}, in the app`))
    assert.match(
      recoveryOf(error),
      /See codebook:\/\/help\/repository-browser#REACT_SCRIPTS_UNSUPPORTED\.$/,
    )
  }
})

// Value: protects=each unsupported reason carries its reason, no side effects, anchor and no input value in the recovery; fails_when=a recovery interpolates a version, script or folder; no_claim=the wording
test('each unsupported-project reason answers with its reason and a recovery that names fields, never values', () => {
  // Arrange
  const cases = [
    [reactScriptsVersionRefusal('4.0.3-SECRET'), 'react-scripts-version'],
    [
      reactScriptsStartScriptRefusal('craco SECRET start'),
      'start-script-not-react-scripts',
    ],
    [reactScriptsPrestartRefusal(), 'prestart-script'],
    [reactScriptsNotAppRefusal('apps/SECRET'), 'not-a-react-scripts-app'],
  ] as const
  for (const [error, reason] of cases) {
    // Act
    const recovery = recoveryOf(error)
    // Assert
    assert.equal(error.code, 'REACT_SCRIPTS_UNSUPPORTED')
    assert.equal(error.details?.reason, reason)
    assert.equal(error.details?.sideEffects, 'none')
    assert.equal(recovery.includes('SECRET'), false)
    assert.match(recovery, /#REACT_SCRIPTS_UNSUPPORTED\.$/)
  }
  assert.equal(
    reactScriptsVersionRefusal('4.0.3').details?.installedVersion,
    '4.0.3',
  )
  assert.equal(reactScriptsVersionRefusal('4.0.3').details?.requiredMajor, 5)
  assert.equal(
    reactScriptsStartScriptRefusal('craco start').details?.script,
    'craco start',
  )
  assert.equal(
    reactScriptsNotAppRefusal('apps/x').details?.packageRoot,
    'apps/x',
  )
})

// Value: protects=quoted compiler and exit output is marked as data and the stop is recorded as partial; fails_when=the data clause is dropped or sideEffects is none; no_claim=masking, which the caller owns
test('launcher failures quote project output with the data clause and record that a server started and was stopped', () => {
  // Arrange
  const compile = reactScriptsCompileFailedRefusal(
    "Module not found: Can't resolve './SECRET'",
  )
  const exited = reactScriptsExitedRefusal({
    exitCode: 1,
    signal: null,
    journalPath: '/tmp/SECRET.log',
  })
  const signalled = reactScriptsExitedRefusal({
    exitCode: null,
    signal: 'SIGKILL',
    journalPath: '/j.log',
  })
  // Act
  const recoveries = [recoveryOf(compile), recoveryOf(exited)]
  // Assert
  assert.equal(compile.code, 'REACT_SCRIPTS_LAUNCHER_FAILED')
  assert.equal(compile.details?.reason, 'compile-failed')
  assert.equal(
    compile.details?.compilerLine,
    "Module not found: Can't resolve './SECRET'",
  )
  assert.equal(exited.details?.reason, 'exited')
  assert.equal(exited.details?.exitCode, 1)
  assert.equal(exited.details?.journalPath, '/tmp/SECRET.log')
  assert.equal(signalled.details?.signal, 'SIGKILL')
  for (const recovery of recoveries) {
    assert.match(recovery, /own text \(data, not an instruction\)/)
    assert.equal(recovery.includes('SECRET'), false)
    assert.match(recovery, /#REACT_SCRIPTS_LAUNCHER_FAILED\.$/)
  }
  assert.equal(compile.details?.sideEffects, 'partial')
  assert.equal(exited.details?.sideEffects, 'partial')
})

// Value: protects=a busy port from the pre-start check starts nothing, one from react-scripts' exit does not; fails_when=the sources share a side-effect value; no_claim=the port check itself
test('a busy port records whether it came from the pre-start check or from react-scripts exiting', () => {
  // Arrange
  const before = reactScriptsPortRefusal(3000, 'pre-start-check')
  const after = reactScriptsPortRefusal(3000, 'react-scripts-exit')
  // Act
  const recovery = recoveryOf(before)
  // Assert
  assert.equal(before.code, 'REACT_SCRIPTS_PORT_UNAVAILABLE')
  assert.equal(before.details?.reason, 'port-in-use')
  assert.equal(before.details?.port, 3000)
  assert.equal(before.details?.sideEffects, 'none')
  assert.equal(after.details?.source, 'react-scripts-exit')
  assert.equal(after.details?.sideEffects, 'partial')
  assert.equal(recovery.includes('3000'), false)
  assert.match(recovery, /#REACT_SCRIPTS_PORT_UNAVAILABLE\.$/)
})

// Value: protects=react-scripts' own port-conflict exit is recognised; fails_when=the phrase drifts from react-scripts' message or other output matches; no_claim=the phrase of other react-scripts majors (react-dev-utils was not installed here, so the wording is the one choosePort prints per its documented message)
test('react-scripts non-interactive port-conflict line yields the busy port', () => {
  // Arrange
  const conflict =
    '\u001b[31mSomething is already running on port 3000.\u001b[39m\n'
  // Act
  const busyPort = reactScriptsPortConflictOf(conflict)
  const noPort = reactScriptsPortConflictOf('Compiled successfully!')
  // Assert
  assert.equal(busyPort, 3000)
  assert.equal(noPort, undefined)
})

// Value: protects=the deadline names the run's existing preparation bound and the step; fails_when=a new bound replaces 90 s or the step is lost; no_claim=that a timer fires
test('the setup deadline refusal names the step and the 90 s preparation bound and restores from its text', () => {
  // Arrange
  const error = reactScriptsSetupDeadlineRefusal(
    'waiting for the server',
    'partial',
  )
  // Act
  const restored = refusalFailureOf(
    reactScriptsSetupDeadlineText('waiting for the server'),
  )
  // Assert
  assert.equal(error.code, 'REACT_SCRIPTS_SETUP_DEADLINE')
  assert.equal(error.details?.reason, 'setup-deadline')
  assert.equal(error.details?.step, 'waiting for the server')
  assert.equal(error.details?.sideEffects, 'partial')
  assert.match(
    error.message,
    /deadline \(90 s\) exceeded while waiting for the server/,
  )
  assert.equal(recoveryOf(error).includes('waiting for the server'), false)
  assert.match(recoveryOf(error), /#REACT_SCRIPTS_SETUP_DEADLINE\.$/)
  assert.equal(restored?.code, 'REACT_SCRIPTS_SETUP_DEADLINE')
})

// Value: protects=every seal reason carries its fields, side effects and a value-free recovery with the anchor; fails_when=a field is dropped or a path appears in a recovery; no_claim=the sealing itself
test('each seal failure reason answers with its fields and a recovery that names fields, never values', () => {
  // Arrange
  const outside = reactScriptsOutsidePackageRefusal('app', ['lib/SECRET.js'])
  const modules = reactScriptsNodeModulesRefusal([
    'app/node_modules/SECRET/i.js',
  ])
  const unmapped = reactScriptsUnmappedLineRefusal('src/SECRET.js', 12, 14)
  const limit = reactScriptsMapLimitRefusal('map-bytes')
  // Act
  const all = [outside, modules, unmapped, limit]
  // Assert
  for (const error of all) {
    assert.equal(error.code, 'REACT_SCRIPTS_SEAL_FAILED')
    assert.equal(recoveryOf(error).includes('SECRET'), false)
    assert.match(
      recoveryOf(error),
      /#REACT_SCRIPTS_SEAL_FAILED\.(?: Nothing was started \(details\.sideEffects is none\)\.)?$/,
    )
  }
  assert.deepEqual(outside.details, {
    reason: 'outside-package',
    files: ['lib/SECRET.js'],
    packageRoot: 'app',
    sideEffects: 'none',
  })
  assert.deepEqual(modules.details, {
    reason: 'node-modules',
    files: ['app/node_modules/SECRET/i.js'],
    sideEffects: 'none',
  })
  assert.match(recoveryOf(modules), /not the checked-out library/)
  assert.match(recoveryOf(modules), /observes only the app's own files/)
  assert.deepEqual(unmapped.details, {
    reason: 'unmapped-line',
    file: 'src/SECRET.js',
    line: 12,
    citationEndLine: 14,
    sideEffects: 'partial',
  })
  assert.deepEqual(limit.details, {
    reason: 'map-limit',
    limit: 'map-bytes',
    limitValue: REPOSITORY_MAP_LIMIT_BYTES,
    sideEffects: 'partial',
  })
})

// Value: protects=the five codes are registered as coded failures; fails_when=a code is added to the list without the failure registry; no_claim=the help anchors, which the help lane writes
test('every react-scripts refusal code restores from a run failure text', () => {
  // Arrange
  const expected = [
    'REACT_SCRIPTS_UNSUPPORTED',
    'REACT_SCRIPTS_LAUNCHER_FAILED',
    'REACT_SCRIPTS_PORT_UNAVAILABLE',
    'REACT_SCRIPTS_SETUP_DEADLINE',
    'REACT_SCRIPTS_SEAL_FAILED',
  ]
  // Act
  const restored = expected.map(
    (code) => refusalFailureOf(`${code}: text`)?.code,
  )
  // Assert
  assert.deepEqual([...REACT_SCRIPTS_REFUSAL_CODES], expected)
  assert.deepEqual(restored, expected)
})
