import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { repositoryHtml } from '../dist/ui/repositoryHtml.js'

import { readerDomCommandOptions } from './utils/readerDomCommandOptions.mjs'
import { readerDomFlowText } from './utils/readerDomFlowText.mjs'
import { readerDomSessionName } from './utils/readerDomSessionName.mjs'

// Exercise the compiled renderer of the Repository Wiki pane in Chromium; host messages and cached webview state are controlled inputs.
const [mode = 'verify', outputPath = 'artifacts/repository-pane-dom'] =
  process.argv.slice(2)
assert.ok(['red', 'verify'].includes(mode))
const output = resolve(outputPath),
  session = readerDomSessionName('repository-pane', mode, output),
  html = repositoryHtml()
await mkdir(output, { recursive: true })
const anchor = {
  path: 'src/order.ts',
  hash: '1'.repeat(64),
  startLine: 1,
  endLine: 2,
}
const message = {
  type: 'repository',
  revision: 7,
  loading: false,
  saving: false,
  catalog: [
    {
      bookId: 'checkout',
      title: 'Checkout',
      revision: 1,
      revisions: [1],
      firstNodeId: 'order',
      status: 'available',
    },
  ],
  selection: {
    bookId: 'checkout',
    revision: 1,
    nodeId: 'order',
    anchorIndex: 0,
  },
  sources: [{ ...anchor, currentHash: anchor.hash, status: 'current' }],
  understanding: {
    known: true,
    understood: false,
    reviewNeeded: false,
    history: [],
  },
  book: {
    bookId: 'checkout',
    latestRevision: 1,
    links: [
      {
        nodeId: 'order',
        linkIndex: 0,
        status: 'available',
        outcome: 'demonstrated',
        studyId: 'saved-checkout',
        elapsedMs: 75000,
        recording: { status: 'available' },
      },
    ],
    revision: {
      revision: 1,
      publishedAt: '2026-09-21T00:00:00.000Z',
      document: {
        title: 'Checkout',
        summary: 'Retain the exact article while reading captured evidence.',
        edges: [],
        nodes: [
          {
            id: 'order',
            title: 'Create the selected order',
            anchors: [anchor],
            observations: [],
            sections: [
              {
                title: 'Retained operation',
                text: 'Read the captured operation state before it completes.\n\nThe article explains the cited source. Runtime evidence retains its separate identity.',
              },
              {
                title: 'Order creation',
                text: 'The paused observation identifies the selected order operation. Returning from its recording must preserve the original reading location.\n\nMoving native panes may save a different temporary viewport. That cached viewport must not replace the explicit return location.',
              },
            ],
          },
        ],
      },
    },
  },
}

/** Runs one CLI step for this renderer regression and preserves transport failures; {@link readerDomCommandOptions} gives the call labelled `flow` the flow's own limit. @example await command(['open', 'about:blank'], 'open') */
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

