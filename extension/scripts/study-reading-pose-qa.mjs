import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { studyHtml } from '../dist/ui/studyHtml.js';
import { createConfiguredStudy } from '../dist/tests/utils/createConfiguredStudy.js';
import { decodeLearnerProgress } from '../dist/utils/decodeLearnerProgress.js';
import { selectStudy } from '../dist/utils/selectStudy.js';
import { projectStudy } from '../dist/studyModel.js';

const [mode = 'verify', outputPath = 'artifacts/cycle-0018/reading-pose-browser'] = process.argv.slice(2);
assert.ok(['red', 'verify'].includes(mode));
const output = resolve(outputPath), session = `cb-reading-pose-${mode}`;
await mkdir(output, { recursive: true });
let html = studyHtml('context');
const compiled = mode === 'red' ? 'artifacts/cycle-0018/reading-pose-controls/original-studyHtml.js' : 'extension/dist/ui/studyHtml.js';
if (mode === 'red') {
  const originalConstants = {}, originalHtml = {}, nativeRequire = createRequire(resolve('extension/dist/ui/studyHtml.js'));
  runInNewContext(await readFile('artifacts/cycle-0018/reading-pose-controls/original-ui-constants.js', 'utf8'), { exports: originalConstants, require: nativeRequire });
  runInNewContext(await readFile(compiled, 'utf8'), { exports: originalHtml, require: name => name === './constants' ? originalConstants : nativeRequire(name) });
  html = originalHtml.studyHtml('context');
}
const study = createConfiguredStudy(), baseline = { text: '', hash: '0'.repeat(64), line: 1, path: '/fixture/unused.mts' };
const model = projectStudy({ study, selection: { ...selectStudy(study), tab: 'live' },
  progress: decodeLearnerProgress({ version: 4, workspaceKey: study.workspaceKey, decisions: [] }, study.workspaceKey), baselines: { server: baseline, browser: baseline },
  citationSources: study.descriptor.sources.map(source => ({ path: source.path, hash: source.hash, currentHash: source.hash, status: 'current' })) });
model.observation.interpretations = [{ text: 'This is source and captured-value context for a reader transfer. '.repeat(35) }];
const message = { type: 'study', revision: 1, model, busy: false, saving: false, loading: false, errors: [], canClick: false, canRun: false, profiles: [], moments: [], studies: [],
  presentation: { presentationId: '11111111-1111-4111-8111-111111111111', presentationControlRevision: 1, mode: 'study-workspace', state: 'open', layoutConfirmed: true, preference: { status: 'default' }, panes: {} } };

/** Runs the owned Chromium session through the CLI and retains transport failures separately from assertions. @example command(['open', 'about:blank'], 'open') */
async function command(arguments_, label) {
  const result = await new Promise(resolve => execFile('playwright-cli', [`-s=${session}`, ...arguments_], { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    (error, stdout, stderr) => resolve({ status: error?.code ?? 0, stdout, stderr })));
  await writeFile(`${output}/${label}.log`, result.stdout + result.stderr);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.includes('### Error'), false, result.stdout);
  return result.stdout;
}

