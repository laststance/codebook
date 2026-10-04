import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

import { projectStudy } from '../dist/studyModel.js'
import { createConfiguredStudy } from '../dist/tests/utils/createConfiguredStudy.js'
import { studyHtml } from '../dist/ui/studyHtml.js'
import { decodeLearnerProgress } from '../dist/utils/decodeLearnerProgress.js'
import { selectStudy } from '../dist/utils/selectStudy.js'

const [
  mode = 'verify',
  outputPath = 'artifacts/cycle-0018/bootstrap-renderer',
] = process.argv.slice(2)
assert.ok(['red', 'verify'].includes(mode))
const output = resolve(outputPath),
  session = `cb-bootstrap-${mode}`
await mkdir(output, { recursive: true })
const study = createConfiguredStudy(),
  baseline = {
    text: '',
    hash: '0'.repeat(64),
    line: 1,
    path: '/fixture/unused.mts',
  }
const message = {
  type: 'study',
  revision: 1,
  model: projectStudy({
    study,
    selection: { ...selectStudy(study), tab: 'live' },
    progress: decodeLearnerProgress(
      { version: 4, workspaceKey: study.workspaceKey, decisions: [] },
      study.workspaceKey,
    ),
    baselines: { server: baseline, browser: baseline },
    citationSources: study.descriptor.sources.map((source) => ({
      ...source,
      currentHash: source.hash,
      status: 'current',
    })),
  }),
  busy: false,
  saving: false,
  loading: false,
  errors: [],
  canClick: false,
  canRun: false,
  profiles: [],
  moments: [],
  studies: [],
}

/** Records each owned CLI operation for delayed-snapshot renderer verification. @example await command(['open', 'about:blank'], 'open') */
async function command(arguments_, label) {
  const result = await new Promise((resolve) =>
    execFile(
      'playwright-cli',
      [`-s=${session}`, ...arguments_],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ error, stdout, stderr }),
    ),
  )
  await writeFile(
    `${output}/${label}.log`,
    result.stdout +
      result.stderr +
      (result.error ? `\n${String(result.error)}\n` : ''),
  )
  assert.equal(result.error, null, String(result.error))
  assert.equal(result.stdout.includes('### Error'), false, result.stdout)
  return result.stdout
}

