import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { projectStudy } from '../dist/studyModel.js'
import { createConfiguredStudy } from '../dist/tests/utils/createConfiguredStudy.js'
import { repositoryHtml } from '../dist/ui/repositoryHtml.js'
import { studyHtml } from '../dist/ui/studyHtml.js'
import { citationLearningState } from '../dist/utils/citationLearningState.js'
import { decodeLearnerProgress } from '../dist/utils/decodeLearnerProgress.js'
import { selectStudy } from '../dist/utils/selectStudy.js'

// Real Chromium verifies focus and default checkbox activation; the serialized host bridge is intentionally simulated.
const [
  mode = 'verify',
  outputPath = 'artifacts/cycle-0011/understanding-focus-qa',
] = process.argv.slice(2)
assert.ok(['red', 'verify'].includes(mode))
const output = resolve(outputPath),
  session = `cb-understanding-${mode}`
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

/** Runs one bounded CLI command and rejects transport errors before parsing QA evidence. @example await command(['open', 'about:blank'], 'open') */
async function command(arguments_, label) {
  const result = spawnSync('playwright-cli', [`-s=${session}`, ...arguments_], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  await writeFile(`${output}/${label}.log`, result.stdout + result.stderr)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.includes('### Error'), false, result.stdout)
  return result.stdout
}

/** Exercises real Space/pointer input around delayed host snapshots without fabricating browser focus. @example await check(page, { html, message, id: 'understood', output }) */
async function check(page, options) {
  const render = async () => {
    await page.goto('about:blank')
    await page.evaluate(() => {
      window.sent = []
      window.acquireVsCodeApi = () => ({
        getState: () => undefined,
        setState() {},
        postMessage: (message) => window.sent.push(message),
      })
    })
    await page.setContent(options.html)
    await publish(options.message)
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
    }, options.id)
  const settled = (understood) =>
    options.message.type === 'study'
      ? {
          ...options.message,
          model: {
            ...options.message.model,
            selectedUnderstanding: {
              ...options.message.model.selectedUnderstanding,
              understood,
            },
          },
        }
      : {
          ...options.message,
          understanding: { ...options.message.understanding, understood },
        }
  await page.setViewportSize({ width: 390, height: 640 })
  await render()
  const checkbox = page.locator(`#${options.id}`)
  // Arrange / Act: two immediate Space presses admit one write before the host acknowledges saving.
  await checkbox.focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('Space')
  const immediate = await state()
  await publish({ ...options.message, saving: true })
  const saving = await state()
  await page.keyboard.press('Space')
  const bounds = await checkbox.boundingBox()
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  )
  const blocked = await state()
  await page.screenshot({ path: `${options.output}/${options.id}-saving.png` })
  await publish(settled(false))
  const completed = await state()
  await page.keyboard.press('Space')
  const repeated = await state()
  // Assert: acknowledgement preserves focus, never optimistically changes checked state, and admits the next explicit choice.
  const success =
    immediate.requests.length === 1 &&
    saving.focus === options.id &&
    !saving.disabled &&
    saving.ariaDisabled === 'true' &&
    blocked.requests.length === 1 &&
    blocked.checked === true &&
    completed.focus === options.id &&
    completed.checked === false &&
    JSON.stringify(repeated.requests) === '[false,true]'
  await render()
  await checkbox.focus()
  await page.keyboard.press('Space')
  await publish({ ...options.message, saving: true })
  await publish({
    ...options.message,
    error: 'Not saved',
    errors: ['Not saved'],
  })
  const failed = await state()
  await page.keyboard.press('Space')
  const retried = await state()
  const failure =
    failed.focus === options.id &&
    failed.checked === true &&
    JSON.stringify(retried.requests) === '[false,false]'
  await render()
  await checkbox.focus()
  await page.keyboard.press('Space')
  await publish({ ...options.message, saving: true })
  await page.keyboard.press('Tab')
  const moved = await state()
  await publish(settled(false))
  const afterMove = await state()
  const noFocusTheft =
    moved.focus !== options.id && afterMove.focus === moved.focus
  await render()
  await publish({ ...options.message, loading: true })
  const loading = await state()
  const unknown =
    options.message.type === 'study'
      ? {
          ...options.message,
          model: {
            ...options.message.model,
            selectedUnderstanding: {
              ...options.message.model.selectedUnderstanding,
              known: false,
            },
          },
        }
      : {
          ...options.message,
          understanding: { ...options.message.understanding, known: false },
        }
  await publish(unknown)
  const unavailable = await state()
  return {
    immediate,
    saving,
    blocked,
    completed,
    repeated,
    failed,
    retried,
    moved,
    afterMove,
    loading,
    unavailable,
    checks: {
      success,
      failure,
      noFocusTheft,
      unavailableInert: loading.disabled && unavailable.disabled,
    },
  }
}

const report = {
  mode,
  qualification:
    'Compiled product HTML and real Chromium; simulated host messages, separate from native acceptance.',
  cases: [],
}
try {
  await command(['open', 'about:blank'], 'open')
  await command(['video-start', `${output}/flow.webm`], 'video-start')
  for (const fixture of [
    { id: 'understood', html: studyHtml('context'), message: studyMessage },
    { id: 'understand', html: repositoryHtml(), message: repositoryMessage },
  ]) {
    const result = await command(
      [
        'run-code',
        `async page => (${check.toString()})(page, ${JSON.stringify({ ...fixture, output })})`,
      ],
      fixture.id,
    )
    report.cases.push({
      id: fixture.id,
      ...JSON.parse(result.split('### Result\n')[1].split('\n###')[0]),
    })
  }
  await command(['video-stop'], 'video-stop')
  const passed = report.cases.every((entry) =>
    Object.values(entry.checks).every(Boolean),
  )
  if (mode === 'red') {
    assert.deepEqual(
      report.cases.map((entry) => entry.id),
      ['understood', 'understand'],
    )
    // Layout/input can flush the browser's deferred blur; require actual focus loss in each disabled control.
    for (const entry of report.cases) {
      assert.equal(entry.blocked.disabled, true, JSON.stringify(entry))
      assert.notEqual(entry.blocked.focus, entry.id, JSON.stringify(entry))
    }
  } else
    assert.equal(
      passed,
      true,
      JSON.stringify(
        report.cases.map((entry) => ({ id: entry.id, checks: entry.checks })),
      ),
    )
} finally {
  await writeFile(
    `${output}/result.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  )
  await command(['close'], 'close')
}
console.log(
  JSON.stringify(
    report.cases.map((entry) => ({ id: entry.id, checks: entry.checks })),
  ),
)
