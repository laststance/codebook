import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { expoWebHelp } from '../expoWebHelp'
import { operationsHelp } from '../operationsHelp'
import { viteHelp } from '../viteHelp'

/**
 * Reads a file the extension package ships; tests run from `dist/tests`.
 * @param segments - The path below the package root.
 * @returns The file's text.
 * @example await readPackaged('README.md')
 */
function readPackaged(...segments: string[]): Promise<string> {
  return readFile(join(__dirname, '..', '..', ...segments), 'utf8')
}

// Value: protects=the version 3 help tells the chat when to declare hold record (a request the app bounds with its own deadline, found by reading its code), what Codebook and the learner see, and the STALE_PAUSE refusal; fails_when=the field, the deadline rule, the never-to-avoid-explaining rule, the recordedStops list or the refusal is missing; no_claim=that Codebook implements the field (the run tests do)
test('the operations help names hold record, when to declare it, recordedStops and the STALE_PAUSE refusal', () => {
  // Arrange
  const recorded = operationsHelp().operationsQuickStart.recordedStops
  // Act
  const text = Object.values(recorded).join('\n')
  const missing = [
    'hold: "record"',
    'own deadline or timeout',
    "that request's code",
    'Never declare record merely to avoid explaining',
    'recordedStops',
    'zero-based declared stop indexes',
    'afterOperation 0',
    'saved replay',
    'STALE_PAUSE',
    'API 1.43 or later',
    'a version 1 or 2 configuration refuses hold as an unknown field',
    "field's path",
  ].filter((phrase) => !text.includes(phrase))
  // Assert
  assert.equal(recorded.minimumApi, '1.43')
  assert.deepEqual(missing, [])
})

// Value: protects=the apiServer help no longer tells the chat to explain every server pause before continuing when the request has a deadline, and points to recorded stops; fails_when=the order still has only the explain-then-continue sentence; no_claim=that a real run records the stops
test('the apiServer help sends a deadline-bound request to recorded stops and explanation after the result', () => {
  // Arrange
  const order = viteHelp().viteApiServer.order.join('\n')
  // Act
  const missing = [
    "bounded by the app's own deadline or timeout",
    'hold: "record"',
    'operationsQuickStart.recordedStops',
    "explain the recorded stops after the operation's result",
    'A held stop stays the default for code without a deadline',
  ].filter((phrase) => !order.includes(phrase))
  // Assert
  assert.deepEqual(missing, [])
})

// Value: protects=the bundled skill 1.0.96 and the README tell the chat and the learner about hold record only from API 1.43, with the deadline rule and the replay note; fails_when=the version, a rule sentence or the README bullet is missing; no_claim=how the chat behaves in a host
test('the skill and the README describe recorded stops from API 1.43 with the deadline rule', async () => {
  // Arrange
  const skill = await readPackaged('skills', 'codebook', 'SKILL.md')
  const readme = await readPackaged('README.md')
  // Act
  const missingFromSkill = [
    'metadata:\n  version: "1.0.96"\n',
    'With API 1.43 or later',
    'declare `hold: "record"` on its server stops',
    "explain the recorded stops in order after the operation's result",
    'never call `codebook_continue` for a recorded stop (it is refused `STALE_PAUSE`)',
    'Never declare `record` merely to avoid explaining',
    'in a `repository-browser` version 3 run only',
    'The `node-server` profile accepts no `version: 3`, `afterOperation` or `hold`',
    'resume promptly, explain after the response',
    "the app's own deadline may expire while a stop holds",
    'inspectable there only once the save has completed',
  ].filter((phrase) => !skill.includes(phrase))
  const missingFromReadme = [
    '**Record a stop without pausing (MCP API 1.43).**',
    'may declare `hold: "record"`',
    'the run never shows it paused',
    '`recordedStops`',
    "recorded values are in the saved replay's native debugger",
    'refused `STALE_PAUSE`',
    'updates to **1.0.96**',
    'is saved as format 24 (`.study.v24.json`)',
    'a Codebook older than API 1.43 lists it as saved by a newer Codebook',
  ].filter((phrase) => !readme.includes(phrase))
  // Assert
  assert.deepEqual(missingFromSkill, [])
  assert.deepEqual(missingFromReadme, [])
})

// Value: protects=no help surface that carries the pause order tells the chat to wait for paused or to call codebook_continue for a recorded stop; fails_when=the apiServer, Vite or Expo order sends a recorded stop through the wait-then-continue step; no_claim=that a real run records the stops
test('the apiServer, Vite and Expo help limit wait-then-continue to held stops and read recordedStops for a recorded stop', () => {
  // Arrange
  const apiText = viteHelp().viteApiServer.attribution.join('\n')
  const viteText = viteHelp().viteQuickStart.callOrder.join('\n')
  const expoText = expoWebHelp().expoWebQuickStart.callOrder.join('\n')
  const never = 'do not wait for it and do not call codebook_continue for it'
  // Act
  const missing = [
    apiText.includes(
      'A recorded stop (hold: "record") is never held: do not wait for paused-server and never call codebook_continue for it',
    )
      ? ''
      : 'apiServer',
    viteText.includes(never) ? '' : 'vite',
    expoText.includes(never) ? '' : 'expo',
  ].filter((name) => name !== '')
  // Assert
  assert.deepEqual(missing, [])
})
