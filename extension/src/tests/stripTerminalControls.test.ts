import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  stripTerminalControls,
  stripTerminalControlsAcross,
} from '../utils/stripTerminalControls'

// Value: protects=the Application pane shows a test's recorded output as text: colors, cursor moves, window titles and links of a terminal are removed while the printed text, tabs and line feeds stay; fails_when=an escape sequence survives in part (such as `[32m` or `(B`) or a tab or line feed is lost; why_new=PR-B1 shows recorded output in the Application pane (Design 3, EN10); seam=none; no_claim=how a terminal would have rendered the output
test('recorded test output keeps its text, tabs and line feeds and loses terminal escape sequences', () => {
  // Arrange
  const printed =
    '\u001b[32m✓\u001b[39m schedules a job\r\n' +
    '\u001b]0;vitest\u0007total\t3\n' +
    '\u001b]8;;https://example.test\u001b\\link\u001b]8;;\u001b\\\n' +
    '\u001b7\u001b[2Kprogress\u001b8\u001b(B\u001bM\n'

  // Act
  const shown = stripTerminalControls(printed)

  // Assert
  assert.equal(shown, '✓ schedules a job\ntotal\t3\nlink\nprogress\n')
})

// Value: protects=recorded output cannot reorder or hide what the learner reads: bidirectional controls and C0 controls other than tab and line feed are removed; fails_when=a bidirectional override or a bell, backspace or form feed reaches the pane; why_new=test output is untrusted text from the learner's repository (EN10, S3-1); seam=none; no_claim=Unicode text without controls, which stays as printed
test('recorded test output loses bidirectional and other invisible controls', () => {
  // Arrange
  const printed =
    '\u0007bell \u202Eevil\u202C done \u2066x\u2069\n\u0008back\u000Cfeed\u061C\u200E\u200F ok\n'

  // Act
  const shown = stripTerminalControls(printed)

  // Assert
  assert.equal(shown, 'bell evil done x\nbackfeed ok\n')
})

// Value: protects=recorded output loses DEL and the C1 controls too, and an 8-bit color sequence (CSI written as U+009B) goes whole, so the Application pane keeps the README's promise that control characters are removed; fails_when=DEL, NEL or another C1 control reaches the pane, or an 8-bit sequence leaves its parameters, such as `31m`, as text; why_new=Step 9 pass 2's maintainability review: the class lost DEL and C1, which sanitizeCause removes, and only the 7-bit ESC form of CSI was recognized; seam=none; no_claim=the C1 string escapes other than OSC, which the DCS, SOS, PM and APC test below pins
test('recorded test output loses DEL, C1 controls and 8-bit color sequences', () => {
  // Arrange
  const printed = 'a\u007Fb\u0085c\u009B31md\u009B0m ok\n'

  // Act
  const shown = stripTerminalControls(printed)

  // Assert
  assert.equal(shown, 'abcd ok\n')
})

// Value: protects=an OSC sequence ended by the 8-bit string terminator (U+009C), and an 8-bit OSC (U+009D … U+009C), goes whole: the text printed after it and its line feed stay, and a window title or a link's address is not shown as output; fails_when=the OSC body runs past U+009C to the next escape or the chunk's end and deletes the printed text and line feeds after it, or an 8-bit OSC leaves its payload as text; why_new=Step 9 pass 3's testing review and red team: pass 2 recognized the 8-bit CSI but not the 8-bit string forms; seam=none; no_claim=DCS, SOS, PM and APC strings, which the test below pins
test('recorded test output loses an OSC ended by the 8-bit string terminator and an 8-bit OSC, and keeps the text after them', () => {
  // Arrange
  const printed =
    '\u001b]8;;https://example.test\u009clink\u001b]8;;\u009c done\n' +
    '\u009d0;title\u009cvisible line\n'

  // Act
  const shown = stripTerminalControls(printed)

  // Assert
  assert.equal(shown, 'link done\nvisible line\n')
})

// Value: protects=a control string that the launcher's 4,096-character entry limit split across two output entries goes whole: a color sequence's tail such as `2m` and an OSC's payload such as a forged window title never show as output; fails_when=a piece of a split sequence stays as text, or the text around it is lost; why_new=F109 (controls were removed per entry); seam=none; no_claim=the entries' lines, which the index test pins
test('a terminal sequence split across two output entries is removed whole', () => {
  // Arrange
  const entries = [
    'ok \u001b[3',
    '2m green\n\u001b]0;forged ti',
    'tle\u0007after\n',
  ]

  // Act
  const shown = stripTerminalControlsAcross(entries)

  // Assert
  assert.deepEqual(shown, ['ok ', ' green\n', 'after\n'])
})