/** Exercises initial paint and replacement without host state, then releases an actual typed product model. @example await check(page, options) */
async function check(page, options) {
  /** Derives a Study message's revision from the first message's by its distance in the flow, so no case carries a bare revision number of its own. @example revisionAt(1) // the second message's revision */
  const revisionAt = (step) => options.message.revision + step
  /** Waits until the pane reports that it rendered the Study message of this revision. The number enters the page as an argument, because a callback evaluated in the page cannot call {@link revisionAt}. @example await waitUntilRendered(revisionAt(2)) */
  const waitUntilRendered = (revision) =>
    page.waitForFunction(
      (awaitedRevision) =>
        window.sent.some(
          (message) =>
            message.type === 'rendered' && message.revision === awaitedRevision,
        ),
      revision,
    )
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.setDefaultTimeout(5_000)
  const cases = [],
    publish = (message) =>
      page.evaluate(
        (message) =>
          window.dispatchEvent(new MessageEvent('message', { data: message })),
        message,
      )
  const inspect = () =>
    page.evaluate(() => ({
      text: document.body.innerText,
      actionable: [
        ...document.querySelectorAll('button,input,select,summary'),
      ].filter(
        (control) =>
          control.getClientRects().length &&
          !control.closest('[inert]') &&
          !control.disabled,
      ).length,
      writes: (window.sent ?? []).filter((message) =>
        ['action', 'understanding', 'profile', 'history'].includes(
          message.type,
        ),
      ).length,
    }))
  for (const kind of ['context', 'moments']) {
    // Arrange: first paint must be safe even before the inline renderer starts.
    await page.goto(options.url)
    await page.setContent(
      options.html[kind].replace(/<script nonce="[^"]+">[\s\S]*<\/script>/, ''),
    )
    const firstPaint = await inspect()
    await page.waitForTimeout(350)
    cases.push({
      name: `${kind} first paint exposes only neutral loading guidance`,
      actual: firstPaint,
      passed:
        firstPaint.text.trim() === 'Loading study…' &&
        firstPaint.actionable === 0,
    })
    for (const phase of ['initial', 'replacement']) {
      // Act: a real fresh document reports ready while the simulated host deliberately withholds state.
      await page.goto(options.url)
      await page.evaluate(() => {
        window.sent = []
        window.acquireVsCodeApi = () => ({
          getState: () => undefined,
          setState() {},
          postMessage: (message) => window.sent.push(message),
        })
      })
      await page.setContent(options.html[kind])
      await page.waitForFunction(() =>
        window.sent.some((message) => message.type === 'ready'),
      )
      await page.keyboard.press('Tab')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(500)
      const waiting = await inspect()
      await page.screenshot({
        path: `${options.output}/${kind}-${phase}-waiting.png`,
      })
      cases.push({
        name: `${kind} ${phase} awaits host state without actions or fabricated content`,
        actual: waiting,
        passed:
          waiting.text.trim() === 'Loading study…' &&
          waiting.actionable === 0 &&
          waiting.writes === 0,
      })
      await publish(options.message)
      await page.waitForFunction(() =>
        window.sent.some((message) => message.type === 'rendered'),
      )
      const loaded = await inspect(),
        title = await page.locator('#title').textContent()
      await page.screenshot({
        path: `${options.output}/${kind}-${phase}-loaded.png`,
      })
      await page.waitForTimeout(350)
      // Assert: normal content appears after a complete render; viewing never marks understanding.
      cases.push({
        name: `${kind} ${phase} renders the actual article and safe stopped controls`,
        actual: { ...loaded, title },
        passed:
          title === 'Theme' &&
          !loaded.text.includes('Loading study…') &&
          (await page.locator('[data-action="continue"]').isDisabled()) &&
          loaded.writes === 0,
      })
      if (kind === 'context') {
        await page
          .getByRole('button', { name: 'Open current file', exact: true })
          .click()
        const action = await page.evaluate(() =>
          window.sent.findLast((message) => message.type === 'action'),
        )
        cases.push({
          name: `${phase} enables an explicit source action with the loaded revision`,
          actual: action,
          passed:
            action?.action === 'current-file' &&
            action.revision === revisionAt(0),
        })
        if (phase === 'initial') {
          // Arrange: reproduce a narrow Study column when a followed runtime pause arrives.
          await page.setViewportSize({ width: 260, height: 750 })
          const observed = {
            ...options.message,
            revision: revisionAt(1),
            liveState: 'paused',
            liveTitle: 'Repository operation',
            model: {
              ...options.message.model,
              matching: true,
              selection: {
                ...options.message.model.selection,
                tab: 'live',
                follow: true,
              },
              observation: {
                id: 'pause-1',
                capturedAt: '2026-09-26T05:07:15.000Z',
                values: { pending: true },
                interpretations: [
                  { text: 'The actual form submission is pending.' },
                ],
              },
            },
          }
          // Act: a host loading update precedes the complete pause, as it does during a native run.
          await publish({ ...observed, loading: true })
          await waitUntilRendered(revisionAt(1))
          await publish({ ...observed, revision: revisionAt(2) })
          await waitUntilRendered(revisionAt(2))
          const revealed = await page.evaluate(() => ({
            scrollY: window.scrollY,
            interpretationTop: document
              .querySelector('#live-content h2')
              .getBoundingClientRect().top,
            interpretationBottom: document
              .querySelector('#interpretations')
              .getBoundingClientRect().bottom,
            duplicateValueTable: Boolean(
              document.querySelector('#values, #captured-values-heading'),
            ),
            retiredModeSelector: Boolean(
              document.querySelector('#presentation-mode'),
            ),
            viewportHeight: window.innerHeight,
          }))
          await page.screenshot({
            path: `${options.output}/narrow-followed-pause.png`,
          })
          // Assert: interpretation is visible and native value inspection is not duplicated without moving the app or source panes.
          cases.push({
            name: 'followed pause reveals interpretation without duplicate values or retired modes',
            actual: revealed,
            passed:
              revealed.scrollY > 0 &&
              revealed.interpretationTop >= 0 &&
              revealed.interpretationBottom <= revealed.viewportHeight &&
              !revealed.duplicateValueTable &&
              !revealed.retiredModeSelector,
          })
          await page.evaluate(() => window.scrollTo(0, 0))
          await publish({ ...observed, revision: revisionAt(3) })
          await waitUntilRendered(revisionAt(3))
          cases.push({
            name: 'refresh of the same pause preserves the learner reading position',
            passed: await page.evaluate(() => window.scrollY === 0),
          })
          const longExplanation = {
            ...observed,
            revision: revisionAt(4),
            model: {
              ...observed.model,
              observation: {
                ...observed.model.observation,
                id: 'pause-2',
                interpretations: [
                  {
                    text: 'The operation result is recorded before completion. '.repeat(
                      12,
                    ),
                  },
                ],
              },
            },
          }
          // A new long explanation must remain keyboard-readable while preserving native debugger ownership of values.
          await publish(longExplanation)
          await waitUntilRendered(revisionAt(4))
          const longReading = await page.evaluate(() => ({
            interpretationTop: document
              .querySelector('#live-content h2')
              .getBoundingClientRect().top,
            interpretationHeight:
              document.querySelector('#interpretations').clientHeight,
            interpretationScrollHeight:
              document.querySelector('#interpretations').scrollHeight,
            duplicateValueTable: Boolean(document.querySelector('#values')),
            viewportHeight: window.innerHeight,
          }))
          await page.screenshot({
            path: `${options.output}/narrow-long-explanation.png`,
          })
          cases.push({
            name: 'Live keeps a long keyboard-readable explanation without a duplicate value surface',
            actual: longReading,
            passed:
              longReading.interpretationTop >= 0 &&
              longReading.interpretationScrollHeight >
                longReading.interpretationHeight &&
              !longReading.duplicateValueTable &&
              (await page
                .locator('#interpretations')
                .getAttribute('tabindex')) === '0',
          })
        }
      }
    }
    if (kind === 'context') {
      await publish({
        ...options.message,
        model: { ...options.message.model, progressByItem: [] },
      })
      cases.push({
        name: 'an absent selection never invents a checkout topic',
        passed:
          (await page.locator('#title').textContent()) === 'Codebook study',
      })
      // Arrange: a normal editor side pane receives recorded history, not an executable target.
      await page.setViewportSize({ width: 600, height: 800 })
      const replay = {
        ...options.message,
        revision: revisionAt(5),
        contentTab: 'recording',
        moments: [4000, 1000, 9000].map((elapsedMs, index) => ({
          id: `recorded-${index}`,
          itemId: options.message.model.selection.itemId,
          title: 'Recorded stop',
          elapsedMs,
          at: '2026-09-27T00:00:00.000Z',
        })),
        recording: {
          revision: revisionAt(6),
          mode: 'paused',
          readiness: 'ready',
          presentedMs: 2000,
          range: { startMs: 0, endMs: 8000, endKnown: true },
          recordingStatus: 'finalized',
          historyTimeline: {
            status: 'mapped',
            gaps: [
              { startMs: 0, endMs: 1000 },
              { startMs: 2000, endMs: 4000 },
              { startMs: 5000, endMs: 8000 },
            ],
            recordedPoints: [1000, 4000],
          },
        },
      }
      await publish(replay)
      await page.evaluate(() => window.scrollTo(0, 0))
      cases.push({
        name: 'saved replay marks missing native-history spans and exact stops on the shared timeline',
        passed:
          (await page.locator('#history-coverage .history-gap').count()) ===
            3 &&
          (await page.locator('#history-coverage .history-stop').count()) ===
            2 &&
          (await page
            .locator('#history-coverage')
            .getAttribute('aria-label')) ===
            '3 source/debugger history gaps: 0.00 s–1.00 s, 2.00 s–4.00 s, 5.00 s–8.00 s; 2 recorded stops: 1.00 s, 4.00 s' &&
          (
            await page.locator('#history-coverage-label').textContent()
          ).includes('Striped: source/debugger not recorded') &&
          (await page.locator('#recording-status').textContent()).includes(
            'Not recorded at this moment',
          ),
      })
      await page.screenshot({ path: `${options.output}/history-coverage.png` })
      await publish({
        ...replay,
        recording: {
          ...replay.recording,
          historyTimeline: { status: 'unknown' },
        },
      })
      cases.push({
        name: 'an old replay without sealed history avoids invented coverage marks',
        passed:
          (await page.locator('#history-coverage').isHidden()) &&
          (await page.locator('#history-coverage-label').textContent()) ===
            'Historical source/debugger coverage unknown',
      })
      await publish({ ...replay, playbackPanelVisible: true })
      cases.push({
        name: 'visible bottom panel removes duplicate summary transport',
        passed: !(await page.locator('#recording-transport').isVisible()),
      })
      await publish({ ...replay, playbackPanelVisible: false })
      cases.push({
        name: 'closing bottom panel restores summary playback controls',
        passed: await page.locator('#recording-transport').isVisible(),
      })

      const help = page
        .getByRole('button', { name: 'Keyboard shortcuts', exact: true })
        .first()
      const beforeHelp = await page.evaluate(() => window.sent.length)
      await help.hover()
      cases.push({
        name: 'shortcut tooltip exposes its binding on pointer hover',
        passed: await page.getByRole('tooltip').isVisible(),
      })
      await help.focus()
      cases.push({
        name: 'shortcut tooltip is visible on keyboard focus and names the question-mark binding',
        passed:
          (await page.getByRole('tooltip').isVisible()) &&
          (await page.getByRole('tooltip').textContent()).includes(
            'Keyboard shortcuts — ?',
          ),
      })
      await help.press('?')
      const shortcutSearch = page.getByRole('searchbox', {
        name: 'Search shortcuts',
      })
      cases.push({
        name: 'question mark opens one searchable dialog and focuses its search',
        passed:
          (await page
            .getByRole('dialog', { name: 'Keyboard shortcuts' })
            .isVisible()) &&
          (await shortcutSearch.evaluate(
            (element) => document.activeElement === element,
          )),
      })
      await page
        .getByRole('button', { name: 'Close keyboard shortcuts', exact: true })
        .press('?')
      cases.push({
        name: 'repeated question mark preserves one dialog and its original return target',
        passed: (await page.getByRole('dialog').count()) === 1,
      })
      await shortcutSearch.focus()
      await shortcutSearch.press('?')
      cases.push({
        name: 'question mark remains editable inside shortcut search without duplicating dialogs',
        passed:
          (await shortcutSearch.inputValue()) === '?' &&
          (await page.getByRole('dialog').count()) === 1,
      })
      await shortcutSearch.fill('no-such-shortcut')
      cases.push({
        name: 'unmatched shortcut search explains the empty result and offers clear',
        passed:
          (await page
            .getByText('No shortcuts match.', { exact: true })
            .isVisible()) &&
          (await page
            .getByRole('button', { name: 'Clear search', exact: true })
            .isVisible()),
      })
      await shortcutSearch.press('Escape')
      cases.push({
        name: 'one Escape closes shortcut help even while search contains text',
        passed:
          !(await page.getByRole('dialog').isVisible()) &&
          (await help.evaluate(
            (element) => document.activeElement === element,
          )),
      })
      await help.click()
      await shortcutSearch.fill('no-such-shortcut')
      await page
        .getByRole('button', { name: 'Clear search', exact: true })
        .click()
      await page.screenshot({
        path: `${options.output}/keyboard-shortcuts.png`,
      })
      await shortcutSearch.press('Escape')
      cases.push({
        name: 'Escape returns focus without changing playback or learner state',
        passed:
          !(await page.getByRole('dialog').isVisible()) &&
          (await help.evaluate(
            (element) => document.activeElement === element,
          )) &&
          (await page.evaluate(() => window.sent.length)) === beforeHelp,
      })
      await help.evaluate((element) => {
        element.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: '?',
            isComposing: true,
            bubbles: true,
          }),
        )
        element.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: '?',
            ctrlKey: true,
            bubbles: true,
          }),
        )
      })
      cases.push({
        name: 'IME and modified question-mark events never open shortcut help',
        passed: !(await page.getByRole('dialog').isVisible()),
      })
      await page.locator('#playhead').evaluate((element) => {
        element.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            ctrlKey: true,
            bubbles: true,
          }),
        )
        element.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Home',
            isComposing: true,
            bubbles: true,
          }),
        )
      })
      cases.push({
        name: 'modified and composing timeline keys do not seek the recording',
        passed: (await page.evaluate(() => window.sent.length)) === beforeHelp,
      })
      await help.click()
      await page
        .getByRole('button', { name: 'Close keyboard shortcuts', exact: true })
        .click()
      cases.push({
        name: 'visible help and close controls preserve the same focus return',
        passed: await help.evaluate(
          (element) => document.activeElement === element,
        ),
      })
      await page.waitForFunction(
        () =>
          document.getElementById('recording-transport').getBoundingClientRect()
            .bottom === window.innerHeight,
      )
      const composition = await page.evaluate(() => ({
        heading: document.getElementById('reader-kind').textContent,
        titleTop: document.getElementById('title').getBoundingClientRect().top,
        footer: document
          .getElementById('recording-transport')
          .getBoundingClientRect()
          .toJSON(),
        paneControlsOpen: document.getElementById('reader-options').open,
      }))
      cases.push({
        name: 'replay opens with the learning heading and compact bottom transport',
        actual: composition,
        passed:
          composition.heading === 'Learning summary' &&
          composition.titleTop < 100 &&
          composition.footer.bottom === 800 &&
          composition.footer.height < 170 &&
          !composition.paneControlsOpen,
      })
      await page.screenshot({
        path: `${options.output}/replay-bottom-transport.png`,
      })
      // The summary lives in a sidebar; retired central-pane commands must not be offered even after a saved preference fails.
      await publish({
        ...replay,
        presentation: {
          presentationId: '11111111-1111-4111-8111-111111111111',
          presentationControlRevision: 1,
          mode: 'study-workspace',
          state: 'open',
          layoutConfirmed: true,
          preference: { status: 'failed' },
          panes: {},
        },
      })
      await page.locator('#reader-options > summary').click()
      await page.locator('#presentation-options > summary').click()
      cases.push({
        name: 'replay sidebar offers summary focus without obsolete explanation enlargement or layout preference saving',
        passed:
          (await page
            .getByRole('button', { name: 'Read learning summary', exact: true })
            .isVisible()) &&
          !(await page
            .locator('[data-action="enlarge-context"]')
            .isVisible()) &&
          !(await page
            .locator('[data-presentation="save-preference"]')
            .isVisible()) &&
          (await page.locator('#presentation-caption').textContent()).includes(
            'summary stays in the sidebar',
          ),
      })
      await page
        .getByRole('button', { name: 'Read learning summary', exact: true })
        .click()
      cases.push({
        name: 'reading the replay summary sends only its focus action without moving the playhead',
        passed: await page.evaluate(
          () =>
            window.sent.at(-1)?.type === 'action' &&
            window.sent.at(-1)?.action === 'read-context',
        ),
      })
      await page.locator('#reader-options > summary').click()
      // Act: previous and next use the confirmed playhead and real in-range stop times.
      await page
        .getByRole('button', { name: 'Previous recorded stop', exact: true })
        .click()
      await page
        .getByRole('button', { name: 'Next recorded stop', exact: true })
        .click()
      const steps = await page.evaluate(() =>
        window.sent.filter((message) => message.type === 'playback'),
      )
      cases.push({
        name: 'recorded step controls seek to actual earlier and later stops',
        actual: steps,
        passed:
          steps.length === 2 &&
          steps[0].positionMs === 1000 &&
          steps[1].positionMs === 4000 &&
          steps.every(
            (value) =>
              value.action === 'seek' &&
              value.expectedRevision === revisionAt(6) &&
              value.revision === revisionAt(5),
          ),
      })
      await page.locator('#understood').focus()
      const reading = await page.evaluate(() => ({
        bottom: document.getElementById('understood').getBoundingClientRect()
          .bottom,
        footerTop: document
          .getElementById('recording-transport')
          .getBoundingClientRect().top,
      }))
      cases.push({
        name: 'bottom transport does not cover the focused learning decision',
        actual: reading,
        passed: reading.bottom <= reading.footerTop,
      })
      await publish({
        ...replay,
        recording: { ...replay.recording, presentedMs: 4000 },
      })
      cases.push({
        name: 'next stop is disabled when only out-of-range later observations exist',
        passed: await page.locator('#next-moment').isDisabled(),
      })
      await publish({
        ...replay,
        recording: {
          ...replay.recording,
          cleared: true,
          readiness: 'loading',
          requestedMs: 4000,
        },
      })
      cases.push({
        name: 'pending synchronization keeps pause available and disables recorded stepping',
        passed:
          (await page.locator('#previous-moment').isDisabled()) &&
          (await page.locator('#next-moment').isDisabled()) &&
          (await page
            .getByRole('button', { name: 'Pause playback', exact: true })
            .isEnabled()) &&
          (await page.locator('#playback-pending').textContent()).includes(
            'Waiting for a matching presentation',
          ),
      })
      await publish({
        ...replay,
        recording: { ...replay.recording, nativeValuesUninspected: true },
      })
      cases.push({
        name: 'a moment committed without native values names where Run and Debug loads them in a polite status',
        passed:
          (await page.locator('#playback-hint').isVisible()) &&
          (await page.locator('#playback-hint').getAttribute('role')) ===
            'status' &&
          (await page.locator('#playback-hint').textContent()).includes(
            'expand Variables, then expand its first scope if it stays closed',
          ) &&
          (await page.locator('#playback-hint').textContent()).includes(
            'Codebook · Recorded learning',
          ),
      })
      await page.screenshot({
        path: `${options.output}/replay-native-values-hint.png`,
      })
      // Act: the learner presses the control that comes with the hint (Cycle 0044, 0031-U1).
      const showVariables = page.getByRole('button', {
        name: 'Show Variables',
        exact: true,
      })
      const showVariablesOffered = await showVariables.isVisible()
      await showVariables.click()
      const showVariablesRequests = await page.evaluate(
        () =>
          window.sent.filter(
            (message) =>
              message.type === 'action' && message.action === 'show-variables',
          ).length,
      )
      await publish({
        ...replay,
        recording: { ...replay.recording, nativeValuesUninspected: false },
      })
      cases.push({
        name: 'the Run and Debug hint offers Show Variables, which asks the editor once to open and expand native Variables',
        actual: { showVariablesOffered, showVariablesRequests },
        passed: showVariablesOffered && showVariablesRequests === 1,
      })
      cases.push({
        name: 'the Run and Debug hint leaves once native values load',
        passed:
          (await page.locator('#playback-hint').isHidden()) &&
          (await showVariables.isHidden()),
      })
      await publish({
        ...replay,
        recording: {
          ...replay.recording,
          readiness: 'failed',
          reason: 'Recorded source unavailable',
          nativeValuesUninspected: true,
        },
      })
      cases.push({
        name: 'a failed replay shows its recovery reason instead of the Run and Debug hint',
        passed:
          (await page.locator('#playback-hint').isHidden()) &&
          (await page.locator('#playback-reason').isVisible()),
      })
      const nodeStop = {
        sequence: 2,
        type: 'stop',
        index: 0,
        eventIndex: 1,
        elapsedMs: 1200,
        sourceAvailable: true,
        debuggerAvailable: true,
      }
      await publish({
        ...replay,
        nodeHistoryPosition: { ...nodeStop, nativeValuesUninspected: true },
      })
      const nodeWithoutValues = {
        position: await page.locator('#node-history-position').textContent(),
        hint: await page.locator('#node-history-hint').textContent(),
        role: await page.locator('#node-history-hint').getAttribute('role'),
        muted: await page
          .locator('#node-history-hint')
          .evaluate((element) => element.classList.contains('muted')),
      }
      await publish({
        ...replay,
        nodeHistoryPosition: { ...nodeStop, nativeValuesUninspected: false },
      })
      const nodeWithValues = {
        position: await page.locator('#node-history-position').textContent(),
        hint: await page.locator('#node-history-hint').textContent(),
      }
      cases.push({
        name: 'a saved Node stop without native values shows the Run and Debug hint in its own muted status until values load',
        actual: { nodeWithoutValues, nodeWithValues },
        passed:
          nodeWithoutValues.position ===
            'Debugger stop 1 · 1.20 s · output shown through this event.' &&
          nodeWithoutValues.hint.startsWith(
            'Recorded values for this moment load in Run and Debug',
          ) &&
          nodeWithoutValues.role === 'status' &&
          nodeWithoutValues.muted &&
          nodeWithValues.position ===
            'Debugger stop 1 · 1.20 s · output shown through this event.' &&
          nodeWithValues.hint === '',
      })
      await publish({
        ...replay,
        nodeHistoryPosition: { ...nodeStop, debuggerAvailable: false },
      })
      const nodeSessionEnded = await page
        .locator('#node-history-position')
        .textContent()
      await publish({
        ...replay,
        nodeHistoryPosition: {
          ...nodeStop,
          sourceAvailable: false,
          debuggerAvailable: false,
        },
      })
      const nodeSourceMismatch = await page
        .locator('#node-history-position')
        .textContent()
      cases.push({
        name: 'a saved Node stop whose native session ended keeps its source label, and only a real source mismatch says captured source unavailable',
        actual: { nodeSessionEnded, nodeSourceMismatch },
        passed:
          nodeSessionEnded ===
            'Debugger stop 1 · 1.20 s · output shown through this event.' &&
          nodeSourceMismatch ===
            'Debugger stop 1 · captured source unavailable · 1.20 s · output shown through this event.',
      })
      // Arrange: the Node history reader alone, with its selected stop shown by the native session.
      const nodeReader = {
        ...options.message,
        revision: revisionAt(5),
        nodeHistoryEventCount: 1,
        nodeHistory: {
          header: { studyId: 'node-study' },
          status: 'complete',
          entries: [
            {
              type: 'stop',
              sequence: 2,
              index: 0,
              elapsedMs: 1200,
              source: {
                path: 'app/lib/data.ts',
                hash: 'a'.repeat(64),
                line: 217,
                column: 21,
              },
              frame: { name: 'fetchInvoiceById', line: 217, column: 21 },
              facts: [],
              debuggerSnapshot: {
                frames: [
                  {
                    line: 217,
                    column: 21,
                    source: {
                      name: 'app/lib/data.ts',
                      hash: 'a'.repeat(64),
                      line: 217,
                    },
                  },
                ],
                variables: [],
              },
            },
          ],
        },
      }
      const nodeInspect = page.locator('[data-inspect-node-history-stop]')
      await publish({ ...nodeReader, nodeHistoryPosition: nodeStop })
      const inspectWhileShown = {
        label: await nodeInspect.textContent(),
        disabled: await nodeInspect.isDisabled(),
      }
      // Act: the learner ends the native session while the same stop stays selected.
      await publish({
        ...nodeReader,
        nodeHistoryPosition: { ...nodeStop, debuggerAvailable: false },
      })
      const inspectAfterSessionEnd = {
        label: await nodeInspect.textContent(),
        disabled: await nodeInspect.isDisabled(),
      }
      cases.push({
        name: 'ending the native session of the selected Node stop offers Inspect in native debugger again',
        actual: { inspectWhileShown, inspectAfterSessionEnd },
        passed:
          inspectWhileShown.label === 'Debugger stop selected' &&
          inspectWhileShown.disabled === true &&
          inspectAfterSessionEnd.label === 'Inspect in native debugger' &&
          inspectAfterSessionEnd.disabled === false,
      })
      // Act: the selected stop's captured source no longer matches its recorded hash.
      await publish({
        ...nodeReader,
        nodeHistoryPosition: {
          ...nodeStop,
          sourceAvailable: false,
          debuggerAvailable: false,
        },
      })
      // Counted and read without waiting, so a missing element is a failed case instead of a harness timeout.
      const sourceMismatch = {
        position: await page.locator('#node-history-position').textContent(),
        inspectButtons: await nodeInspect.count(),
        explanation: await page
          .locator('#node-history-events .node-history-event p.muted')
          .allTextContents(),
      }
      cases.push({
        name: 'a selected Node stop whose captured source does not match offers no Inspect in native debugger',
        actual: sourceMismatch,
        passed:
          sourceMismatch.position ===
            'Debugger stop 1 · captured source unavailable · 1.20 s · output shown through this event.' &&
          sourceMismatch.inspectButtons === 0 &&
          sourceMismatch.explanation.join('|') ===
            'Matching captured source is unavailable for native debugging.',
      })
      // Act: the same stop is published again with matching captured source.
      await publish({
        ...nodeReader,
        nodeHistoryPosition: { ...nodeStop, debuggerAvailable: false },
      })
      const sourceMatches = {
        labels: await nodeInspect.allTextContents(),
        enabled: await nodeInspect.evaluateAll((buttons) =>
          buttons.map((button) => !button.disabled),
        ),
      }
      cases.push({
        name: 'a selected Node stop whose captured source matches offers Inspect in native debugger',
        actual: sourceMatches,
        passed:
          sourceMatches.labels.join('|') === 'Inspect in native debugger' &&
          sourceMatches.enabled.join('|') === 'true',
      })
      // Arrange: a second, unselected stop whose captured text failed the extension's hash check (Cycle 0044, 0033-F3a).
      const secondStop = {
        ...nodeReader.nodeHistory.entries[0],
        sequence: 3,
        index: 1,
        elapsedMs: 1500,
      }
      const twoStops = {
        ...nodeReader,
        nodeHistoryEventCount: 2,
        nodeHistory: {
          ...nodeReader.nodeHistory,
          entries: [nodeReader.nodeHistory.entries[0], secondStop],
        },
      }
      // Act
      await publish({
        ...twoStops,
        nodeHistoryUnverifiedStops: [3],
        nodeHistoryPosition: { ...nodeStop, debuggerAvailable: false },
      })
      const unselectedMismatch = {
        inspectSequences: await nodeInspect.evaluateAll((buttons) =>
          buttons.map((button) => button.dataset.nodeHistorySequence),
        ),
        explanation: await page
          .locator('#node-history-events .node-history-event p.muted')
          .allTextContents(),
      }
      cases.push({
        name: 'an unselected Node stop whose captured source does not match offers no Inspect in native debugger',
        actual: unselectedMismatch,
        passed:
          unselectedMismatch.inspectSequences.join('|') === '2' &&
          unselectedMismatch.explanation.join('|') ===
            'Matching captured source is unavailable for native debugging.',
      })
      // Arrange: keyboard focus on the selected stop's Inspect (Cycle 0044, 0033-OCR4).
      await publish({
        ...nodeReader,
        nodeHistoryPosition: { ...nodeStop, debuggerAvailable: false },
      })
      await nodeInspect.focus()
      const stopRequestsBefore = await page.evaluate(
        () =>
          window.sent.filter((message) => message.type === 'node-history-stop')
            .length,
      )
      // Act: the learner presses Inspect, and the host answers that the native session now shows the stop.
      await page.keyboard.press('Enter')
      await publish({ ...nodeReader, nodeHistoryPosition: nodeStop })
      const afterInspect = await page.evaluate(() => ({
        focusedSequence: document.activeElement?.dataset?.nodeHistorySequence,
        focusedIsInspect:
          document.activeElement?.dataset?.inspectNodeHistoryStop === 'true',
        label: document.activeElement?.textContent,
      }))
      await page.keyboard.press('Enter')
      const stopRequestsAfter = await page.evaluate(
        () =>
          window.sent.filter((message) => message.type === 'node-history-stop')
            .length,
      )
      cases.push({
        name: 'pressing Inspect by keyboard keeps focus on that Node stop and a second press sends nothing',
        actual: { afterInspect, stopRequestsBefore, stopRequestsAfter },
        passed:
          afterInspect.focusedSequence === '2' &&
          afterInspect.focusedIsInspect === true &&
          afterInspect.label === 'Debugger stop selected' &&
          stopRequestsAfter === stopRequestsBefore + 1,
      })
      // Arrange: a Node playhead scrub that ends without a change event (Cycle 0044, 0031-U6).
      const nodeTimeline = {
        ...nodeReader,
        nodeHistoryPosition: nodeStop,
        nodeHistoryPlayback: {
          mode: 'paused',
          sequence: 2,
          positionMs: 130560,
          startMs: 0,
          endMs: 400000,
          loading: false,
        },
      }
      await publish(nodeTimeline)
      await page.locator('#node-history-playhead').evaluate((playhead) => {
        playhead.value = '150000'
        playhead.dispatchEvent(new Event('input', { bubbles: true }))
        playhead.dispatchEvent(new Event('blur'))
      })
      // Act: a later step moves the selected test time.
      await publish({
        ...nodeTimeline,
        nodeHistoryPlayback: {
          ...nodeTimeline.nodeHistoryPlayback,
          positionMs: 198630,
        },
      })
      const nodePlayheadAfterStep = await page
        .locator('#node-history-playhead')
        .evaluate((playhead) => ({
          value: playhead.value,
          valueText: playhead.getAttribute('aria-valuetext'),
        }))
      cases.push({
        name: 'a Node step after an abandoned scrub moves the playhead value and its spoken test time',
        actual: nodePlayheadAfterStep,
        passed:
          nodePlayheadAfterStep.value === '198630' &&
          nodePlayheadAfterStep.valueText === '198.63 s of recorded test time',
      })
      await publish({
        ...replay,
        recording: {
          ...replay.recording,
          readiness: 'failed',
          reason: 'Recorded source unavailable',
        },
      })
      await page.locator('#playback-options > summary').click()
      cases.push({
        name: 'failed replay retains reload and visible recovery guidance in the bottom strip',
        passed:
          (await page
            .getByRole('button', {
              name: 'Reload saved recording',
              exact: true,
            })
            .isVisible()) &&
          (await page.locator('#playback-reason').isVisible()) &&
          (await page.locator('#playback-toggle').isDisabled()),
      })
      await page.screenshot({ path: `${options.output}/replay-recovery.png` })

      cases.push({
        name: 'old recordings disclose missing learning material instead of inventing a summary',
        passed:
          (await page.locator('#learning-unavailable').isVisible()) &&
          !(await page.locator('#learning-material').isVisible()),
      })
      const reference = {
        snapshotUri: 'codebook://recorded-stop',
        sourceHash: 'a'.repeat(64),
      }
      const learningSummary = {
        explanationId: '44444444-4444-4444-8444-444444444444',
        createdAt: '2026-09-27T00:00:00.000Z',
        content: {
          question: 'How is the operation handled?',
          title: 'Saved processing path',
          summary: 'A saved explanation <script>window.invented=true</script>',
          participants: [
            { id: 'ui', label: 'Application' },
            { id: 'handler', label: 'Source handler' },
          ],
          steps: [
            {
              id: '__proto__',
              from: 'ui',
              to: 'handler',
              label: 'Observed submission',
              explanation: 'The recorded source stop follows the user input.',
              evidence: 'observed',
              reference,
            },
            {
              id: 'derive',
              from: 'handler',
              to: 'ui',
              label: 'Source relationship',
              explanation:
                'Derived from captured source, not proof of execution.',
              evidence: 'source-derived',
              reference,
            },
            {
              id: 'constructor',
              from: 'handler',
              to: 'handler',
              label: 'Unknown completion',
              explanation: '<img src=x onerror="window.invented=true">',
              evidence: 'unknown',
            },
          ],
        },
        positions: [
          { stepId: '__proto__', elapsedMs: 2000 },
          { stepId: 'derive', elapsedMs: 2000 },
        ],
      }
      const learning = {
        ...replay,
        revision: revisionAt(7),
        recording: { ...replay.recording, learningSummary },
        model: {
          ...replay.model,
          observation: {
            ...replay.model.observation,
            snapshotUri: reference.snapshotUri,
          },
        },
      }
      await publish(learning)
      await page.locator('#learning-material').scrollIntoViewIfNeeded()
      const diagram = await page.evaluate(() => ({
        arrows: document.querySelectorAll('#learning-sequence svg path').length,
        steps: [...document.querySelectorAll('.sequence-steps strong')].map(
          (value) => value.textContent,
        ),
        unsafeElements: document.querySelectorAll(
          '#learning-material script, #learning-material img',
        ).length,
        invented: window.invented === true,
        links: document.querySelectorAll('[data-summary-step]').length,
        summary: document.getElementById('learning-summary').textContent,
      }))
      cases.push({
        name: 'saved sequence renders evidence classifications and agent markup only as text',
        actual: diagram,
        passed:
          diagram.arrows === 3 &&
          diagram.steps.join('|') ===
            'Observed submission · observed|Source relationship · source-derived|Unknown completion · unknown' &&
          diagram.unsafeElements === 0 &&
          !diagram.invented &&
          diagram.links === 2 &&
          diagram.summary.includes('<script>'),
      })
      await page.screenshot({
        path: `${options.output}/saved-learning-sequence.png`,
      })
      const wideLearning = JSON.parse(JSON.stringify(learning))
      wideLearning.recording.learningSummary.content.participants = Array.from(
        { length: 8 },
        (_, index) => ({
          id: `actor-${index}`,
          label: `Participant ${index + 1}`,
        }),
      )
      wideLearning.recording.learningSummary.content.steps = [
        {
          id: 'wide',
          from: 'actor-0',
          to: 'actor-7',
          label: 'Across the project',
          explanation: 'Source-derived relationship.',
          evidence: 'source-derived',
          reference,
        },
      ]
      wideLearning.recording.learningSummary.positions = [
        { stepId: 'wide', elapsedMs: 2000 },
      ]
      await publish(wideLearning)
      await page.locator('.sequence-diagram').scrollIntoViewIfNeeded()
      await page.locator('.sequence-diagram').focus()
      for (let index = 0; index < 40; index++)
        await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(400)
      const scrolledDiagram = await page
        .locator('.sequence-diagram')
        .evaluate((element) => ({
          focused: document.activeElement === element,
          left: element.scrollLeft,
          width: element.clientWidth,
          contentWidth: element.scrollWidth,
          pageOverflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
          // Names what widens the page when the case fails; the diagram's own content scrolls inside it and is not counted.
          overflowing: [...document.querySelectorAll('body *')]
            .filter(
              (candidate) =>
                !element.contains(candidate) &&
                candidate.getBoundingClientRect().right >
                  document.documentElement.clientWidth + 1,
            )
            .map(
              (candidate) =>
                `${candidate.tagName.toLowerCase()}${candidate.id ? `#${candidate.id}` : ''}${typeof candidate.className === 'string' && candidate.className ? `.${candidate.className}` : ''}`,
            )
            .slice(0, 12),
        }))
      cases.push({
        name: 'wide saved sequence remains reachable by keyboard inside its own scroll area',
        actual: scrolledDiagram,
        passed:
          scrolledDiagram.focused &&
          scrolledDiagram.left + scrolledDiagram.width >=
            scrolledDiagram.contentWidth - 1 &&
          !scrolledDiagram.pageOverflow,
      })
      await page.screenshot({
        path: `${options.output}/wide-sequence-scrolled.png`,
      })
      // Arrange: the Learning summary as a narrow side bar at default zoom, with a long saved title (Cycle 0044, 0031-U3).
      await page.setViewportSize({ width: 300, height: 720 })
      const denseLearning = JSON.parse(JSON.stringify(learning))
      denseLearning.recording.learningSummary.content.title =
        'How submitting the invoice form reaches the server action and updates the saved invoice'
      // Act
      await publish(denseLearning)
      await page.evaluate(() => window.scrollTo(0, 0))
      const summaryDensity = await page.evaluate(() => {
        const title = document.getElementById('learning-title'),
          diagram = document.querySelector(
            '#learning-sequence .sequence-diagram',
          )
        const range = document.createRange()
        range.selectNodeContents(title)
        return {
          // Distinct line boxes of the rendered title, including any the reader clips.
          titleLines: new Set(
            [...range.getClientRects()].map((rect) => Math.round(rect.top)),
          ).size,
          titleHeight: Math.round(title.getBoundingClientRect().height),
          titleLineHeight: Math.round(
            Number.parseFloat(getComputedStyle(title).lineHeight),
          ),
          fullTitle: title.getAttribute('title'),
          sequenceTop: Math.round(diagram.getBoundingClientRect().top),
          // The fixed transport covers the bottom of the pane; the sequence must begin above it.
          transportTop: Math.round(
            document
              .getElementById('recording-transport')
              .getBoundingClientRect().top,
          ),
          viewportHeight: window.innerHeight,
          pageOverflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        }
      })
      await page.screenshot({
        path: `${options.output}/narrow-learning-summary.png`,
      })
      cases.push({
        name: 'a narrow Learning summary keeps a long title to two lines and its sequence in view',
        actual: summaryDensity,
        passed:
          summaryDensity.titleHeight <=
            summaryDensity.titleLineHeight * 2 + 1 &&
          summaryDensity.fullTitle ===
            'How submitting the invoice form reaches the server action and updates the saved invoice' &&
          summaryDensity.sequenceTop < summaryDensity.viewportHeight &&
          summaryDensity.sequenceTop < summaryDensity.transportTop &&
          !summaryDensity.pageOverflow,
      })
      await page.setViewportSize({ width: 600, height: 800 })
      await publish(learning)

      const beforeLearningWrites = (await inspect()).writes
      await page.locator('[data-summary-step="__proto__"]').click()
      const inspection = await page.evaluate(() =>
        window.sent.filter((value) => value.type === 'playback').at(-1),
      )
      cases.push({
        name: 'sequence inspection seeks its source-bound stop through the current replay revision',
        actual: inspection,
        passed:
          inspection.action === 'seek' &&
          inspection.positionMs === 2000 &&
          inspection.expectedRevision === revisionAt(6) &&
          inspection.revision === revisionAt(7),
      })
      await page.locator('[data-summary-step="derive"]').focus()
      await publish({
        ...learning,
        revision: revisionAt(8),
        recording: { ...learning.recording, presentedMs: 6000 },
      })
      cases.push({
        name: 'playhead updates preserve the full saved sequence and focused inspection control',
        passed:
          (await page.evaluate(
            () => document.activeElement?.dataset.summaryStep === 'derive',
          )) &&
          (await page.locator('.sequence-steps li').count()) === 3 &&
          (await inspect()).writes === beforeLearningWrites,
      })
      await publish({
        ...learning,
        revision: revisionAt(9),
        recording: {
          ...learning.recording,
          readiness: 'loading',
          cleared: true,
        },
      })
      cases.push({
        name: 'pending replay synchronization disables summary navigation',
        passed:
          (await page
            .locator('[data-summary-step="__proto__"]')
            .isDisabled()) &&
          (await page.locator('[data-summary-step="derive"]').isDisabled()),
      })
      await publish({ ...replay, revision: revisionAt(10) })
      cases.push({
        name: 'switching to older history hides previous learning material',
        passed:
          !(await page.locator('#learning-material').isVisible()) &&
          (await page.locator('#learning-unavailable').isVisible()),
      })
    } else {
      await page.setViewportSize({ width: 1200, height: 180 })
      await publish({
        ...options.message,
        revision: revisionAt(5),
        contentTab: 'recording',
        playbackPanelVisible: true,
        repositoryArticleAvailable: true,
        study: {
          terminal: true,
          studyOutcome: 'demonstrated',
          historyOutcome: 'saved',
          finalOutcome: 'demonstrated',
          recordingSave: { status: 'finalized', contextStatus: 'saved' },
        },
        recording: {
          revision: revisionAt(6),
          mode: 'paused',
          readiness: 'ready',
          cleared: false,
          presentedMs: 2000,
          range: { startMs: 0, endMs: 5000, endKnown: true },
          recordingStatus: 'finalized',
        },
      })
      cases.push({
        name: 'bottom panel presents playback without duplicate learning or library sections',
        passed:
          (await page.locator('#recording-transport').isVisible()) &&
          !(await page.locator('.learning-header').isVisible()) &&
          !(await page.locator('#observed-moments').isVisible()) &&
          !(await page.locator('#saved-studies').isVisible()) &&
          !(await page.locator('[data-action="open-article"]').isVisible()) &&
          !(await page.locator('#recording-save-state').isVisible()) &&
          !(await page.locator('#evidence-details').isVisible()) &&
          (await page.locator('#playback-toggle').isEnabled()),
      })
      const compactPanel = await page.evaluate(() => ({
        transportTop: document
          .getElementById('recording-transport')
          .getBoundingClientRect().top,
        playTop: document
          .getElementById('playback-toggle')
          .getBoundingClientRect().top,
        viewportHeight: window.innerHeight,
      }))
      cases.push({
        name: 'short bottom panel keeps replay controls at its visible top edge',
        actual: compactPanel,
        passed:
          compactPanel.transportTop <= 16 &&
          compactPanel.playTop < compactPanel.viewportHeight,
      })
      await page.locator('#playback-toggle').click()
      const play = await page.evaluate(() =>
        window.sent.filter((value) => value.type === 'playback').at(-1),
      )
      cases.push({
        name: 'bottom panel uses the current recording revision for playback',
        passed:
          play.action === 'play' &&
          play.revision === revisionAt(5) &&
          play.expectedRevision === revisionAt(6),
      })
      await publish({
        ...options.message,
        revision: revisionAt(6),
        contentTab: 'recording',
        playbackPanelVisible: true,
        errors: [
          'The editor did not retain the requested Codebook layout. '.repeat(
            12,
          ),
        ],
        recording: {
          revision: revisionAt(6),
          mode: 'paused',
          readiness: 'ready',
          cleared: false,
          presentedMs: 2000,
          range: { startMs: 0, endMs: 5000, endKnown: true },
          recordingStatus: 'finalized',
        },
      })
      const errorPanel = await page.evaluate(() => ({
        transportTop: document
          .getElementById('recording-transport')
          .getBoundingClientRect().top,
        errorTop: document.getElementById('errors').getBoundingClientRect().top,
      }))
      cases.push({
        name: 'layout errors stay below the replay controls in a short panel',
        actual: errorPanel,
        passed:
          errorPanel.transportTop <= 16 &&
          errorPanel.errorTop > errorPanel.transportTop,
      })
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      const scrolledPanel = await page.evaluate(() => ({
        transportTop: document
          .getElementById('recording-transport')
          .getBoundingClientRect().top,
        scrollY: window.scrollY,
      }))
      cases.push({
        name: 'short panel keeps playback accessible after its error area scrolls',
        actual: scrolledPanel,
        passed: scrolledPanel.scrollY > 0 && scrolledPanel.transportTop <= 16,
      })
      await page.screenshot({
        path: `${options.output}/bottom-playback-panel.png`,
      })
    }
  }
  // Saved studies: the delete control, its reasons, an entry that cannot be opened, the outcome line and focus.
  await page.setViewportSize({ width: 420, height: 720 })
  await page.goto(options.url)
  await page.evaluate(() => {
    window.sent = []
    window.acquireVsCodeApi = () => ({
      getState: () => undefined,
      setState() {},
      postMessage: (message) => window.sent.push(message),
    })
  })
  await page.setContent(options.html.context)
  await page.waitForFunction(() =>
    window.sent.some((message) => message.type === 'ready'),
  )
  const savedStudy = (id, overrides = {}) => ({
      id,
      savedAt: '2026-09-20T00:00:10.000Z',
      profile: 'repository-browser',
      format: 'v3',
      outcome: 'demonstrated',
      metadata: 'validated',
      ...overrides,
    }),
    shownStudy = savedStudy('window_run-shown01'),
    otherStudy = savedStudy('window_run-other02'),
    staleStudy = savedStudy('window_run-stale03', {
      profile: undefined,
      outcome: 'unverified',
      metadata: 'unavailable',
    }),
    legacyStudy = savedStudy('window_run-legacy4', {
      format: 'legacy-v1',
      outcome: 'Unsupported historical format; original file preserved',
      metadata: 'unavailable',
    }),
    nodeHistory = savedStudy('window_run-node005', {
      profile: 'node-test',
      format: 'node-test-history',
      outcome: 'Node test complete',
    }),
    brokenNodeHistory = savedStudy('window_run-node006', {
      profile: 'node-test',
      format: 'node-test-history',
      outcome: 'Node test partial',
      metadata: 'unavailable',
    })
  let savedRevision = 100
  /** Publishes one Study message for the Saved studies cases; `chosen` is the study the reader shows. */
  const library = (studies, chosen, extra = {}) =>
    publish({
      ...options.message,
      revision: ++savedRevision,
      studies,
      model: {
        ...options.message.model,
        selection: { ...options.message.model.selection, studyId: chosen },
      },
      ...extra,
    })
  const removalControl = () =>
    page.evaluate(() => {
      const visible = (id) =>
          document.getElementById(id).getClientRects().length > 0,
        // The text of a line the learner can see; null while the line is hidden.
        shownText = (id) =>
          visible(id) ? document.getElementById(id).textContent : null,
        control = document.getElementById('delete-study'),
        list = document.getElementById('studies'),
        status = document.getElementById('delete-study-status'),
        sent = (type) => window.sent.filter((message) => message.type === type)
      return {
        heading: document.querySelector('#saved-studies h2').textContent,
        options: [...list.options].map((option) => [
          option.value,
          option.disabled,
        ]),
        chosen: list.value,
        shownText: list.selectedOptions[0]?.textContent,
        buttonVisible: visible('delete-study'),
        ariaDisabled: control.getAttribute('aria-disabled'),
        disabledAttribute: control.hasAttribute('disabled'),
        describedBy: control.getAttribute('aria-describedby'),
        reason: shownText('delete-study-reason'),
        note: shownText('study-unopenable'),
        status: status.textContent,
        statusIsError: status.classList.contains('error'),
        statusRole: `${status.getAttribute('role')}/${status.getAttribute('aria-live')}`,
        focus: document.activeElement.id,
        deletes: sent('delete-study').map((message) => [
          message.studyId,
          message.revision,
        ]),
        histories: sent('history').length,
      }
    })
  const deleteButton = page.getByRole('button', {
    name: 'Delete saved study…',
    exact: true,
  })

  await library([], undefined)
  const emptyLibrary = await removalControl()
  cases.push({
    name: 'an empty library shows No saved study yet under its own heading and offers no delete control',
    actual: emptyLibrary,
    passed:
      emptyLibrary.heading === 'Saved studies' &&
      emptyLibrary.shownText === 'No saved study yet' &&
      emptyLibrary.options.length === 1 &&
      !emptyLibrary.buttonVisible &&
      emptyLibrary.reason === null,
  })

  await library([shownStudy, otherStudy], undefined)
  await page.locator('#studies').focus()
  await page.keyboard.press('Tab')
  const reachedByTab = await removalControl()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  // A learner can still press a button that is only marked unavailable; Playwright waits for an enabled one unless forced.
  await deleteButton.click({ force: true })
  const nothingChosen = await removalControl()
  await page
    .locator('#saved-studies')
    .screenshot({ path: `${options.output}/saved-studies-reason.png` })
  cases.push({
    name: 'with no study chosen the delete button is reached by Tab, says why it cannot be used and sends nothing',
    actual: nothingChosen,
    passed:
      (await deleteButton.count()) === 1 &&
      reachedByTab.focus === 'delete-study' &&
      nothingChosen.buttonVisible &&
      nothingChosen.ariaDisabled === 'true' &&
      !nothingChosen.disabledAttribute &&
      nothingChosen.describedBy === 'delete-study-reason delete-study-status' &&
      nothingChosen.reason === 'Choose a saved study to delete.' &&
      nothingChosen.statusRole === 'status/polite' &&
      nothingChosen.focus === 'delete-study' &&
      nothingChosen.deletes.length === 0,
  })

  await library([shownStudy, otherStudy], shownStudy.id)
  const deletable = await removalControl()
  await deleteButton.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  const requested = await removalControl()
  cases.push({
    name: 'for the shown saved study Enter and Space on the delete button each ask the host to delete it',
    actual: { deletable, requested },
    passed:
      deletable.chosen === shownStudy.id &&
      deletable.ariaDisabled === null &&
      deletable.reason === null &&
      JSON.stringify(requested.deletes) ===
        JSON.stringify([
          [shownStudy.id, 103],
          [shownStudy.id, 103],
        ]),
  })
  const deletesSoFar = requested.deletes.length

  const replaying = {
    contentTab: 'recording',
    study: {
      terminal: true,
      studyOutcome: 'demonstrated',
      historyOutcome: 'saved',
      finalOutcome: 'demonstrated',
      recordingSave: { status: 'finalized', contextStatus: 'saved' },
    },
    recording: {
      revision: revisionAt(6),
      mode: 'paused',
      readiness: 'ready',
      cleared: false,
      presentedMs: 2000,
      range: { startMs: 0, endMs: 5000, endKnown: true },
      recordingStatus: 'finalized',
    },
  }
  await library([shownStudy, nodeHistory], nodeHistory.id, {
    unstoppedStudyId: nodeHistory.id,
    ...replaying,
  })
  const nodeReason = (await removalControl()).reason
  await library([shownStudy, otherStudy], shownStudy.id, {
    unstoppedStudyId: shownStudy.id,
    ...replaying,
  })
  const liveReason = (await removalControl()).reason
  await library([shownStudy, otherStudy], shownStudy.id, replaying)
  const recordingReason = (await removalControl()).reason
  await library([shownStudy, otherStudy], shownStudy.id, {
    unstoppedStudyId: shownStudy.id,
    studyRemoval: {
      status: 'moving',
      studyId: shownStudy.id,
      text: 'Moving the saved study to the Trash…',
    },
  })
  const moving = await removalControl()
  await deleteButton.click({ force: true })
  cases.push({
    name: 'the delete button gives one reason at a time: Node history, then a run that has not stopped, then an open Recording; a removal in progress is named by the status line',
    actual: { nodeReason, liveReason, recordingReason, moving },
    passed:
      nodeReason === 'Node test histories cannot be deleted here yet.' &&
      liveReason === 'Stop the run before deleting its study.' &&
      recordingReason ===
        'Choose Overview or Live to leave Recording before deleting this study.' &&
      moving.ariaDisabled === 'true' &&
      moving.reason === null &&
      moving.status === 'Moving the saved study to the Trash…' &&
      !moving.statusIsError &&
      (await removalControl()).deletes.length === deletesSoFar,
  })

  const mixedLibrary = [
    shownStudy,
    staleStudy,
    legacyStudy,
    nodeHistory,
    brokenNodeHistory,
  ]
  await library(mixedLibrary, shownStudy.id)
  const historiesBefore = (await removalControl()).histories
  await page.selectOption('#studies', staleStudy.id)
  const choseUnopenable = await removalControl()
  await library(mixedLibrary, shownStudy.id)
  const keptAcrossRender = await removalControl()
  await deleteButton.click()
  const askedForUnopenable = await removalControl()
  await page.selectOption('#studies', legacyStudy.id)
  const choseLegacy = await removalControl()
  await library([shownStudy, nodeHistory, brokenNodeHistory], shownStudy.id)
  const afterItLeft = await removalControl()
  cases.push({
    name: 'a saved study that cannot be opened can be chosen and deleted without being opened, stays chosen across a render, and a broken Node history stays unavailable',
    actual: {
      choseUnopenable,
      keptAcrossRender,
      askedForUnopenable,
      choseLegacy,
      afterItLeft,
    },
    passed:
      JSON.stringify(choseUnopenable.options) ===
        JSON.stringify([
          [shownStudy.id, false],
          [staleStudy.id, false],
          [legacyStudy.id, false],
          [nodeHistory.id, false],
          [brokenNodeHistory.id, true],
        ]) &&
      choseUnopenable.chosen === staleStudy.id &&
      choseUnopenable.histories === historiesBefore &&
      choseUnopenable.note ===
        'This saved study cannot be opened. It can still be deleted.' &&
      choseUnopenable.ariaDisabled === null &&
      keptAcrossRender.chosen === staleStudy.id &&
      keptAcrossRender.note ===
        'This saved study cannot be opened. It can still be deleted.' &&
      JSON.stringify(askedForUnopenable.deletes.at(-1)) ===
        JSON.stringify([staleStudy.id, 109]) &&
      askedForUnopenable.deletes.length === deletesSoFar + 1 &&
      choseLegacy.chosen === legacyStudy.id &&
      choseLegacy.histories === historiesBefore &&
      choseLegacy.ariaDisabled === null &&
      afterItLeft.chosen === shownStudy.id &&
      afterItLeft.note === null,
  })

  const partlyMoved = {
    status: 'failed',
    studyId: staleStudy.id,
    text: 'The saved study was only partly moved to the Trash; delete it again to finish. Trash refused the archive',
  }
  await library(mixedLibrary, staleStudy.id, { studyRemoval: partlyMoved })
  const failedOutcome = await removalControl()
  await page
    .locator('#saved-studies')
    .screenshot({ path: `${options.output}/saved-studies-failed.png` })
  await library(mixedLibrary, staleStudy.id, { studyRemoval: partlyMoved })
  const outcomeAfterRender = await removalControl()
  await page.selectOption('#studies', legacyStudy.id)
  const outcomeAfterAnotherChoice = await removalControl()
  await library(mixedLibrary, staleStudy.id, {
    studyRemoval: { status: 'confirming', studyId: legacyStudy.id },
  })
  await library(mixedLibrary, staleStudy.id, { studyRemoval: partlyMoved })
  const outcomeOfTheNextAttempt = await removalControl()
  cases.push({
    name: 'the outcome of a removal stays under the button across renders, is shown as an error when it failed, and gives way when another entry is chosen',
    actual: {
      failedOutcome,
      outcomeAfterRender,
      outcomeAfterAnotherChoice,
      outcomeOfTheNextAttempt,
    },
    passed:
      failedOutcome.status === partlyMoved.text &&
      failedOutcome.statusIsError &&
      failedOutcome.chosen === staleStudy.id &&
      failedOutcome.note ===
        'This saved study cannot be opened. It can still be deleted.' &&
      outcomeAfterRender.status === partlyMoved.text &&
      outcomeAfterAnotherChoice.status === '' &&
      outcomeOfTheNextAttempt.status === partlyMoved.text,
  })

  const confirming = { status: 'confirming', studyId: shownStudy.id },
    movingShown = {
      status: 'moving',
      studyId: shownStudy.id,
      text: 'Moving the saved study to the Trash…',
    },
    movedShown = {
      status: 'moved',
      studyId: shownStudy.id,
      text: 'Saved study moved to the Trash. The library now holds 1 of 64 saved studies.',
    }
  // This pane asks, the learner confirms, the study moves: focus goes to the list.
  await library([shownStudy, otherStudy], shownStudy.id)
  await deleteButton.click()
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: confirming,
  })
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: movingShown,
  })
  await library([otherStudy], otherStudy.id, { studyRemoval: movedShown })
  const afterOwnRemoval = await removalControl()
  await page
    .locator('#saved-studies')
    .screenshot({ path: `${options.output}/saved-studies-moved.png` })
  // This pane asks and the learner cancels: the field is cleared and focus stays on the button.
  await library([shownStudy, otherStudy], shownStudy.id)
  await deleteButton.click()
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: confirming,
  })
  await library([shownStudy, otherStudy], shownStudy.id)
  const afterCancel = await removalControl()
  // This pane asks and the host refuses at once.
  await deleteButton.click()
  await page.evaluate(() => document.activeElement.blur())
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: {
      status: 'refused',
      studyId: shownStudy.id,
      text: 'Stop the run before deleting its study.',
    },
  })
  const afterRefusal = await removalControl()
  // Another pane asked: this pane shows the outcome and moves no focus.
  await library([shownStudy, otherStudy], shownStudy.id)
  await deleteButton.focus()
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: confirming,
  })
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: movingShown,
  })
  await library([otherStudy], otherStudy.id, { studyRemoval: movedShown })
  const afterAnotherPanesRemoval = await removalControl()
  // This pane asked, but the learner moved on to another control before the answer.
  await library([shownStudy, otherStudy], shownStudy.id)
  await deleteButton.click()
  await page.locator('#overview-tab').focus()
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: confirming,
  })
  await library([otherStudy], otherStudy.id, { studyRemoval: movedShown })
  const afterMovingOn = await removalControl()
  cases.push({
    name: 'after its own delete request a pane moves focus once: to the list after a removal, to the button after Cancel or a refusal, and nowhere when the learner moved on or another pane asked',
    actual: {
      afterOwnRemoval,
      afterCancel,
      afterRefusal,
      afterAnotherPanesRemoval,
      afterMovingOn,
    },
    passed:
      afterOwnRemoval.focus === 'studies' &&
      afterOwnRemoval.status === movedShown.text &&
      !afterOwnRemoval.statusIsError &&
      afterOwnRemoval.chosen === otherStudy.id &&
      afterCancel.focus === 'delete-study' &&
      afterCancel.status === '' &&
      afterRefusal.focus === 'delete-study' &&
      afterRefusal.status === 'Stop the run before deleting its study.' &&
      afterRefusal.statusIsError &&
      afterAnotherPanesRemoval.focus === 'delete-study' &&
      afterAnotherPanesRemoval.status === movedShown.text &&
      afterMovingOn.focus === 'overview-tab',
  })

  /** Publishes a Study message with the revision of the one before it, as a host message does that was sent before the pane's request arrived. */
  const republish = (studies, chosen, extra = {}) => {
    savedRevision -= 1
    return library(studies, chosen, extra)
  }
  await library([shownStudy, otherStudy], shownStudy.id)
  const beforeChoice = await removalControl()
  await page.selectOption('#studies', otherStudy.id)
  const rightAfterChoice = await removalControl()
  // A message the host sent before the request arrived still shows the earlier study.
  await republish([shownStudy, otherStudy], shownStudy.id)
  const afterEarlierMessage = await removalControl()
  await deleteButton.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  await deleteButton.click({ force: true })
  await republish([shownStudy, otherStudy], shownStudy.id, { loading: true })
  const whileHostLoads = await removalControl()
  await page
    .locator('#saved-studies')
    .screenshot({ path: `${options.output}/saved-studies-opening.png` })
  await deleteButton.click({ force: true })
  const afterPresses = await removalControl()
  await library([shownStudy, otherStudy], otherStudy.id)
  const onceShown = await removalControl()
  await deleteButton.click()
  const askedForChosen = await removalControl()
  cases.push({
    name: 'while a chosen saved study is still opening the list keeps it and the delete button waits with its reason and sends nothing; once the host shows it the button deletes that study',
    actual: {
      rightAfterChoice,
      afterEarlierMessage,
      whileHostLoads,
      afterPresses,
      onceShown,
      askedForChosen,
    },
    passed:
      rightAfterChoice.chosen === otherStudy.id &&
      rightAfterChoice.histories === beforeChoice.histories + 1 &&
      rightAfterChoice.ariaDisabled === 'true' &&
      rightAfterChoice.reason === 'Wait for the chosen saved study to open.' &&
      afterEarlierMessage.chosen === otherStudy.id &&
      afterEarlierMessage.ariaDisabled === 'true' &&
      afterEarlierMessage.reason ===
        'Wait for the chosen saved study to open.' &&
      whileHostLoads.chosen === otherStudy.id &&
      whileHostLoads.ariaDisabled === 'true' &&
      afterPresses.deletes.length === beforeChoice.deletes.length &&
      onceShown.chosen === otherStudy.id &&
      onceShown.ariaDisabled === null &&
      onceShown.reason === null &&
      askedForChosen.deletes.length === beforeChoice.deletes.length + 1 &&
      JSON.stringify(askedForChosen.deletes.at(-1)) ===
        JSON.stringify([otherStudy.id, savedRevision]),
  })

  /** Reads the number the pane gave its last request to open an entry. */
  const lastOpenRequest = () =>
    page.evaluate(
      () =>
        window.sent.findLast(
          (message) =>
            message.type === 'history' || message.type === 'node-history',
        )?.openRequest,
    )
  /** Answers one open request the way the host does once the request has ended: a reply to this pane only. */
  const settleOpenRequest = (openRequest) =>
    publish({ type: 'open-request-settled', openRequest })

  // The host starts loading the chosen entry, shows the earlier study again and answers the request: the open failed.
  await library([shownStudy, otherStudy], shownStudy.id)
  await page.selectOption('#studies', otherStudy.id)
  await republish([shownStudy, otherStudy], shownStudy.id, { loading: true })
  await library([shownStudy, otherStudy], shownStudy.id, {
    errors: ['Error: Study archive is unavailable.'],
  })
  await settleOpenRequest(await lastOpenRequest())
  const afterFailedOpen = await removalControl()
  // The host answers with another revision without ever loading, and answers the request: it was refused as stale.
  await page.selectOption('#studies', otherStudy.id)
  await library([shownStudy, otherStudy], shownStudy.id)
  await settleOpenRequest(await lastOpenRequest())
  const afterRefusedRequest = await removalControl()
  // Forced, so a button that still waits is a failed case instead of a harness timeout.
  await deleteButton.click({ force: true })
  const askedForShown = await removalControl()
  cases.push({
    name: 'when the chosen saved study does not open the list returns to the shown study and the delete button is offered for it',
    actual: { afterFailedOpen, afterRefusedRequest, askedForShown },
    passed:
      afterFailedOpen.chosen === shownStudy.id &&
      afterFailedOpen.ariaDisabled === null &&
      afterFailedOpen.reason === null &&
      afterRefusedRequest.chosen === shownStudy.id &&
      afterRefusedRequest.ariaDisabled === null &&
      JSON.stringify(askedForShown.deletes.at(-1)) ===
        JSON.stringify([shownStudy.id, savedRevision]),
  })

  // The host refuses the request before it loads anything: the same revision, the earlier study, no loading state.
  await library([shownStudy, otherStudy, nodeHistory], shownStudy.id)
  await page.selectOption('#studies', otherStudy.id)
  const refusedRequest = await lastOpenRequest()
  await republish([shownStudy, otherStudy, nodeHistory], shownStudy.id)
  const refusedWithoutReply = await removalControl()
  // A reply to an earlier request of this pane does not end the wait for the newer one.
  await settleOpenRequest(refusedRequest - 1)
  const afterEarlierReply = await removalControl()
  cases.push({
    name: 'a chosen saved study the host has not answered stays chosen and the delete button keeps waiting, also after a reply to an earlier request',
    actual: { refusedRequest, refusedWithoutReply, afterEarlierReply },
    passed:
      Number.isInteger(refusedRequest) &&
      refusedRequest > 1 &&
      refusedWithoutReply.chosen === otherStudy.id &&
      refusedWithoutReply.ariaDisabled === 'true' &&
      refusedWithoutReply.reason ===
        'Wait for the chosen saved study to open.' &&
      afterEarlierReply.chosen === otherStudy.id &&
      afterEarlierReply.ariaDisabled === 'true' &&
      afterEarlierReply.reason === 'Wait for the chosen saved study to open.',
  })
  await settleOpenRequest(refusedRequest)
  const afterReply = await removalControl()
  // Forced, so a button that still waits is a failed case instead of a harness timeout.
  await deleteButton.click({ force: true })
  const askedAfterReply = await removalControl()
  cases.push({
    name: 'when the host answers a chosen saved study it refused before loading, the list returns to the shown study and the delete button deletes that study',
    actual: { afterReply, askedAfterReply },
    passed:
      afterReply.chosen === shownStudy.id &&
      afterReply.ariaDisabled === null &&
      afterReply.reason === null &&
      JSON.stringify(askedAfterReply.deletes.at(-1)) ===
        JSON.stringify([shownStudy.id, savedRevision]),
  })

  // A Node test history the host refuses to open (as it does during Recording) is answered the same way.
  await page.selectOption('#studies', nodeHistory.id)
  const nodeRequest = await lastOpenRequest()
  const whileNodeHistoryWaits = await removalControl()
  await settleOpenRequest(nodeRequest)
  const afterNodeReply = await removalControl()
  cases.push({
    name: 'when the host answers a chosen Node test history it did not open, the list returns to the shown study and the delete button is offered for it',
    actual: { nodeRequest, whileNodeHistoryWaits, afterNodeReply },
    passed:
      nodeRequest === refusedRequest + 1 &&
      whileNodeHistoryWaits.chosen === nodeHistory.id &&
      whileNodeHistoryWaits.ariaDisabled === 'true' &&
      whileNodeHistoryWaits.reason ===
        'Wait for the chosen saved study to open.' &&
      afterNodeReply.chosen === shownStudy.id &&
      afterNodeReply.ariaDisabled === null &&
      afterNodeReply.reason === null,
  })

  const runRefusal =
    'The last run did not start: Study library is full at its maximum of 256 saved studies. Delete a saved study from Saved studies in the Study workspace before starting another run. Existing learning was kept.'
  await library([shownStudy], shownStudy.id, { runRefusal })
  const refusalAlone = await page.evaluate(() => ({
    errors: document.getElementById('errors').textContent,
    retryVisible:
      document.querySelector('[data-action="retry"]').getClientRects().length >
      0,
  }))
  await library([shownStudy], shownStudy.id, {
    runRefusal,
    errors: ['Error: History not saved: disk is read-only'],
  })
  const refusalWithStorageError = await page.evaluate(() => ({
    errors: document.getElementById('errors').textContent,
    retryVisible:
      document.querySelector('[data-action="retry"]').getClientRects().length >
      0,
  }))
  cases.push({
    name: 'a run that did not start is named first in the error region and offers Retry storage only beside a storage error',
    actual: { refusalAlone, refusalWithStorageError },
    passed:
      refusalAlone.errors === runRefusal &&
      !refusalAlone.retryVisible &&
      refusalWithStorageError.errors ===
        `${runRefusal}\nError: History not saved: disk is read-only` &&
      refusalWithStorageError.retryVisible,
  })
  await page.screenshot({ path: `${options.output}/run-refusal.png` })

  // The only saved study leaves the library: the list shows its placeholder instead of a blank.
  await library([shownStudy], shownStudy.id)
  const beforeLastStudyLeft = await removalControl()
  await library([], undefined)
  const afterLastStudyLeft = await removalControl()
  cases.push({
    name: 'after the only saved study left the library the list shows No saved study yet instead of a blank',
    actual: { beforeLastStudyLeft, afterLastStudyLeft },
    passed:
      beforeLastStudyLeft.chosen === shownStudy.id &&
      afterLastStudyLeft.chosen === '' &&
      afterLastStudyLeft.shownText === 'No saved study yet' &&
      !afterLastStudyLeft.buttonVisible,
  })

  // An earlier refusal for the same study is still shown when the learner asks again: it does not answer the new request.
  const refusedBefore = {
    status: 'refused',
    studyId: shownStudy.id,
    text: 'Choose Overview or Live to leave Recording before deleting this study.',
  }
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: refusedBefore,
  })
  await deleteButton.focus()
  await page.keyboard.press('Enter')
  // A message for another reason still carries the earlier refusal.
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: refusedBefore,
    busy: true,
  })
  const whileNewRequestWaits = await removalControl()
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: movingShown,
  })
  await library([otherStudy], otherStudy.id, { studyRemoval: movedShown })
  const afterNewRequestWasAnswered = await removalControl()
  cases.push({
    name: 'a refusal that was already shown does not answer a new delete request: focus moves to the list only when the new removal has ended',
    actual: { whileNewRequestWaits, afterNewRequestWasAnswered },
    passed:
      whileNewRequestWaits.focus === 'delete-study' &&
      afterNewRequestWasAnswered.focus === 'studies' &&
      afterNewRequestWasAnswered.chosen === otherStudy.id,
  })

  // A current-format entry whose catalog checkpoint is stale can be repaired by Retry storage; the delete-only note is for files no Retry can repair.
  const repairableReason =
      'Catalog unavailable; retry storage. Error: Archive changed after its catalog checkpoint.',
    repairableStudy = savedStudy('window_run-repair7', {
      profile: undefined,
      outcome: 'unverified',
      metadata: 'unavailable',
      reason: repairableReason,
    })
  await library([shownStudy, repairableStudy, legacyStudy], shownStudy.id, {
    errors: [repairableReason],
  })
  await page.selectOption('#studies', repairableStudy.id)
  const repairableChosen = await page.evaluate(() => {
    const shownText = (id) =>
      document.getElementById(id)?.getClientRects().length
        ? document.getElementById(id).textContent
        : null
    return {
      deleteOnlyNote: shownText('study-unopenable'),
      repairNote: shownText('study-repairable'),
      retryVisible:
        document.querySelector('[data-action="retry"]').getClientRects()
          .length > 0,
    }
  })
  await page.selectOption('#studies', legacyStudy.id)
  const legacyChosen = await page.evaluate(() => {
    const shownText = (id) =>
      document.getElementById(id)?.getClientRects().length
        ? document.getElementById(id).textContent
        : null
    return {
      deleteOnlyNote: shownText('study-unopenable'),
      repairNote: shownText('study-repairable'),
    }
  })
  cases.push({
    name: 'a saved study whose catalog checkpoint is stale names Retry storage as its repair, and only a file no Retry can repair gets the delete-only note',
    actual: { repairableChosen, legacyChosen },
    passed:
      repairableChosen.deleteOnlyNote === null &&
      repairableChosen.repairNote ===
        "This saved study's catalog checkpoint is missing or out of date. Use Retry storage / refresh to repair it; it can also be deleted." &&
      repairableChosen.retryVisible &&
      legacyChosen.deleteOnlyNote ===
        'This saved study cannot be opened. It can still be deleted.' &&
      legacyChosen.repairNote === null,
  })

  // Retry storage is offered for what it can answer: not for a layout notice or a refused control alone.
  const retryVisible = () =>
    page.evaluate(
      () =>
        document.querySelector('[data-action="retry"]').getClientRects()
          .length > 0,
    )
  const layoutNotice =
      'Error: Existing editor groups were preserved because the editor did not retain the requested Codebook layout.',
    controlRefusal =
      'Error: Close browser replay before opening a separate Node test history.'
  await library([shownStudy], shownStudy.id, {
    errors: [layoutNotice],
    unretryableErrorCount: 1,
  })
  const retryBesideLayoutNotice = await retryVisible()
  await library([shownStudy], shownStudy.id, {
    errors: [controlRefusal],
    unretryableErrorCount: 1,
  })
  const retryBesideControlRefusal = await retryVisible()
  await library([shownStudy], shownStudy.id, {
    errors: [layoutNotice, 'Error: History not saved: disk is read-only'],
    unretryableErrorCount: 1,
  })
  const retryBesideStorageError = await retryVisible()
  cases.push({
    name: 'a layout notice or a refused control alone does not offer Retry storage; a storage error beside it does',
    actual: {
      retryBesideLayoutNotice,
      retryBesideControlRefusal,
      retryBesideStorageError,
    },
    passed:
      !retryBesideLayoutNotice &&
      !retryBesideControlRefusal &&
      retryBesideStorageError,
  })

  // A pane document that is loaded again numbers its open requests above every number of the document before it, so a late reply to an old request names no new one.
  await library([shownStudy, otherStudy], shownStudy.id)
  await page.selectOption('#studies', otherStudy.id)
  const lastRequestOfFirstDocument = await lastOpenRequest()
  await page.waitForTimeout(5)
  await page.evaluate(() => {
    window.sent = []
  })
  await page.setContent(options.html.context)
  await page.waitForFunction(() =>
    window.sent.some((message) => message.type === 'ready'),
  )
  await library([shownStudy, otherStudy], shownStudy.id)
  await page.selectOption('#studies', otherStudy.id)
  const firstRequestOfSecondDocument = await lastOpenRequest()
  cases.push({
    name: 'a pane document that is loaded again numbers its open requests above those of the document before it',
    actual: { lastRequestOfFirstDocument, firstRequestOfSecondDocument },
    passed:
      Number.isInteger(lastRequestOfFirstDocument) &&
      Number.isInteger(firstRequestOfSecondDocument) &&
      firstRequestOfSecondDocument > lastRequestOfFirstDocument,
  })
  return { cases, errors }
}