/** Recreates the actual product DOM and exercises capture, restoration and newer keyboard input; native host messages are simulated. @example check(page, options) */
async function check(page, options) {
  const errors = []; page.on('pageerror', error => errors.push(String(error))); page.setDefaultTimeout(5_000);
  const publish = message => page.evaluate(message => window.dispatchEvent(new MessageEvent('message', { data: message })), message);
  const render = async message => {
    await page.goto(options.url);
    await page.evaluate(() => { window.sent = []; window.acquireVsCodeApi = () => ({ getState: () => undefined, setState() {}, postMessage: message => window.sent.push(message) }); });
    await page.setContent(options.html); await publish(message);
    try { await page.waitForFunction(() => window.sent.some(message => message.type === 'rendered'), undefined, { timeout: 5_000 }); }
    catch (error) { throw new Error(JSON.stringify({ stage: 'initial product render', error: String(error), errors, sent: await page.evaluate(() => window.sent) })); }
  };
  const inspect = () => page.evaluate(() => ({
    focus: document.activeElement?.id, scrollY: window.scrollY,
    anchorTop: document.getElementById('source-version').getBoundingClientRect().top,
    expanded: [...document.querySelectorAll('details[open]')].map(element => element.id),
    visited: [...new Set([...document.querySelectorAll('.visited')].map(element => element.dataset.action))],
    understood: document.getElementById('understood').checked,
    invalidated: window.sent.filter(message => message.type === 'presentation-pose-invalidated').length,
    restored: window.sent.filter(message => message.type === 'presentation-pose-restored').length,
    understandingWrites: window.sent.filter(message => message.type === 'understanding').length,
  }));
  const applying = { ...options.message, presentation: { ...options.message.presentation, state: 'applying' } };
  const request = { type: 'capture-presentation-pose', captureId: '22222222-2222-4222-8222-222222222222',
    presentationId: applying.presentation.presentationId, expectedRevision: 1, revision: 1, itemId: applying.model.selection.itemId, sourceHash: applying.model.source.hash,
    studyId: applying.model.selection.studyId, observationId: applying.model.observation?.id, contentTab: applying.model.selection.tab };
  await page.setViewportSize({ width: 390, height: 640 }); await render(options.message);
  await page.locator('#presentation-options > summary').click();
  await page.locator('[data-action="source"]').nth(1).click();
  await page.locator('#understood').focus();
  const before = await inspect(); await publish(applying); await publish(request);
  const captured = await page.evaluate(() => window.sent.findLast(message => message.type === 'presentation-pose'));
  const living = { ...applying, presentation: { ...applying.presentation, mode: 'living-book' } };
  await page.screenshot({ path: `${options.output}/before-replacement.png` });
  await page.waitForTimeout(500); // Video reading pause after capture; it does not satisfy a product readiness predicate.
  // A real document replacement deliberately has no old local state or HTMLElement references.
  await render(living);
  if (captured?.pose) { await publish({ ...captured, type: 'restore-presentation-pose' }); await page.waitForFunction(() => window.sent.some(message => message.type === 'presentation-pose-restored')); }
  const after = await inspect(); await page.screenshot({ path: `${options.output}/after-replacement.png` });
  await page.waitForTimeout(500);
  const cases = [{ name: 'replacement preserves reading, disclosure, visited link and focused control', before, after,
    passed: Boolean(captured?.pose) && before.focus === 'understood' && after.focus === 'understood' && Math.abs(after.anchorTop - before.anchorTop) <= 2
      && JSON.stringify(after.expanded) === JSON.stringify(before.expanded) && JSON.stringify(after.visited) === JSON.stringify(before.visited)
      && after.understood === before.understood && after.understandingWrites === 0 && after.restored === 1 }];
  if (options.mode === 'red') return { captured, cases };
  if (!captured?.pose) throw new Error('No serializable reading pose was captured.');
  const restore = { ...captured, type: 'restore-presentation-pose' };
  await render(applying); await page.locator('#understood').focus(); await publish(request);
  await page.keyboard.press('Tab'); const newer = await inspect(); await publish(restore);
  await page.waitForFunction(() => window.sent.some(message => message.type === 'presentation-pose-invalidated'));
  const retained = await inspect();
  await page.waitForTimeout(500);
  cases.push({ name: 'later keyboard input invalidates the old capture', newer, retained, passed: retained.focus === newer.focus && retained.scrollY === newer.scrollY && retained.restored === 0 && retained.invalidated >= 1 });
  await render(applying); await publish(request);
  await page.mouse.move(300, 550); await page.mouse.wheel(0, 300); await page.waitForFunction(() => window.scrollY > 0);
  // Wait for the wheel's native scroll to settle before comparing the later rejected restore.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const scrolled = await inspect(); await publish(restore); const scrollRetained = await inspect();
  await page.waitForTimeout(500);
  cases.push({ name: 'later wheel input preserves its new reading position', scrolled, scrollRetained, passed: scrollRetained.scrollY === scrolled.scrollY && scrollRetained.restored === 0 && scrollRetained.invalidated >= 1 });
  await render(living); await page.keyboard.press('Tab'); const freshInput = await inspect(); await publish(restore);
  await page.waitForFunction(() => window.sent.some(message => message.type === 'presentation-pose-invalidated'));
  const freshRetained = await inspect();
  await page.waitForTimeout(500);
  cases.push({ name: 'new renderer input wins over imported state', freshInput, freshRetained, passed: freshRetained.focus === freshInput.focus && freshRetained.scrollY === freshInput.scrollY && freshRetained.restored === 0 });
  await render(living);
  await page.evaluate(() => { window.queuedFrames = []; window.requestAnimationFrame = callback => { window.queuedFrames.push(callback); return window.queuedFrames.length; }; });
  await publish(restore); await page.keyboard.press('Tab'); const between = await inspect();
  await page.evaluate(() => { for (const callback of window.queuedFrames.splice(0)) callback(performance.now()); });
  const afterFrame = await inspect();
  await page.waitForTimeout(500);
  cases.push({ name: 'keyboard input before the queued restore frame keeps its new focus and scroll', between, afterFrame, passed: afterFrame.focus === between.focus && afterFrame.scrollY === between.scrollY && afterFrame.restored === 0 && afterFrame.invalidated >= 1 });
  await render({ ...living, revision: 2 }); await publish(restore);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  const stale = await inspect();
  await page.waitForTimeout(500);
  cases.push({ name: 'a different displayed model cannot acknowledge an old pose', stale, passed: stale.restored === 0 && stale.scrollY === 0 });
  await render({ ...living, model: { ...living.model, observation: { ...living.model.observation, id: 'browser-session:999' } } }); await publish(restore);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  const differentObservation = await inspect(); await page.waitForTimeout(500);
  cases.push({ name: 'another observation of the same source cannot inherit the old reading receipt', differentObservation, passed: differentObservation.restored === 0 && differentObservation.scrollY === 0 });
  return { captured, cases };
}

