import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { repositoryHtml } from '../dist/ui/repositoryHtml.js';

// Exercise the compiled renderer in Chromium; host messages and cached webview state are controlled inputs.
const [mode = 'verify', outputPath = 'artifacts/cycle-0016/repository-return-qa'] = process.argv.slice(2);
assert.ok(['red', 'verify'].includes(mode));
const output = resolve(outputPath), session = `cb-repository-return-${mode}`, html = repositoryHtml();
await mkdir(output, { recursive: true });
const anchor = { path: 'src/order.ts', hash: '1'.repeat(64), startLine: 1, endLine: 2 };
const message = {
  type: 'repository', revision: 7, loading: false, saving: false,
  catalog: [{ bookId: 'checkout', title: 'Checkout', revision: 1, revisions: [1], firstNodeId: 'order', status: 'available' }],
  selection: { bookId: 'checkout', revision: 1, nodeId: 'order', anchorIndex: 0 },
  sources: [{ ...anchor, currentHash: anchor.hash, status: 'current' }],
  understanding: { known: true, understood: false, reviewNeeded: false, history: [] },
  book: { bookId: 'checkout', latestRevision: 1,
    links: [{ nodeId: 'order', linkIndex: 0, status: 'available', outcome: 'demonstrated', studyId: 'saved-checkout', elapsedMs: 75000, recording: { status: 'available' } }],
    revision: { revision: 1, publishedAt: '2026-09-21T00:00:00.000Z', document: {
      title: 'Checkout', summary: 'Retain the exact article while reading captured evidence.', edges: [],
      nodes: [{ id: 'order', title: 'Create the selected order', anchors: [anchor], observations: [], sections: [
        { title: 'Retained cart', text: 'Read the captured cart and selected product before the order is stored.\n\nThe article explains the cited source. Runtime evidence retains its separate identity.' },
        { title: 'Order creation', text: 'The paused observation identifies the selected order operation. Returning from its recording must preserve the original reading location.\n\nMoving native panes may save a different temporary viewport. That cached viewport must not replace the explicit return location.' },
      ] }],
    } },
  },
};

/** Runs one CLI step for this renderer regression and preserves transport failures. @example await command(['open', 'about:blank'], 'open') */
async function command(arguments_, label) {
  const result = spawnSync('playwright-cli', [`-s=${session}`, ...arguments_], { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  await writeFile(`${output}/${label}.log`, result.stdout + result.stderr);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes('### Error'), false, result.stdout);
  return result.stdout;
}

/** Recreates the actual reader with competing saved/explicit locations to expose native Return precedence. @example await check(page, { html, message, output }) */
async function check(page, options) {
  const cases = [];
  for (const scenario of [
    { name: 'observation Return overrides a cached temporary pane position', focusId: 'evidence-0-observation', explicit: true, expectedTop: 221 },
    { name: 'recording Return overrides a cached temporary pane position', focusId: 'evidence-0-recording', explicit: true, expectedTop: 221 },
    { name: 'same-article reopen without an explicit location retains cached reading', focusId: 'evidence-0-recording', explicit: false, expectedTop: 110.5 },
    { name: 'a different article ignores the previous article cached location', focusId: 'article-title', explicit: false, foreign: true },
  ]) {
    // Arrange: the host's original control was halfway down; hidden-pane persistence saved one quarter instead.
    await page.goto('about:blank'); await page.setViewportSize({ width: 326, height: 442 });
    const location = { sectionIndex: 4, fraction: 0, focusId: scenario.focusId, focusViewportFraction: 0.5 };
    const saved = { key: scenario.foreign ? 'different/1/article' : 'checkout/1/order', location: { ...location, focusViewportFraction: 0.25 } };
    await page.evaluate(state => {
      window.sent = []; window.acquireVsCodeApi = () => ({ getState: () => state, setState() {}, postMessage: value => window.sent.push(value) });
    }, saved);
    await page.setContent(options.html);
    const message = { ...options.message, selection: { ...options.message.selection, ...(scenario.explicit ? { location } : {}) } };
    // Act: an explicit Study Return or ordinary reopen reconstructs the webview after native pane movement.
    await page.evaluate(value => window.dispatchEvent(new MessageEvent('message', { data: value })), message);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const actual = await page.evaluate(id => {
      const control = document.getElementById(id), bounds = control.getBoundingClientRect();
      return { focusedId: document.activeElement.id, top: bounds.top, scrollY, understood: document.getElementById('understand').checked };
    }, scenario.focusId);
    // Assert: exact control and reading offset survive; this action never grants understanding.
    const passed = actual.focusedId === scenario.focusId && actual.understood === false
      && (scenario.foreign ? actual.scrollY === 0 : Math.abs(actual.top - scenario.expectedTop) <= 1);
    await page.screenshot({ path: `${options.output}/case-${cases.length + 1}.png` });
    cases.push({ name: scenario.name, expectedTop: scenario.expectedTop, expectedFocus: scenario.focusId, actual, passed });
  }
  return cases;
}

const report = { mode, htmlSha256: createHash('sha256').update(html).digest('hex'), qualification: 'Real compiled renderer and Chromium; controlled host/cached-state inputs, separate from native installed validation.', cases: [] };
let recording = false;
try {
  await command(['open', 'about:blank'], 'open');
  await command(['video-start', `${output}/flow.webm`], 'video-start'); recording = true;
  const result = await command(['run-code', `async page => (${check.toString()})(page, ${JSON.stringify({ html, message, output })})`], 'cases');
  report.cases = JSON.parse(result.split('### Result\n')[1].split('\n###')[0]);
  assert.deepEqual(report.cases.map(entry => entry.passed), mode === 'red' ? [false, false, true, true] : [true, true, true, true]);
} finally {
  if (recording) await command(['video-stop'], 'video-stop');
  await writeFile(`${output}/result.json`, `${JSON.stringify(report, null, 2)}\n`);
  await command(['close'], 'close');
}
console.log(JSON.stringify(report.cases.map(entry => ({ name: entry.name, passed: entry.passed, actual: entry.actual }))));
