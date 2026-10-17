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

// Real Chromium verifies focus and default checkbox activation of the understanding checkbox in the Study pane and in the Repository Wiki pane; the serialized host bridge is intentionally simulated.
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
    const state = () =>
      page.evaluate((id) => {
        const checkbox = document.getElementById(id)
        return {
          focus: document.activeElement.id,
          disabled: checkbox.disabled,
          ariaDisabled: checkbox.getAttribute('aria-disabled'),
          checked: checkbox.checked,
          requests: window.sent
            .filter((message) => message.type === 'understanding')
            .map((message) => message.understood),
        }
      }, pane.id)
    const settled = (understood) =>
      pane.message.type === 'study'
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
    await publish({ ...pane.message, saving: true })
    const saving = await state()
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
      saving.focus === pane.id &&
      !saving.disabled &&
      saving.ariaDisabled === 'true' &&
      blocked.requests.length === 1 &&
      blocked.checked === true &&
      completed.focus === pane.id &&
      completed.checked === false &&
      JSON.stringify(repeated.requests) === '[false,true]'
    await render()
    await checkbox.focus()
    await page.keyboard.press('Space')
    await publish({ ...pane.message, saving: true })
    await publish({
      ...pane.message,
      error: 'Not saved',
      errors: ['Not saved'],
    })
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
    await publish({ ...pane.message, saving: true })
    await page.keyboard.press('Tab')
    const moved = await state()
    await publish(settled(false))
    const afterMove = await state()
    const noFocusTheft =
      moved.focus !== pane.id && afterMove.focus === moved.focus
    await render()
    await publish({ ...pane.message, loading: true })
    const loading = await state()
    const unknown =
      pane.message.type === 'study'
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
    collected.cases.push(
      {
        name: `${pane.name}: two immediate Space presses ask for one save, the checkbox keeps the focus while the save is pending and takes no further press, and the first press after the answer asks again`,
        actual: { immediate, saving, blocked, completed, repeated },
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