/** Recreates the actual reader with competing saved/explicit locations to expose native Return precedence, then leaves it and returns to it the way the editor does, to expose where the keyboard stands afterwards. It adds its cases and the page's errors to the lists of `collected`, which {@link runFlowKeepingCases} answers. @example await check(page, { html, message, output }, { cases: [], errors: [] }) */
async function check(page, options, collected) {
  const { cases } = collected
  page.on('pageerror', (error) => collected.errors.push(String(error)))
  page.setDefaultTimeout(5_000)
  /** Loads the pane's document anew over the state the webview kept for it; the host's message follows with {@link publish}. */
  const openPane = async (savedState) => {
    await page.goto('about:blank')
    await page.setViewportSize({ width: 326, height: 442 })
    await page.evaluate((state) => {
      window.sent = []
      window.acquireVsCodeApi = () => ({
        getState: () => state,
        setState() {},
        postMessage: (value) => window.sent.push(value),
      })
    }, savedState)
    await page.setContent(options.html)
  }
  /** Hands the pane one message of the host and waits until the frame in which the pane restores its place has passed. */
  const publish = async (message) => {
    await page.evaluate(
      (value) =>
        window.dispatchEvent(new MessageEvent('message', { data: value })),
      message,
    )
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    )
  }
  /** Names the element that has the focus: its id, or `body` while no control has it. */
  const focusedId = () =>
    page.evaluate(() =>
      document.activeElement === document.body
        ? 'body'
        : document.activeElement.id,
    )
  /**
   * Takes the focus from the pane the way the editor does when the learner goes to another part of it, as seen in VS Code 1.140.0 (Cycle 0046 row 326): the webview first takes the focus from the control (a focusout without a related target, after which the active element is the page body), then the window gets its blur event, and the document reports that it has no focus.
   * With an id the learner first reaches that control and leaves at once, within the same task, so no timer of the pane runs in between.
   */
  const leavePane = (idReachedFirst) =>
    page.evaluate((id) => {
      if (id) document.getElementById(id).focus()
      const focused = document.activeElement
      if (focused instanceof HTMLElement && focused !== document.body)
        focused.blur()
      document.hasFocus = () => false
      window.dispatchEvent(new Event('blur'))
    }, idReachedFirst)
  /** Gives the pane the focus back the way the editor's Focus into Panel command does: the window's focus event, at which the active element is still the page body. */
  const returnToPane = () =>
    page.evaluate(() => {
      delete document.hasFocus
      window.dispatchEvent(new Event('focus'))
    })
  /**
   * Returns to the pane with a real pointer press at a point, in one of the two orders in which the window's focus event and the press can reach the page; the pane must handle both, because the editor's order is not fixed by anything the pane can rely on.
   * `focus-first`: the focus event fires before the pane sees the press (a capturing listener on the window runs ahead of the pane's on the document). `press-first`: it fires after the pane saw the pointerdown and before the browser's own handling of the press, which takes the focus off a control when the press is on the background (a bubbling listener on the document).
   */
  const returnToPaneByPressAt = async (point, order) => {
    await page.evaluate((order) => {
      const giveFocusBack = () => {
        delete document.hasFocus
        window.dispatchEvent(new Event('focus'))
      }
      if (order === 'focus-first')
        window.addEventListener('pointerdown', giveFocusBack, {
          capture: true,
          once: true,
        })
      else
        document.addEventListener('pointerdown', giveFocusBack, { once: true })
    }, order)
    await page.mouse.click(point.x, point.y)
  }
  /** The middle of one control of the pane, for a press on it; the control is brought into the viewport first. */
  const middleOf = async (selector) => {
    await page.locator(selector).scrollIntoViewIfNeeded()
    const box = await page.locator(selector).boundingBox()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  /** Finds a point of the pane's background in the viewport: a place whose element, and everything around it, takes no focus when it is pressed. */
  const backgroundPoint = () =>
    page.evaluate(() => {
      for (let y = 4; y < innerHeight; y += 8)
        for (let x = innerWidth - 4; x > 0; x -= 8)
          if (
            !document
              .elementFromPoint(x, y)
              ?.closest(
                'button,a[href],input,select,textarea,summary,label,[tabindex],[contenteditable]',
              )
          )
            return { x, y }
      throw new Error('The pane shows no background to press.')
    })
  /** Adds one case whose values are compared whole with the values it expects. */
  const addCase = (name, expected, actual) =>
    cases.push({
      name,
      expected,
      actual,
      passed: JSON.stringify(actual) === JSON.stringify(expected),
    })
  for (const scenario of [
    {
      name: 'observation Return overrides a cached temporary pane position',
      focusId: 'evidence-0-observation',
      explicit: true,
      expectedTop: 221,
    },
    {
      name: 'recording Return overrides a cached temporary pane position',
      focusId: 'evidence-0-recording',
      explicit: true,
      expectedTop: 221,
    },
    {
      name: 'same-article reopen without an explicit location retains cached reading',
      focusId: 'evidence-0-recording',
      explicit: false,
      expectedTop: 110.5,
    },
    {
      name: 'a different article ignores the previous article cached location',
      focusId: 'article-title',
      explicit: false,
      foreign: true,
    },
  ]) {
    // Arrange: the host's original control was halfway down; hidden-pane persistence saved one quarter instead.
    const location = {
      sectionIndex: 4,
      fraction: 0,
      focusId: scenario.focusId,
      focusViewportFraction: 0.5,
    }
    await openPane({
      key: scenario.foreign ? 'different/1/article' : 'checkout/1/order',
      location: { ...location, focusViewportFraction: 0.25 },
    })
    // Act: an explicit Study Return or ordinary reopen reconstructs the webview after native pane movement.
    await publish({
      ...options.message,
      selection: {
        ...options.message.selection,
        ...(scenario.explicit ? { location } : {}),
      },
    })
    const actual = await page.evaluate((id) => {
      const control = document.getElementById(id),
        bounds = control.getBoundingClientRect()
      return {
        focusedId: document.activeElement.id,
        top: bounds.top,
        scrollY,
        understood: document.getElementById('understand').checked,
      }
    }, scenario.focusId)
    // Assert: exact control and reading offset survive; this action never grants understanding.
    const passed =
      actual.focusedId === scenario.focusId &&
      actual.understood === false &&
      (scenario.foreign
        ? actual.scrollY === 0
        : Math.abs(actual.top - scenario.expectedTop) <= 1)
    await page.screenshot({
      path: `${options.output}/case-${cases.length + 1}.png`,
    })
    cases.push({
      name: scenario.name,
      expectedTop: scenario.expectedTop,
      expectedFocus: scenario.focusId,
      actual,
      passed,
    })
  }

  // Cycle 0046 row 331. Arrange: the learner works in another part of the editor (the chat, a file), and the pane's document has no focus.
  await openPane(undefined)
  await leavePane()
  // Act: an agent opens an article in the pane, and later the learner comes to the pane.
  await publish(options.message)
  const focusWhileArticleOpens = await focusedId()
  await returnToPane()
  // Assert: a focus by script in a webview takes the window's keyboard, so the title waits for the pane's own focus.
  addCase(
    'an article that opens while the pane’s document has no focus takes no focus, and its title has the focus at the pane’s next focus event',
    { whileAway: 'body', atReturn: 'article-title' },
    { whileAway: focusWhileArticleOpens, atReturn: await focusedId() },
  )

  // Cycle 0046 row 331. Arrange: the learner read the article and left the pane.
  await openPane(undefined)
  await publish(options.message)
  await leavePane()
  // Act: the host shows a new revision of its message with a place to return to (a Return from a study), and later the learner comes to the pane.
  await publish({
    ...options.message,
    revision: options.message.revision + 1,
    selection: {
      ...options.message.selection,
      location: {
        sectionIndex: 4,
        fraction: 0,
        focusId: 'evidence-0-observation',
        focusViewportFraction: 0.5,
      },
    },
  })
  const focusWhileRevisionArrives = await focusedId()
  await returnToPane()
  // Assert
  addCase(
    'a revision with a place to return to that arrives while the pane’s document has no focus takes no focus, and the control it names has the focus at the pane’s next focus event',
    { whileAway: 'body', atReturn: 'evidence-0-observation' },
    { whileAway: focusWhileRevisionArrives, atReturn: await focusedId() },
  )

  // Cycle 0046 row 332. Arrange: the keyboard stands on View recording.
  await openPane(undefined)
  await publish(options.message)
  // Act: the learner goes to the editor, which takes the focus from the control, and returns.
  await leavePane('evidence-0-recording')
  const focusWhileAway = await focusedId()
  await returnToPane()
  // Assert
  addCase(
    'the control the learner left the pane at has the focus again when the learner returns, and none is taken while the learner is away',
    { whileAway: 'body', atReturn: 'evidence-0-recording' },
    { whileAway: focusWhileAway, atReturn: await focusedId() },
  )

  // Cycle 0046 row 332. Arrange: the learner left the pane at View recording.
  await openPane(undefined)
  await publish(options.message)
  await page.evaluate(() => {
    window.controlLeft = document.getElementById('evidence-0-recording')
  })
  await leavePane('evidence-0-recording')
  // Act: the observations are rendered again under the same revision (the linked study's time changed), and the learner returns.
  await publish({
    ...options.message,
    book: {
      ...options.message.book,
      links: [{ ...options.message.book.links[0], elapsedMs: 76000 }],
    },
  })
  const focusWhileListChanges = await focusedId()
  await returnToPane()
  // Assert: the part puts the focus on the same control of its new list.
  addCase(
    'when the observations are rendered again while the learner is away, the same control of the new list has the focus at the return, and none is taken before',
    {
      whileAway: 'body',
      atReturn: 'evidence-0-recording',
      isLeftControlStillShown: false,
      isFocusOnNewControl: true,
    },
    {
      whileAway: focusWhileListChanges,
      atReturn: await focusedId(),
      ...(await page.evaluate(() => ({
        isLeftControlStillShown: window.controlLeft.isConnected,
        isFocusOnNewControl:
          document.activeElement !== window.controlLeft &&
          document.activeElement.isConnected,
      }))),
    },
  )

  // Cycle 0046 row 332: the return is itself a pointer press, in each of the two orders in which the window's focus event and the press can reach the page.
  const focusAfterPress = { onAnotherControl: {}, onTheBackground: {} }
  for (const order of ['focus-first', 'press-first']) {
    // Arrange: the learner left the pane at View recording.
    await openPane(undefined)
    await publish(options.message)
    await leavePane('evidence-0-recording')
    // Act: the learner returns with a press on View observation.
    await returnToPaneByPressAt(
      await middleOf('#evidence-0-observation'),
      order,
    )
    focusAfterPress.onAnotherControl[order] = await focusedId()
    // Arrange again, and Act: the learner returns with a press on the pane's background.
    await openPane(undefined)
    await publish(options.message)
    await leavePane('evidence-0-recording')
    await returnToPaneByPressAt(await backgroundPoint(), order)
    focusAfterPress.onTheBackground[order] = await focusedId()
  }
  // Assert
  addCase(
    'a return by a press on another control leaves the focus on that control, and a return by a press on the pane’s background gives the control the learner left the focus back, in both orders of the focus event and the press',
    {
      onAnotherControl: {
        'focus-first': 'evidence-0-observation',
        'press-first': 'evidence-0-observation',
      },
      onTheBackground: {
        'focus-first': 'evidence-0-recording',
        'press-first': 'evidence-0-recording',
      },
    },
    focusAfterPress,
  )

  // Cycle 0046 row 332. Arrange: an open article whose title has the focus.
  await openPane(undefined)
  await publish(options.message)
  const sentBeforeLeaving = await page.evaluate(() => window.sent.length)
  // Act: the learner reaches View recording and leaves at once, before the pane has saved its reading place; the pane saves it while the learner is away.
  await leavePane('evidence-0-recording')
  await page.waitForFunction(
    (start) =>
      window.sent.slice(start).some((message) => message.type === 'location'),
    sentBeforeLeaving,
  )
  // Assert: the saved place, which a later Return and a reopened pane restore, names the control the learner left and not the one before it.
  addCase(
    'the reading place the pane saves while the learner is away names the control the learner left the pane at',
    { focusId: 'evidence-0-recording' },
    await page.evaluate(() => ({
      focusId: window.sent.findLast((message) => message.type === 'location')
        .selection.location.focusId,
    })),
  )
}

