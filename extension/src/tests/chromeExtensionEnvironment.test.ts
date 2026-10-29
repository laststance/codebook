import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'

import { createEnvironmentWith } from './utils/nodeServerEnvironment'

// Value: protects=DXR16, ER7: the real environment reports the chrome-extension profile from the Chrome it found: Chrome 148 reads not ready with the 149 fix sentence, Chrome 156 reads ready (off Windows) and the run factory is offered; fails_when=an old Chrome reads ready, the sentence differs or the factory is absent; no_claim=Windows (gaps unit test) and the real Chrome lookup
test('the environment reports chrome-extension unavailable for Chrome 148 with the 149 fix and ready for Chrome 156', async (context) => {
  // Arrange
  const old = await createEnvironmentWith(context, {
    gaps: [],
    chromeVersionText: 'Google Chrome 148.0.7778.96',
  })
  const current = await createEnvironmentWith(context, {
    gaps: [],
    chromeVersionText: 'Google Chrome 156.0.8078.74',
  })
  // Act
  const oldProfile = (await old.environment.prerequisites()).profiles?.[
    'chrome-extension'
  ]
  const currentProfile = (await current.environment.prerequisites()).profiles?.[
    'chrome-extension'
  ]
  // Assert
  assert.deepEqual(
    [oldProfile?.ready, [...(oldProfile?.missing ?? [])]],
    process.platform === 'win32'
      ? [
          false,
          [
            'The chrome-extension profile is not available on Windows in this version.',
          ],
        ]
      : [
          false,
          [
            'Chrome 149 or later is needed to load an unpacked extension; found 148.0.7778.96. Set codebook.chromeExecutable to Google Chrome or Chrome for Testing 149 or later, or update Chrome.',
          ],
        ],
  )
  assert.equal(currentProfile?.ready, process.platform !== 'win32')
  assert.equal(typeof current.environment.createChromeExtensionRun, 'function')
})

// Value: protects=A1: a found Chrome older than 149 refuses the run with CHROME_VERSION_UNSUPPORTED and its own sentence, not PREREQUISITE_MISSING; fails_when=the code is PREREQUISITE_MISSING or the sentence is the joined gap; no_claim=Windows, which refuses earlier
test('the environment refuses a run on Chrome 148 with CHROME_VERSION_UNSUPPORTED and the version sentence', async (context) => {
  // Arrange
  const { environment } = await createEnvironmentWith(context, {
    gaps: [],
    chromeVersionText: 'Google Chrome 148.0.7778.96',
  })
  if (process.platform === 'win32') {
    context.skip('The chrome-extension profile is not available on Windows.')
    return
  }
  // Act
  const refusal = await environment
    .createChromeExtensionRun?.({} as never)
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  // Assert
  assert.equal(refusal instanceof StudyError, true)
  assert.equal((refusal as StudyError).code, 'CHROME_VERSION_UNSUPPORTED')
  assert.equal(
    (refusal as StudyError).message,
    'Chrome 149 or later is needed to load an unpacked extension; found 148.0.7778.96.',
  )
})

// Value: protects=CR3: a disabled js-debug keeps the chrome-extension profile not ready in status and in the start's own wait; fails_when=an editor gap is filtered out with the Node gaps; no_claim=Windows wording
test('the environment reports chrome-extension not ready when js-debug is disabled', async (context) => {
  // Arrange
  const { environment } = await createEnvironmentWith(context, {
    gaps: [],
    chromeVersionText: 'Google Chrome 156.0.8078.74',
    jsDebugEnabled: false,
  })
  if (process.platform === 'win32') {
    context.skip('The chrome-extension profile is not available on Windows.')
    return
  }
  // Act
  const profile = (await environment.prerequisites()).profiles?.[
    'chrome-extension'
  ]
  const start = await environment.chromeExtensionStartPrerequisites?.()
  // Assert
  // The environment runs in another realm, so its arrays are compared as copies.
  assert.deepEqual(
    [profile?.ready, [...(profile?.missing ?? [])]],
    [false, ['Enable the bundled JavaScript Debugger (ms-vscode.js-debug).']],
  )
  assert.deepEqual(
    [start?.ready, [...(start?.missing ?? [])]],
    [false, ['Enable the bundled JavaScript Debugger (ms-vscode.js-debug).']],
  )
})
