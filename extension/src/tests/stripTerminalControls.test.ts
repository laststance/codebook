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

// Value: protects=recorded output loses DEL and the C1 controls too, and an 8-bit color sequence (CSI written as U+009B) goes whole, so the Application pane keeps the README's promise that control characters are removed; fails_when=DEL, NEL or another C1 control reaches the pane, or an 8-bit sequence leaves its parameters, such as `31m`, as text; why_new=Step 9 pass 2's maintainability review: the class lost DEL and C1, which sanitizeCause removes, and only the 7-bit ESC form of CSI was recognized; seam=none; no_claim=the C1 escapes other than CSI, whose following text stays as printed
test('recorded test output loses DEL, C1 controls and 8-bit color sequences', () => {
  // Arrange
  const printed = 'a\u007Fb\u0085c\u009B31md\u009B0m ok\n'

  // Act
  const shown = stripTerminalControls(printed)

  // Assert
  assert.equal(shown, 'abcd ok\n')
})
