import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'

import type * as ConfiguredBrowserRunModule from '../configuredBrowserRun'
import type * as OwnedRepositoryBreakpointModule from '../ownedRepositoryBreakpoint'
import { buildIdentityScriptMap } from '../utils/buildIdentityScriptMap'

import { loadModule } from './utils/loadModule'

/** The URL a browser announces every inline script of a page under: the page's own. */
const PAGE_URL = 'http://localhost:4310/'

/**
 * Runs the script binding of {@link ConfiguredBrowserRun} for announced inline scripts against two stops, each sealed in its own inline block.
 * @param announcements - The scripts the browser announced, in order.
 * @returns The failures the run recorded and the script id each stop was bound to.
 * @example bindInlineScripts([{ scriptId: '10', startLine: 5, startColumn: 8 }])
 */
async function bindInlineScripts(
  announcements: ReadonlyArray<{
    scriptId: string
    startLine: number
    startColumn: number
  }>,
): Promise<{ failures: string[]; bound: Array<string | undefined> }> {
  // The run module needs only an editor stand-in at load time; no editor API is called on this path.
  const vscode = {}
  const breakpointModule = await loadModule<
    typeof OwnedRepositoryBreakpointModule
  >(resolve(__dirname, '../ownedRepositoryBreakpoint.js'), { vscode })
  const { ConfiguredBrowserRun } = await loadModule<
    typeof ConfiguredBrowserRunModule
  >(resolve(__dirname, '../configuredBrowserRun.js'), {
    vscode,
    './ownedRepositoryBreakpoint': breakpointModule,
    './runtimeSupport/hostBrowser': { HostBrowser: class {} },
  })
  const failures: string[] = []
  const stops = [
    { line: 5, column: 8 },
    { line: 10, column: 22 },
  ].map((start) => ({
    participant: 'browser',
    source: { path: 'examples/page/index.html', line: 3 },
    bundle: { scriptUrl: 'http://127.0.0.1:4310/', scriptStart: start },
    script: undefined as { scriptId?: string } | undefined,
  }))
  const run = Object.create(ConfiguredBrowserRun.prototype) as Record<
    string,
    unknown
  >
  Object.assign(run, {
    stops,
    adapter: { isScriptOfModule: () => true },
    fail: (text: string) => failures.push(text),
    track: () => undefined,
    journalStopModule: () => undefined,
    judgeNewsRefusedBeforeModule: () => undefined,
    changedAfterSealingText: () => 'changed after sealing',
  })
  const bind = (run as { bindParsedScript: (...args: unknown[]) => void })
    .bindParsedScript
  for (const announcement of announcements)
    bind.call(run, 'browser', { ...announcement, url: PAGE_URL })
  return { failures, bound: stops.map((stop) => stop.script?.scriptId) }
}

// Value: protects=a page with two inline scripts runs: each stop binds to the inline script that starts where its sealed block starts, and the other inline script of the same page is not mistaken for it; fails_when=the first announcement binds both stops and the second announcement fails the run as changed after sealing; no_claim=a real browser's announcement order
test('two inline scripts of one page bind to their own stops and do not fail the run', async () => {
  // Arrange
  const announcements = [
    { scriptId: '10', startLine: 5, startColumn: 8 },
    { scriptId: '11', startLine: 10, startColumn: 22 },
  ]
  // Act
  const outcome = await bindInlineScripts(announcements)
  // Assert
  assert.deepEqual(outcome, { failures: [], bound: ['10', '11'] })
})

// Value: protects=the identity map counts columns in UTF-16 code units as the browser does; fails_when=an astral character (two code units) before a stop on the same line shifts every later mapped column by one; no_claim=combining marks or right-to-left text
test('a character outside the basic plane before a stop does not shift the mapped column', () => {
  // Arrange
  const scriptText = "x='😀';y=1"
  const map = JSON.parse(
    buildIdentityScriptMap({
      sourcePath: '/p/index.html',
      sourceText: `<script>${scriptText}</script>`,
      scriptText,
      startLine: 0,
      startColumn: 8,
    }),
  ) as { mappings: string }
  // Act
  const segments = map.mappings.split(',')
  // Assert
  // Ten UTF-16 code units (the emoji takes two) make ten segments; counting code points would give nine and put `1` one column early.
  assert.equal(segments.length, 10)
})