const report = {
  mode,
  qualification:
    'Real Chromium/compiled product HTML; delayed simulated host snapshots, not native acceptance.',
  compiledSha256: createHash('sha256')
    .update(await readFile('extension/dist/ui/studyHtml.js'))
    .digest('hex'),
  cases: [],
}
// The server only gives the page an address to load: the check navigates to it before it sets each document.
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><title>Codebook bootstrap verification</title>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
// The check and its fixtures reach `run-code` as one function in a file it loads itself (`--filename`): together they exceed the size a single command argument may have on Linux (E2BIG), and this script turns no text into code on its own. `run-code` wraps the file's text in parentheses, so the file is one expression without a closing semicolon; it calls that function outside Node's module system, so the check cannot import and takes everything it uses from `options`.
const flowPath = `${output}/flow.js`
let recording = false
try {
  await writeFile(
    flowPath,
    `async (page) => (${check.toString()})(page, ${JSON.stringify({
      html: { context: studyHtml('context'), moments: studyHtml('moments') },
      message,
      output,
      url: `http://127.0.0.1:${server.address().port}/`,
    })})\n`,
  )
  await command(['open', 'about:blank'], 'open')
  await command(
    [
      'run-code',
      `async page => { await page.setViewportSize({ width: 420, height: 720 }); await page.screencast.start({ path: ${JSON.stringify(`${output}/flow.webm`)}, size: { width: 420, height: 720 } }); }`,
    ],
    'video-start',
  )
  recording = true
  const result = await command(['run-code', `--filename=${flowPath}`], 'flow')
  Object.assign(
    report,
    JSON.parse(result.split('### Result\n')[1].split('\n###')[0]),
  )
  await command(
    ['run-code', 'async page => await page.screencast.stop()'],
    'video-stop',
  )
  recording = false
  assert.deepEqual(report.errors, [])
  assert.equal(
    report.cases.every((entry) => entry.passed),
    mode !== 'red',
    JSON.stringify(report.cases),
  )
} finally {
  // Preserve diagnostics and release each owned resource independently after assertions or transport failures.
  try {
    await writeFile(
      `${output}/result.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    )
  } finally {
    try {
      if (recording)
        await command(
          ['run-code', 'async page => await page.screencast.stop()'],
          'failure-video-stop',
        )
    } finally {
      try {
        await command(['close'], 'close')
      } finally {
        await new Promise((resolve) => server.close(resolve))
      }
    }
  }
}
console.log(
  JSON.stringify(
    report.cases.map((entry) => ({ name: entry.name, passed: entry.passed })),
  ),
)
