import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildExpoWebEnvironment } from '../utils/expoWebChildEnvironment'
import { isExpoWebScriptOfModule } from '../utils/isExpoWebScriptOfModule'
import { classifyExpoWebOutput } from '../utils/launchExpoWebDevelopmentServer'

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
