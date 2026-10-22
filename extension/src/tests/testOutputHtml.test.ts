import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { NodeTestApplicationView } from '../utils/projectNodeTestApplication'
import { testOutputHtml } from '../utils/testOutputHtml'

const HOSTILE_TITLE = '<img src=x onerror=alert(1)>'

/** A test replay's Application view whose test title and output lines hold markup, as a repository's test may print. */
const hostileView: NodeTestApplicationView = {
  generation: 3,
  time: 'Recorded test output · 0.42 s',
  test: `src/jobs.test.ts › ${HOSTILE_TITLE}`,
  name: `Recorded test output · src/jobs.test.ts › ${HOSTILE_TITLE} · 0.42 s`,
  region: 'Recorded test output up to 0.42 s',
  lines: [
    { channel: 'stdout', text: '<script>alert(1)</script>', number: 0 },
    { channel: 'stderr', text: '"><b onmouseover="alert(2)">x', number: 1 },
  ],
  end: 'Test passed · exit code 0',
}

// Value: protects=test output and test titles that hold markup render as text in the Application pane, in its body, its title and its attributes, so a repository's test cannot run script or add elements there; fails_when=a `<script>`, an event-handler attribute or a closing quote reaches the document unescaped; why_new=PR-B1 prints recorded output and test titles into the Application document (S3-1); seam=none; no_claim=the webview's Content Security Policy, which a browser enforces
test('test output and test titles that hold markup render as text in the Application pane', () => {
  // Arrange / Act
  const html = testOutputHtml(hostileView, 'fixed-nonce', 'study_1')

  // Assert
  assert.equal(
    html.split('<script').length - 1,
    1,
    'only the document’s own script',
  )
  assert.equal(html.includes(HOSTILE_TITLE), false)
  assert.equal(html.includes('<b onmouseover'), false)
  assert.equal(html.includes('"><b'), false)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(
    html,
    /title="src\/jobs\.test\.ts › &lt;img src=x onerror=alert\(1\)&gt;"/,
  )
  assert.match(html, /&quot;&gt;&lt;b onmouseover=&quot;alert\(2\)&quot;&gt;x/)
})

// Value: protects=the Application document of a test replay: a script-only policy without images, the two header lines, the output region with its accessible name, a `[stderr] ` mark on standard-error lines only, hidden empty lines, the verdict, the hidden Jump to latest and the footer; fails_when=the policy admits images or another script source, the region loses its role or name, stderr is told by color alone, or an absent line shows; why_new=Design 3, DS4, DS17 and DS20 define this document; seam=none; no_claim=its rendering or in-place updates, which the Reader DOM check covers
test('the Application document of a test replay names its moment, marks standard error and ends with the verdict', () => {
  // Arrange
  const view: NodeTestApplicationView = {
    ...hostileView,
    test: 'src/jobs.test.ts › job scheduler › runs a delayed job',
    name: 'Recorded test output · src/jobs.test.ts › job scheduler › runs a delayed job · 0.42 s',
    lines: [
      { channel: 'stdout', text: 'RUN src/jobs.test.ts', number: 0 },
      { channel: 'stderr', text: 'slow timer', number: 1 },
    ],
  }

  // Act
  const html = testOutputHtml(view, 'fixed-nonce', 'study_1')

  // Assert
  assert.match(
    html,
    /content="default-src 'none'; style-src 'nonce-fixed-nonce'; script-src 'nonce-fixed-nonce'"/,
  )
  assert.match(
    html,
    /<p id="test-output-time" class="status">Recorded test output · 0\.42 s<\/p>/,
  )
  assert.match(
    html,
    /<pre id="test-output" tabindex="0" role="region" aria-label="Recorded test output up to 0\.42 s">/,
  )
  assert.equal(html.split('class="stderr-mark"').length - 1, 1)
  assert.match(
    html,
    /data-channel="stderr"><span class="stderr-mark">\[stderr\] <\/span><span class="output-text">slow timer<\/span>/,
  )
  assert.match(html, /<p id="test-output-cut" class="muted" hidden><\/p>/)
  assert.match(
    html,
    /<p id="test-output-end" class="status">Test passed · exit code 0<\/p>/,
  )
  assert.match(
    html,
    /<button id="test-output-jump" type="button" hidden>Jump to latest<\/button>/,
  )
  assert.match(
    html,
    /Historical test output\. Reading it does not rerun the target\./,
  )
})

// Value: protects=a standard-error line cut to its end shows that end without the `[stderr] ` mark, which belongs to the line's start, and says it is cut; fails_when=the cut tail is marked as if it started the line, or the document leaves out the cut flag the in-place update compares; why_new=Step 9's testing review found no test rendering a cut line; seam=none; no_claim=the in-place update of a cut line, which the Reader DOM check drives
test('a cut standard-error line shows its end without the mark of its start', () => {
  // Arrange
  const view: NodeTestApplicationView = {
    ...hostileView,
    lines: [
      {
        channel: 'stderr',
        text: 'end of a long warning',
        number: 4,
        cut: true,
      },
    ],
  }

  // Act
  const html = testOutputHtml(view, 'fixed-nonce', 'study_1')

  // Assert
  assert.match(
    html,
    /<span class="output-line" data-line="4" data-channel="stderr" data-cut="true"><span class="output-text">end of a long warning<\/span>/,
  )
  assert.equal(html.includes('class="stderr-mark"'), false)
})
