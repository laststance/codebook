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

import { runFlowKeepingCases } from './utils/runFlowKeepingCases.mjs'

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

/** How long one call of the browser CLI may take. */
const COMMAND_TIMEOUT_MS = 30_000
/** How long the call that runs the whole flow may take: every case of the check, with its viewport changes and screenshots, runs inside this one call, and the job that runs it ends after ten minutes. */
const FLOW_TIMEOUT_MS = 300_000

/** Records each owned CLI operation for delayed-snapshot renderer verification; the call labelled `flow` gets the flow's own limit. @example await command(['open', 'about:blank'], 'open') */
async function command(arguments_, label) {
  const result = await new Promise((resolve) =>
    execFile(
      'playwright-cli',
      [`-s=${session}`, ...arguments_],
      {
        timeout: label === 'flow' ? FLOW_TIMEOUT_MS : COMMAND_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      },
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

/** Exercises initial paint and replacement without host state, then releases an actual typed product model. It adds its cases and the page's errors to the lists of `collected`, which {@link runFlowKeepingCases} answers also when a step throws. @example await check(page, options, { cases: [], errors: [] }) */
async function check(page, options, collected) {
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
  const { errors } = collected
  page.on('pageerror', (error) => errors.push(String(error)))
  page.setDefaultTimeout(5_000)
  const { cases } = collected,
    publish = (message) =>
      page.evaluate(
        (message) =>
          window.dispatchEvent(new MessageEvent('message', { data: message })),
        message,
      )
  /** Reads where the replay transport's controls stand in the viewport. */
  const transportTops = () =>
    page.evaluate(() =>
      ['playback-toggle', 'previous-moment', 'next-moment', 'playhead']
        .map((id) =>
          Math.round(document.getElementById(id).getBoundingClientRect().top),
        )
        .join(','),
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
        name: 'a moment committed without native values names Show Variables first and the manual step after it, in a polite status',
        actual: await page.locator('#playback-hint').textContent(),
        passed:
          (await page.locator('#playback-hint').isVisible()) &&
          (await page.locator('#playback-hint').getAttribute('role')) ===
            'status' &&
          (await page.locator('#playback-hint').textContent()) ===
            'Recorded values for this moment are not loaded yet. Show Variables opens Run and Debug and expands them; if the first scope stays closed, expand it. If Call Stack lists several sessions, select “Codebook · Recorded learning” first.',
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
          nodeWithoutValues.hint ===
            'Recorded values for this moment are not loaded yet. Show Variables opens Run and Debug and expands them; if the first scope stays closed, expand it. If Call Stack lists several sessions, select “Codebook · Recorded learning” first.' &&
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
      // Arrange: the thumb of the Node playhead is moved and the host has not answered yet (SD-5).
      await publish(nodeTimeline)
      await page.locator('#node-history-playhead').evaluate((playhead) => {
        playhead.value = '150000'
        playhead.dispatchEvent(new Event('input', { bubbles: true }))
      })
      const spokenUnderThumb = await page
        .locator('#node-history-playhead')
        .getAttribute('aria-valuetext')
      // Act: a Study message for another reason arrives while the thumb is still held.
      await publish({ ...nodeTimeline, busy: true })
      const spokenDuringScrub = await page
        .locator('#node-history-playhead')
        .getAttribute('aria-valuetext')
      // What Chrome's own accessibility tree holds for the same thumb, beside the attribute (row NF-18, 0031-U6).
      // The tree a debugging client is given carries the role, the name and the range, and has no field for `aria-valuetext`
      // (a plain `<input type="range" aria-valuetext="…">` reads the same there), so the spoken sentence stays pinned by the case above.
      const accessibility = await page.context().newCDPSession(page)
      const { root } = await accessibility.send('DOM.getDocument')
      const { nodeId: playheadNodeId } = await accessibility.send(
        'DOM.querySelector',
        { nodeId: root.nodeId, selector: '#node-history-playhead' },
      )
      const { nodes: playheadAccessibility } = await accessibility.send(
        'Accessibility.getPartialAXTree',
        { nodeId: playheadNodeId, fetchRelatives: false },
      )
      await accessibility.detach()
      const rangeProperty = (name) =>
        playheadAccessibility[0]?.properties?.find(
          (property) => property.name === name,
        )?.value?.value
      const readFromAccessibilityTree = {
        role: playheadAccessibility[0]?.role?.value,
        name: playheadAccessibility[0]?.name?.value,
        value: playheadAccessibility[0]?.value?.value,
        minimum: rangeProperty('valuemin'),
        maximum: rangeProperty('valuemax'),
      }
      await page
        .locator('#node-history-playhead')
        .dispatchEvent('pointercancel', { bubbles: true })
      // Assert
      cases.push({
        name: 'dragging the Node playhead speaks the time under the thumb before the host answers',
        actual: { spokenUnderThumb, spokenDuringScrub },
        passed:
          spokenUnderThumb === '150.00 s of recorded test time' &&
          spokenDuringScrub === '150.00 s of recorded test time',
      })
      cases.push({
        name: 'Chrome’s accessibility tree gives the Node playhead as a slider named Recorded test time whose value is the time under the thumb',
        actual: readFromAccessibilityTree,
        passed:
          readFromAccessibilityTree.role === 'slider' &&
          readFromAccessibilityTree.name === 'Recorded test time' &&
          readFromAccessibilityTree.value === 150000 &&
          readFromAccessibilityTree.minimum === 0 &&
          readFromAccessibilityTree.maximum === 400000,
      })
      // Arrange: two events, the second one unselected, with keyboard focus on its Select event (SD-1).
      await publish({ ...twoStops, nodeHistoryPosition: nodeStop })
      const selectSecond = page.locator(
        '[data-node-history-sequence="3"]:not([data-inspect-node-history-stop])',
      )
      await selectSecond.focus()
      const eventRequestsBefore = await page.evaluate(
        () =>
          window.sent.filter((message) => message.type === 'node-history-event')
            .length,
      )
      // Act: the learner presses it, the host answers with that event selected, and the learner presses again.
      await page.keyboard.press('Enter')
      await publish({
        ...twoStops,
        nodeHistoryPosition: {
          ...nodeStop,
          sequence: 3,
          index: 1,
          eventIndex: 1,
          debuggerAvailable: false,
        },
      })
      const afterSelect = await page.evaluate(() => ({
        focusedSequence: document.activeElement?.dataset?.nodeHistorySequence,
        focusedIsInspect:
          document.activeElement?.dataset?.inspectNodeHistoryStop === 'true',
        label: document.activeElement?.textContent,
        ariaDisabled: document.activeElement?.getAttribute('aria-disabled'),
        disabled: document.activeElement?.disabled,
      }))
      await page.keyboard.press('Enter')
      const eventRequestsAfter = await page.evaluate(
        () =>
          window.sent.filter((message) => message.type === 'node-history-event')
            .length,
      )
      // Assert
      cases.push({
        name: "pressing Select event by keyboard keeps focus on that event's control and a second press sends nothing",
        actual: { afterSelect, eventRequestsBefore, eventRequestsAfter },
        passed:
          afterSelect.focusedSequence === '3' &&
          afterSelect.focusedIsInspect === false &&
          afterSelect.label === 'Selected event' &&
          afterSelect.ariaDisabled === 'true' &&
          afterSelect.disabled === false &&
          eventRequestsAfter === eventRequestsBefore + 1,
      })
      // Arrange: an output event whose text is one unbroken line of 400 characters (SD-9).
      await page.setViewportSize({ width: 300, height: 720 })
      await publish({
        ...nodeReader,
        nodeHistoryEventCount: 2,
        nodeHistory: {
          ...nodeReader.nodeHistory,
          entries: [
            {
              type: 'output',
              sequence: 1,
              channel: 'stdout',
              elapsedMs: 500,
              text: 'x'.repeat(400),
            },
            nodeReader.nodeHistory.entries[0],
          ],
        },
        nodeHistoryPosition: nodeStop,
      })
      // Act
      const cardOverflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        cardTextLength: document.querySelector('.node-history-event pre')
          .textContent.length,
      }))
      await page.setViewportSize({ width: 600, height: 800 })
      // Assert
      cases.push({
        name: 'a Node event card with one 400-character line does not widen the pane',
        actual: cardOverflow,
        passed:
          cardOverflow.cardTextLength === 400 &&
          cardOverflow.scrollWidth === cardOverflow.clientWidth,
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
      /** Measures a title: its rendered lines, whether its text is cut, and whether the keyboard reaches it. */
      const titleReading = (id) =>
        page.evaluate((titleId) => {
          const title = document.getElementById(titleId),
            range = document.createRange()
          range.selectNodeContents(title)
          return {
            lines: new Set(
              [...range.getClientRects()].map((rect) => Math.round(rect.top)),
            ).size,
            // How many line heights the heading's box is tall: two while the clamp holds.
            shownLines: Math.round(
              title.getBoundingClientRect().height /
                Number.parseFloat(getComputedStyle(title).lineHeight),
            ),
            cut: title.scrollHeight > title.clientHeight,
            tabIndex: title.getAttribute('tabindex'),
            tooltip: title.getAttribute('title'),
            focused: document.activeElement === title,
          }
        }, id)
      // Act: the long title in the narrow side bar, reached from the control before it with Tab (SD-4, DR-11).
      const clampedSummaryTitle = await titleReading('learning-title')
      await page.locator('#reader-options > summary').focus()
      await page.keyboard.press('Tab')
      const focusedSummaryTitle = await titleReading('learning-title')
      await page.locator('#reader-options > summary').focus()
      // A title that fits in two lines, in the same side bar.
      await publish(learning)
      const fittingSummaryTitle = await titleReading('learning-title')
      // Assert
      cases.push({
        name: 'in a 300 px side bar a Learning summary title longer than two lines is reached with Tab and shown whole while focused, and a title that fits is not a tab stop',
        actual: {
          clampedSummaryTitle,
          focusedSummaryTitle,
          fittingSummaryTitle,
        },
        passed:
          clampedSummaryTitle.lines > 2 &&
          clampedSummaryTitle.shownLines === 2 &&
          clampedSummaryTitle.cut &&
          clampedSummaryTitle.tabIndex === '0' &&
          focusedSummaryTitle.focused &&
          focusedSummaryTitle.shownLines === focusedSummaryTitle.lines &&
          !focusedSummaryTitle.cut &&
          fittingSummaryTitle.tabIndex === null &&
          !fittingSummaryTitle.cut,
      })

      // Arrange: a replay whose article title is longer than two lines of its heading (SD-4, the replay heading).
      const longArticleTitle =
          'How submitting the invoice form reaches the server action and updates the saved invoice',
        longHeading = {
          ...learning,
          model: {
            ...learning.model,
            progressByItem: learning.model.progressByItem.map((item) => ({
              ...item,
              title: longArticleTitle,
            })),
          },
        }
      // Act
      await publish(longHeading)
      await page.evaluate(() => window.scrollTo(0, 0))
      const clampedHeading = await titleReading('title')
      await page.locator('#title').focus()
      const focusedHeading = await titleReading('title')
      await page.locator('#reader-options > summary').focus()
      // Assert
      cases.push({
        name: 'the clamped replay heading carries its whole title as a tooltip and opens the same way',
        actual: { clampedHeading, focusedHeading },
        passed:
          clampedHeading.tooltip === longArticleTitle &&
          clampedHeading.shownLines === 2 &&
          clampedHeading.cut &&
          clampedHeading.tabIndex === '0' &&
          focusedHeading.focused &&
          focusedHeading.shownLines === focusedHeading.lines &&
          !focusedHeading.cut,
      })

      // Act: the same long Learning summary title in a wider side bar.
      await page.setViewportSize({ width: 480, height: 720 })
      const longerLearning = JSON.parse(JSON.stringify(learning))
      longerLearning.recording.learningSummary.content.title =
        'How submitting the invoice form reaches the server action, validates the amount, writes the invoice to the database and updates the saved invoice list'
      await publish(longerLearning)
      const wideSummaryTitle = await titleReading('learning-title')
      // Assert
      cases.push({
        name: 'in a side bar 480 px wide a long Learning summary title is shown whole',
        actual: wideSummaryTitle,
        passed:
          wideSummaryTitle.lines > 2 &&
          wideSummaryTitle.shownLines === wideSummaryTitle.lines &&
          !wideSummaryTitle.cut &&
          wideSummaryTitle.tabIndex === null &&
          wideSummaryTitle.tooltip ===
            'How submitting the invoice form reaches the server action, validates the amount, writes the invoice to the database and updates the saved invoice list',
      })

      // Arrange: another tab is in front of the recorded application; the moment is recorded and only hidden (NF-31, DR-19).
      await page.setViewportSize({ width: 600, height: 800 })
      const coveredLearning = {
        ...learning,
        recording: {
          ...learning.recording,
          cleared: true,
          applicationCovered: true,
        },
      }
      // Act
      await publish(coveredLearning)
      const whileCovered = await page.evaluate(() => {
        const shownText = (id) =>
          document.getElementById(id).getClientRects().length
            ? document.getElementById(id).textContent
            : null
        return {
          line: shownText('loading'),
          selectedShown:
            document.getElementById('selected').getClientRects().length > 0,
          transportStatus: shownText('recording-status'),
        }
      })
      await publish(learning)
      const afterReturnToFront = await page.evaluate(() => ({
        lineShown:
          document.getElementById('loading').getClientRects().length > 0,
        transportStatus:
          document.getElementById('recording-status').textContent,
      }))
      // Assert
      cases.push({
        name: 'while another tab covers the recorded application the Learning summary says so and names the remedy, not that the observation is loading',
        actual: { whileCovered, afterReturnToFront },
        passed:
          whileCovered.line ===
            'Recorded application is covered by another tab. Bring the Recorded application tab to the front to show this moment again.' &&
          whileCovered.selectedShown &&
          whileCovered.transportStatus ===
            'Paused · finalized · Not recorded at this moment · Recorded application is covered by another tab' &&
          !afterReturnToFront.lineShown &&
          afterReturnToFront.transportStatus ===
            'Paused · finalized · Not recorded at this moment',
      })

      // Arrange: a recorded stop declared on line 73 that the debugger bound on line 75 (SD-16, DR-28).
      const movedStop = {
        ...learning,
        model: {
          ...learning.model,
          source: {
            ...learning.model.source,
            hash: 'b'.repeat(64),
            line: 75,
          },
          sourceDeclaredLine: 73,
        },
      }
      // Act
      await publish(movedStop)
      const movedStopLabel = await page.locator('#source-version').textContent()
      await publish({
        ...movedStop,
        model: { ...movedStop.model, sourceDeclaredLine: undefined },
      })
      const unmovedStopLabel = await page
        .locator('#source-version')
        .textContent()
      // Assert
      cases.push({
        name: 'a stop the debugger moved names both its declared and its bound line',
        actual: { movedStopLabel, unmovedStopLabel },
        passed:
          movedStopLabel ===
            'Captured source · line 75 (declared on line 73) · bbbbbbbbbbbb' &&
          unmovedStopLabel === 'Captured source · line 75 · bbbbbbbbbbbb',
      })

      // Arrange: a recorded stop whose explanations are shown ahead of their saved times, beside a later annotation (Cycle 0045 cause 10).
      const explainedAhead = {
        ...learning,
        model: {
          ...learning.model,
          observation: {
            ...learning.model.observation,
            interpretations: [
              { text: 'Saved while paused.', savedLater: 'while-pause-held' },
              {
                text: 'Saved after the pause.',
                savedLater: 'after-pause-ended',
              },
              {
                text: 'Saved after the film.',
                savedLater: 'after-recording-ended',
              },
              { text: 'Saved before this time.' },
            ],
          },
        },
        recording: {
          ...learning.recording,
          laterInterpretations: [
            { text: 'A revision saved later.', availableMs: 7000 },
          ],
        },
      }
      // Act
      await publish(explainedAhead)
      const explanationNotes = await page.evaluate(() => ({
        shown: [...document.getElementById('interpretations').children].map(
          (paragraph) => `${paragraph.className}: ${paragraph.textContent}`,
        ),
        later: [
          ...document.getElementById('later-interpretations').children,
        ].map((paragraph) => paragraph.textContent),
      }))
      await publish(learning)
      // Assert
      cases.push({
        name: 'an explanation shown before its saved time is followed by the note that says when it was saved, and Later annotations holds only the other explanations',
        actual: explanationNotes,
        passed:
          JSON.stringify(explanationNotes.shown) ===
            JSON.stringify([
              'interpretation: Saved while paused.',
              'muted: This explanation was saved while this pause was held.',
              'interpretation: Saved after the pause.',
              'muted: This explanation was saved after this pause ended.',
              'interpretation: Saved after the film.',
              'muted: This explanation was saved after the recording ended.',
              'interpretation: Saved before this time.',
            ]) &&
          JSON.stringify(explanationNotes.later) ===
            JSON.stringify(['Added at 7.00 s · A revision saved later.']),
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

      // Arrange: one replay moment without its native values and the same moment with them (SD-8, T-3, SD-15).
      const withoutValues = {
          ...replay,
          revision: revisionAt(11),
          recording: { ...replay.recording, nativeValuesUninspected: true },
        },
        withValues = { ...replay, revision: revisionAt(12) }
      /** Names the element that holds the pane's focus by its id, or by its tag when it has none. */
      const focusedControl = () =>
        page.evaluate(
          () => document.activeElement.id || document.activeElement.tagName,
        )
      // Act
      await publish(withoutValues)
      const footerButton = await page.evaluate(() => {
        const style = (id) => getComputedStyle(document.getElementById(id)),
          height = (id) =>
            Math.round(
              document.getElementById(id).getBoundingClientRect().height,
            )
        return {
          showVariablesHeight: height('playback-show-variables'),
          showVariablesMinHeight: style('playback-show-variables').minHeight,
          showVariablesFontSize: style('playback-show-variables').fontSize,
          // The transport's buttons share the 32 px rule; their 16 px text makes them two pixels taller.
          playHeight: height('playback-toggle'),
          playMinHeight: style('playback-toggle').minHeight,
          hintFontSize: style('playback-hint').fontSize,
        }
      })
      // Assert
      cases.push({
        name: "Show Variables in the replay footer is as tall as the transport buttons and set in the hint's text size",
        actual: footerButton,
        passed:
          footerButton.showVariablesHeight === 32 &&
          footerButton.showVariablesMinHeight === '32px' &&
          footerButton.playMinHeight === '32px' &&
          footerButton.playHeight === 34 &&
          footerButton.showVariablesFontSize === '12px' &&
          footerButton.hintFontSize === '12px',
      })

      // Act: the same moment with and without the hint, in a side bar at two widths (T-3, ER-18).
      // The playback details opened earlier in this flow are closed again: a learner's footer starts without them.
      await page.locator('#playback-options').evaluate((details) => {
        details.open = false
      })
      const sideBarTops = {}
      for (const width of [600, 300]) {
        await page.setViewportSize({ width, height: 720 })
        await publish(withValues)
        const before = await transportTops()
        await publish(withoutValues)
        sideBarTops[width] = {
          before,
          withHint: await transportTops(),
          // The footer scrolls inside itself once it reaches its greatest height; a hint that makes it scroll would hide controls.
          footerScrolls: await page
            .locator('#recording-transport')
            .evaluate((footer) => footer.scrollHeight > footer.clientHeight),
          hintShown: await page.locator('#playback-hint').isVisible(),
          footerHeight: await page
            .locator('#recording-transport')
            .evaluate((footer) =>
              Math.round(footer.getBoundingClientRect().height),
            ),
        }
      }
      await page.setViewportSize({ width: 600, height: 800 })
      // Assert
      cases.push({
        name: "the transport's buttons do not move when the values hint appears",
        actual: sideBarTops,
        passed:
          sideBarTops[600].before === sideBarTops[600].withHint &&
          sideBarTops[600].hintShown &&
          !sideBarTops[600].footerScrolls &&
          sideBarTops[300].before === sideBarTops[300].withHint &&
          sideBarTops[300].hintShown &&
          !sideBarTops[300].footerScrolls,
      })

      // Arrange: a press on the replay thumb that moves nothing fires neither input nor change (SD-17).
      await publish(withValues)
      const playheadValue = () =>
        page.locator('#playhead').evaluate((playhead) => playhead.value)
      await page
        .locator('#playhead')
        .dispatchEvent('pointerdown', { bubbles: true })
      // Act: the host answers a keyboard seek with a new presented position.
      await publish({
        ...withValues,
        recording: { ...replay.recording, presentedMs: 3000 },
      })
      const afterPressWithoutDrag = await playheadValue()
      // A drag holds the thumb under the pointer until it ends, also when it ends without a change event.
      await page.locator('#playhead').evaluate((playhead) => {
        playhead.value = '5000'
        playhead.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await publish({
        ...withValues,
        recording: { ...replay.recording, presentedMs: 3500 },
      })
      const whileDragging = await playheadValue()
      await page
        .locator('#playhead')
        .dispatchEvent('pointercancel', { bubbles: true })
      await publish({
        ...withValues,
        recording: { ...replay.recording, presentedMs: 3600 },
      })
      const afterCancelledDrag = await playheadValue()
      // Assert
      cases.push({
        name: 'a press on the replay thumb without a drag does not stop the playhead from following a keyboard seek',
        actual: { afterPressWithoutDrag, whileDragging, afterCancelledDrag },
        passed:
          afterPressWithoutDrag === '3000' &&
          whileDragging === '5000' &&
          afterCancelledDrag === '3600',
      })

      // Arrange: keyboard focus on Show Variables (SD-15).
      await publish(withoutValues)
      await page.locator('#playback-show-variables').focus()
      // Act: the learner presses it, and the values load.
      await page.keyboard.press('Enter')
      await publish(withValues)
      // Assert
      cases.push({
        name: 'after Show Variables is pressed by keyboard and the values load, focus rests on Play, not on the document body (replay)',
        actual: await focusedControl(),
        passed: (await focusedControl()) === 'playback-toggle',
      })

      // Arrange: the same press, but the editor moved the focus to Run and Debug, so this document has none (DR-24).
      await publish(withoutValues)
      await page.locator('#playback-show-variables').focus()
      await page.keyboard.press('Enter')
      await page.evaluate(() => {
        document.hasFocus = () => false
      })
      // Act: the values load while the learner is in Run and Debug; later the learner returns to the pane.
      await publish(withValues)
      const focusWhileAway = await focusedControl()
      await page.evaluate(() => {
        delete document.hasFocus
        window.dispatchEvent(new Event('focus'))
      })
      const focusOnReturn = await focusedControl()
      // Assert
      cases.push({
        name: "when Show Variables is hidden while the pane does not have the focus, the pane's focus is on Play when the learner returns",
        actual: { focusWhileAway, focusOnReturn },
        passed:
          focusWhileAway !== 'playback-toggle' &&
          focusOnReturn === 'playback-toggle',
      })

      // Arrange: a Node test history of two stops whose first, selected stop has no native values (SD-15, the Node button).
      const nodeWithoutNativeValues = {
          ...twoStops,
          revision: revisionAt(13),
          nodeHistoryPosition: {
            ...nodeStop,
            eventIndex: 0,
            nativeValuesUninspected: true,
          },
          nodeHistoryPlayback: {
            mode: 'paused',
            sequence: 2,
            positionMs: 1200,
            startMs: 0,
            endMs: 1500,
            loading: false,
          },
        },
        nodeWithNativeValues = {
          ...nodeWithoutNativeValues,
          revision: revisionAt(14),
          nodeHistoryPosition: { ...nodeStop, eventIndex: 0 },
        }
      await publish(nodeWithoutNativeValues)
      await page.locator('#node-history-show-variables').focus()
      // Act
      await page.keyboard.press('Enter')
      await publish(nodeWithNativeValues)
      // Assert
      cases.push({
        name: 'after Show Variables is pressed by keyboard and the values load, focus rests on Play, not on the document body (Node test history)',
        actual: await focusedControl(),
        passed: (await focusedControl()) === 'node-history-playback-toggle',
      })

      // Act: Play cannot take the focus at the end of a recording (PC-3.7).
      const atRecordingEnd = {
        ...withValues,
        recording: { ...replay.recording, presentedMs: 8000 },
      }
      await publish({
        ...atRecordingEnd,
        recording: {
          ...atRecordingEnd.recording,
          nativeValuesUninspected: true,
        },
      })
      await page.locator('#playback-show-variables').focus()
      await publish(atRecordingEnd)
      const focusAtRecordingEnd = await page.evaluate(() => ({
        playDisabled: document.getElementById('playback-toggle').disabled,
        focused: document.activeElement.getAttribute('aria-label'),
      }))
      // Act: while the replay loads its next moment the toggle is Pause and stays usable.
      await publish(withoutValues)
      await page.locator('#playback-show-variables').focus()
      await publish({
        ...withValues,
        recording: {
          ...replay.recording,
          cleared: true,
          readiness: 'loading',
          requestedMs: 4000,
        },
      })
      const focusWhileLoading = await page.evaluate(() => ({
        focused: document.activeElement.id,
        label: document.activeElement.textContent,
      }))
      // Act: a Node test history with a single event, whose transport has no usable control.
      const singleEvent = {
        ...nodeReader,
        revision: revisionAt(15),
        nodeHistoryPlayback: {
          mode: 'paused',
          sequence: 2,
          positionMs: 1200,
          startMs: 1200,
          endMs: 1200,
          loading: false,
        },
      }
      await publish({
        ...singleEvent,
        nodeHistoryPosition: {
          ...nodeStop,
          eventIndex: 0,
          nativeValuesUninspected: true,
        },
      })
      await page.locator('#node-history-show-variables').focus()
      await publish({
        ...singleEvent,
        nodeHistoryPosition: { ...nodeStop, eventIndex: 0 },
      })
      const focusWithSingleEvent = await page.evaluate(() => ({
        transportDisabled: [
          'node-history-playback-toggle',
          'node-history-playhead',
          'node-history-moment-previous',
          'node-history-moment-next',
        ].every((id) => document.getElementById(id).disabled),
        focused: document.activeElement.textContent,
        focusedSequence: document.activeElement.dataset.nodeHistorySequence,
      }))
      // Assert
      cases.push({
        name: "when Play cannot be used as Show Variables leaves, focus goes to the first transport control that can: at the end of a recording and while a moment loads; in a history with a single event it goes to that event's own control",
        actual: {
          focusAtRecordingEnd,
          focusWhileLoading,
          focusWithSingleEvent,
        },
        passed:
          focusAtRecordingEnd.playDisabled &&
          focusAtRecordingEnd.focused === 'Replay from start' &&
          focusWhileLoading.focused === 'playback-toggle' &&
          focusWhileLoading.label === 'Pause' &&
          focusWithSingleEvent.transportDisabled &&
          focusWithSingleEvent.focused === 'Selected event' &&
          focusWithSingleEvent.focusedSequence === '2',
      })
      await publish({ ...replay, revision: revisionAt(10) })
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
      // Arrange: the bottom panel's transport starts at the panel's top, so its hint stands below the controls (T-3, ER-18).
      const panelReplay = {
        ...options.message,
        revision: revisionAt(7),
        contentTab: 'recording',
        playbackPanelVisible: true,
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
      await publish(panelReplay)
      await page.evaluate(() => window.scrollTo(0, 0))
      const panelTopsBefore = await transportTops()
      // Act
      await publish({
        ...panelReplay,
        recording: { ...panelReplay.recording, nativeValuesUninspected: true },
      })
      const panelTopsWithHint = await transportTops(),
        panelHintBelowControls = await page.evaluate(
          () =>
            document.getElementById('playback-hint').getBoundingClientRect()
              .top >
            document.getElementById('playback-toggle').getBoundingClientRect()
              .bottom,
        )
      // Assert
      cases.push({
        name: "in the bottom panel the transport's buttons do not move when the values hint appears",
        actual: { panelTopsBefore, panelTopsWithHint, panelHintBelowControls },
        passed: panelTopsBefore === panelTopsWithHint && panelHintBelowControls,
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
  // Arrange: a fresh document in a page that has the focus (NF-17: the host has no other way to learn the pane's focus).
  const focusReports = () =>
    page.evaluate(() =>
      window.sent
        .filter((message) => message.type === 'pane-focus')
        .map((message) => message.focused),
    )
  const reportsAtLoad = await focusReports()
  // Act: the document loses the focus (the learner goes to another part of the editor) and gains it again.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  const reportsAfterLeaving = await focusReports()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  const reportsAfterReturning = await focusReports()
  // Assert
  cases.push({
    name: 'the pane reports to the host when its document gains and when it loses the keyboard focus',
    actual: { reportsAtLoad, reportsAfterLeaving, reportsAfterReturning },
    passed:
      JSON.stringify(reportsAtLoad) === JSON.stringify([true]) &&
      JSON.stringify(reportsAfterLeaving) === JSON.stringify([true, false]) &&
      JSON.stringify(reportsAfterReturning) ===
        JSON.stringify([true, false, true]),
  })
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
        listDescribedBy: list.getAttribute('aria-describedby'),
        reason: shownText('delete-study-reason'),
        note: shownText('study-unopenable'),
        repairNote: shownText('study-repairable'),
        newerNote: shownText('study-newer'),
        repairVisible: visible('repair-study'),
        // The files a window without a Trash lists for removal by hand; null while the list is hidden.
        files: visible('study-files')
          ? [...document.querySelectorAll('#study-files-list li')].map(
              (item) => item.textContent,
            )
          : null,
        status: status.textContent,
        statusIsError: status.classList.contains('error'),
        statusRole: `${status.getAttribute('role')}/${status.getAttribute('aria-live')}`,
        focus: document.activeElement.id,
        deletes: sent('delete-study').map((message) => [
          message.studyId,
          message.revision,
        ]),
        histories: sent('history').length,
        removalRequests: sent('delete-study').map(
          (message) => message.removalRequest,
        ),
        copies: sent('copy-study-files').map((message) => message.studyId),
        retries: sent('action').filter((message) => message.action === 'retry')
          .length,
      }
    })
  /** Reads the number the pane gave its last delete request. */
  const lastRemovalRequest = () =>
    page.evaluate(
      () =>
        window.sent.findLast((message) => message.type === 'delete-study')
          ?.removalRequest,
    )
  /** Gives a removal state the number of the pane's last delete request, as the host does in every state of the removal that request started or was refused with. */
  const answering = async (removal) => ({
    ...removal,
    request: await lastRemovalRequest(),
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
          ['', true],
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
    studyRemoval: await answering(confirming),
  })
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: await answering(movingShown),
  })
  await library([otherStudy], otherStudy.id, {
    studyRemoval: await answering(movedShown),
  })
  const afterOwnRemoval = await removalControl()
  await page
    .locator('#saved-studies')
    .screenshot({ path: `${options.output}/saved-studies-moved.png` })
  // This pane asks and the learner cancels: the field is cleared and focus stays on the button.
  await library([shownStudy, otherStudy], shownStudy.id)
  await deleteButton.click()
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: await answering(confirming),
  })
  await library([shownStudy, otherStudy], shownStudy.id)
  const afterCancel = await removalControl()
  // This pane asks and the host refuses at once.
  await deleteButton.click()
  await page.evaluate(() => document.activeElement.blur())
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: await answering({
      status: 'refused',
      studyId: shownStudy.id,
      text: 'Stop the run before deleting its study.',
    }),
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
    studyRemoval: await answering(confirming),
  })
  await library([otherStudy], otherStudy.id, {
    studyRemoval: await answering(movedShown),
  })
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
    studyRemoval: await answering(movingShown),
  })
  await library([otherStudy], otherStudy.id, {
    studyRemoval: await answering(movedShown),
  })
  const afterNewRequestWasAnswered = await removalControl()
  cases.push({
    name: 'a refusal that was already shown does not answer a new delete request: focus moves to the list only when the new removal has ended',
    actual: { whileNewRequestWaits, afterNewRequestWasAnswered },
    passed:
      whileNewRequestWaits.focus === 'delete-study' &&
      afterNewRequestWasAnswered.focus === 'studies' &&
      afterNewRequestWasAnswered.chosen === otherStudy.id,
  })

  // Arrange: a current-format entry whose catalog checkpoint is stale can be repaired; the delete-only note is for files no repair reaches (CX-D1, DR-25).
  const repairableReason =
      'Catalog unavailable; retry storage. Error: Archive changed after its catalog checkpoint.',
    repairableStudy = savedStudy('window_run-repair7', {
      profile: undefined,
      outcome: 'unverified',
      metadata: 'unavailable',
      reason: repairableReason,
    }),
    repairButton = page.getByRole('button', {
      name: 'Repair saved study',
      exact: true,
    })
  await library([shownStudy, repairableStudy, legacyStudy], shownStudy.id, {
    errors: [repairableReason],
  })
  await page.selectOption('#studies', repairableStudy.id)
  const repairableChosen = await removalControl(),
    repairButtons = await repairButton.count()
  const repairLayout = await page.evaluate(() => {
    const box = (id) => document.getElementById(id).getBoundingClientRect()
    return {
      // The repair button stands in the row directly under its note, before the delete button.
      noteToRowGap: Math.round(
        box('delete-study-row').top - box('study-repairable').bottom,
      ),
      repairBeforeDelete: box('repair-study').left < box('delete-study').left,
      sameRow: box('repair-study').top === box('delete-study').top,
      repairDescribedBy: document
        .getElementById('repair-study')
        .getAttribute('aria-describedby'),
    }
  })
  await page
    .locator('#saved-studies')
    .screenshot({ path: `${options.output}/saved-studies-repair.png` })
  // Act: the learner presses the repair button by keyboard, and the host answers with the repaired entry.
  // Focused by its id, so a button that is not offered is a failed case instead of a harness timeout.
  await page.locator('#repair-study').focus()
  await page.keyboard.press('Enter')
  const afterRepairPress = await removalControl()
  await library(
    [
      shownStudy,
      { ...repairableStudy, metadata: 'validated', reason: undefined },
      legacyStudy,
    ],
    shownStudy.id,
  )
  const afterRepair = await removalControl()
  await page.selectOption('#studies', legacyStudy.id)
  const legacyChosen = await removalControl()
  // Assert
  cases.push({
    name: 'a saved study whose checkpoint can be repaired offers Repair saved study under its note, and pressing it asks the host to retry',
    actual: {
      repairableChosen,
      repairButtons,
      repairLayout,
      afterRepairPress,
      afterRepair,
      legacyChosen,
    },
    passed:
      repairButtons === 1 &&
      repairableChosen.note === null &&
      repairableChosen.repairNote ===
        "This saved study's catalog checkpoint is missing or out of date. Repair it, or delete the study." &&
      repairableChosen.repairVisible &&
      repairLayout.repairBeforeDelete &&
      repairLayout.sameRow &&
      repairLayout.repairDescribedBy === 'study-repairable' &&
      afterRepairPress.retries === repairableChosen.retries + 1 &&
      afterRepairPress.focus === 'repair-study' &&
      // The button left with its note: the keyboard focus is on the list, not on the document body (PC-3.10).
      afterRepair.repairNote === null &&
      !afterRepair.repairVisible &&
      afterRepair.focus === 'studies' &&
      legacyChosen.note ===
        'This saved study cannot be opened. It can still be deleted.' &&
      legacyChosen.repairNote === null &&
      !legacyChosen.repairVisible,
  })

  // Arrange: the same three entries, to measure the notes above the delete row (SD-3).
  await library([shownStudy, repairableStudy, legacyStudy], shownStudy.id)
  const gapAboveDeleteRow = (noteId) =>
    page.evaluate(
      (id) =>
        Math.round(
          document.getElementById('delete-study-row').getBoundingClientRect()
            .top - document.getElementById(id).getBoundingClientRect().bottom,
        ),
      noteId,
    )
  // Act
  await page.selectOption('#studies', repairableStudy.id)
  const repairNoteGap = await gapAboveDeleteRow('study-repairable')
  await page.selectOption('#studies', legacyStudy.id)
  const deleteOnlyNoteGap = await gapAboveDeleteRow('study-unopenable')
  // Assert
  cases.push({
    name: 'the repair note of a saved study sits 8 px above the delete row, like the delete-only note',
    actual: { repairNoteGap, deleteOnlyNoteGap },
    passed: repairNoteGap === 8 && deleteOnlyNoteGap === 8,
  })

  // Act: each kind of chosen entry, read for what describes the list and the delete button (SD-7).
  await page.selectOption('#studies', repairableStudy.id)
  const describedWhileRepairable = await removalControl()
  await page.selectOption('#studies', legacyStudy.id)
  const describedWhileUnopenable = await removalControl()
  await library([shownStudy, repairableStudy], shownStudy.id)
  const describedWhileOpenable = await removalControl()
  // Assert
  cases.push({
    name: 'a saved study that can be repaired or cannot be opened is described to the list and to the delete button by its note',
    actual: {
      describedWhileRepairable,
      describedWhileUnopenable,
      describedWhileOpenable,
    },
    passed:
      describedWhileRepairable.listDescribedBy === 'study-repairable' &&
      describedWhileRepairable.describedBy ===
        'study-repairable delete-study-reason delete-study-status' &&
      describedWhileUnopenable.listDescribedBy === 'study-unopenable' &&
      describedWhileUnopenable.describedBy ===
        'study-unopenable delete-study-reason delete-study-status' &&
      describedWhileOpenable.chosen === shownStudy.id &&
      describedWhileOpenable.listDescribedBy === null &&
      describedWhileOpenable.describedBy ===
        'delete-study-reason delete-study-status',
  })

  // Arrange: a study a newer Codebook saved, listed with the catalog's sentence as its reason (RT-1, DX-15).
  const newerSentence =
      'This study was saved in format 6 by a newer Codebook; this Codebook reads formats up to 4. Update the extension to open it. The study is kept as it is.',
    newerStudy = savedStudy('window_run-newer08', {
      profile: undefined,
      format: 'newer',
      outcome: 'Saved by a newer Codebook; kept as it is',
      metadata: 'unavailable',
      reason: newerSentence,
    })
  await library([shownStudy, newerStudy], shownStudy.id)
  const deletesBeforeNewer = (await removalControl()).deletes.length
  // Act
  await page.selectOption('#studies', newerStudy.id)
  await deleteButton.click({ force: true })
  const newerChosen = await removalControl()
  // Assert
  cases.push({
    name: 'a saved study of a newer format is listed with the sentence that names both formats as its note, offers no repair and says why it cannot be deleted here',
    actual: newerChosen,
    passed:
      newerChosen.chosen === newerStudy.id &&
      newerChosen.newerNote === newerSentence &&
      newerChosen.note === null &&
      newerChosen.repairNote === null &&
      !newerChosen.repairVisible &&
      newerChosen.listDescribedBy === 'study-newer' &&
      newerChosen.describedBy ===
        'study-newer delete-study-reason delete-study-status' &&
      newerChosen.ariaDisabled === 'true' &&
      newerChosen.reason ===
        'This study was saved by a newer Codebook and is kept as it is. Update the extension, then delete it there.' &&
      newerChosen.deletes.length === deletesBeforeNewer,
  })

  // Arrange: a removal that leaves other studies while the host shows none of them (SD-6).
  await library([shownStudy, otherStudy], shownStudy.id)
  await deleteButton.click()
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: await answering(movingShown),
  })
  // Act
  await library([otherStudy], undefined, {
    studyRemoval: await answering(movedShown),
  })
  const noneChosenAfterRemoval = await removalControl()
  const promptOption = await page
    .locator('#studies option')
    .first()
    .evaluate((option) => ({
      value: option.value,
      disabled: option.disabled,
      // Left out of the open list.
      rendered: getComputedStyle(option).display !== 'none',
    }))
  // Assert
  cases.push({
    name: 'after a removal that leaves other studies and none chosen, the list reads Choose a saved study instead of a blank',
    actual: { noneChosenAfterRemoval, promptOption },
    passed:
      noneChosenAfterRemoval.chosen === '' &&
      noneChosenAfterRemoval.shownText === 'Choose a saved study' &&
      noneChosenAfterRemoval.focus === 'studies' &&
      JSON.stringify(noneChosenAfterRemoval.options) ===
        JSON.stringify([
          ['', true],
          [otherStudy.id, false],
        ]) &&
      promptOption.value === '' &&
      promptOption.disabled &&
      !promptOption.rendered,
  })

  // Arrange: a delete request the host refuses, shown under the button (A-L5, AD-14, DR-26).
  const sameRefusal = {
    status: 'refused',
    studyId: shownStudy.id,
    text: 'Stop the run before deleting its study.',
  }
  await library([shownStudy, otherStudy], shownStudy.id)
  await deleteButton.focus()
  await page.keyboard.press('Enter')
  const firstRemovalRequest = await lastRemovalRequest()
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: { ...sameRefusal, request: firstRemovalRequest },
  })
  // Act: the learner asks again and leaves the button; the host refuses with the same sentence under the new number.
  await page.keyboard.press('Enter')
  const secondRemovalRequest = await lastRemovalRequest()
  await page.evaluate(() => document.activeElement.blur())
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: { ...sameRefusal, request: firstRemovalRequest },
    busy: true,
  })
  const whileSecondRequestWaits = await removalControl()
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: { ...sameRefusal, request: secondRemovalRequest },
  })
  const afterSecondRefusal = await removalControl()
  // A refusal for that study that answers another pane's request arrives later.
  await page.evaluate(() => document.activeElement.blur())
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: { ...sameRefusal, request: secondRemovalRequest + 1 },
  })
  const afterLaterRefusal = await removalControl()
  // Assert
  cases.push({
    name: 'a second refusal with the same sentence answers the new delete request: a later refusal for that study moves no focus',
    actual: {
      firstRemovalRequest,
      secondRemovalRequest,
      whileSecondRequestWaits,
      afterSecondRefusal,
      afterLaterRefusal,
    },
    passed:
      Number.isInteger(firstRemovalRequest) &&
      secondRemovalRequest === firstRemovalRequest + 1 &&
      whileSecondRequestWaits.focus === '' &&
      afterSecondRefusal.focus === 'delete-study' &&
      afterSecondRefusal.status === 'Stop the run before deleting its study.' &&
      afterLaterRefusal.focus === '' &&
      afterLaterRefusal.status === 'Stop the run before deleting its study.',
  })

  // Arrange: a window without a Trash (a WSL remote window); the host names a study's files only in its answer to a delete request (RT-7, DR-14).
  const withoutTrash = { removalWithoutTrash: true },
    withoutTrashSentence =
      "This window has no Trash, so Codebook cannot delete a saved study here. Remove this study's files by hand (listed below), then press Retry storage / refresh.",
    studyFiles = [
      '/home/learner/.config/Code/User/workspaceStorage/0123/laststance.codebook/recordings/window_run-shown01',
      '/home/learner/.config/Code/User/workspaceStorage/0123/laststance.codebook/studies/window_run-shown01.study.v4.json',
      '/home/learner/.config/Code/User/workspaceStorage/0123/laststance.codebook/studies/window_run-shown01.study.v4.meta.json',
    ],
    otherStudyFile =
      '/home/learner/.config/Code/User/workspaceStorage/0123/laststance.codebook/studies/window_run-other02.study.v4.json'
  await library([otherStudy], undefined, withoutTrash)
  const withoutTrashNothingChosen = await removalControl()
  // Act: the host shows a study; the pane asks once for its files, and the host answers.
  await library([shownStudy, otherStudy], shownStudy.id, withoutTrash)
  const askedForFiles = await removalControl()
  const filesAnswer = await answering({
    status: 'refused',
    studyId: shownStudy.id,
    text: withoutTrashSentence,
    files: studyFiles,
  })
  await library([shownStudy, otherStudy], shownStudy.id, {
    ...withoutTrash,
    studyRemoval: filesAnswer,
    studyFiles: { [shownStudy.id]: studyFiles },
  })
  await library([shownStudy, otherStudy], shownStudy.id, {
    ...withoutTrash,
    studyRemoval: filesAnswer,
    studyFiles: { [shownStudy.id]: studyFiles },
    busy: true,
  })
  const filesListed = await removalControl()
  // Another pane asked for the other study's files: the removal state answers that request, and the host keeps both lists by study.
  await library([shownStudy, otherStudy], shownStudy.id, {
    ...withoutTrash,
    studyRemoval: {
      status: 'refused',
      studyId: otherStudy.id,
      text: withoutTrashSentence,
      files: [otherStudyFile],
      request: 1,
    },
    studyFiles: {
      [shownStudy.id]: studyFiles,
      [otherStudy.id]: [otherStudyFile],
    },
  })
  const besideAnotherPanesAnswer = await removalControl()
  await page
    .locator('#saved-studies')
    .screenshot({ path: `${options.output}/saved-studies-without-trash.png` })
  await page.getByRole('button', { name: 'Copy path', exact: true }).click()
  await page.locator('#study-files [data-action="retry"]').click()
  const afterCopyAndRetry = await removalControl()
  const retryBesideFiles = await page
    .locator('#study-files [data-action="retry"]')
    .evaluate((control) => ({
      label: control.textContent,
      visible: control.getClientRects().length > 0,
    }))
  // Assert
  cases.push({
    name: "in a window without a Trash, Saved studies names the chosen study's files, offers Copy path and shows no delete button",
    actual: {
      withoutTrashNothingChosen,
      askedForFiles,
      filesListed,
      besideAnotherPanesAnswer,
      afterCopyAndRetry,
      retryBesideFiles,
    },
    passed:
      !withoutTrashNothingChosen.buttonVisible &&
      withoutTrashNothingChosen.reason ===
        'This window has no Trash, so Codebook cannot delete a saved study here. Choose a saved study to list its files for removal by hand.' &&
      withoutTrashNothingChosen.files === null &&
      withoutTrashNothingChosen.deletes.length ===
        afterLaterRefusal.deletes.length &&
      // One numbered request for the shown study's files, sent by the pane itself.
      askedForFiles.deletes.length === afterLaterRefusal.deletes.length + 1 &&
      askedForFiles.deletes.at(-1)[0] === shownStudy.id &&
      Number.isInteger(askedForFiles.removalRequests?.at(-1)) &&
      !filesListed.buttonVisible &&
      filesListed.reason === null &&
      filesListed.status === withoutTrashSentence &&
      !filesListed.statusIsError &&
      JSON.stringify(filesListed.files) === JSON.stringify(studyFiles) &&
      // A later Study message with the answer asks nothing again.
      filesListed.deletes.length === askedForFiles.deletes.length &&
      // The answer to another pane's request leaves this pane's list as it is, and this pane asks nothing again.
      JSON.stringify(besideAnotherPanesAnswer.files) ===
        JSON.stringify(studyFiles) &&
      besideAnotherPanesAnswer.deletes.length ===
        askedForFiles.deletes.length &&
      JSON.stringify(afterCopyAndRetry.copies) ===
        JSON.stringify([shownStudy.id]) &&
      afterCopyAndRetry.retries === filesListed.retries + 1 &&
      retryBesideFiles.label === 'Retry storage / refresh' &&
      retryBesideFiles.visible,
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
  // Arrange: a page of the Wiki reader at 720 px, where its right rail is a row (701 to 1000 px) and an outline entry that cannot break leaves the row short of room.
  await page.setViewportSize({ width: 720, height: 720 })
  await page.goto(options.url)
  await page.setContent(options.wikiShell)
  // Act: the open control's label is measured line by line, the outline by its width.
  const railRow = await page.evaluate(() => {
    const openLink = document.querySelector('.open-in-editor a')
    const label = document.createRange()
    label.selectNodeContents(openLink)
    return {
      railDisplay: getComputedStyle(document.querySelector('.right-rail'))
        .display,
      // A range answers one box per line of its text.
      openLabelLines: label.getClientRects().length,
      openControlWidth: Math.round(openLink.getBoundingClientRect().width),
      outlineWidth: Math.round(
        document.querySelector('.right-rail nav').getBoundingClientRect().width,
      ),
    }
  })
  await page
    .locator('.right-rail')
    .screenshot({ path: `${options.output}/wiki-rail-row.png` })
  // Assert
  cases.push({
    name: 'in the Wiki reader at 720 px the open control of the right rail keeps its label on one line, and the outline is no narrower than it',
    actual: railRow,
    passed:
      railRow.railDisplay === 'flex' &&
      railRow.openLabelLines === 1 &&
      railRow.outlineWidth >= railRow.openControlWidth,
  })
  // Arrange: the same page at 960 px with the sentence of a refused update in the panel, as the owned clone's native check W-3 showed it (about 300 characters in a 288 px panel).
  await page.setViewportSize({ width: 960, height: 720 })
  await page.goto(options.url)
  await page.setContent(options.wikiShell)
  // Act: the rail's content is measured against the rail's own box.
  const railStrip = await page.evaluate(() => {
    document.querySelector('[data-codebook-update-status]').innerHTML =
      '<strong>Update failed</strong> at 11:05 AM: An earlier chat or another editor window appears to be updating this Wiki (candidate wiki.stage-c34c9bc0-55bd-4a45-9bc0-eecfaa647e2b, written 11:04 AM GMT+9). Codebook waits for it until 11:19 AM GMT+9. If that chat was stopped, choose Update anyway in the editor’s notification. The last usable site is kept.'
    const rail = document.querySelector('.right-rail')
    const railBox = rail.getBoundingClientRect()
    const groupBox = document
      .querySelector('[data-codebook-update-group]')
      .getBoundingClientRect()
    return {
      railDisplay: getComputedStyle(rail).display,
      railHeight: Math.round(railBox.height),
      railScrollHeight: rail.scrollHeight,
      groupBottomBelowRailBottom: Math.round(groupBox.bottom - railBox.bottom),
    }
  })
  await page
    .locator('.right-rail')
    .screenshot({ path: `${options.output}/wiki-rail-refusal-960.png` })
  // Assert
  cases.push({
    name: 'in the Wiki reader at 960 px the update panel shows the whole sentence of a refused update, with no scroll in the right rail',
    actual: railStrip,
    passed:
      railStrip.railDisplay === 'flex' &&
      railStrip.railScrollHeight <= railStrip.railHeight &&
      railStrip.groupBottomBelowRailBottom <= 0,
  })
}

/**
 * Fills the Wiki reader's shell the way the publisher does for one page, so the check can lay out the right rail without a published Wiki.
 * @param shell - The text of `skills/codebook/reader-shell.html`.
 * @returns The page: every field of the shell replaced, with an outline entry that cannot break and the open control the publisher prints.
 * @throws When the shell names a field this page has no text for, so a new field cannot reach the browser as `{{FIELD}}`.
 * @example
 * wikiShellPage('<title>{{TITLE}}</title>') // => '<title>Overview</title>'
 */
function wikiShellPage(shell) {
  const fields = {
    TITLE: 'Overview',
    REPOSITORY: 'sample',
    DATE: '5 Oct 2026',
    REVISION: 'a1b2c3d',
    ROOT: '/home/learner/sample',
    FULL_REVISION: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    INDEX_TIME: '5 Oct 2026, 12:00',
    SOURCE_COUNT: '12',
    EXCLUSIONS: 'none',
    OUTPUT: '/home/learner/sample/.codebook/wiki',
    OUTPUT_LABEL: '.codebook/wiki',
    NAVIGATION:
      '<ul><li><a href="index.html" aria-current="page">Overview</a></li></ul>',
    SOURCES: '<li>src/a.ts</li>',
    ARTICLE: '<h2 id="rendering">Rendering</h2><p>How a page is rendered.</p>',
    UPDATE: '#update',
    OUTLINE:
      '<li><a href="#rendering">Rendering</a></li><li><a href="#preparation">createConfiguredBrowserRunPreparationForReplay</a></li>',
    OPEN_SOURCE:
      '<p class="open-in-editor"><a href="#source">Open in VS Code</a></p>',
    SETTINGS: '#settings',
  }
  return shell.replace(/\{\{([A-Z_]+)\}\}/g, (field, name) => {
    assert.ok(Object.hasOwn(fields, name), `no text for the field ${field}`)
    return fields[name]
  })
}

const report = {
  mode,
  qualification:
    'Real Chromium/compiled product HTML; delayed simulated host snapshots, not native acceptance.',
  compiledSha256: createHash('sha256')
    .update(await readFile(new URL('../dist/ui/studyHtml.js', import.meta.url)))
    .digest('hex'),
  cases: [],
}
// The server only gives the page an address to load: the check navigates to it before it sets each document.
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><title>Codebook bootstrap verification</title>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
// The check and its fixtures reach `run-code` as one function in a file it loads itself (`--filename`): together they exceed the size a single command argument may have on Linux (E2BIG), and this script turns no text into code on its own. `run-code` wraps the file's text in parentheses, so the file is one expression without a closing semicolon; it calls that function outside Node's module system, so the check cannot import and takes everything it uses from `options`. The check runs inside {@link runFlowKeepingCases}, whose text is written into the same file: a step that throws then ends as one failed case after the cases that passed, instead of a call without a result.
const flowPath = `${output}/flow.js`
let recording = false
try {
  await writeFile(
    flowPath,
    `async (page) => (${runFlowKeepingCases.toString()})(${check.toString()}, page, ${JSON.stringify(
      {
        html: { context: studyHtml('context'), moments: studyHtml('moments') },
        wikiShell: wikiShellPage(
          await readFile(
            new URL('../skills/codebook/reader-shell.html', import.meta.url),
            'utf8',
          ),
        ),
        message,
        output,
        url: `http://127.0.0.1:${server.address().port}/`,
      },
    )})\n`,
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
