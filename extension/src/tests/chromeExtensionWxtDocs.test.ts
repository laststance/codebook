import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { chromeExtensionConfigSchema } from '../chromeExtensionConfigSchemas'
import { chromeExtensionHelp } from '../chromeExtensionHelp'
import { describeChromeExtensionProfile } from '../chromeExtensionProfile'
import { ERROR_RECOVERY } from '../errors'

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

// protects=the packaged skill is 1.0.82 and tells the chat to declare wxt-build for a WXT project only when codebook_status reports API 1.32 or later, and the README states the wxt-build behaviors the CHANGELOG names (build in the private folder, Node 24, building phase, contextSources, never restored tracked files, history format 2, no content scripts) with the API 1.32 and skill 1.0.82 lines; fails_when=a sentence, the skill version or the API line is missing; no_claim=that the behavior is implemented, which other tests cover
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
  assert.ok(skill.includes('metadata:\n  version: "1.0.103"\n'))
  assert.ok(
    skill.includes(
      'declare `adapter: "wxt-build"` with `extensionRoot` set to that folder and stops in source files under `extensionRoot`, never in `node_modules` (for example in `src/`), only when `codebook_status` reports API 1.32 or later',
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
  assert.ok(readme.includes('with **MCP API 1.44**'))
  assert.ok(
    readme.includes('API 1.32 is additive: it adds the `wxt-build` adapter'),
  )
  assert.ok(readme.includes('updates to **1.0.103**'))
})

// protects=the help, README, STOP_FILE_NOT_LOADED recovery and skill give contextSources the base extensionRoot (the form a stop path takes), say the build runs the project's own code, name both adapters, document the discovery skips and the tracked-files-unverified reason; fails_when=contextSources is called repository-relative again or any of those sentences is dropped; no_claim=the behavior itself, which the build, discovery and resolver tests cover
test('the wxt-build docs name the contextSources base, the executed project code, both adapters, the discovery rules and tracked-files-unverified', async () => {
  // Arrange
  const help = chromeExtensionHelp()
  const skill = await readPackaged('skills', 'codebook', 'SKILL.md')
  const readme = await readPackaged('README.md')
  const bullet =
    readme
      .split('\n')
      .find((line) => line.startsWith('- **WXT projects (MCP API 1.32).**')) ??
    ''
  const profile = describeChromeExtensionProfile({ ready: true, missing: [] })
  const buildText = help.wxtBuild.build.join(' ')
  const base = 'relative to extensionRoot, the form a stop path takes'
  // Act
  const adapterTerm = help.vocabulary.find((entry) => entry.term === 'adapter')
  // Assert
  assert.ok(help.wxtBuild.contextSources.includes(base))
  assert.equal(
    help.wxtBuild.contextSources.includes('repository-relative'),
    false,
  )
  assert.ok(ERROR_RECOVERY.STOP_FILE_NOT_LOADED.includes(base))
  assert.ok(
    bullet.includes('relative to `extensionRoot`, the form a stop path takes'),
  )
  assert.ok(
    skill.includes('(relative to `extensionRoot`, the form a stop path takes)'),
  )
  assert.ok(
    buildText.includes(
      "does run the project's own code: WXT loads wxt.config.* and the modules and Vite plugins it imports, in the external Node, before Chrome starts",
    ),
  )
  assert.ok(bullet.includes("the build does run the project's own code"))
  assert.ok(
    skill.includes(
      "the build runs the project's own WXT config, modules and Vite plugins in the external Node before Chrome starts",
    ),
  )
  assert.equal(
    adapterTerm?.meaning,
    'chrome-mv3-unpacked, or wxt-build for a WXT project built with source maps',
  )
  assert.match(
    profile.description,
    /chrome-mv3-unpacked as it is, or wxt-build for a WXT project/,
  )
  assert.equal(profile.adapter, 'chrome-mv3-unpacked')
  assert.ok(
    buildText.includes(
      'node_modules, .git and every dot-folder are skipped and linked folders are not followed; a project outside that search can still be named as extensionRoot',
    ),
  )
  assert.ok(
    bullet.includes(
      '`node_modules`, `.git` and every dot-folder are skipped, linked folders are not followed, and a project outside that search can still be named as `extensionRoot`',
    ),
  )
  assert.ok(
    bullet.includes(
      '`tracked-files-unverified`: do not retry, and check `git status`',
    ),
  )
})
