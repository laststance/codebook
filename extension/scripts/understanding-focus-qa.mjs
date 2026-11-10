import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

import { projectStudy } from '../dist/studyModel.js'
import { createConfiguredStudy } from '../dist/tests/utils/createConfiguredStudy.js'
import { repositoryHtml } from '../dist/ui/repositoryHtml.js'
import { studyHtml } from '../dist/ui/studyHtml.js'
import { citationLearningState } from '../dist/utils/citationLearningState.js'
import { decodeLearnerProgress } from '../dist/utils/decodeLearnerProgress.js'
import { selectStudy } from '../dist/utils/selectStudy.js'

import { readerDomCommandOptions } from './utils/readerDomCommandOptions.mjs'
import { readerDomFlowText } from './utils/readerDomFlowText.mjs'
import { readerDomSessionName } from './utils/readerDomSessionName.mjs'

// Real Chromium verifies focus and default checkbox activation of the understanding checkbox in the Study pane and in the Repository Wiki pane, and of the per-step check (I understand this step) in a browser replay's selected-step block and in a Node family's replay section; the serialized host bridge is intentionally simulated.
const [mode = 'verify', outputPath = 'artifacts/understanding-dom'] =
  process.argv.slice(2)
assert.ok(['red', 'verify'].includes(mode))
const output = resolve(outputPath),
  session = readerDomSessionName('understanding', mode, output)
await mkdir(output, { recursive: true })
const study = createConfiguredStudy(),
  descriptor = study.descriptor
