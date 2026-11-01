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
  assert.match(
    html,
    /title="src\/jobs\.test\.ts › &lt;img src=x onerror=alert\(1\)&gt;"/,
  )
  // The lines reach the document's script as JSON in which `<` is an escape, so no line can end the script element or add one (the script draws them as text).
  assert.ok(html.includes('"text":"\\u003cscript>alert(1)\\u003c/script>"'))
  assert.ok(html.includes('\\">\\u003cb onmouseover=\\"alert(2)\\">x'))
})

// Value: protects=the Application document of a test replay: a script-only policy without images, the two header lines, the output region with its accessible name, hidden empty lines, the verdict, the hidden Jump to latest and the footer; fails_when=the policy admits images or another script source, the region loses its role or name, the markup draws output lines itself (a second renderer next to the script's, F136), or an absent line shows; why_new=Design 3, DS4, DS17 and DS20 define this document; seam=none; no_claim=its rendering, the `[stderr] ` mark or in-place updates, which the Reader DOM check covers
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
    /<pre id="test-output" tabindex="0" role="region" aria-label="Recorded test output up to 0\.42 s"><\/pre>/,
  )
  // The output lines are drawn by the document's script from the first view in its options, never by this markup (F136).
  assert.equal(html.includes('class="output-line"'), false)
  assert.equal(html.includes('class="stderr-mark"'), false)
  assert.ok(
    html.includes('{"channel":"stderr","text":"slow timer","number":1}'),
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

// Value: protects=a standard-error line cut to its end reaches the script with its cut flag, which the one renderer reads to leave out the `[stderr] ` mark that belongs to the line's start; fails_when=the first view leaves out the cut flag, or the markup draws the line (and its mark) itself; why_new=Step 9's testing review found no test rendering a cut line; seam=none; no_claim=the drawn mark, which the Reader DOM check reads in the browser
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
  assert.ok(
    html.includes(
      '{"channel":"stderr","text":"end of a long warning","number":4,"cut":true}',
    ),
  )
  assert.equal(html.includes('class="stderr-mark"'), false)
})

// Value: protects=the recorded frame of an Extension replay is fitted into the Application pane's remaining height with its caption on its own line, so a tall frame in a short pane is not clipped by the pane that never scrolls; fails_when=the figure is not a shrinkable flex column, the image is not contained within the figure's height, the caption can shrink away, or an inline style (which the pane's policy blocks) sizes the image; why_new=a 720x640 frame in a 720x400 pane ended at 647 px under overflow hidden; seam=none; no_claim=the browser's layout, which the headless-Chrome measurement of the task covers
test('the Application document of an Extension replay fits the recorded frame into the pane height and keeps its caption visible', () => {
  // Arrange
  const view: NodeTestApplicationView = {
    ...hostileView,
    profile: 'chrome-extension',
    lines: [],
    frame: {
      src: 'data:image/png;base64,AAAA',
      label: 'Recorded frame captured at this stop',
      width: 720,
      height: 640,
    },
  }

  // Act
  const html = testOutputHtml(view, 'fixed-nonce', 'study_1')
  const serverHtml = testOutputHtml(
    { ...hostileView, profile: 'node-server' },
    'fixed-nonce',
    'study_1',
  )

  // Assert
  assert.ok(
    html.includes(
      '.extension-frame{flex:1 1 auto;min-height:0;min-width:0;margin:4px 0;display:flex;flex-direction:column;',
    ),
  )
  assert.ok(html.includes('max-height:100%'))
  assert.ok(html.includes('object-fit:contain'))
  assert.ok(html.includes('.extension-frame figcaption{flex:none;'))
  assert.equal(html.includes('style="max-width:100%;height:auto"'), false)
  assert.equal(serverHtml.includes('.extension-frame'), false)
})

// Value: protects=a short Application pane (about 255 px in a side bar) gives the recorded extension frame the height: one header line, one caption line and no footer sentence; fails_when=the header stacks time and surface on two lines again, the caption wraps, or the footer shows in a pane no taller than 360 px; why_new=Cycle 0069 native smoke: the frame rendered about 100 px tall in a 255 px pane; seam=none; no_claim=the rendered pixel height, which the headless-Chrome check at 720x255 and 720x400 reports
test('the Application document of an Extension replay leaves a short pane to the frame with a one-line header, a one-line caption and no footer', () => {
  // Arrange
  const view: NodeTestApplicationView = {
    ...hostileView,
    profile: 'chrome-extension',
    lines: [],
    frame: {
      src: 'data:image/png;base64,AAAA',
      label: 'Recorded frame from 1.2 s before this stop',
      width: 720,
      height: 640,
    },
  }

  // Act
  const html = testOutputHtml(view, 'fixed-nonce', 'study_1')

  // Assert
  assert.ok(
    html.includes(
      '.test-output-header{flex:none;display:flex;align-items:baseline;',
    ),
  )
  assert.ok(
    html.includes(
      '.extension-frame figcaption{flex:none;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
    ),
  )
  assert.ok(
    html.includes(
      '@media(max-height:360px){.test-output-footer{display:none}}',
    ),
  )
  assert.ok(
    html.includes(
      'title="Recorded frame from 1.2 s before this stop">Recorded frame from 1.2 s before this stop</figcaption>',
    ),
  )
})
