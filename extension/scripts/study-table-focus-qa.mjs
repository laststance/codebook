import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { studyHtml } from '../dist/ui/studyHtml.js';
import { createConfiguredStudy } from '../dist/tests/utils/createConfiguredStudy.js';
import { decodeLearnerProgress } from '../dist/utils/decodeLearnerProgress.js';
import { selectStudy } from '../dist/utils/selectStudy.js';
import { projectStudy } from '../dist/studyModel.js';

// Compiled product HTML and real keyboard/default scrolling; the host snapshot bridge is simulated.
const [mode = 'verify', outputPath = 'artifacts/cycle-0011/study-table-focus-qa'] = process.argv.slice(2);
assert.ok(['red', 'verify'].includes(mode));
const output = resolve(outputPath), session = `cb-table-focus-${mode}`;
await mkdir(output, { recursive: true });
const study = createConfiguredStudy();
study.observations[0].values = {
  'value:otherTheme': 'dark', 'type:setTheme': 'function',
  'value:document.activeElement.className': 'group min-h-11 min-w-11 rounded-full bg-white/90 px-3 py-2 shadow-lg shadow-zinc-800/5 ring-1 ring-zinc-900/5 backdrop-blur-sm transition dark:bg-zinc-800/90 dark:ring-white/10 dark:hover:ring-white/20',
};
const baseline = { text: '', hash: '0'.repeat(64), line: 1, path: '/fixture/unused.mts' };
const message = { type: 'study', revision: 1, model: projectStudy({ study,
  selection: { ...selectStudy(study), tab: 'live' }, progress: decodeLearnerProgress({ version: 4, workspaceKey: study.workspaceKey, decisions: [] }, study.workspaceKey),
  baselines: { server: baseline, browser: baseline },
  citationSources: study.descriptor.sources.map(source => ({ ...source, currentHash: source.hash, status: 'current' })) }),
  busy: false, saving: false, loading: false, errors: [], canClick: false, canRun: false, profiles: [], moments: [], studies: [] };

/** Runs a CLI operation without blocking the browser transport and preserves its diagnostics. @example await command(['open', 'about:blank'], 'open') */
async function command(arguments_, label) {
  const result = await promisify(execFile)('playwright-cli', [`-s=${session}`, ...arguments_], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  await writeFile(`${output}/${label}.log`, result.stdout + result.stderr);
  assert.equal(result.stdout.includes('### Error'), false, result.stdout);
  return result.stdout;
}

/** Checks natural Tab entry and later pointer reading against the visible column heading. @example await check(page, { html, message, height: 542, output }) */
async function check(page, options) {
  await page.goto('about:blank');
  await page.setViewportSize({ width: 330, height: options.height });
  await page.evaluate(() => { window.acquireVsCodeApi = () => ({ getState: () => undefined, setState() {}, postMessage() {} }); });
  await page.setContent(options.html);
  await page.evaluate(message => window.dispatchEvent(new MessageEvent('message', { data: message })), options.message);
  await page.waitForTimeout(150);
  // Arrange / Act: let Chromium perform its real automatic focus scrolling for the overflowing table.
  await page.getByRole('tab', { name: 'Live', exact: true }).focus();
  await page.keyboard.press('Tab'); await page.waitForTimeout(150);
  const measure = () => page.evaluate(() => {
    const table = document.querySelector('.table-scroll'), header = table.querySelector('thead'), strip = document.querySelector('.live-strip');
    const bounds = header.getBoundingClientRect(), hit = document.elementFromPoint(Math.min(innerWidth - 8, bounds.x + bounds.width / 2), bounds.y + bounds.height / 2);
    return { focused: document.activeElement === table, visible: Boolean(hit && header.contains(hit)),
      top: bounds.top, stripBottom: strip.getBoundingClientRect().bottom, stripPosition: getComputedStyle(strip).position,
      scrollY, tableHeight: table.getBoundingClientRect().height, viewportHeight: innerHeight };
  });
  const keyboard = await measure();
  await page.screenshot({ path: `${options.output}/height-${options.height}-keyboard.png` });
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
  const horizontal = await page.locator('.table-scroll').evaluate(element => element.scrollLeft);
  await page.keyboard.press('Tab');
  const next = await page.evaluate(() => document.activeElement.textContent);
  // Pointer reading in the middle of a long value must not jump back to the heading.
  await page.getByRole('cell', { name: 'function', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('cell', { name: 'function', exact: true }).hover(); await page.mouse.wheel(0, 150); await page.waitForTimeout(150);
  const beforePointer = await page.evaluate(() => scrollY);
  await page.mouse.click(260, options.height - 40); await page.waitForTimeout(150);
  const afterPointer = await page.evaluate(() => scrollY);
  await page.screenshot({ path: `${options.output}/height-${options.height}-pointer.png` });
  return { keyboard, horizontal, next, beforePointer, afterPointer };
}

const report = { mode, qualification: 'Real Chromium and compiled HTML; simulated host snapshots, separate from native acceptance.', cases: [] };
try {
  await command(['open', 'about:blank'], 'open'); await command(['video-start', `${output}/flow.webm`], 'video-start');
  for (const height of [542, 320]) {
    const result = await command(['run-code', `async page => (${check.toString()})(page, ${JSON.stringify({ html: studyHtml('context'), message, height, output })})`], `height-${height}`);
    report.cases.push({ height, ...JSON.parse(result.split('### Result\n')[1].split('\n###')[0]) });
  }
  await command(['video-stop'], 'video-stop');
  for (const entry of report.cases) {
    assert.equal(entry.keyboard.focused, true, JSON.stringify(entry));
    assert.equal(entry.keyboard.visible, mode !== 'red', JSON.stringify(entry));
    assert.ok(entry.horizontal > 0, JSON.stringify(entry));
    assert.equal(entry.next, 'Captured / source-derived document', JSON.stringify(entry));
    assert.equal(entry.afterPointer, entry.beforePointer, JSON.stringify(entry));
  }
} finally {
  await writeFile(`${output}/result.json`, `${JSON.stringify(report, null, 2)}\n`);
  await command(['close'], 'close');
}
console.log(JSON.stringify(report.cases));