// Value: protects=DCS, SOS, PM and APC strings, in their 7-bit and 8-bit forms, go up to their terminator with their payload, and a string terminated in a later entry goes across both; fails_when=a payload such as `secret` stays as output text; why_new=F148 (only the introducers were removed); seam=none; no_claim=text after the terminator, which stays
test('DCS, SOS, PM and APC strings are removed with their payload in both forms and across entries', () => {
  // Arrange
  const printed = [
    'a\u001bPsecret\u001b\\b',
    'c\u0090secret\u009cd',
    'e\u001bXsecret\u001b\\f\u0098secret\u009cg',
    'h\u001b^secret\u001b\\i\u009esecret\u009cj',
    'k\u001b_secret\u001b\\l\u009fsecret\u009cm',
    'n\u001b_sec',
    'ret\u001b\\o',
  ]

  // Act
  const shown = stripTerminalControlsAcross(printed)

  // Assert
  assert.deepEqual(shown, ['ab', 'cd', 'efg', 'hij', 'klm', 'n', 'o'])
})

// Value: protects=an introducer with no terminator within the next 4,096 code points is a stray: only its own code points go and the text after it stays, so one stray U+009D no longer deletes the rest of its entry; fails_when=a stray introducer removes the following text, or a string closed exactly at the bound stays; why_new=F148 and closure rule 7's bounds; seam=none; no_claim=how a terminal would treat a stray
test('an introducer with no terminator within 4,096 code points removes only itself', () => {
  // Arrange
  const text = 'a'.repeat(5_000)
  const closedAtBound = '\u009d' + 'b'.repeat(4_096) + '\u009c'

  // Act
  const strayEightBit = stripTerminalControls(`x\u009d${text}\u0007y`)
  const straySevenBit = stripTerminalControls(`x\u001b]0;${text}\u0007y`)
  const closed = stripTerminalControls(`${closedAtBound}z`)
  const strayAtEnd = stripTerminalControls('p\u009dq')

  // Assert
  assert.equal(strayEightBit, `x${text}y`)
  assert.equal(straySevenBit, `x0;${text}y`)
  assert.equal(closed, 'z')
  assert.equal(strayAtEnd, 'pq')
})

// Value: protects=output dense with unterminated 8-bit introducers is stripped in time linear in its length, so a hostile 8 MiB journal cannot stall the extension host; fails_when=200,000 U+009D take more than 500 ms (the scan of 4,096 code points per introducer returned: about 800 million steps) or the introducers are not all removed; why_new=F289; seam=none; no_claim=the speed of ordinary output
test('200,000 unterminated 8-bit introducers are stripped within 500 ms', () => {
  // Arrange
  const dense = `${'\u009D'.repeat(200_000)}tail`
  const startedAt = performance.now()

  // Act
  const shown = stripTerminalControls(dense)
  const elapsedMs = performance.now() - startedAt

  // Assert
  assert.equal(shown, 'tail')
  // gstack-timing-ok: the bound is F289's contract (linear time): the quadratic scan took 1,431 ms here and the linear one 11 ms, so 500 ms separates them under load.
  assert.ok(elapsedMs < 500, `took ${Math.round(elapsedMs)} ms`)
})

// Value: protects=the linear scan keeps the closure-rule-7 reach of a string: an introducer whose terminator lies 4,096 code points away goes whole even when astral characters sit between, and one a code point further is a stray; fails_when=the bound counts UTF-16 units instead of code points, or a nested introducer inside a string splits it; why_new=F289 (the scan was rewritten); seam=none; no_claim=anything beyond the bound
test('the string bound counts code points and a nested introducer stays inside its string', () => {
  // Arrange
  const exactlyAtBound = `\u009D${'😀'.repeat(4_096)}\u0007kept`
  const oneBeyond = `\u009D${'😀'.repeat(4_097)}\u0007kept`
  const nested = 'a\u009Dtitle\u009Dmore\u0007b'

  // Act
  const shown = [exactlyAtBound, oneBeyond, nested].map(stripTerminalControls)

  // Assert
  assert.equal(shown[0], 'kept')
  assert.equal(shown[1], `${'😀'.repeat(4_097)}kept`)
  assert.equal(shown[2], 'ab')
})
