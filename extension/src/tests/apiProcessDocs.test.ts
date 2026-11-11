import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { API_PROCESS_PROBE_MS, API_VERSION } from '../constants'
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

// Value: protects=the API version 1.44 and its note name details.apiProcess, its three states and the 5 s bound of the probe; fails_when=the version stays 1.43, or the note omits the field, a state or the bound constant; no_claim=that a run measures the state (the run tests do)
test('API 1.44 is served and its note names details.apiProcess with its three states', async () => {
  // Arrange
  const constants = await readFile(
    join(__dirname, '..', '..', 'src', 'constants.ts'),
    'utf8',
  )
  // Act
  const missing = [
    ' * 1.44 is additive: the `SERVER_STOP_NOT_REACHED` error of an API stop',
    '`details.apiProcess`',
    '{ state: "paused" | "not-paused" | "unknown", at?: { path, line } }',
    '`not-paused` means js-debug answered that the thread is not paused',
    '{@link API_PROCESS_PROBE_MS}',
  ].filter((phrase) => !constants.includes(phrase))
  // Assert
  assert.equal(API_VERSION, '1.44')
  assert.equal(API_PROCESS_PROBE_MS, 5_000)
  assert.deepEqual(missing, [])
})

// Value: protects=the apiServer help tells the chat what details.apiProcess means and to name no cause the run did not observe; fails_when=a state, the output-tail pointer or the no-guessing rule is missing from the help; no_claim=that the chat follows the sentence (native checks own that)
test('the apiServer help explains details.apiProcess and forbids naming an unobserved cause', () => {
  // Arrange
  const attribution = viteHelp().viteApiServer.attribution.join('\n')
  // Act
  const missing = [
    'details.apiProcess is what Codebook measured of the API process when the deadline ran out',
    'state not-paused means the API process was running, not paused at any breakpoint, when the deadline ran out',
    'may be waiting inside the app (its database or another service it calls, for example) or no request reached the line',
    'paused (with at: { path, line } when the place maps to a repository file) means the API process was paused at that place',
    'unknown means Codebook could not read it',
    'read details.apiOutputTail for what the API printed',
    'never name a cause the run did not observe',
  ].filter((phrase) => !attribution.includes(phrase))
  // Assert
  assert.deepEqual(missing, [])
})

// Value: protects=the bundled skill 1.0.97 tells the chat how to report a not-paused API process and the README tells the learner what details.apiProcess means, where the run resource carries it and in which order the failure text gives it; fails_when=the skill version, the skill rule, the README sentence or the README's current API mention is stale; no_claim=how the chat behaves in a host
test('the skill and the README describe details.apiProcess of an unreached API stop', async () => {
  // Arrange
  const skill = await readPackaged('skills', 'codebook', 'SKILL.md')
  const readme = await readPackaged('README.md')
  // Act
  const missingFromSkill = [
    'metadata:\n  version: "1.0.97"\n',
    '`details.apiProcess.state` is `not-paused`',
    'the API process was running, not stopped at a breakpoint, when the deadline ran out',
    'the request may be waiting inside the app (it may depend on a service the app calls) or may never have arrived',
    "check the API's output tail",
    'never name a cause the run did not observe',
  ].filter((phrase) => !skill.includes(phrase))
  const missingFromReadme = [
    'with **MCP API 1.44** (`codebook_status` reports the installed build). API 1.44 is additive:',
    '`SERVER_STOP_NOT_REACHED` also states what Codebook measured of the API process at that moment in `details.apiProcess` (MCP API 1.44)',
    '`not-paused` means the API process was running, not paused at any breakpoint, so a request that reached the API may be waiting inside the app',
    'or no request reached the line, `paused` names the repository place where it was paused',
    '`unknown` means Codebook could not read it',
    "The run resource's operation failure carries the same `apiProcess`, and the failure text names the unreached stop first, then the measured state in one sentence, then the possibilities.",
    'updates to **1.0.97**',
  ].filter((phrase) => !readme.includes(phrase))
  // Assert
  assert.deepEqual(missingFromSkill, [])
  assert.deepEqual(missingFromReadme, [])
})
