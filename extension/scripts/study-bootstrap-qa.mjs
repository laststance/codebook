import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { studyHtml } from '../dist/ui/studyHtml.js';
import { createConfiguredStudy } from '../dist/tests/utils/createConfiguredStudy.js';
import { decodeLearnerProgress } from '../dist/utils/decodeLearnerProgress.js';
import { selectStudy } from '../dist/utils/selectStudy.js';
import { projectStudy } from '../dist/studyModel.js';

const [mode = 'verify', outputPath = 'artifacts/cycle-0018/bootstrap-renderer'] = process.argv.slice(2);
assert.ok(['red', 'verify'].includes(mode));
const output = resolve(outputPath), session = `cb-bootstrap-${mode}`;
await mkdir(output, { recursive: true });
const study = createConfiguredStudy(), baseline = { text: '', hash: '0'.repeat(64), line: 1, path: '/fixture/unused.mts' };
const message = { type: 'study', revision: 1, model: projectStudy({ study, selection: { ...selectStudy(study), tab: 'live' },
  progress: decodeLearnerProgress({ version: 4, workspaceKey: study.workspaceKey, decisions: [] }, study.workspaceKey), baselines: { server: baseline, browser: baseline },
  citationSources: study.descriptor.sources.map(source => ({ ...source, currentHash: source.hash, status: 'current' })) }),
  busy: false, saving: false, loading: false, errors: [], canClick: false, canRun: false, profiles: [], moments: [], studies: [] };

