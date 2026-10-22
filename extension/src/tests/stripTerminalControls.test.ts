import assert from 'node:assert/strict'
import { test } from 'node:test'

import { stripTerminalControls } from '../utils/stripTerminalControls'

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
  const printed = '\u0007bell ‮evil‬ done ⁦x⁩\n\u0008back\u000Cfeed؜‎‏ ok\n'

  // Act
  const shown = stripTerminalControls(printed)

  // Assert
  assert.equal(shown, 'bell evil done x\nbackfeed ok\n')
})

// Value: protects=recorded output loses DEL and the C1 controls too, and an 8-bit color sequence (CSI written as U+009B) goes whole, so the Application pane keeps the README's promise that control characters are removed; fails_when=DEL, NEL or another C1 control reaches the pane, or an 8-bit sequence leaves its parameters, such as `31m`, as text; why_new=Step 9 pass 2's maintainability review: the class lost DEL and C1, which sanitizeCause removes, and only the 7-bit ESC form of CSI was recognized; seam=none; no_claim=the C1 string escapes other than OSC (DCS, SOS, PM and APC), whose introducers alone are removed
test('recorded test output loses DEL, C1 controls and 8-bit color sequences', () => {
  // Arrange
  const printed = 'a\u007Fb\u0085c\u009B31md\u009B0m ok\n'

  // Act
  const shown = stripTerminalControls(printed)

  // Assert
  assert.equal(shown, 'abcd ok\n')
})

// Value: protects=an OSC sequence ended by the 8-bit string terminator (U+009C), and an 8-bit OSC (U+009D … U+009C), goes whole: the text printed after it and its line feed stay, and a window title or a link's address is not shown as output; fails_when=the OSC body runs past U+009C to the next escape or the chunk's end and deletes the printed text and line feeds after it, or an 8-bit OSC leaves its payload as text; why_new=Step 9 pass 3's testing review and red team: pass 2 recognized the 8-bit CSI but not the 8-bit string forms; seam=none; no_claim=DCS, SOS, PM and APC strings, whose C1 introducers alone are removed
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