const report = {
  mode,
  htmlSha256: createHash('sha256').update(html).digest('hex'),
  qualification:
    'Real compiled renderer and Chromium; controlled host/cached-state inputs, separate from native installed validation.',
  cases: [],
}
// The check and its fixtures reach `run-code` as one function in a file it loads itself (`--filename`), as in the other Reader DOM checks: a flow handed over as one command argument stops starting once it outgrows the size the system allows for one argument (E2BIG).
const flowPath = `${output}/flow.js`
const failures = []
let recording = false
try {
  await writeFile(flowPath, readerDomFlowText(check, { html, message, output }))
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
  // Attempt every cleanup step and retain earlier verification/transport failures if a later step also fails.
  try {
    if (recording) await command(['video-stop'], 'video-stop')
  } catch (error) {
    failures.push(error)
  }
  try {
    await writeFile(
      `${output}/result.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    )
  } catch (error) {
    failures.push(error)
  }
  try {
    await command(['close'], 'close')
  } catch (error) {
    failures.push(error)
  }
}
if (failures.length)
  throw new AggregateError(
    failures,
    'Repository renderer QA failed; see command logs.',
    { cause: failures[0] },
  )
console.log(
  JSON.stringify(
    report.cases.map((entry) => ({ name: entry.name, passed: entry.passed })),
  ),
)
