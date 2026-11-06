import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { chromeExtensionConfigSchema } from '../chromeExtensionConfigSchemas'
import { chromeExtensionHelp } from '../chromeExtensionHelp'

/** The book selection a real start copies from `codebook_publish_book`, replacing the help's placeholders. */
const REAL_BOOK = {
  bookId: 'interface',
  revision: 1,
  nodeId: 'theme',
  anchorIndex: 0,
}

/**
 * Reads a file the extension package ships; tests run from `dist/tests`.
 * @param segments - The path below the package root.
 * @returns The file's text.
 * @example await readPackaged('README.md')
 */
function readPackaged(...segments: string[]): Promise<string> {
  return readFile(join(__dirname, '..', '..', ...segments), 'utf8')
}

// protects=the wxt-build sample of the help is a declaration the live schema accepts (adapter wxt-build, a WXT folder below the repository root, an Options page surface, a stop under src/) once its placeholders are filled; fails_when=the sample drifts from chromeExtensionConfigSchema or names a stop path in node_modules; no_claim=that a run with it succeeds or that the placeholder names a real file
test('the wxt-build help sample parses with the live configuration schema', () => {
  // Arrange
  const { wxtBuild } = chromeExtensionHelp()
  const { configuration } = wxtBuild.sample
  // Act
  const parsed = chromeExtensionConfigSchema.parse({
    ...configuration,
    book: REAL_BOOK,
    clicks: [
      {
        title: 'Connect',
        selector: 'button[type=submit]',
        inputs: [{ selector: 'input', text: 'test-value' }],
      },
    ],
    stops: [{ path: 'src/lib/storage.ts', line: 12, context: 'page' }],
    observe: { kind: 'storage', key: 'token' },
  })
  // Assert
  assert.equal(parsed.adapter, 'wxt-build')
  assert.equal(parsed.extensionRoot, 'browser-extension')
  assert.deepEqual(parsed.surface, { kind: 'page', path: 'options.html' })
  assert.equal(JSON.stringify(configuration).includes('nsx_pat'), false)
})

// protects=the help's wxtBuild section says when to use the adapter, what the build writes, the visible building phase, the unchanged stop rules, contextSources, the missing content scripts and the API 1.32 gate, and the unpacked-only bundled-file rule; fails_when=any of those sentences is dropped or the bundled-file rule loses its adapter; no_claim=the behavior itself, which the build, resolver and run tests cover
test('the help states the wxt-build section and limits the bundled-file rule to unpacked extensions', () => {
  // Arrange
  const help = chromeExtensionHelp()
  const { wxtBuild } = help
  // Act
  const text = JSON.stringify(wxtBuild)
  // Assert
  assert.match(wxtBuild.when, /wxt\.config\.ts/)
  assert.match(text, /private folder beside the test Chrome profile/)
  assert.match(text, /ignored \.wxt folder/)
  assert.match(wxtBuild.phase, /chromeExtension\.phase building/)
  assert.match(wxtBuild.stopRules[0], /apply unchanged to the build folder/)
  assert.match(wxtBuild.contextSources, /details\.contextSources: up to 20/)
  assert.match(wxtBuild.notIncluded, /Content scripts are not in this version/)
  assert.match(wxtBuild.apiGate, /MCP API 1\.32 or later/)
  assert.match(wxtBuild.apiGate, /INVALID_CONFIGURATION/)
  assert.equal(
    help.stopRules.some((rule) =>
      rule.startsWith(
        'For adapter chrome-mv3-unpacked, a bundled file is refused with BUNDLED_EXTENSION_UNSUPPORTED',
      ),
    ),
    true,
  )
})

// protects=the packaged skill is 1.0.81 and tells the chat to declare wxt-build for a WXT project only when codebook_status reports API 1.32 or later, and the README states the wxt-build behaviors the CHANGELOG names (build in the private folder, Node 24, building phase, contextSources, never restored tracked files, history format 2, no content scripts) with the API 1.32 and skill 1.0.81 lines; fails_when=a sentence, the skill version or the API line is missing; no_claim=that the behavior is implemented, which other tests cover
test('the packaged skill and README state the wxt-build route, its API gate and its limits', async () => {
  // Arrange
  const skill = await readPackaged('skills', 'codebook', 'SKILL.md')
  const readme = await readPackaged('README.md')
  // Act
  const bullet =
    readme
      .split('\n')
      .find((line) => line.startsWith('- **WXT projects (MCP API 1.32).**')) ??
    ''
  // Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.81"\n'))
  assert.ok(
    skill.includes(
      'declare `adapter: "wxt-build"` with `extensionRoot` set to that folder and stops in its `src/` files, only when `codebook_status` reports API 1.32 or later',
    ),
  )
  for (const phrase of [
    '`wxtProjects`',
    "into the run's private folder, which is removed when the run ends",
    'an external Node 24 or later',
    'the `building` phase',
    '`details.contextSources`',
    'never restores one',
    '`tracked-file-changed`',
    'Extension replay of history format 2',
    'Content scripts are not included.',
  ])
    assert.ok(bullet.includes(phrase), phrase)
  assert.ok(readme.includes('with **MCP API 1.32**'))
  assert.ok(
    readme.includes('API 1.32 is additive: it adds the `wxt-build` adapter'),
  )
  assert.ok(readme.includes('updates to **1.0.81**'))
})