const report = { mode, qualification: 'Compiled product HTML and real Chromium input; simulated host transport, not native acceptance.',
  compiled, compiledSha256: createHash('sha256').update(await readFile(compiled)).digest('hex'), cases: [] };
// A loopback secure context supplies the real crypto API; never patch the product's focus identity generator.
const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Codebook reading pose control</title>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
let recording = false;
try {
  await command(['open', 'about:blank'], 'open');
  await command(['run-code', `async page => { await page.setViewportSize({ width: 390, height: 640 }); await page.screencast.start({ path: ${JSON.stringify(`${output}/flow.webm`)}, size: { width: 390, height: 640 } }); }`], 'video-start'); recording = true;
  const result = await command(['run-code', `async page => (${check.toString()})(page, ${JSON.stringify({ html, message, output, mode, url })})`], 'flow');
  Object.assign(report, JSON.parse(result.split('### Result\n')[1].split('\n###')[0]));
  await command(['run-code', 'async page => await page.screencast.stop()'], 'video-stop'); recording = false;
  if (mode === 'red') { assert.equal(report.captured?.pose, undefined); assert.equal(report.cases[0].passed, false); assert.notEqual(report.cases[0].after.focus, 'understood'); }
  else assert.equal(report.cases.every(entry => entry.passed), true, JSON.stringify(report.cases));
} finally {
  // Each owned resource must close even when saving evidence or stopping its recording fails.
  try { await writeFile(`${output}/result.json`, `${JSON.stringify(report, null, 2)}\n`); }
  finally {
    try { if (recording) await command(['run-code', 'async page => await page.screencast.stop()'], 'failure-video-stop'); }
    finally {
      try { await command(['close'], 'close'); }
      finally { await new Promise(resolve => server.close(resolve)); }
    }
  }
}
console.log(JSON.stringify(report.cases.map(entry => ({ name: entry.name, passed: entry.passed }))));