/** Records each owned CLI operation for delayed-snapshot renderer verification. @example await command(['open', 'about:blank'], 'open') */
async function command(arguments_, label) {
  const result = await new Promise(resolve => execFile('playwright-cli', [`-s=${session}`, ...arguments_], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  await writeFile(`${output}/${label}.log`, result.stdout + result.stderr + (result.error ? `\n${String(result.error)}\n` : ''));
  assert.equal(result.error, null, String(result.error)); assert.equal(result.stdout.includes('### Error'), false, result.stdout);
  return result.stdout;
}

/** Exercises initial paint and replacement without host state, then releases an actual typed product model. @example await check(page, options) */
async function check(page, options) {
  const errors = []; page.on('pageerror', error => errors.push(String(error))); page.setDefaultTimeout(5_000);
  const cases = [], publish = message => page.evaluate(message => window.dispatchEvent(new MessageEvent('message', { data: message })), message);
  const inspect = () => page.evaluate(() => ({ text: document.body.innerText,
    actionable: [...document.querySelectorAll('button,input,select,summary')].filter(control => control.getClientRects().length && !control.closest('[inert]') && !control.disabled).length,
    writes: (window.sent ?? []).filter(message => ['action', 'understanding', 'profile', 'history'].includes(message.type)).length }));
  for (const kind of ['context', 'moments']) {
    // Arrange: first paint must be safe even before the inline renderer starts.
    await page.goto(options.url); await page.setContent(options.html[kind].replace(/<script nonce="[^"]+">[\s\S]*<\/script>/, ''));
    const firstPaint = await inspect(); await page.waitForTimeout(350);
    cases.push({ name: `${kind} first paint exposes only neutral loading guidance`, actual: firstPaint,
      passed: firstPaint.text.trim() === 'Loading study…' && firstPaint.actionable === 0 });
    for (const phase of ['initial', 'replacement']) {
      // Act: a real fresh document reports ready while the simulated host deliberately withholds state.
      await page.goto(options.url);
      await page.evaluate(() => { window.sent = []; window.acquireVsCodeApi = () => ({ getState: () => undefined, setState() {}, postMessage: message => window.sent.push(message) }); });
      await page.setContent(options.html[kind]);
      await page.waitForFunction(() => window.sent.some(message => message.type === 'ready'));
      await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
      const waiting = await inspect(); await page.screenshot({ path: `${options.output}/${kind}-${phase}-waiting.png` });
      cases.push({ name: `${kind} ${phase} awaits host state without actions or fabricated content`, actual: waiting,
        passed: waiting.text.trim() === 'Loading study…' && waiting.actionable === 0 && waiting.writes === 0 });
      await publish(options.message); await page.waitForFunction(() => window.sent.some(message => message.type === 'rendered'));
      const loaded = await inspect(), title = await page.locator('#title').textContent();
      await page.screenshot({ path: `${options.output}/${kind}-${phase}-loaded.png` }); await page.waitForTimeout(350);
      // Assert: normal content appears after a complete render; viewing never marks understanding.
      cases.push({ name: `${kind} ${phase} renders the actual article and safe stopped controls`, actual: { ...loaded, title },
        passed: title === 'Theme' && !loaded.text.includes('Loading study…') && !loaded.text.includes('Study the checkout flow')
          && await page.locator('[data-action="continue"]').isDisabled() && loaded.writes === 0 });
      if (kind === 'context') {
        await page.getByRole('button', { name: 'Open current file', exact: true }).click();
        const action = await page.evaluate(() => window.sent.findLast(message => message.type === 'action'));
        cases.push({ name: `${phase} enables an explicit source action with the loaded revision`, actual: action,
          passed: action?.action === 'current-file' && action.revision === 1 });
        if (phase === 'initial') {
          // Arrange: reproduce a narrow Study column when a followed runtime pause arrives.
          await page.setViewportSize({ width: 260, height: 750 });
          const observed = { ...options.message, revision: 2, liveState: 'paused', liveTitle: 'Checkout demo',
            model: { ...options.message.model, matching: true, selection: { ...options.message.model.selection, tab: 'live', follow: true },
              observation: { id: 'pause-1', capturedAt: '2026-09-26T05:07:15.000Z', values: { price: 24, cartCount: 1 },
                interpretations: [{ text: 'The selected tote costs $24 and the cart count is one.' }] } } };
          // Act: a host loading update precedes the complete pause, as it does during a native run.
          await publish({ ...observed, loading: true });
          await page.waitForFunction(() => window.sent.some(message => message.type === 'rendered' && message.revision === 2));
          await publish({ ...observed, revision: 3 });
          await page.waitForFunction(() => window.sent.some(message => message.type === 'rendered' && message.revision === 3));
          const revealed = await page.evaluate(() => ({ scrollY: window.scrollY,
            interpretationTop: document.querySelector('#live-content h2').getBoundingClientRect().top,
            interpretationBottom: document.querySelector('#interpretations').getBoundingClientRect().bottom,
            valuesBottom: document.querySelector('#values tr').getBoundingClientRect().bottom,
            viewportHeight: window.innerHeight }));
          await page.screenshot({ path: `${options.output}/narrow-followed-pause.png` });
          // Assert: interpretation and at least one captured value are visible without moving the app or source panes.
          cases.push({ name: 'narrow followed pause reveals interpretation and captured values without a manual scroll', actual: revealed,
            passed: revealed.scrollY > 0 && revealed.interpretationTop >= 0 && revealed.interpretationBottom <= revealed.viewportHeight
              && revealed.valuesBottom <= revealed.viewportHeight });
          await page.evaluate(() => window.scrollTo(0, 0));
          await publish({ ...observed, revision: 4 });
          await page.waitForFunction(() => window.sent.some(message => message.type === 'rendered' && message.revision === 4));
          cases.push({ name: 'refresh of the same pause preserves the learner reading position',
            passed: await page.evaluate(() => window.scrollY === 0) });
        }
      }
    }
    if (kind === 'context') {
      await publish({ ...options.message, model: { ...options.message.model, progressByItem: [] } });
      cases.push({ name: 'an absent selection never invents a checkout topic', passed: await page.locator('#title').textContent() === 'Codebook study' });
    }
  }
  return { cases, errors };
}

const report = { mode, qualification: 'Real Chromium/compiled product HTML; delayed simulated host snapshots, not native acceptance.',
  compiledSha256: createHash('sha256').update(await readFile('extension/dist/ui/studyHtml.js')).digest('hex'), cases: [] };
const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Codebook bootstrap verification</title>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let recording = false;
try {
  await command(['open', 'about:blank'], 'open');
  await command(['run-code', `async page => { await page.setViewportSize({ width: 420, height: 720 }); await page.screencast.start({ path: ${JSON.stringify(`${output}/flow.webm`)}, size: { width: 420, height: 720 } }); }`], 'video-start'); recording = true;
  const result = await command(['run-code', `async page => (${check.toString()})(page, ${JSON.stringify({ html: { context: studyHtml('context'), moments: studyHtml('moments') }, message, output, url: `http://127.0.0.1:${server.address().port}/` })})`], 'flow');
  Object.assign(report, JSON.parse(result.split('### Result\n')[1].split('\n###')[0]));
  await command(['run-code', 'async page => await page.screencast.stop()'], 'video-stop'); recording = false;
  assert.deepEqual(report.errors, []);
  assert.equal(report.cases.every(entry => entry.passed), mode !== 'red', JSON.stringify(report.cases));
} finally {
  // Preserve diagnostics and release each owned resource independently after assertions or transport failures.
  try { await writeFile(`${output}/result.json`, `${JSON.stringify(report, null, 2)}\n`); }
  finally { try { if (recording) await command(['run-code', 'async page => await page.screencast.stop()'], 'failure-video-stop'); }
    finally { try { await command(['close'], 'close'); } finally { await new Promise(resolve => server.close(resolve)); } } }
}
console.log(JSON.stringify(report.cases.map(entry => ({ name: entry.name, passed: entry.passed }))));
