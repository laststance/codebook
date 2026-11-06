import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SINGLE_BUNDLE_ERROR_BODY_LIMIT_BYTES } from '../constants'
import { expoWebBundlerLineOf } from '../utils/expoWebBundlerLineOf'
import { buildExpoWebEnvironment } from '../utils/expoWebChildEnvironment'
import { isExpoWebScriptOfModule } from '../utils/isExpoWebScriptOfModule'
import { classifyExpoWebOutput } from '../utils/launchExpoWebDevelopmentServer'
import { readErrorBodyHead } from '../utils/readErrorBodyHead'

// Value: protects=Metro is not reachable from the learner's LAN: the child gets IPv4-first DNS so --localhost binds 127.0.0.1; fails_when=the option is missing from NODE_OPTIONS; why_new=Cycle 0089 review (OCR security); seam=none; no_claim=real Metro bind
test('the Expo child gets the IPv4-first Node option so the loopback bind is 127.0.0.1', () => {
  // Arrange / Act
  const environment = buildExpoWebEnvironment({})
  // Assert
  assert.equal(environment.NODE_OPTIONS, '--dns-result-order=ipv4first')
})

// Value: protects=the learner's own Node options survive; fails_when=the option replaces them; why_new=append rule; seam=none; no_claim=none
test('the IPv4-first option is appended after an existing NODE_OPTIONS of the script', () => {
  // Arrange / Act
  const environment = buildExpoWebEnvironment({
    NODE_OPTIONS: '--max-old-space-size=4096',
  })
  // Assert
  assert.equal(
    environment.NODE_OPTIONS,
    '--max-old-space-size=4096 --dns-result-order=ipv4first',
  )
})

// Value: protects=a plugin printing EADDRINUSE while Metro starts does not fail a listening start; fails_when=the conflict regex runs before the listening check; why_new=Cycle 0089 review; seam=none; no_claim=none
test('output with a plugin EADDRINUSE line and the Waiting on line is listening, not port-in-use', () => {
  // Arrange
  const output =
    'plugin: retrying after EADDRINUSE on 9229\nWaiting on http://localhost:4101\n'
  // Act
  const listening = classifyExpoWebOutput(output, 4101)
  // Assert
  assert.equal(listening, true)
})

// Value: protects=the real busy-port output of Expo 57 is still port-in-use; fails_when=the listening-first order drops the conflict check; why_new=real lines observed in the Space; seam=none; no_claim=other Expo versions
test('the real Expo busy-port output without a Waiting on line is refused as port-in-use', () => {
  // Arrange
  const output = [
    '› Port 4114 is running this app in another window',
    "Input is required, but 'npx expo' is in non-interactive mode.",
    '> Use port 4115 instead?',
    '› Skipping dev server',
  ].join('\n')
  // Act / Assert
  assert.throws(
    () => classifyExpoWebOutput(output, 4114),
    (error: unknown) =>
      (error as { code?: string }).code === 'EXPO_WEB_PORT_UNAVAILABLE',
  )
})

// Value: protects=Metro's query is significant: another build option is another bundle; fails_when=Vite's t/v stripping is used; why_new=Cycle 0089 review; seam=none; no_claim=none
test('a Metro bundle URL differing in v is a different script, while localhost spelling matches', () => {
  // Arrange
  const sealed = 'http://127.0.0.1:8081/index.bundle?platform=web&v=1'
  // Act
  const sameBundle = isExpoWebScriptOfModule(
    sealed,
    'http://localhost:8081/index.bundle?platform=web&v=1',
  )
  const otherBundle = isExpoWebScriptOfModule(
    sealed,
    'http://localhost:8081/index.bundle?platform=web&v=2',
  )
  // Assert
  assert.equal(sameBundle, true)
  assert.equal(otherBundle, false)
})

// Value: protects=the Metro line a bundle-failed refusal quotes is the JSON message, else the first non-empty body line, else the status, never a page of text; fails_when=a non-JSON body quotes every line, an empty body quotes an empty string, or a non-string message is quoted; why_new=expoWebAdapter.test.ts covers only the JSON message form; seam=none; no_claim=Metro's real error shapes beyond these bodies
test('the quoted Metro line falls back to the first non-empty body line and then to the status', () => {
  // Arrange
  const identity = (text: string) => text
  // Act
  const plain = expoWebBundlerLineOf(
    { status: 500, body: '\n  \nUnable to resolve ./x\nat module y\n' },
    identity,
  )
  const nonStringMessage = expoWebBundlerLineOf(
    { status: 500, body: '{"message":42}' },
    identity,
  )
  const empty = expoWebBundlerLineOf({ status: 502, body: '' }, identity)
  const unreadable = expoWebBundlerLineOf(
    { status: 503, body: undefined },
    identity,
  )
  // Assert
  assert.equal(plain, 'Unable to resolve ./x')
  assert.equal(nonStringMessage, '{"message":42}')
  assert.equal(empty, 'Metro answered status 502')
  assert.equal(unreadable, 'Metro answered status 503')
})

// Value: protects=a quoted Metro message is masked before it is collapsed to one line and cut at 300 characters; fails_when=the secret survives, the message keeps its line breaks, or the cap is dropped; why_new=cap and whitespace collapse are untested; seam=none; no_claim=mask quality (a stand-in mask replaces one literal)
test('the quoted Metro line is masked, kept to one line and cut at 300 characters', () => {
  // Arrange
  const mask = (text: string) => text.replaceAll('pk-live-abc123', '***')
  const message = `Failed with pk-live-abc123\t   in   file ${'x'.repeat(400)}`
  // Act
  const line = expoWebBundlerLineOf(
    { status: 500, body: JSON.stringify({ message }) },
    mask,
  )
  // Assert
  assert.equal(line.length, 300)
  assert.equal(line.startsWith('Failed with *** in file xxxx'), true)
  assert.equal(line.includes('pk-live-abc123'), false)
})

// Value: protects=a secret cut by the error-body byte cap never reaches the quoted Metro line as an unmaskable fragment; fails_when=the head keeps the partial token at the cut; why_new=Cycle 0089 ship review (adversarial); seam=none; no_claim=mask quality
test('a secret straddling the error-body cap leaves no fragment in the quoted line', async () => {
  // Arrange
  const secret = 'SECRETVALUE-0123456789'
  const body = `${'\n'.repeat(SINGLE_BUNDLE_ERROR_BODY_LIMIT_BYTES - 8)}${secret}`
  const mask = (text: string) => text.replaceAll(secret, '***')
  // Act
  const head = await readErrorBodyHead(
    new Response(body, { status: 500 }),
    SINGLE_BUNDLE_ERROR_BODY_LIMIT_BYTES,
  )
  const line = expoWebBundlerLineOf({ status: 500, body: head }, mask)
  // Assert
  assert.equal(line.includes('SECRET'), false)
  assert.equal(line, 'Metro answered status 500')
})
