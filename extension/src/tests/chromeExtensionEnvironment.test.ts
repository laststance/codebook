import assert from 'node:assert/strict'
import { test } from 'node:test'

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
