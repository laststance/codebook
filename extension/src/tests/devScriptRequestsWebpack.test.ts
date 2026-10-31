import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { devScriptRequestsWebpack } from '../utils/devScriptRequestsWebpack'

import { DEV_SCRIPT_WEBPACK_FORMS } from './utils/devScriptWebpackForms'

// Value: protects=the webpack-compatibility sentence of a Pages launch or compile failure is added exactly for the dev script forms the packaged README lists as not asking for webpack, and left out for the forms it lists as asking; fails_when=devScriptRequestsWebpack reads a listed form otherwise (a quoted flag, a flag before ";" or "=", a delegated script, or a plain or trailing --webpack); why_new=Cycle 0066 task 12 (Cycle 0065 red team: the README named more --webpack forms than the function reads); seam=temporary package.json per form; no_claim=forms the table does not list
test('a Pages launch failure reads each dev script form the README lists as asking, or not asking, Next for webpack', async (context) => {
  // Arrange
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-webpack-forms-'))
  context.after(() => rm(workspace, { recursive: true, force: true }))
  const answers: { devScript: string; asksForWebpack: boolean }[] = []
  // Act
  // One form at a time: each answer reads the package.json written for it.
  for (const form of DEV_SCRIPT_WEBPACK_FORMS) {
    const otherScripts = 'otherScripts' in form ? form.otherScripts : {}
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: 'stand-in',
        scripts: { dev: form.devScript, ...otherScripts },
      }),
    )
    answers.push({
      devScript: form.devScript,
      asksForWebpack: await devScriptRequestsWebpack(workspace),
    })
  }
  // Assert
  const expected = [
    { devScript: 'next dev --webpack', asksForWebpack: true },
    { devScript: 'next dev --webpack -p 3000', asksForWebpack: true },
    {
      devScript: 'concurrently "next dev --webpack" "tsc -w"',
      asksForWebpack: false,
    },
    { devScript: 'next dev --webpack; echo ready', asksForWebpack: false },
    { devScript: 'next dev --webpack=true', asksForWebpack: false },
    { devScript: 'npm run dev:web', asksForWebpack: false },
  ]
  assert.deepEqual(answers, expected)
  // The table the README pin reads claims the same answers the function gave.
  assert.deepEqual(
    DEV_SCRIPT_WEBPACK_FORMS.map(({ devScript, asksForWebpack }) => ({
      devScript,
      asksForWebpack,
    })),
    expected,
  )
})