const progress = decodeLearnerProgress(
  {
    version: 4,
    workspaceKey: study.workspaceKey,
    decisions: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        item: descriptor.itemId,
        sourceHash: study.configuration.source.hash,
        context: descriptor.citationContext,
        understood: true,
        at: '2026-09-20T00:00:01.000Z',
      },
    ],
  },
  study.workspaceKey,
)
const sources = descriptor.sources.map((source) => ({
  path: source.path,
  hash: source.hash,
  currentHash: source.hash,
  status: 'current',
}))
const baseline = {
  text: '',
  hash: '0'.repeat(64),
  line: 1,
  path: '/fixture/unused.mts',
}
const studyMessage = {
  type: 'study',
  revision: 1,
  model: projectStudy({
    study,
    selection: { ...selectStudy(study), tab: 'live' },
    progress,
    baselines: { server: baseline, browser: baseline },
    citationSources: sources,
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
  // Without a presentation the Study pane keeps its content hidden, and the checkbox with it.
  presentation: {
    presentationId: '11111111-1111-4111-8111-111111111111',
    presentationControlRevision: 1,
    mode: 'study-workspace',
    state: 'open',
    layoutConfirmed: true,
    preference: { status: 'default' },
    panes: {},
  },
}
// The per-step checks: a browser replay's selected-step block and a Node family's replay section, each with two steps whose first is marked understood.
const STEP_STUDY_ID =
  '11111111-1111-4111-8111-111111111111_22222222-2222-4222-8222-222222222222'
const stepViewOf = (ids) => ({
  studyId: STEP_STUDY_ID,
  status: 'ready',
  steps: ids.map((stepId, index) => ({
    stepId,
    understood: index === 0,
    ...(index === 0 ? { at: '2026-11-10T01:02:03.000Z' } : {}),
    reviewNeeded: false,
    saving: false,
  })),
  understoodCount: 1,
  selectableCount: ids.length,
})
const stepContent = (ids) => ({
  question: 'How does the theme change?',
  title: 'Theme change',
  summary: 'The control applies the theme.',
  participants: [
    { id: 'control', label: 'Control' },
    { id: 'interface', label: 'Interface' },
  ],
  steps: ids.map((id) => ({
    id,
    from: 'control',
    to: 'interface',
    label: `Step ${id}`,
    explanation: `Explains ${id}.`,
    evidence: 'observed',
  })),
})
const browserStepIds = ['select', 'apply']
const observedSnapshotUri =
  studyMessage.model.observation?.snapshotUri ?? 'codebook://recorded-stop'
const browserStepMessage = {
  ...studyMessage,
  contentTab: 'recording',
  recording: {
    revision: 1,
    studyId: STEP_STUDY_ID,
    mode: 'paused',
    readiness: 'ready',
    presentedMs: 2000,
    range: { startMs: 0, endMs: 8000, endKnown: true },
    recordingStatus: 'finalized',
    learningSummary: {
      explanationId: '44444444-4444-4444-8444-444444444444',
      createdAt: '2026-11-10T00:00:00.000Z',
      content: {
        ...stepContent(browserStepIds),
        steps: stepContent(browserStepIds).steps.map((step) => ({
          ...step,
          reference: {
            snapshotUri: observedSnapshotUri,
            sourceHash: study.configuration.source.hash,
          },
        })),
      },
      positions: browserStepIds.map((stepId) => ({ stepId, elapsedMs: 2000 })),
    },
  },
  stepUnderstanding: stepViewOf(browserStepIds),
}
const nodeStepIds = ['read', 'keep']
const nodeStepMessage = {
  ...studyMessage,
  replayFamily: 'test',
  nodeHistoryEventCount: 0,
  nodeHistory: {
    header: { studyId: STEP_STUDY_ID },
    status: 'complete',
    entries: [],
  },
  nodeHistoryLearningSummary: {
    content: stepContent(nodeStepIds),
    positions: [],
  },
  nodeHistoryPosition: { sequence: 2, eventIndex: 0 },
  nodeHistorySection: {
    status: 'Test passed · exit code 0 · capture complete',
    position: 'Stop 1 of 1 · 1.20 s',
    pointer: 'Output up to this moment is in the Application pane.',
    applicationClosed: false,
    sameMomentStepIds: [],
    stepActions: {},
    events: 'Events (0)',
    verdict: 'Test passed · exit code 0',
    previousStop: false,
    nextStop: false,
    selectedStepId: 'read',
  },
  stepUnderstanding: stepViewOf(nodeStepIds),
}
const repositoryMessage = {
  type: 'repository',
  revision: 1,
  saving: false,
  loading: false,
  catalog: [
    {
      bookId: 'interface',
      revision: 1,
      title: 'Interface',
      firstNodeId: 'theme',
      revisions: [1],
      status: 'available',
    },
  ],
  selection: {
    bookId: 'interface',
    revision: 1,
    nodeId: 'theme',
    anchorIndex: 0,
  },
  sources,
  understanding: citationLearningState(
    progress,
    descriptor.itemId,
    descriptor.anchors,
  ),
  book: {
    bookId: 'interface',
    latestRevision: 1,
    links: [],
    revision: {
      revision: 1,
      publishedAt: '2026-09-20T00:00:00.000Z',
      document: {
        title: 'Interface',
        summary: 'Understanding is an explicit learner decision.',
        edges: [],
        nodes: [
          {
            id: 'theme',
            title: 'Theme',
            anchors: descriptor.anchors,
            observations: [],
            sections: [
              {
                title: 'Source',
                text: 'Read the captured theme before marking understanding.',
              },
            ],
          },
        ],
      },
    },
  },
}

/** Runs one bounded CLI command and rejects transport errors before parsing QA evidence; it does not block, because the page it drives is loaded from this process's own server. {@link readerDomCommandOptions} gives the call labelled `flow` the flow's own limit. @example await command(['open', 'about:blank'], 'open') */
async function command(arguments_, label) {
  const result = await new Promise((resolve) =>
    execFile(
      'playwright-cli',
      [`-s=${session}`, ...arguments_],
      readerDomCommandOptions(label),
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

/** Exercises real Space/pointer input around delayed host snapshots without fabricating browser focus, once in each pane that has an understanding checkbox. It adds its cases and the page's errors to the lists of `collected`, which {@link runFlowKeepingCases} answers. @example await check(page, { panes: [{ name: 'the Study pane', id: 'understood', html, message }], output, url }, { cases: [], errors: [] }) */
async function check(page, options, collected) {
  page.on('pageerror', (error) => collected.errors.push(String(error)))
  for (const pane of options.panes) {
    const render = async () => {
      await page.goto(options.url)
      await page.evaluate(() => {
        window.sent = []
        window.acquireVsCodeApi = () => ({
          getState: () => undefined,
          setState() {},
          postMessage: (message) => window.sent.push(message),
        })
      })
      await page.setContent(pane.html)
      await publish(pane.message)
      await page.waitForTimeout(100)
    }
    const publish = (message) =>
      page.evaluate(
        (value) =>
          window.dispatchEvent(new MessageEvent('message', { data: value })),
        message,
      )
    // A per-step pane carries its state in the selected step's entry of the Study message; the other panes carry it in the model or the repository state.
    const stepPane = pane.requestType === 'step-understanding'
    const changeEntry = (message, change) => ({
      ...message,
      stepUnderstanding: {
        ...message.stepUnderstanding,
        steps: message.stepUnderstanding.steps.map((step) =>
          step.stepId === pane.stepId ? { ...step, ...change } : step,
        ),
      },
    })
    const state = () =>
      page.evaluate(
        ({ id, type }) => {
          const checkbox = document.getElementById(id)
          return {
            focus: document.activeElement.id,
            disabled: checkbox.disabled,
            ariaDisabled: checkbox.getAttribute('aria-disabled'),
            checked: checkbox.checked,
            requests: window.sent
              .filter((message) => message.type === type)
              .map((message) => message.understood),
            // A per-step request names the step and the replay it was made for.
            identities: window.sent
              .filter((message) => message.type === type)
              .map((message) => ({
                stepId: message.stepId,
                studyId: message.studyId,
              })),
          }
        },
        { id: pane.id, type: pane.requestType ?? 'understanding' },
      )
    const saving = (message) =>
      stepPane
        ? changeEntry(message, { saving: true })
        : { ...message, saving: true }
    const failedSave = (message) =>
      stepPane
        ? changeEntry(message, { saving: false, failure: 'Not saved' })
        : { ...message, error: 'Not saved', errors: ['Not saved'] }
    const settled = (understood) =>
      stepPane
        ? changeEntry(pane.message, {
            understood,
            saving: false,
            ...(understood ? { at: '2026-11-10T01:02:03.000Z' } : {}),
          })
        : pane.message.type === 'study'
          ? {
              ...pane.message,
              model: {
                ...pane.message.model,
                selectedUnderstanding: {
                  ...pane.message.model.selectedUnderstanding,
                  understood,
                },
              },
            }
          : {
              ...pane.message,
              understanding: { ...pane.message.understanding, understood },
            }
    await page.setViewportSize({ width: 390, height: 640 })
    await render()
    const checkbox = page.locator(`#${pane.id}`)
    // Arrange / Act: two immediate Space presses admit one write before the host acknowledges saving.
    await checkbox.focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('Space')
    const immediate = await state()
    await publish(saving(pane.message))
    const whileSaving = await state()
    await page.keyboard.press('Space')
    const bounds = await checkbox.boundingBox()
    await page.mouse.click(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    )
    const blocked = await state()
    await page.screenshot({ path: `${options.output}/${pane.id}-saving.png` })
    await publish(settled(false))
    const completed = await state()
    await page.keyboard.press('Space')
    const repeated = await state()
    // Assert: acknowledgement preserves focus, never optimistically changes checked state, and admits the next explicit choice.
    const success =
      immediate.requests.length === 1 &&
      whileSaving.focus === pane.id &&
      !whileSaving.disabled &&
      whileSaving.ariaDisabled === 'true' &&
      blocked.requests.length === 1 &&
      blocked.checked === true &&
      completed.focus === pane.id &&
      completed.checked === false &&
      JSON.stringify(repeated.requests) === '[false,true]'
    await render()
    await checkbox.focus()
    await page.keyboard.press('Space')
    await publish(saving(pane.message))
    await publish(failedSave(pane.message))
    const failed = await state()
    await page.keyboard.press('Space')
    const retried = await state()
    const failure =
      failed.focus === pane.id &&
      failed.checked === true &&
      JSON.stringify(retried.requests) === '[false,false]'
    await render()
    await checkbox.focus()
    await page.keyboard.press('Space')
    await publish(saving(pane.message))
    await page.keyboard.press('Tab')
    const moved = await state()
    await publish(settled(false))
    const afterMove = await state()
    const noFocusTheft =
      moved.focus !== pane.id && afterMove.focus === moved.focus
    await render()
    await publish({ ...pane.message, loading: true })
    const loading = await state()
    const unknown = stepPane
      ? {
          ...pane.message,
          stepUnderstanding: {
            ...pane.message.stepUnderstanding,
            status: 'unknown',
          },
        }
      : pane.message.type === 'study'
        ? {
            ...pane.message,
            model: {
              ...pane.message.model,
              selectedUnderstanding: {
                ...pane.message.model.selectedUnderstanding,
                known: false,
              },
            },
          }
        : {
            ...pane.message,
            understanding: { ...pane.message.understanding, known: false },
          }
    await publish(unknown)
    const unavailable = await state()
    const unavailableInert = loading.disabled && unavailable.disabled
    // A per-step check shows its state line, its progress line and, in a browser replay, the step's heading and explanation in order below the sequence.
    let drawn
    if (stepPane) {
      await render()
      drawn = await page.evaluate(
        ({ prefix, headingId }) => {
          const get = (suffix) => document.getElementById(`${prefix}-${suffix}`)
          const inOrder = (first, second) =>
            Boolean(
              first.compareDocumentPosition(second) &
              Node.DOCUMENT_POSITION_FOLLOWING,
            )
          const check = get('understood')
          const label = check.closest('label')
          const heading = headingId ? document.getElementById(headingId) : null
          const sequence = document.getElementById('learning-sequence')
          return {
            checkVisible: check.checkVisibility(),
            labelText: label.textContent.trim(),
            state: get('state').textContent,
            progress: get('progress').textContent,
            progressVisible: get('progress').checkVisibility(),
            heading: heading?.textContent ?? null,
            explanation: heading
              ? document.getElementById(`${prefix}-explanation`).textContent
              : null,
            belowSequence: heading
              ? inOrder(sequence, heading) &&
                inOrder(
                  heading,
                  document.getElementById(`${prefix}-explanation`),
                ) &&
                inOrder(document.getElementById(`${prefix}-explanation`), label)
              : null,
          }
        },
        {
          prefix: pane.id.replace(/-understood$/, ''),
          headingId: pane.headingId ?? null,
        },
      )
    }
    if (stepPane) {
      const prefix = pane.id.replace(/-understood$/, '')
      // The state line is announced politely and described to the check; in the Node family it stays outside the moment's own live region, so nothing is announced twice.
      const attributes = await page.evaluate(
        ({ prefix }) => {
          const state = document.getElementById(`${prefix}-state`)
          return {
            role: state.getAttribute('role'),
            live: state.getAttribute('aria-live'),
            describedBy: document
              .getElementById(`${prefix}-understood`)
              .getAttribute('aria-describedby'),
            insideMoment: Boolean(state.closest('#node-history-moment')),
          }
        },
        { prefix },
      )
      collected.cases.push({
        name: `${pane.name}: the state line is a polite status the check is described by, outside the moment's live region`,
        actual: attributes,
        passed:
          attributes.role === 'status' &&
          attributes.live === 'polite' &&
          attributes.describedBy === `${prefix}-state` &&
          attributes.insideMoment === false,
      })
      collected.cases.push({
        name: `${pane.name}: each save request names the step and the replay it was made for`,
        actual: repeated.identities,
        passed:
          JSON.stringify(repeated.identities) ===
          JSON.stringify([
            { stepId: pane.stepId, studyId: pane.studyId },
            { stepId: pane.stepId, studyId: pane.studyId },
          ]),
      })
      // Unknown, unreadable and review states: what the learner reads and whether a count is shown.
      const lines = () =>
        page.evaluate(
          ({ prefix }) => ({
            state: document.getElementById(`${prefix}-state`).textContent,
            progressVisible: document
              .getElementById(`${prefix}-progress`)
              .checkVisibility(),
          }),
          { prefix },
        )
      await publish({
        ...pane.message,
        stepUnderstanding: {
          ...pane.message.stepUnderstanding,
          status: 'unknown',
        },
      })
      const unknownLines = await lines()
      await publish({
        ...pane.message,
        stepUnderstanding: {
          ...pane.message.stepUnderstanding,
          status: 'unreadable',
        },
      })
      const unreadableLines = await lines()
      await publish(
        changeEntry(pane.message, {
          understood: false,
          reviewNeeded: true,
          reviewAt: '2026-11-10T01:02:03.000Z',
        }),
      )
      const reviewLines = await lines()
      collected.cases.push(
        {
          name: `${pane.name}: an unknown state hides the progress line instead of showing 0 of 2`,
          actual: unknownLines,
          passed: unknownLines.progressVisible === false,
        },
        {
          name: `${pane.name}: an unreadable file says so and hides the progress line`,
          actual: unreadableLines,
          passed:
            unreadableLines.progressVisible === false &&
            unreadableLines.state ===
              'Understanding for this replay could not be read.',
        },
        {
          name: `${pane.name}: a step changed after it was marked shows the review wording`,
          actual: reviewLines,
          passed: reviewLines.state.startsWith(
            'Review: you marked an earlier version of this step understood · ',
          ),
        },
      )
    }
    // The browser replay picks the step the learner activated in the sequence while its position is presented, and falls back to the first step matching the observation.
    if (stepPane && pane.headingId) {
      const steps = pane.message.recording.learningSummary.content.steps
      const [first, second] = [steps[0].id, steps[1].id]
      const atPosition = (presentedMs) => ({
        ...pane.message,
        recording: {
          ...pane.message.recording,
          presentedMs,
          learningSummary: {
            ...pane.message.recording.learningSummary,
            positions: [
              { stepId: first, elapsedMs: 2000 },
              { stepId: second, elapsedMs: 4000 },
            ],
          },
        },
      })
      const headingNow = () =>
        page.evaluate((id) => {
          const block = document.getElementById('learning-step')
          return block.hidden ? null : document.getElementById(id).textContent
        }, pane.headingId)
      await render()
      await publish(atPosition(2000))
      const beforeClick = await headingNow()
      await page.click(`button[data-summary-step="${second}"]`)
      await publish(atPosition(4000))
      const chosen = await headingNow()
      await publish(atPosition(4000.5))
      const nearby = await headingNow()
      await publish(atPosition(5000))
      const elsewhere = await headingNow()
      collected.cases.push({
        name: `${pane.name}: activating the second of two steps that share an observation shows that step while its position is presented, within the tolerance, and the first match elsewhere`,
        actual: { beforeClick, chosen, nearby, elsewhere },
        passed:
          beforeClick === `Step 1 · Step ${first}` &&
          chosen === `Step 2 · Step ${second}` &&
          nearby === `Step 2 · Step ${second}` &&
          elsewhere === `Step 1 · Step ${first}`,
      })
    }
    if (stepPane)
      collected.cases.push({
        name: `${pane.name}: the check is labelled I understand this step, shows when the learner marked it and how many steps are understood${pane.headingId ? ', and follows the step heading and explanation below the sequence' : ''}`,
        actual: drawn,
        passed:
          drawn.checkVisible &&
          drawn.labelText === 'I understand this step' &&
          /^Marked understood · /.test(drawn.state) &&
          drawn.progressVisible &&
          drawn.progress === 'Steps understood: 1 of 2' &&
          (!pane.headingId ||
            (drawn.heading === 'Step 1 · Step select' &&
              drawn.explanation === 'Explains select.' &&
              drawn.belowSequence === true)),
      })
    collected.cases.push(
      {
        name: `${pane.name}: two immediate Space presses ask for one save, the checkbox keeps the focus while the save is pending and takes no further press, and the first press after the answer asks again`,
        actual: { immediate, whileSaving, blocked, completed, repeated },
        passed: success,
      },
      {
        name: `${pane.name}: a save that failed leaves the focus on the checkbox and its state as it was, and the next press asks again`,
        actual: { failed, retried },
        passed: failure,
      },
      {
        name: `${pane.name}: the answer to a save takes no focus from the control the learner moved to meanwhile`,
        actual: { moved, afterMove },
        passed: noFocusTheft,
      },
      {
        name: `${pane.name}: the checkbox is disabled while the article loads and while its understanding is not known`,
        actual: { loading, unavailable },
        passed: unavailableInert,
      },
    )
  }
}

const report = {
  mode,
  qualification:
    'Compiled product HTML and real Chromium; simulated host messages, separate from native acceptance.',
  cases: [],
}
// A loopback address gives the Study pane the secure context its script needs (`crypto.randomUUID`); on `about:blank` the pane's script stops at its first line.
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><title>Codebook understanding check</title>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
// The check and both panes' pages reach `run-code` as one function in a file it loads itself (`--filename`): handed over as one command argument, the Study pane's page alone exceeds the size the system allows for one argument, and the script could not start (Cycle 0046 row 333).
const flowPath = `${output}/flow.js`
const failures = []
let recording = false
try {
  await writeFile(
    flowPath,
    readerDomFlowText(check, {
      panes: [
        {
          name: 'the Study pane',
          id: 'understood',
          html: studyHtml('context'),
          message: studyMessage,
        },
        {
          name: 'the Repository Wiki pane',
          id: 'understand',
          html: repositoryHtml(),
          message: repositoryMessage,
        },
        {
          name: "a browser replay's selected-step check",
          id: 'learning-step-understood',
          headingId: 'learning-step-heading',
          requestType: 'step-understanding',
          stepId: browserStepIds[0],
          studyId: STEP_STUDY_ID,
          html: studyHtml('context'),
          message: browserStepMessage,
        },
        {
          name: "a Node family's step check",
          id: 'node-step-understood',
          requestType: 'step-understanding',
          stepId: nodeStepIds[0],
          studyId: STEP_STUDY_ID,
          html: studyHtml('context'),
          message: nodeStepMessage,
        },
      ],
      output,
      url: `http://127.0.0.1:${server.address().port}/`,
    }),
  )
  await command(['open', 'about:blank'], 'open')
  await command(['video-start', `${output}/flow.webm`], 'video-start')
  recording = true
  const result = await command(['run-code', `--filename=${flowPath}`], 'flow')
  Object.assign(
    report,
    JSON.parse(result.split('### Result\n')[1].split('\n###')[0]),
  )
  assert.deepEqual(report.errors, [])
  assert.equal(
    report.cases.every((entry) => entry.passed),
    mode !== 'red',
    JSON.stringify(report.cases),
  )
} catch (error) {
  failures.push(error)
} finally {
  // Attempt every release step and keep the first failure, so a failed case does not leave the browser or the server behind.
  for (const release of [
    () => (recording ? command(['video-stop'], 'video-stop') : undefined),
    () =>
      writeFile(
        `${output}/result.json`,
        `${JSON.stringify(report, null, 2)}\n`,
      ),
    () => command(['close'], 'close'),
    () => new Promise((resolve) => server.close(resolve)),
  ])
    try {
      await release()
    } catch (error) {
      failures.push(error)
    }
}
if (failures.length)
  throw new AggregateError(
    failures,
    'Understanding checkbox QA failed; see command logs.',
    { cause: failures[0] },
  )
console.log(
  JSON.stringify(
    report.cases.map((entry) => ({ name: entry.name, passed: entry.passed })),
  ),
)
