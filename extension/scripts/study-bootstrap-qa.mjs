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
        passed: title === 'Theme' && !loaded.text.includes('Loading study…')
          && await page.locator('[data-action="continue"]').isDisabled() && loaded.writes === 0 });
      if (kind === 'context') {
        await page.getByRole('button', { name: 'Open current file', exact: true }).click();
        const action = await page.evaluate(() => window.sent.findLast(message => message.type === 'action'));
        cases.push({ name: `${phase} enables an explicit source action with the loaded revision`, actual: action,
          passed: action?.action === 'current-file' && action.revision === 1 });
        if (phase === 'initial') {
          // Arrange: reproduce a narrow Study column when a followed runtime pause arrives.
          await page.setViewportSize({ width: 260, height: 750 });
          const observed = { ...options.message, revision: 2, liveState: 'paused', liveTitle: 'Repository operation',
            model: { ...options.message.model, matching: true, selection: { ...options.message.model.selection, tab: 'live', follow: true },
              observation: { id: 'pause-1', capturedAt: '2026-09-26T05:07:15.000Z', values: { pending: true },
                interpretations: [{ text: 'The actual form submission is pending.' }] } } };
          // Act: a host loading update precedes the complete pause, as it does during a native run.
          await publish({ ...observed, loading: true });
          await page.waitForFunction(() => window.sent.some(message => message.type === 'rendered' && message.revision === 2));
          await publish({ ...observed, revision: 3 });
          await page.waitForFunction(() => window.sent.some(message => message.type === 'rendered' && message.revision === 3));
          const revealed = await page.evaluate(() => ({ scrollY: window.scrollY,
            interpretationTop: document.querySelector('#live-content h2').getBoundingClientRect().top,
            interpretationBottom: document.querySelector('#interpretations').getBoundingClientRect().bottom,
            duplicateValueTable: Boolean(document.querySelector('#values, #captured-values-heading')),
            retiredModeSelector: Boolean(document.querySelector('#presentation-mode')),
            viewportHeight: window.innerHeight }));
          await page.screenshot({ path: `${options.output}/narrow-followed-pause.png` });
          // Assert: interpretation is visible and native value inspection is not duplicated without moving the app or source panes.
          cases.push({ name: 'followed pause reveals interpretation without duplicate values or retired modes', actual: revealed,
            passed: revealed.scrollY > 0 && revealed.interpretationTop >= 0 && revealed.interpretationBottom <= revealed.viewportHeight
              && !revealed.duplicateValueTable && !revealed.retiredModeSelector });
          await page.evaluate(() => window.scrollTo(0, 0));
          await publish({ ...observed, revision: 4 });
          await page.waitForFunction(() => window.sent.some(message => message.type === 'rendered' && message.revision === 4));
          cases.push({ name: 'refresh of the same pause preserves the learner reading position',
            passed: await page.evaluate(() => window.scrollY === 0) });
          const longExplanation = { ...observed, revision: 5, model: { ...observed.model,
            observation: { ...observed.model.observation, id: 'pause-2', interpretations: [{ text: 'The operation result is recorded before completion. '.repeat(12) }] } } };
          // A new long explanation must remain keyboard-readable while preserving native debugger ownership of values.
          await publish(longExplanation);
          await page.waitForFunction(() => window.sent.some(message => message.type === 'rendered' && message.revision === 5));
          const longReading = await page.evaluate(() => ({ interpretationTop: document.querySelector('#live-content h2').getBoundingClientRect().top,
            interpretationHeight: document.querySelector('#interpretations').clientHeight,
            interpretationScrollHeight: document.querySelector('#interpretations').scrollHeight,
            duplicateValueTable: Boolean(document.querySelector('#values')), viewportHeight: window.innerHeight }));
          await page.screenshot({ path: `${options.output}/narrow-long-explanation.png` });
          cases.push({ name: 'Live keeps a long keyboard-readable explanation without a duplicate value surface', actual: longReading,
            passed: longReading.interpretationTop >= 0 && longReading.interpretationScrollHeight > longReading.interpretationHeight
              && !longReading.duplicateValueTable && await page.locator('#interpretations').getAttribute('tabindex') === '0' });
        }
      }
    }
    if (kind === 'context') {
      await publish({ ...options.message, model: { ...options.message.model, progressByItem: [] } });
      cases.push({ name: 'an absent selection never invents a checkout topic', passed: await page.locator('#title').textContent() === 'Codebook study' });
      // Arrange: a normal editor side pane receives recorded history, not an executable target.
      await page.setViewportSize({ width: 600, height: 800 });
      const replay = { ...options.message, revision: 6, contentTab: 'recording',
        moments: [4000, 1000, 9000].map((elapsedMs, index) => ({ id: `recorded-${index}`, itemId: options.message.model.selection.itemId, title: 'Recorded stop', elapsedMs, at: '2026-09-27T00:00:00.000Z' })),
        recording: { revision: 7, mode: 'paused', readiness: 'ready', presentedMs: 2000, range: { startMs: 0, endMs: 8000, endKnown: true }, recordingStatus: 'finalized',
          historyTimeline: { status: 'mapped', gaps: [{ startMs: 0, endMs: 1000 }, { startMs: 2000, endMs: 4000 }, { startMs: 5000, endMs: 8000 }], recordedPoints: [1000, 4000] } } };
      await publish(replay); await page.evaluate(() => window.scrollTo(0, 0));
      cases.push({ name: 'saved replay marks missing native-history spans and exact stops on the shared timeline',
        passed: await page.locator('#history-coverage .history-gap').count() === 3
          && await page.locator('#history-coverage .history-stop').count() === 2
          && (await page.locator('#history-coverage').getAttribute('aria-label')) === '3 source/debugger history gaps: 0.00 s–1.00 s, 2.00 s–4.00 s, 5.00 s–8.00 s; 2 recorded stops: 1.00 s, 4.00 s'
          && (await page.locator('#history-coverage-label').textContent()).includes('Striped: source/debugger not recorded')
          && (await page.locator('#recording-status').textContent()).includes('Not recorded at this moment') });
      await page.screenshot({ path: `${options.output}/history-coverage.png` });
      await publish({ ...replay, recording: { ...replay.recording, historyTimeline: { status: 'unknown' } } });
      cases.push({ name: 'an old replay without sealed history avoids invented coverage marks',
        passed: await page.locator('#history-coverage').isHidden() && (await page.locator('#history-coverage-label').textContent()) === 'Historical source/debugger coverage unknown' });
      await publish({ ...replay, playbackPanelVisible: true });
      cases.push({ name: 'visible bottom panel removes duplicate summary transport', passed: !(await page.locator('#recording-transport').isVisible()) });
      await publish({ ...replay, playbackPanelVisible: false });
      cases.push({ name: 'closing bottom panel restores summary playback controls', passed: await page.locator('#recording-transport').isVisible() });

      const help = page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).first();
      const beforeHelp = await page.evaluate(() => window.sent.length);
      await help.hover();
      cases.push({ name: 'shortcut tooltip exposes its binding on pointer hover', passed: await page.getByRole('tooltip').isVisible() });
      await help.focus();
      cases.push({ name: 'shortcut tooltip is visible on keyboard focus and names the question-mark binding',
        passed: await page.getByRole('tooltip').isVisible() && (await page.getByRole('tooltip').textContent()).includes('Keyboard shortcuts — ?') });
      await help.press('?');
      const shortcutSearch = page.getByRole('searchbox', { name: 'Search shortcuts' });
      cases.push({ name: 'question mark opens one searchable dialog and focuses its search',
        passed: await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).isVisible()
          && await shortcutSearch.evaluate(element => document.activeElement === element) });
      await page.getByRole('button', { name: 'Close keyboard shortcuts', exact: true }).press('?');
      cases.push({ name: 'repeated question mark preserves one dialog and its original return target', passed: await page.getByRole('dialog').count() === 1 });
      await shortcutSearch.focus();
      await shortcutSearch.press('?');
      cases.push({ name: 'question mark remains editable inside shortcut search without duplicating dialogs',
        passed: await shortcutSearch.inputValue() === '?' && await page.getByRole('dialog').count() === 1 });
      await shortcutSearch.fill('no-such-shortcut');
      cases.push({ name: 'unmatched shortcut search explains the empty result and offers clear',
        passed: await page.getByText('No shortcuts match.', { exact: true }).isVisible() && await page.getByRole('button', { name: 'Clear search', exact: true }).isVisible() });
      await shortcutSearch.press('Escape');
      cases.push({ name: 'one Escape closes shortcut help even while search contains text',
        passed: !(await page.getByRole('dialog').isVisible()) && await help.evaluate(element => document.activeElement === element) });
      await help.click(); await shortcutSearch.fill('no-such-shortcut');
      await page.getByRole('button', { name: 'Clear search', exact: true }).click();
      await page.screenshot({ path: `${options.output}/keyboard-shortcuts.png` });
      await shortcutSearch.press('Escape');
      cases.push({ name: 'Escape returns focus without changing playback or learner state',
        passed: !(await page.getByRole('dialog').isVisible()) && await help.evaluate(element => document.activeElement === element)
          && await page.evaluate(() => window.sent.length) === beforeHelp });
      await help.evaluate(element => {
        element.dispatchEvent(new KeyboardEvent('keydown', { key: '?', isComposing: true, bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keydown', { key: '?', ctrlKey: true, bubbles: true }));
      });
      cases.push({ name: 'IME and modified question-mark events never open shortcut help', passed: !(await page.getByRole('dialog').isVisible()) });
      await page.locator('#playhead').evaluate(element => {
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', isComposing: true, bubbles: true }));
      });
      cases.push({ name: 'modified and composing timeline keys do not seek the recording', passed: await page.evaluate(() => window.sent.length) === beforeHelp });
      await help.click(); await page.getByRole('button', { name: 'Close keyboard shortcuts', exact: true }).click();
      cases.push({ name: 'visible help and close controls preserve the same focus return', passed: await help.evaluate(element => document.activeElement === element) });
      await page.waitForFunction(() => document.getElementById('recording-transport').getBoundingClientRect().bottom === window.innerHeight);
      const composition = await page.evaluate(() => ({ heading: document.getElementById('reader-kind').textContent,
        titleTop: document.getElementById('title').getBoundingClientRect().top,
        footer: document.getElementById('recording-transport').getBoundingClientRect().toJSON(),
        paneControlsOpen: document.getElementById('reader-options').open }));
      cases.push({ name: 'replay opens with the learning heading and compact bottom transport', actual: composition,
        passed: composition.heading === 'Learning summary' && composition.titleTop < 100 && composition.footer.bottom === 800
          && composition.footer.height < 170 && !composition.paneControlsOpen });
      await page.screenshot({ path: `${options.output}/replay-bottom-transport.png` });
      // The summary lives in a sidebar; retired central-pane commands must not be offered even after a saved preference fails.
      await publish({ ...replay, presentation: { presentationId: '11111111-1111-4111-8111-111111111111', presentationControlRevision: 1,
        mode: 'study-workspace', state: 'open', layoutConfirmed: true, preference: { status: 'failed' }, panes: {} } });
      await page.locator('#reader-options > summary').click();
      await page.locator('#presentation-options > summary').click();
      cases.push({ name: 'replay sidebar offers summary focus without obsolete explanation enlargement or layout preference saving',
        passed: await page.getByRole('button', { name: 'Read learning summary', exact: true }).isVisible()
          && !await page.locator('[data-action="enlarge-context"]').isVisible()
          && !await page.locator('[data-presentation="save-preference"]').isVisible()
          && (await page.locator('#presentation-caption').textContent()).includes('summary stays in the sidebar') });
      await page.getByRole('button', { name: 'Read learning summary', exact: true }).click();
      cases.push({ name: 'reading the replay summary sends only its focus action without moving the playhead',
        passed: await page.evaluate(() => window.sent.at(-1)?.type === 'action' && window.sent.at(-1)?.action === 'read-context') });
      await page.locator('#reader-options > summary').click();
      // Act: previous and next use the confirmed playhead and real in-range stop times.
      await page.getByRole('button', { name: 'Previous recorded stop', exact: true }).click();
      await page.getByRole('button', { name: 'Next recorded stop', exact: true }).click();
      const steps = await page.evaluate(() => window.sent.filter(message => message.type === 'playback'));
      cases.push({ name: 'recorded step controls seek to actual earlier and later stops', actual: steps,
        passed: steps.length === 2 && steps[0].positionMs === 1000 && steps[1].positionMs === 4000
          && steps.every(value => value.action === 'seek' && value.expectedRevision === 7 && value.revision === 6) });
      await page.locator('#understood').focus();
      const reading = await page.evaluate(() => ({ bottom: document.getElementById('understood').getBoundingClientRect().bottom,
        footerTop: document.getElementById('recording-transport').getBoundingClientRect().top }));
      cases.push({ name: 'bottom transport does not cover the focused learning decision', actual: reading, passed: reading.bottom <= reading.footerTop });
      await publish({ ...replay, recording: { ...replay.recording, presentedMs: 4000 } });
      cases.push({ name: 'next stop is disabled when only out-of-range later observations exist', passed: await page.locator('#next-moment').isDisabled() });
      await publish({ ...replay, recording: { ...replay.recording, cleared: true, readiness: 'loading', requestedMs: 4000 } });
      cases.push({ name: 'pending synchronization keeps pause available and disables recorded stepping',
        passed: await page.locator('#previous-moment').isDisabled() && await page.locator('#next-moment').isDisabled()
          && await page.getByRole('button', { name: 'Pause playback', exact: true }).isEnabled()
          && (await page.locator('#playback-pending').textContent()).includes('Waiting for a matching presentation') });
      await publish({ ...replay, recording: { ...replay.recording, readiness: 'failed', reason: 'Recorded source unavailable' } });
      await page.locator('#playback-options > summary').click();
      cases.push({ name: 'failed replay retains reload and visible recovery guidance in the bottom strip',
        passed: await page.getByRole('button', { name: 'Reload saved recording', exact: true }).isVisible()
          && await page.locator('#playback-reason').isVisible() && await page.locator('#playback-toggle').isDisabled() });
      await page.screenshot({ path: `${options.output}/replay-recovery.png` });

      cases.push({ name: 'old recordings disclose missing learning material instead of inventing a summary',
        passed: await page.locator('#learning-unavailable').isVisible() && !await page.locator('#learning-material').isVisible() });
      const reference = { snapshotUri: 'codebook://recorded-stop', sourceHash: 'a'.repeat(64) };
      const learningSummary = { explanationId: '44444444-4444-4444-8444-444444444444', createdAt: '2026-09-27T00:00:00.000Z',
        content: { question: 'How is the operation handled?', title: 'Saved processing path', summary: 'A saved explanation <script>window.invented=true</script>',
          participants: [{ id: 'ui', label: 'Application' }, { id: 'handler', label: 'Source handler' }],
          steps: [{ id: '__proto__', from: 'ui', to: 'handler', label: 'Observed submission', explanation: 'The recorded source stop follows the user input.', evidence: 'observed', reference },
            { id: 'derive', from: 'handler', to: 'ui', label: 'Source relationship', explanation: 'Derived from captured source, not proof of execution.', evidence: 'source-derived', reference },
            { id: 'constructor', from: 'handler', to: 'handler', label: 'Unknown completion', explanation: '<img src=x onerror="window.invented=true">', evidence: 'unknown' }] },
        positions: [{ stepId: '__proto__', elapsedMs: 2000 }, { stepId: 'derive', elapsedMs: 2000 }] };
      const learning = { ...replay, revision: 8, recording: { ...replay.recording, learningSummary },
        model: { ...replay.model, observation: { ...replay.model.observation, snapshotUri: reference.snapshotUri } } };
      await publish(learning); await page.locator('#learning-material').scrollIntoViewIfNeeded();
      const diagram = await page.evaluate(() => ({ arrows: document.querySelectorAll('#learning-sequence svg path').length,
        steps: [...document.querySelectorAll('.sequence-steps strong')].map(value => value.textContent),
        unsafeElements: document.querySelectorAll('#learning-material script, #learning-material img').length,
        invented: window.invented === true, links: document.querySelectorAll('[data-summary-step]').length,
        summary: document.getElementById('learning-summary').textContent }));
      cases.push({ name: 'saved sequence renders evidence classifications and agent markup only as text', actual: diagram,
        passed: diagram.arrows === 3 && diagram.steps.join('|') === 'Observed submission · observed|Source relationship · source-derived|Unknown completion · unknown'
          && diagram.unsafeElements === 0 && !diagram.invented && diagram.links === 2 && diagram.summary.includes('<script>') });
      await page.screenshot({ path: `${options.output}/saved-learning-sequence.png` });
      const wideLearning = JSON.parse(JSON.stringify(learning));
      wideLearning.recording.learningSummary.content.participants = Array.from({ length: 8 }, (_, index) => ({ id: `actor-${index}`, label: `Participant ${index + 1}` }));
      wideLearning.recording.learningSummary.content.steps = [{ id: 'wide', from: 'actor-0', to: 'actor-7', label: 'Across the project', explanation: 'Source-derived relationship.', evidence: 'source-derived', reference }];
      wideLearning.recording.learningSummary.positions = [{ stepId: 'wide', elapsedMs: 2000 }];
      await publish(wideLearning);
      await page.locator('.sequence-diagram').scrollIntoViewIfNeeded();
      await page.locator('.sequence-diagram').focus();
      for (let index = 0; index < 40; index++) await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(400);
      const scrolledDiagram = await page.locator('.sequence-diagram').evaluate(element => ({
        focused: document.activeElement === element,
        left: element.scrollLeft, width: element.clientWidth, contentWidth: element.scrollWidth,
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }));
      cases.push({ name: 'wide saved sequence remains reachable by keyboard inside its own scroll area', actual: scrolledDiagram,
        passed: scrolledDiagram.focused && scrolledDiagram.left + scrolledDiagram.width >= scrolledDiagram.contentWidth - 1 && !scrolledDiagram.pageOverflow });
      await page.screenshot({ path: `${options.output}/wide-sequence-scrolled.png` });
      await publish(learning);

      const beforeLearningWrites = (await inspect()).writes;
      await page.locator('[data-summary-step="__proto__"]').click();
      const inspection = await page.evaluate(() => window.sent.filter(value => value.type === 'playback').at(-1));
      cases.push({ name: 'sequence inspection seeks its source-bound stop through the current replay revision', actual: inspection,
        passed: inspection.action === 'seek' && inspection.positionMs === 2000 && inspection.expectedRevision === 7 && inspection.revision === 8 });
      await page.locator('[data-summary-step="derive"]').focus();
      await publish({ ...learning, revision: 9, recording: { ...learning.recording, presentedMs: 6000 } });
      cases.push({ name: 'playhead updates preserve the full saved sequence and focused inspection control',
        passed: await page.evaluate(() => document.activeElement?.dataset.summaryStep === 'derive') && await page.locator('.sequence-steps li').count() === 3
          && (await inspect()).writes === beforeLearningWrites });
      await publish({ ...learning, revision: 10, recording: { ...learning.recording, readiness: 'loading', cleared: true } });
      cases.push({ name: 'pending replay synchronization disables summary navigation',
        passed: await page.locator('[data-summary-step="__proto__"]').isDisabled() && await page.locator('[data-summary-step="derive"]').isDisabled() });
      await publish({ ...replay, revision: 11 });
      cases.push({ name: 'switching to older history hides previous learning material',
        passed: !await page.locator('#learning-material').isVisible() && await page.locator('#learning-unavailable').isVisible() });


    } else {
      await page.setViewportSize({ width: 1200, height: 180 });
      await publish({ ...options.message, revision: 6, contentTab: 'recording', playbackPanelVisible: true, repositoryArticleAvailable: true,
        study: { terminal: true, studyOutcome: 'demonstrated', historyOutcome: 'saved', finalOutcome: 'demonstrated', recordingSave: { status: 'finalized', contextStatus: 'saved' } },
        recording: { revision: 7, mode: 'paused', readiness: 'ready', cleared: false, presentedMs: 2000,
          range: { startMs: 0, endMs: 5000, endKnown: true }, recordingStatus: 'finalized' } });
      cases.push({ name: 'bottom panel presents playback without duplicate learning or library sections',
        passed: await page.locator('#recording-transport').isVisible() && !(await page.locator('.learning-header').isVisible())
          && !(await page.locator('#observed-moments').isVisible()) && !(await page.locator('[data-action="open-article"]').isVisible())
          && !(await page.locator('#recording-save-state').isVisible()) && !(await page.locator('#evidence-details').isVisible())
          && await page.locator('#playback-toggle').isEnabled() });
      const compactPanel = await page.evaluate(() => ({
        transportTop: document.getElementById('recording-transport').getBoundingClientRect().top,
        playTop: document.getElementById('playback-toggle').getBoundingClientRect().top,
        viewportHeight: window.innerHeight,
      }));
      cases.push({ name: 'short bottom panel keeps replay controls at its visible top edge', actual: compactPanel,
        passed: compactPanel.transportTop <= 16 && compactPanel.playTop < compactPanel.viewportHeight });
      await page.locator('#playback-toggle').click();
      const play = await page.evaluate(() => window.sent.filter(value => value.type === 'playback').at(-1));
      cases.push({ name: 'bottom panel uses the current recording revision for playback',
        passed: play.action === 'play' && play.revision === 6 && play.expectedRevision === 7 });
      await publish({ ...options.message, revision: 7, contentTab: 'recording', playbackPanelVisible: true,
        errors: ['The editor did not retain the requested Codebook layout. '.repeat(12)],
        recording: { revision: 7, mode: 'paused', readiness: 'ready', cleared: false, presentedMs: 2000,
          range: { startMs: 0, endMs: 5000, endKnown: true }, recordingStatus: 'finalized' } });
      const errorPanel = await page.evaluate(() => ({
        transportTop: document.getElementById('recording-transport').getBoundingClientRect().top,
        errorTop: document.getElementById('errors').getBoundingClientRect().top,
      }));
      cases.push({ name: 'layout errors stay below the replay controls in a short panel', actual: errorPanel,
        passed: errorPanel.transportTop <= 16 && errorPanel.errorTop > errorPanel.transportTop });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const scrolledPanel = await page.evaluate(() => ({
        transportTop: document.getElementById('recording-transport').getBoundingClientRect().top,
        scrollY: window.scrollY,
      }));
      cases.push({ name: 'short panel keeps playback accessible after its error area scrolls', actual: scrolledPanel,
        passed: scrolledPanel.scrollY > 0 && scrolledPanel.transportTop <= 16 });
      await page.screenshot({ path: `${options.output}/bottom-playback-panel.png` });
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
