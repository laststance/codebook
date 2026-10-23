import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

import { projectStudy } from '../dist/studyModel.js'
import { createConfiguredStudy } from '../dist/tests/utils/createConfiguredStudy.js'
import { studyHtml } from '../dist/ui/studyHtml.js'
import { capturedAppHtml } from '../dist/utils/capturedAppHtml.js'
import { decodeLearnerProgress } from '../dist/utils/decodeLearnerProgress.js'
import { selectStudy } from '../dist/utils/selectStudy.js'

import { readerDomCommandOptions } from './utils/readerDomCommandOptions.mjs'
import { readerDomFlowText } from './utils/readerDomFlowText.mjs'
import { readerDomSessionName } from './utils/readerDomSessionName.mjs'

const [
  mode = 'verify',
  outputPath = 'artifacts/cycle-0018/bootstrap-renderer',
] = process.argv.slice(2)
assert.ok(['red', 'verify'].includes(mode))
const output = resolve(outputPath),
  session = readerDomSessionName('bootstrap', mode, output)
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

/** Records each owned CLI operation for delayed-snapshot renderer verification; {@link readerDomCommandOptions} gives the call labelled `flow` the flow's own limit. @example await command(['open', 'about:blank'], 'open') */
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
  /** Builds the presentation an open Study workspace reports, so the cases that publish one state its control revision once, here. @example openPresentation({ layoutConfirmed: false }) // an open workspace whose layout is not confirmed */
  const openPresentation = (overrides) => ({
    presentationId: '11111111-1111-4111-8111-111111111111',
    presentationControlRevision: 1,
    mode: 'study-workspace',
    state: 'open',
    layoutConfirmed: true,
    preference: { status: 'default' },
    panes: {},
    ...overrides,
  })
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
  /**
   * Presses the summary of a disclosure by keyboard and waits until the disclosure has changed its open state and told so with a toggle event, at which the pane acts on the opened or closed disclosure.
   * A toggle event alone is no sign of the press: the browser tells a change of the open state later, so a render before the press (the pane closes the disclosure for another study) can still owe one. The helper therefore reads the state before the press and waits for the other state together with an event that reports it; its own handler runs after the pane's.
   * The wait is bounded: a disclosure that does not toggle rejects after five seconds with a sentence that names it, which ends the flow as one failed case, instead of holding the flow until the limit of its one browser call.
   */
  const toggleByKeyboard = async (disclosureId, key = 'Enter') => {
    const toggleWaitMs = 5_000
    const wasOpen = await page.evaluate((id) => {
      const disclosure = document.getElementById(id)
      window.disclosureToggledTo = undefined
      disclosure.ontoggle = () => {
        window.disclosureToggledTo = disclosure.open
      }
      return disclosure.open
    }, disclosureId)
    await page.locator(`#${disclosureId} > summary`).focus()
    await page.keyboard.press(key)
    await page
      .waitForFunction(
        ({ id, wasOpen }) =>
          document.getElementById(id).open !== wasOpen &&
          window.disclosureToggledTo === !wasOpen,
        { id: disclosureId, wasOpen },
        { timeout: toggleWaitMs },
      )
      .catch((error) => {
        throw new Error(
          `The disclosure #${disclosureId} did not toggle within ${toggleWaitMs} ms of ${key} on its summary (${error.message})`,
        )
      })
  }
  /** Names the element that holds the keyboard focus: `body`, else its id, its action, or its tag with its text. */
  const focusName = () =>
    page.evaluate(() => {
      const focused = document.activeElement
      if (focused === document.body) return 'body'
      return (
        focused.id ||
        focused.dataset.action ||
        `${focused.tagName.toLowerCase()}: ${focused.textContent.trim()}`
      )
    })
  /**
   * Takes the focus from the pane the way the editor does when the learner goes to another part of it, as seen in VS Code 1.140.0 (row 326): the webview first takes the focus from the control (a focusout without a related target, after which the active element is the page body), then the window gets its blur event, and the document reports that it has no focus.
   * Until row 326 this helper left the active element in place, which no editor does: every case that holds the pane out of focus was untrue to the editor in that point.
   */
  const leavePane = () =>
    page.evaluate(() => {
      const focused = document.activeElement
      if (focused instanceof HTMLElement && focused !== document.body)
        focused.blur()
      document.hasFocus = () => false
      window.dispatchEvent(new Event('blur'))
    })
  /** Gives the pane the focus back the way the editor's Focus into Panel command does: the window's focus event, at which the active element is still the page body. */
  const returnToPane = () =>
    page.evaluate(() => {
      delete document.hasFocus
      window.dispatchEvent(new Event('focus'))
    })
  /** Finds a point of the pane's background: a place whose element, and everything around it, takes no focus when it is pressed. */
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
  /** The middle of one control of the pane, for a press on it. */
  const middleOf = async (selector) => {
    const box = await page.locator(selector).first().boundingBox()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  /** Reads one status region of the pane: its role, its text and whether it is rendered. `checkVisibility` is false when the region or an ancestor has the `hidden` attribute or `display:none`, and when a closed disclosure holds it; a region that is rendered exists for assistive technology before its first text. */
  const statusRegion = (id) =>
    page.evaluate((id) => {
      const region = document.getElementById(id)
      return {
        id,
        role: `${region.getAttribute('role')}/${region.getAttribute('aria-live')}`,
        text: region.textContent,
        isRendered: region.checkVisibility(),
      }
    }, id)
  /** What {@link statusRegion} reads for a region that is in the page, rendered and empty. */
  const emptyRegion = (id) => ({
    id,
    role: 'status/polite',
    text: '',
    isRendered: true,
  })
  /**
   * Says whether the pane is laid out and painted the same with one of its parts in place as with that part taken out by the `hidden` attribute: `moved` names the page (its scroll size) and every rendered element outside the part whose box differs, and `samePixels` compares a screenshot of the whole page. Nothing moves and the pixels are equal only for a part that shows nothing and takes no room. Two frames pass before each reading, so the pane's resize observers have answered, and each screenshot is repeated until the picture stands still.
   * Both readings are taken in one settled state (row 730). A full-page screenshot of a page taller than the viewport lays the page out again at the page's height while it is taken (CI's video of the failed run shows those frames), and the pane answers a resize (vh units, its resize handlers and observers) at a time the runner decides, so one reading could catch another layout than the other. The viewport is therefore made as tall as the page once, before the readings, and given back with the scroll position afterwards. The pointer rests where the flow's last press left it, and the browser updates the hover state of what moved under it only with its next pointer event (`button:hover` brightens a button), so a real move to the page's top-left corner sets that state before the readings.
   */
  const looksAsWithout = async (selector) => {
    /** Waits two frames, so the pane's resize observers and handlers have answered. */
    const twoFrames = () =>
      page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      )
    await page.mouse.move(0, 0)
    const viewport = page.viewportSize(),
      scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }))
    // A page whose height grows with the viewport (vh units) is measured again; five rounds are more than the pane's growth needs.
    for (let round = 0; round < 5; round++) {
      const height = await page.evaluate(
        () => document.documentElement.scrollHeight,
      )
      if (height <= page.viewportSize().height) break
      await page.setViewportSize({ width: viewport.width, height })
      await twoFrames()
    }
    const reading = async () => {
      await twoFrames()
      const boxes = await page.evaluate((selector) => {
        const part = document.querySelector(selector),
          root = document.documentElement
        return [
          ['page', `${root.scrollWidth} x ${root.scrollHeight}`],
          ...[...document.body.querySelectorAll('*')]
            // What a closed disclosure holds is not laid out and keeps the box of an earlier layout: only rendered elements are compared.
            .filter(
              (element) => !part.contains(element) && element.checkVisibility(),
            )
            .map((element) => {
              const box = element.getBoundingClientRect()
              return [
                element.id || `${element.tagName}.${element.className}`,
                [box.x, box.y, box.width, box.height].join(' '),
              ]
            }),
        ]
      }, selector)
      // What the browser still settles after a change (a hover that sets in, a scrollbar that fades) is not the part's doing: the picture is taken until two in a row are equal.
      let pixels = await page.screenshot({ fullPage: true })
      for (let attempt = 0; attempt < 10; attempt++) {
        const again = await page.screenshot({ fullPage: true })
        if (again.equals(pixels)) break
        pixels = again
      }
      return { boxes, pixels }
    }
    const setHidden = (isHidden) =>
      page.locator(selector).evaluate((part, isHidden) => {
        part.hidden = isHidden
      }, isHidden)
    // A text field that has the focus blinks its caret, which two screenshots catch differently; the page's content security policy keeps the browser tool from hiding it, so the check hides it on the focused element for the two readings.
    const setCaretColor = (color) =>
      page.evaluate((color) => {
        document.activeElement.style.caretColor = color
      }, color)
    await setCaretColor('transparent')
    const inPlace = await reading()
    await setHidden(true)
    const takenOut = await reading()
    await setHidden(false)
    await setCaretColor('')
    // The flow goes on in the viewport and at the scroll position it had.
    await page.setViewportSize(viewport)
    await page.evaluate(({ x, y }) => scrollTo(x, y), scroll)
    await twoFrames()
    return {
      moved: inPlace.boxes.flatMap(([name, box], index) =>
        box === takenOut.boxes[index]?.[1]
          ? []
          : [`${name}: ${box} / ${takenOut.boxes[index]?.[1]}`],
      ),
      samePixels: inPlace.pixels.equals(takenOut.pixels),
    }
  }
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
    // Arrange: a loaded study with no run and no recording, so the pane shows neither its live strip nor its replay transport (row 74).
    const paneName = kind === 'context' ? 'Study pane' : 'bottom panel'
    await page.setViewportSize({ width: 420, height: 720 })
    await publish(options.message)
    /** Reads what the live strip shows: its status, its height and whether its Stop button is rendered. */
    const liveStrip = () =>
      page.evaluate(() => ({
        status: document.getElementById('runtime').textContent,
        height: Math.round(
          document.querySelector('.live-strip').getBoundingClientRect().height,
        ),
        stopShown: document
          .querySelector('[data-action="stop"]')
          .checkVisibility(),
      }))
    // Act: the strip's status is read before a run, when a run reports its first state, and after that run stopped.
    const stripBeforeRun = {
      region: await statusRegion('runtime'),
      strip: await liveStrip(),
      looks: await looksAsWithout('.live-strip'),
    }
    await publish({
      ...options.message,
      liveState: 'running',
      liveTitle: 'Repository operation',
    })
    const stripDuringRun = {
      region: await statusRegion('runtime'),
      strip: await liveStrip(),
    }
    await publish({
      ...options.message,
      liveState: 'stopped',
      liveTitle: 'Repository operation',
    })
    const stripAfterRun = {
      region: await statusRegion('runtime'),
      strip: await liveStrip(),
      looks: await looksAsWithout('.live-strip'),
    }
    // Assert
    cases.push({
      name: `in the ${paneName} the live strip’s status is in the page, rendered and empty, before a run starts, and the pane looks as it does without the strip; the run’s first state is the status’s first text, and a stopped run empties it again`,
      actual: { stripBeforeRun, stripDuringRun, stripAfterRun },
      passed:
        JSON.stringify(stripBeforeRun) ===
          JSON.stringify({
            region: emptyRegion('runtime'),
            strip: { status: '', height: 0, stopShown: false },
            looks: { moved: [], samePixels: true },
          }) &&
        JSON.stringify(stripDuringRun.region) ===
          JSON.stringify({
            ...emptyRegion('runtime'),
            text: 'Repository operation — running',
          }) &&
        stripDuringRun.strip.height > 0 &&
        stripDuringRun.strip.stopShown &&
        JSON.stringify(stripAfterRun) === JSON.stringify(stripBeforeRun),
    })

    // Arrange: the same study without a recording; the transport's three status regions have had no text yet (row 74).
    const transportRegionIds = [
      'recording-status',
      'application-covered-remedy',
      'playback-hint',
    ]
    /** Reads the transport as this pane holds it: its three status regions, the name that makes its section a landmark, its height, and whether the pane looks as it does without it. */
    const transportHeld = async () => ({
      regions: [
        await statusRegion(transportRegionIds[0]),
        await statusRegion(transportRegionIds[1]),
        await statusRegion(transportRegionIds[2]),
      ],
      landmarkName: await page
        .locator('#recording-transport')
        .getAttribute('aria-label'),
      height: await page
        .locator('#recording-transport')
        .evaluate((transport) =>
          Math.round(transport.getBoundingClientRect().height),
        ),
      looks: await looksAsWithout('#recording-transport'),
    })
    const transportBeforeRecording = await transportHeld()
    // Act: a recording opens whose moment another tab covers and whose native values are not loaded, which gives each region its first text; then the recording is left.
    await publish({
      ...options.message,
      contentTab: 'recording',
      recording: {
        revision: revisionAt(1),
        mode: 'paused',
        readiness: 'ready',
        cleared: false,
        presentedMs: 2000,
        range: { startMs: 0, endMs: 5000, endKnown: true },
        recordingStatus: 'finalized',
        nativeValuesUninspected: true,
        applicationCovered: true,
      },
    })
    const transportWithRecording = {
      regions: [
        await statusRegion(transportRegionIds[0]),
        await statusRegion(transportRegionIds[1]),
        await statusRegion(transportRegionIds[2]),
      ],
      landmarkName: await page
        .locator('#recording-transport')
        .getAttribute('aria-label'),
      playShown: await page.locator('#playback-toggle').isVisible(),
    }
    await publish(options.message)
    const transportAfterRecording = await transportHeld()
    // Assert: one case a region, each with the transport it stands in.
    const firstTexts = [
      'Paused · finalized · Recorded application is covered by another tab',
      'Bring the Recorded application tab to the front to show this moment again.',
      'Recorded values for this moment are not loaded yet. Show Variables opens Run and Debug and expands them; if the first scope stays closed, expand it. If Call Stack lists several sessions, select “Codebook · Recorded learning” first.',
    ]
    /** Says whether a reading of {@link transportHeld} shows one region empty in a transport that is left out: no name, no height, nothing moved and no pixel changed by taking the transport out. */
    const transportLeftOut = (held, index) =>
      JSON.stringify([
        held.regions[index],
        held.landmarkName,
        held.height,
        held.looks,
      ]) ===
      JSON.stringify([
        emptyRegion(transportRegionIds[index]),
        null,
        0,
        { moved: [], samePixels: true },
      ])
    for (const [index, regionId] of transportRegionIds.entries())
      cases.push({
        name: `in the ${paneName} the transport’s status region #${regionId} is in the page, rendered and empty, before a recording opens, in a transport that shows nothing, takes no room and is no landmark; the recording gives the region its first text, and leaving the recording empties it again`,
        actual: {
          beforeRecording: transportBeforeRecording,
          withRecording: transportWithRecording,
          afterRecording: transportAfterRecording,
        },
        passed:
          transportLeftOut(transportBeforeRecording, index) &&
          JSON.stringify(transportWithRecording.regions[index]) ===
            JSON.stringify({
              ...emptyRegion(regionId),
              text: firstTexts[index],
            }) &&
          transportWithRecording.landmarkName === 'Recorded playback' &&
          transportWithRecording.playShown &&
          transportLeftOut(transportAfterRecording, index),
      })
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
      // Golden DOM (PR-B2, AC14): the browser transport's time slider with its gap and stop marks renders the markup it rendered before its drawing was shared with test replays.
      const mappedTransportMarkup = await page.evaluate(
        () =>
          document.querySelector('#recording-transport .timeline-track')
            .outerHTML,
      )
      await publish({
        ...replay,
        recording: {
          ...replay.recording,
          historyTimeline: { status: 'unknown' },
        },
      })
      const unknownTransportMarkup = await page.evaluate(
        () =>
          document.querySelector('#recording-transport .timeline-track')
            .outerHTML,
      )
      // Value: protects=the browser transport's slider keeps the markup it had before its drawing was shared with test replays (AC14): the gap and stop marks, mapped and unknown, in the same elements and attributes; fails_when=the shared drawing changes the browser slider's DOM, so a recording's transport reads or looks different; why_new=PR-B2 shared the coverage drawing and pinned the old markup as a text fixture; seam=none; no_claim=how the slider looks (native pixels)
      cases.push({
        name: 'the browser transport’s slider with its gap and stop marks, mapped and unknown, renders the same markup as before its drawing was shared with test replays',
        actual: `${mappedTransportMarkup}\n---\n${unknownTransportMarkup}`,
        passed:
          `${mappedTransportMarkup}\n---\n${unknownTransportMarkup}` ===
          options.goldenHistoryTransport,
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
      // While the bottom panel shows the transport, the Learning summary keeps its own in the page with nothing in it, also at a moment that has a text for each of its three status regions: another tab covers the application and the native values are not loaded (row 74).
      await publish({
        ...replay,
        playbackPanelVisible: true,
        recording: {
          ...replay.recording,
          nativeValuesUninspected: true,
          applicationCovered: true,
        },
      })
      const transportWhilePanelOwnsIt = await transportHeld()
      await publish({ ...replay, playbackPanelVisible: false })
      cases.push({
        name: 'closing bottom panel restores summary playback controls',
        passed: await page.locator('#recording-transport').isVisible(),
      })
      const transportAfterPanelClosed = {
        status: await statusRegion('recording-status'),
        landmarkName: await page
          .locator('#recording-transport')
          .getAttribute('aria-label'),
      }
      cases.push({
        name: 'while the bottom panel shows the transport, the status regions of the Learning summary’s own transport stay in the page, rendered and empty, and say nothing a second time; the summary looks as it does without that transport, which is no landmark; closing the panel writes the status into the region that was there',
        actual: { transportWhilePanelOwnsIt, transportAfterPanelClosed },
        passed:
          transportRegionIds.every((regionId, index) =>
            transportLeftOut(transportWhilePanelOwnsIt, index),
          ) &&
          JSON.stringify(transportAfterPanelClosed) ===
            JSON.stringify({
              status: {
                ...emptyRegion('recording-status'),
                text: 'Paused · finalized · Not recorded at this moment',
              },
              landmarkName: 'Recorded playback',
            }),
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

      // Arrange: the Keyboard shortcuts dialog is open and nothing was searched; its no-match line is a status region (row 81).
      const noMatchSelector = '.shortcut-dialog [role=status]'
      /** Reads the no-match line of the open dialog: its text, whether it is rendered, whether it or an ancestor up to the dialog has the `hidden` attribute or `display:none`, its height, how many shortcuts are listed and whether Clear search is shown. */
      const noMatchLine = () =>
        page.evaluate((selector) => {
          const line = document.querySelector(selector),
            dialog = line.closest('dialog'),
            upToDialog = []
          for (let node = line; node !== dialog; node = node.parentElement)
            upToDialog.push(node)
          return {
            role: line.getAttribute('role'),
            text: line.textContent,
            isRendered: line.checkVisibility(),
            isTakenOut: [...upToDialog, dialog].some(
              (node) =>
                node.hidden || getComputedStyle(node).display === 'none',
            ),
            height: Math.round(line.getBoundingClientRect().height),
            hasRows: dialog.querySelectorAll('.shortcut-row').length > 0,
            clearShown: [...dialog.querySelectorAll('button')]
              .find((button) => button.textContent === 'Clear search')
              .checkVisibility(),
          }
        }, noMatchSelector)
      await help.click()
      const lineBeforeSearch = {
        line: await noMatchLine(),
        looks: await looksAsWithout(noMatchSelector),
      }
      // Act: a search with matches, read also in a page whose stylesheet gives the line a paragraph's margins (as the Wiki reader's page does); a search without a match; a matching search again; and Clear search after one without.
      await shortcutSearch.fill('seek')
      await page.evaluate((selector) => {
        const paragraphMargins = new CSSStyleSheet()
        paragraphMargins.replaceSync(
          `${selector.replace('[role=status]', 'p[role=status]')}{margin:16px 0}`,
        )
        document.adoptedStyleSheets = [paragraphMargins]
      }, noMatchSelector)
      const lineWithMatch = {
        line: await noMatchLine(),
        looks: await looksAsWithout(noMatchSelector),
      }
      await page.evaluate(() => {
        document.adoptedStyleSheets = []
      })
      await shortcutSearch.fill('no-such-shortcut')
      const lineWithoutMatch = await noMatchLine()
      await shortcutSearch.fill('seek')
      const lineWithMatchAgain = await noMatchLine()
      await shortcutSearch.fill('no-such-shortcut')
      await page
        .getByRole('button', { name: 'Clear search', exact: true })
        .click()
      const lineAfterClear = await noMatchLine()
      await shortcutSearch.press('Escape')
      // Assert
      const emptyLine = {
        role: 'status',
        text: '',
        isRendered: true,
        isTakenOut: false,
        height: 0,
        hasRows: true,
      }
      cases.push({
        name: 'the no-match line of the Keyboard shortcuts list is in the open dialog, rendered and empty, while a search has matches, and the dialog looks as it does without the line, also where a stylesheet gives the line a paragraph’s margins; a search without a match gives it No shortcuts match., and a matching search or Clear search empties it again',
        actual: {
          lineBeforeSearch,
          lineWithMatch,
          lineWithoutMatch,
          lineWithMatchAgain,
          lineAfterClear,
        },
        passed:
          JSON.stringify(lineBeforeSearch) ===
            JSON.stringify({
              line: { ...emptyLine, clearShown: false },
              looks: { moved: [], samePixels: true },
            }) &&
          JSON.stringify(lineWithMatch) ===
            JSON.stringify({
              line: { ...emptyLine, clearShown: true },
              looks: { moved: [], samePixels: true },
            }) &&
          JSON.stringify(lineWithoutMatch) ===
            JSON.stringify({
              ...emptyLine,
              text: 'No shortcuts match.',
              height: 24,
              hasRows: false,
              clearShown: true,
            }) &&
          JSON.stringify(lineWithMatchAgain) ===
            JSON.stringify({ ...emptyLine, clearShown: true }) &&
          JSON.stringify(lineAfterClear) ===
            JSON.stringify({ ...emptyLine, clearShown: false }),
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
        presentation: openPresentation({ preference: { status: 'failed' } }),
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
      // The one-event history's stop is its first event (F305).
      const nodeStop = {
        sequence: 2,
        eventIndex: 0,
        sourceAvailable: true,
        debuggerAvailable: true,
      }
      // The host words the test replay section (projectNodeTestSection); the pane places its lines.
      const nodeSection = {
        status:
          'Test passed · exit code 0 · capture complete · 1 of 1 stops explained',
        position: 'Stop 1 of 1 · 1.20 s',
        pointer: 'Output up to this moment is in the Application pane.',
        applicationClosed: false,
        sameMomentStepIds: [],
        stepActions: {},
        events: 'Events (1)',
        verdict: 'Test passed · exit code 0',
        previousStop: false,
        nextStop: false,
      }
      const unverifiedNodeSection = {
        ...nodeSection,
        notRecorded: 'Source and debugger not recorded at this moment.',
        unverified: 'Recorded source unavailable for this stop.',
      }
      await publish({
        ...replay,
        nodeHistorySection: nodeSection,
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
        nodeHistorySection: nodeSection,
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
          nodeWithoutValues.position === 'Stop 1 of 1 · 1.20 s' &&
          nodeWithoutValues.hint ===
            'Recorded values for this moment are not loaded yet. Show Variables opens Run and Debug and expands them; if the first scope stays closed, expand it. If Call Stack lists several sessions, select “Codebook · Recorded learning” first.' &&
          nodeWithoutValues.role === 'status' &&
          nodeWithoutValues.muted &&
          nodeWithValues.position === 'Stop 1 of 1 · 1.20 s' &&
          nodeWithValues.hint === '',
      })
      /** Reads the test replay section's position and the two lines that say what is not recorded. */
      const nodeMomentLines = async () => ({
        position: await page.locator('#node-history-position').textContent(),
        notRecorded: await page
          .locator('#node-history-not-recorded')
          .textContent(),
        unverified: await page
          .locator('#node-history-unverified')
          .textContent(),
      })
      await publish({
        ...replay,
        nodeHistorySection: nodeSection,
        nodeHistoryPosition: { ...nodeStop, debuggerAvailable: false },
      })
      const nodeSessionEnded = await nodeMomentLines()
      await publish({
        ...replay,
        nodeHistorySection: unverifiedNodeSection,
        nodeHistoryPosition: {
          ...nodeStop,
          sourceAvailable: false,
          debuggerAvailable: false,
        },
      })
      const nodeSourceMismatch = await nodeMomentLines()
      // Value: protects=ending the native session of a saved stop keeps the Study section's position line, and only a real source mismatch shows the unavailable-source and not-recorded lines; fails_when=a session that ended is told as a missing source, or a real mismatch shows no line; why_new=PR-B1 moved these lines into the section (the String catalog) and changed this case's expectations; seam=none; no_claim=the host's verification of the stop's source (the workspace tests) (stand-ins: the Study messages the host posts)
      cases.push({
        name: 'a saved test replay stop whose native session ended keeps its position line, and only a real source mismatch shows the unavailable-source and not-recorded lines',
        actual: { nodeSessionEnded, nodeSourceMismatch },
        passed:
          JSON.stringify(nodeSessionEnded) ===
            JSON.stringify({
              position: 'Stop 1 of 1 · 1.20 s',
              notRecorded: '',
              unverified: '',
            }) &&
          JSON.stringify(nodeSourceMismatch) ===
            JSON.stringify({
              position: 'Stop 1 of 1 · 1.20 s',
              notRecorded: 'Source and debugger not recorded at this moment.',
              unverified: 'Recorded source unavailable for this stop.',
            }),
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
      // Value: protects=a selected stop whose values are not loaded offers Inspect in native debugger beside the hint and Show Variables (DS6), not only in the collapsed event list, and a press asks the host to select that stop; the control leaves with the hint once values load and is not offered for a stop whose captured source does not match; fails_when=the row has no Inspect, it stays after the values load or for a source mismatch, or its press sends another stop or nothing; why_new=F121: Inspect lived in the collapsed event list only; seam=none; no_claim=the host's selection of the stop (studyWorkspace tests) (stand-ins: the Study messages the host posts and the pane's sent messages)
      // Arrange
      const rowInspect = page.locator('#node-history-inspect')
      const rowInspectState = async () => ({
        visible: await rowInspect.isVisible(),
        label: (await rowInspect.textContent()) ?? '',
        followsShowVariables: await rowInspect.evaluate(
          (button) =>
            button.previousElementSibling?.id === 'node-history-show-variables',
        ),
      })
      // Act
      await publish({
        ...nodeReader,
        nodeHistoryPosition: {
          ...nodeStop,
          debuggerAvailable: false,
          nativeValuesUninspected: true,
        },
      })
      const rowInspectOffered = await rowInspectState()
      await page.evaluate(() => {
        window.sent.length = 0
      })
      await rowInspect.click()
      const rowInspectRequests = await page.evaluate(() =>
        window.sent.filter((message) => message.type === 'node-history-stop'),
      )
      await publish({
        ...nodeReader,
        nodeHistoryPosition: { ...nodeStop, nativeValuesUninspected: false },
      })
      const rowInspectAfterValues = await rowInspectState()
      await publish({
        ...nodeReader,
        nodeHistorySection: unverifiedNodeSection,
        nodeHistoryPosition: {
          ...nodeStop,
          sourceAvailable: false,
          debuggerAvailable: false,
          nativeValuesUninspected: true,
        },
      })
      const rowInspectForMismatch = await rowInspectState()
      // Assert
      cases.push({
        name: 'a selected Node stop whose values are not loaded offers Inspect in native debugger beside Show Variables, and a press selects that stop',
        actual: {
          rowInspectOffered,
          rowInspectRequests,
          rowInspectAfterValues,
          rowInspectForMismatch,
        },
        passed:
          rowInspectOffered.visible &&
          rowInspectOffered.label === 'Inspect in native debugger' &&
          rowInspectOffered.followsShowVariables &&
          rowInspectRequests.length === 1 &&
          rowInspectRequests[0].sequence === 2 &&
          !rowInspectAfterValues.visible &&
          !rowInspectForMismatch.visible,
      })
      // Act: the selected stop's captured source no longer matches its recorded hash.
      await publish({
        ...nodeReader,
        nodeHistorySection: unverifiedNodeSection,
        nodeHistoryPosition: {
          ...nodeStop,
          sourceAvailable: false,
          debuggerAvailable: false,
        },
      })
      // Counted and read without waiting, so a missing element is a failed case instead of a harness timeout.
      const sourceMismatch = {
        unverified: await page
          .locator('#node-history-unverified')
          .textContent(),
        inspectButtons: await nodeInspect.count(),
        explanation: await page
          .locator('#node-history-events .node-history-event p.muted')
          .allTextContents(),
      }
      cases.push({
        name: 'a selected Node stop whose captured source does not match offers no Inspect in native debugger',
        actual: sourceMismatch,
        passed:
          sourceMismatch.unverified ===
            'Recorded source unavailable for this stop.' &&
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
      // Arrange: keyboard focus on the selected stop's Inspect (Cycle 0044, 0033-OCR4), in the event list the learner expanded (DS16 collapses it).
      await publish({
        ...nodeReader,
        nodeHistoryPosition: { ...nodeStop, debuggerAvailable: false },
      })
      await page.locator('#node-history-events-details').evaluate((details) => {
        details.open = true
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
      // Arrange: the same stop's Inspect holds the focus, and the learner has left the pane for another part of the editor (row 172).
      await publish({
        ...nodeReader,
        nodeHistoryPosition: { ...nodeStop, debuggerAvailable: false },
      })
      await nodeInspect.focus()
      await leavePane()
      // Act: the native session shows the stop, so the list is rendered again; later the learner returns to the pane.
      await publish({ ...nodeReader, nodeHistoryPosition: nodeStop })
      const nodeFocusWhileAway = await focusName()
      await returnToPane()
      const nodeFocusOnReturn = await focusName()
      // Assert
      cases.push({
        name: 'when the Node event list is rendered again while the pane does not have the focus, the pane takes none, and the same stop’s control has it when the learner returns',
        actual: { nodeFocusWhileAway, nodeFocusOnReturn },
        passed:
          nodeFocusWhileAway === 'body' &&
          nodeFocusOnReturn === 'button: Debugger stop selected',
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

      // Arrange: a test replay of two outputs, one stop and its passing result, with saved learning whose two steps share the stop; every line is worded by the host, as projectNodeTestSection words it (Design 8, red first).
      const replayHash = 'b'.repeat(64)
      const replayEntries = [
        {
          type: 'output',
          sequence: 1,
          elapsedMs: 100,
          channel: 'stdout',
          text: 'RUN src/jobs.test.ts\n',
        },
        {
          type: 'output',
          sequence: 2,
          elapsedMs: 150,
          channel: 'stderr',
          text: 'slow timer\n',
        },
        {
          type: 'stop',
          sequence: 3,
          index: 0,
          elapsedMs: 420,
          source: {
            path: 'src/jobs.ts',
            hash: replayHash,
            line: 12,
            column: 5,
          },
          frame: { name: 'schedule', line: 12, column: 5 },
          facts: [],
          debuggerSnapshot: {
            frames: [
              {
                line: 12,
                column: 5,
                source: { name: 'src/jobs.ts', hash: replayHash, line: 12 },
              },
            ],
            variables: [],
          },
        },
        {
          type: 'result',
          sequence: 4,
          elapsedMs: 900,
          exitCode: 0,
          signal: null,
          outputTail: '',
        },
      ]
      const replayLearning = {
        content: {
          question: 'How does the scheduler delay a job?',
          title:
            'How the job scheduler delays a job until its timer fires and then runs it exactly once',
          summary:
            'The test schedules a job and checks that it runs after its timer.',
          participants: [
            { id: 'test', label: 'Job test' },
            { id: 'scheduler', label: 'schedule' },
            { id: 'timer', label: 'Timer' },
          ],
          steps: [
            {
              id: 'read',
              from: 'test',
              to: 'scheduler',
              label: 'Read the delay',
              explanation: 'The stop shows the delay of 5,000 ms.',
              evidence: 'observed',
              reference: { type: 'stop', sequence: 3, sourceHash: replayHash },
            },
            {
              id: 'keep',
              from: 'scheduler',
              to: 'timer',
              label: 'Keep the timer',
              explanation: 'The scheduler keeps the timer it created.',
              evidence: 'source-derived',
              reference: { type: 'stop', sequence: 3, sourceHash: replayHash },
            },
            {
              id: 'verdict',
              from: 'timer',
              to: 'test',
              label: 'Pass',
              explanation: 'The job ran after its timer, so the test passed.',
              evidence: 'observed',
              reference: { type: 'result', sequence: 4 },
            },
          ],
        },
        positions: [
          { stepId: 'read', elapsedMs: 420, sequence: 3 },
          { stepId: 'keep', elapsedMs: 420, sequence: 3 },
          { stepId: 'verdict', elapsedMs: 900, sequence: 4 },
        ],
      }
      const replaySection = {
        status:
          'Test passed · exit code 0 · capture complete · 1 of 1 stops explained',
        pointer: 'Output up to this moment is in the Application pane.',
        applicationClosed: false,
        sameMomentStepIds: [],
        stepActions: {
          read: 'Inspect stop 1 · 0.42 s',
          keep: 'Inspect stop 1 · 0.42 s',
          verdict: 'Inspect result · 0.90 s',
        },
        events: 'Events (4)',
        verdict: 'Test passed · exit code 0',
        // The whole range is one unrecorded span; the verified stop at 0.42 s is a tick (PR-B2, Design 4).
        timeline: {
          startMs: 100,
          endMs: 900,
          gaps: [{ startMs: 100, endMs: 900 }],
          recordedPoints: [420],
        },
      }
      const notRecordedLine = 'Source and debugger not recorded at this moment.'
      /** The Study message of the job scheduler's test replay at one selected event. */
      const testReplayAt = (
        position,
        section,
        mode = 'paused',
        positionMs = 0,
      ) => ({
        ...nodeReader,
        nodeHistoryEventCount: 4,
        nodeHistory: {
          header: { studyId: 'job-study' },
          status: 'complete',
          entries: replayEntries,
        },
        nodeHistoryLearningSummary: replayLearning,
        nodeHistoryPosition: position,
        nodeHistorySection: { ...replaySection, ...section },
        nodeHistoryPlayback: {
          mode,
          sequence: position.sequence,
          positionMs,
          startMs: 100,
          endMs: 900,
          loading: false,
        },
      })
      const atFirstOutput = testReplayAt(
          { sequence: 1, eventIndex: 0 },
          {
            position: 'Output · 0.10 s',
            notRecorded: notRecordedLine,
            previousStop: false,
            nextStop: true,
          },
          'paused',
          100,
        ),
        atStop = testReplayAt(
          {
            sequence: 3,
            eventIndex: 2,
            sourceAvailable: true,
            debuggerAvailable: true,
          },
          {
            position: 'Stop 1 of 1 · 0.42 s',
            explanation: 'The stop shows the delay of 5,000 ms.',
            selectedStepId: 'read',
            sameMomentStepIds: ['keep'],
            previousStop: false,
            nextStop: false,
          },
          'paused',
          420,
        ),
        atResult = testReplayAt(
          { sequence: 4, eventIndex: 3 },
          {
            position: 'Result · Test passed · exit code 0 · 0.90 s',
            explanation: 'The job ran after its timer, so the test passed.',
            notRecorded: notRecordedLine,
            selectedStepId: 'verdict',
            previousStop: true,
            nextStop: false,
          },
          'paused',
          900,
        )
      /** Reads the section's lines, the step marked current and the steps marked as the same recorded moment. */
      const replaySectionLines = () =>
        page.evaluate(() => ({
          position: document.getElementById('node-history-position')
            .textContent,
          explanation: document.getElementById('node-history-explanation')
            .textContent,
          notRecorded: document.getElementById('node-history-not-recorded')
            .textContent,
          current: Array.from(
            document.querySelectorAll(
              '#node-learning-steps [data-node-step][aria-current="true"]',
            ),
            (control) => control.dataset.nodeStep,
          ),
          sameMoment: Array.from(
            document.querySelectorAll(
              '#node-learning-steps .same-moment:not([hidden])',
            ),
            (note) =>
              note.parentElement.querySelector('[data-node-step]').dataset
                .nodeStep,
          ),
          stepControls: document.querySelectorAll(
            '#node-learning-steps [data-node-step]',
          ).length,
        }))
      // Act: the replay opens on its first output, then shows the stop and the result.
      await page.setViewportSize({ width: 600, height: 800 })
      await publish(atFirstOutput)
      const firstOutputLines = await replaySectionLines()
      await publish(atStop)
      const stopLines = await replaySectionLines()
      await publish(atResult)
      const resultLines = await replaySectionLines()
      // Assert
      // Moves with D8 (the later region-2 composition): this Study-pane pin follows the test replay section to wherever D8 places it.
      // Value: protects=the section shows each moment's locator, explanation and not-recorded line, marks exactly the selected step current and names the other steps of its moment as the same recorded moment; fails_when=a moment shows another moment's line, two steps read as current, or the same-moment note names the wrong step; why_new=PR-B1 (Design 8, DS21) draws the summary through the shared renderer with a selected step per event; seam=none; no_claim=how the host chooses the step (projectNodeTestSection's tests) (stand-ins: the Study messages of the job scheduler's replay at three moments)
      cases.push({
        name: 'a test replay section shows each moment’s locator, explanation and not-recorded line, marks exactly the selected step current and names the other steps of its moment (Design 8)',
        actual: { firstOutputLines, stopLines, resultLines },
        passed:
          JSON.stringify({ firstOutputLines, stopLines, resultLines }) ===
          JSON.stringify({
            firstOutputLines: {
              position: 'Output · 0.10 s',
              explanation: '',
              notRecorded: notRecordedLine,
              current: [],
              sameMoment: [],
              stepControls: 3,
            },
            stopLines: {
              position: 'Stop 1 of 1 · 0.42 s',
              explanation: 'The stop shows the delay of 5,000 ms.',
              notRecorded: '',
              current: ['read'],
              sameMoment: ['keep'],
              stepControls: 3,
            },
            resultLines: {
              position: 'Result · Test passed · exit code 0 · 0.90 s',
              explanation: 'The job ran after its timer, so the test passed.',
              notRecorded: notRecordedLine,
              current: ['verdict'],
              sameMoment: [],
              stepControls: 3,
            },
          }),
      })
      // Moves with D8 (the later region-2 composition): this Study-pane pin follows the test replay section to wherever D8 places it.
      // Value: protects=an interrupted or partial test replay shows why its capture ended on its own line under the status, and the line takes no room (it is not displayed) when the capture has no reason; fails_when=the reason never reaches the page (the regression of PR-B1), it is shown for a complete capture, or the empty line keeps its margin; why_new=F130: the section lost the old status line's reason; seam=none; no_claim=how the host words the reason (projectNodeTestSection's tests) (stand-ins: the Study messages the host posts)
      // Arrange
      const readCaptureReason = () =>
        page.evaluate(() => {
          const line = document.getElementById('node-history-capture-reason')
          return {
            text: line.textContent,
            displayed: getComputedStyle(line).display !== 'none',
          }
        })
      // Act
      await publish(
        testReplayAt(
          { sequence: 1, eventIndex: 0 },
          {
            captureReason:
              'Capture interrupted: Interrupted test replay after its verified prefix: Error: EIO',
          },
          'paused',
          100,
        ),
      )
      const interruptedReason = await readCaptureReason()
      await publish(atFirstOutput)
      const completeReason = await readCaptureReason()
      // Assert
      cases.push({
        name: 'an interrupted test replay shows why its capture ended under the status, and a complete one shows no such line',
        actual: { interruptedReason, completeReason },
        passed:
          JSON.stringify({ interruptedReason, completeReason }) ===
          JSON.stringify({
            interruptedReason: {
              text: 'Capture interrupted: Interrupted test replay after its verified prefix: Error: EIO',
              displayed: true,
            },
            completeReason: { text: '', displayed: false },
          }),
      })
      // Moves with D8 (the later region-2 composition): this Study-pane pin follows the test replay section to wherever D8 places it.
      // Value: protects=the test replay's slider showing the whole recorded range as one unrecorded span with a tick at each verified stop and the catalog legend, and nothing for a one-event history; fails_when=the section's timeline is not drawn by the shared coverage drawing, the legend differs, or a one-event history shows a mark; why_new=Design 8's remaining part (gap mark at the first output), red first on the build without the shared drawing; seam=none; no_claim=native pixels or the browser transport (its golden DOM case)
      // Arrange: the replay at its first output, then a replay of one event, which has nothing to mark.
      await publish(atFirstOutput)
      const readCoverage = () =>
        page.evaluate(() => {
          const strip = document.getElementById('node-history-coverage')
          return {
            hidden: strip.hidden,
            gaps: strip.querySelectorAll('.history-gap').length,
            stops: strip.querySelectorAll('.history-stop').length,
            gapWidth: strip.querySelector('.history-gap')?.style.width ?? '',
            stopLeft: strip.querySelector('.history-stop')?.style.left ?? '',
            legend: document.getElementById('node-history-coverage-label')
              .textContent,
            name: strip.getAttribute('aria-label'),
            // The strip is drawn inside the slider's track, below the slider.
            insideTrack: Boolean(strip.closest('.timeline-track')),
            height: Math.round(strip.getBoundingClientRect().height),
          }
        })
      // Act
      const firstOutputCoverage = await readCoverage()
      await publish(
        testReplayAt(
          { sequence: 1, eventIndex: 0 },
          { timeline: undefined, previousStop: false, nextStop: false },
          'paused',
          100,
        ),
      )
      const oneEventCoverage = await readCoverage()
      // Assert
      cases.push({
        name: 'the test replay’s first output shows its gap mark and a tick at the verified stop under the catalog legend, and a history without a span shows no mark',
        actual: { firstOutputCoverage, oneEventCoverage },
        passed:
          JSON.stringify({ firstOutputCoverage, oneEventCoverage }) ===
          JSON.stringify({
            firstOutputCoverage: {
              hidden: false,
              gaps: 1,
              stops: 1,
              gapWidth: '100%',
              stopLeft: '40%',
              legend:
                'Ticks mark recorded stops; source and debugger are not recorded between them.',
              name: '1 source/debugger history gap: 0.10 s–0.90 s; 1 recorded stop: 0.42 s',
              insideTrack: true,
              height: 6,
            },
            oneEventCoverage: {
              hidden: true,
              gaps: 0,
              stops: 0,
              gapWidth: '',
              stopLeft: '',
              legend: '',
              name: 'Historical source and debugger coverage unknown',
              insideTrack: true,
              height: 0,
            },
          }),
      })
      // Moves with D8 (the later region-2 composition): this Study-pane pin follows the test replay section to wherever D8 places it.
      // Value: protects=a closed Application pane is named in the test replay section with a way back: the row with Show recorded output appears, its click asks the host for the pane (`focus-app`), and the row goes once the pane is back; fails_when=the row stays hidden while the pane is closed, the button sends another action (`arrange`, which could not bring the pane back), or the row stays after the pane is back; why_new=Step 9 pass 1b's QA critical (Show recorded output could not bring the pane back) and pass 2's testing review: no DOM case showed the row or clicked it; seam=none; no_claim=that the host builds the pane again, which studyWorkspaceTestReplayOutput.test.ts proves
      // Arrange: the stop of the replay while the learner has closed the Application pane.
      const paneClosedLine = 'The Application pane is closed.'
      await publish(
        testReplayAt(
          atStop.nodeHistoryPosition,
          {
            ...atStop.nodeHistorySection,
            applicationClosed: true,
            pointer: paneClosedLine,
          },
          'paused',
          420,
        ),
      )
      const whenClosed = await page.evaluate(() => ({
        rowShown: !document.getElementById('node-history-closed').hidden,
        pointer: document.getElementById('node-history-pointer').textContent,
      }))
      await page.evaluate(() => {
        window.sent = []
      })
      // Act
      await page.locator('#node-history-closed button').click()
      const sentOnClick = await page.evaluate(() =>
        window.sent
          .filter((message) => message.type === 'action')
          .map((message) => message.action),
      )
      await publish(atStop)
      const rowShownWhenBack = await page.evaluate(
        () => !document.getElementById('node-history-closed').hidden,
      )
      // Assert
      cases.push({
        name: 'a closed Application pane is named in the test replay section, Show recorded output asks for it again, and the row goes once the pane is back (DS7)',
        actual: { whenClosed, sentOnClick, rowShownWhenBack },
        passed:
          JSON.stringify({ whenClosed, sentOnClick, rowShownWhenBack }) ===
          JSON.stringify({
            whenClosed: { rowShown: true, pointer: paneClosedLine },
            sentOnClick: ['focus-app'],
            rowShownWhenBack: false,
          }),
      })
      // Arrange: the keyboard alone, from the opened replay (DS17): Step details, a step of the stop, Next stop, Previous stop, a seek and Pause.
      await publish(atFirstOutput)
      await page.evaluate(() => {
        window.sent = []
      })
      // Act
      await toggleByKeyboard('node-learning-steps-details')
      await page.locator('#node-learning-steps [data-node-step="keep"]').focus()
      await page.keyboard.press('Enter')
      await page.locator('#node-history-stop-next').focus()
      await page.keyboard.press('Enter')
      await publish(atResult)
      await page.locator('#node-history-stop-previous').focus()
      await page.keyboard.press('Enter')
      await publish(atStop)
      await page.locator('#node-history-playhead').focus()
      await page.keyboard.press('End')
      await publish(
        testReplayAt(
          atStop.nodeHistoryPosition,
          atStop.nodeHistorySection,
          'playing',
          420,
        ),
      )
      await page.locator('#node-history-playback-toggle').focus()
      await page.keyboard.press('Enter')
      const keyboardRequests = await page.evaluate(() =>
        window.sent
          .filter((message) => message.type.startsWith('node-history'))
          .map(({ type, sequence, stepId, direction, unit, action }) => ({
            type,
            sequence,
            stepId,
            direction,
            unit,
            action,
          })),
      )
      // Assert
      // Moves with D8 (the later region-2 composition): this Study-pane pin follows the test replay section to wherever D8 places it.
      // Value: protects=the keyboard alone opens Step details, selects a step of the stop, moves by Next stop and Previous stop, seeks and pauses, each press sending the one request the control names; fails_when=a control cannot be pressed by keyboard or sends another request; why_new=PR-B1 (Design 8, DS17) rebuilt the transport and the summary; seam=none; no_claim=the host's answer to each request and the Application pane's output region (the next case reaches it)
      cases.push({
        name: 'the keyboard alone opens Step details, selects a step of the stop, moves by Next stop and Previous stop, seeks and pauses a test replay (Design 8)',
        actual: keyboardRequests,
        passed:
          JSON.stringify(keyboardRequests) ===
          JSON.stringify([
            { type: 'node-history-event', sequence: 3, stepId: 'keep' },
            { type: 'node-history-step', direction: 'next', unit: 'stop' },
            { type: 'node-history-step', direction: 'previous', unit: 'stop' },
            { type: 'node-history-playback', action: 'seek' },
            { type: 'node-history-playback', action: 'pause' },
          ]),
      })
      // Moves with D8 (the later region-2 composition): this Study-pane pin follows the test replay section to wherever D8 places it.
      // Value: protects=the keyboard's whole path through a test replay (DS17): Open the replay from Saved studies (the list's own key handling is the browser's), then Step details, a step, Next stop, Previous stop, a seek and Pause in the Study pane, and then the Application pane's output region, which the first Tab of the document reaches and a page key scrolls; fails_when=choosing the replay by keyboard asks the host for another entry or nothing, a step of the path is not reached by Tab presses (a control outside the tab order passes a script focus, F295), or the output region is no tab stop, has no name or does not scroll by keyboard; why_new=F122 (AC13 path): the keyboard case began after Open and never reached the output region; seam=none; no_claim=the host's answer to each request (the workspace tests) (stand-ins: the pane's sent messages and a document of the Application pane in a page of its own)
      // Arrange: a saved replay listed in Saved studies and none opened.
      const savedReplays = [
          {
            id: 'job-study',
            savedAt: '2026-10-22T06:00:00.000Z',
            profile: 'node-test',
            format: 'node-test-history',
            outcome:
              'Test replay · Test passed · exit code 0 · capture complete · 1 of 1 stops explained',
            metadata: 'validated',
          },
          {
            id: 'other-replay',
            savedAt: '2026-10-21T06:00:00.000Z',
            profile: 'node-test',
            format: 'node-test-history',
            outcome:
              'Test replay · Test failed · exit code 1 · capture complete · 0 of 1 stops explained',
            metadata: 'validated',
          },
        ],
        savedReplayCatalog = [
          { studyId: 'job-study' },
          { studyId: 'other-replay' },
        ]
      await publish({
        ...options.message,
        revision: revisionAt(5),
        studies: savedReplays,
        nodeHistoryCatalog: savedReplayCatalog,
      })
      // The replay chosen below, at a moment: Saved studies still lists both replays, and the history shown is the chosen one (F306).
      const openedAt = (at) => ({
        ...at,
        studies: savedReplays,
        nodeHistoryCatalog: savedReplayCatalog,
        nodeHistory: { ...at.nodeHistory, header: { studyId: 'other-replay' } },
      })
      await page.evaluate(() => {
        window.sent = []
      })
      // Act: Open by keyboard, then the path inside the Study pane.
      await page.locator('#studies').focus()
      const sentHistory = () =>
        page.evaluate(() =>
          window.sent
            .filter((message) => message.type === 'node-history')
            .map(({ type, studyId }) => ({ type, studyId })),
        )
      // The native list's own key handling is the browser's (it opens a popup on some systems); the choice is made as the list reports it.
      await page.selectOption('#studies', 'other-replay')
      const openRequests = await sentHistory()
      const reachableControls = {},
        listedWhileOpen = []
      for (const [name, selector, at] of [
        [
          'stepDetails',
          '#node-learning-steps-details > summary',
          atFirstOutput,
        ],
        ['nextStop', '#node-history-stop-next', atFirstOutput],
        ['previousStop', '#node-history-stop-previous', atResult],
        ['playhead', '#node-history-playhead', atStop],
        ['pause', '#node-history-playback-toggle', atStop],
      ]) {
        await publish(openedAt(at))
        listedWhileOpen.push({
          listed: await page
            .locator('#studies option')
            .evaluateAll((choices) => choices.map((choice) => choice.value)),
          chosen: await page.locator('#studies').inputValue(),
        })
        // The press count that reaches the control by Tab from the replay chooser (0 when it is outside the tab order or beyond the limit), never a script focus: a control with tabindex -1 or one that is hidden is not reached (F295).
        await page.locator('#studies').focus()
        let presses = 0
        for (let press = 1; press <= 120 && presses === 0; press++) {
          await page.keyboard.press('Tab')
          if (
            await page.evaluate(
              (selector) =>
                document.activeElement === document.querySelector(selector),
              selector,
            )
          )
            presses = press
        }
        reachableControls[name] = presses > 0
      }
      // Act: the output region of the Application pane, from the first Tab of its document.
      const outputPage = await page.context().newPage()
      await outputPage.setViewportSize({ width: 760, height: 360 })
      await outputPage.goto(options.url)
      await outputPage.evaluate(() => {
        window.savedState = undefined
        window.acquireVsCodeApi = () => ({
          getState: () => window.savedState,
          setState(state) {
            window.savedState = state
          },
          postMessage: () => {},
        })
      })
      await outputPage.setContent(options.html.application)
      // The result's view holds enough lines to scroll.
      await outputPage.evaluate((view) => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'node-history-output',
              generation: 2,
              view: { ...view, generation: 2 },
            },
          }),
        )
      }, options.testReplayViews.result)
      await outputPage.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      )
      await outputPage.keyboard.press('Tab')
      const outputRegion = await outputPage.evaluate(() => {
        const region = document.getElementById('test-output')
        region.scrollTop = 0
        return {
          focused: document.activeElement === region,
          role: region.getAttribute('role'),
          named: Boolean(region.getAttribute('aria-label')),
        }
      })
      await outputPage.keyboard.press('PageDown')
      // The browser scrolls a key press smoothly.
      await outputPage.waitForTimeout(400)
      const outputScrolledByKey = await outputPage.evaluate(
        () => document.getElementById('test-output').scrollTop > 0,
      )
      await outputPage.close()
      // Assert
      cases.push({
        name: 'the keyboard reaches a test replay from Open through Step details, Next stop, Previous stop, a seek and Pause to the Application pane’s output region (DS17)',
        actual: {
          openRequests,
          listedWhileOpen,
          reachableControls,
          outputRegion,
          outputScrolledByKey,
        },
        passed:
          JSON.stringify(openRequests) ===
            JSON.stringify([
              { type: 'node-history', studyId: 'other-replay' },
            ]) &&
          listedWhileOpen.every(
            ({ listed, chosen }) =>
              listed.includes('job-study') &&
              listed.includes('other-replay') &&
              chosen === 'other-replay',
          ) &&
          Object.values(reachableControls).every(Boolean) &&
          outputRegion.focused &&
          outputRegion.role === 'region' &&
          outputRegion.named &&
          outputScrolledByKey,
      })
      // Arrange: the section's four move buttons with a replay saved and none chosen, then at three moments of the replay (DS12): the stop buttons follow the stops around the selected event, the event buttons its place among the events.
      /** Reads which of the section's move buttons the learner can press. */
      const enabledMoves = () =>
        page.evaluate(() =>
          Object.fromEntries(
            [
              ['previousStop', 'node-history-stop-previous'],
              ['nextStop', 'node-history-stop-next'],
              ['previousEvent', 'node-history-moment-previous'],
              ['nextEvent', 'node-history-moment-next'],
            ].map(([move, id]) => [
              move,
              !document.getElementById(id).disabled,
            ]),
          ),
        )
      // Act
      await publish({
        ...options.message,
        revision: revisionAt(5),
        nodeHistoryCatalog: [{ studyId: 'job-study' }],
      })
      const movesWithNoReplay = await enabledMoves()
      await publish(atFirstOutput)
      const movesAtTheFirstOutput = await enabledMoves()
      await publish(atStop)
      const movesAtTheOnlyStop = await enabledMoves()
      await publish(atResult)
      const movesAtTheResult = await enabledMoves()
      // Assert
      // Moves with D8 (the later region-2 composition): this Study-pane pin follows the test replay section to wherever D8 places it.
      // Value: protects=the section's four move buttons can be pressed only where the move exists: with no replay chosen none can; at the first output Next stop and Next event can; at the only stop, which has events on both sides, neither stop button can but both event buttons can; at the result Previous stop and Previous event can, and Next stop and Next event cannot; fails_when=a stop button is enabled where no stop lies that way (the learner's press ends in a refusal line), a button the host would honor stays disabled, the stop buttons follow the event position or the event buttons follow the stops, or a button can be pressed with no replay; why_new=PR-B1 adds the stop buttons beside the event buttons and takes their state from the host's flags (DS12), and no case reads a disabled state: the keyboard case presses buttons that are enabled and the focus case reads them for a replay of one event only; seam=none; no_claim=which flags the host sends for each moment (projectNodeTestSection's tests) or what a press sends (the keyboard case) (stand-ins: the Study messages the host posts)
      cases.push({
        name: 'a test replay offers Previous stop and Next stop only where a stop lies that way and Previous event and Next event only where an event does (Design 8, DS12)',
        actual: {
          movesWithNoReplay,
          movesAtTheFirstOutput,
          movesAtTheOnlyStop,
          movesAtTheResult,
        },
        passed:
          JSON.stringify({
            movesWithNoReplay,
            movesAtTheFirstOutput,
            movesAtTheOnlyStop,
            movesAtTheResult,
          }) ===
          JSON.stringify({
            movesWithNoReplay: {
              previousStop: false,
              nextStop: false,
              previousEvent: false,
              nextEvent: false,
            },
            movesAtTheFirstOutput: {
              previousStop: false,
              nextStop: true,
              previousEvent: false,
              nextEvent: true,
            },
            movesAtTheOnlyStop: {
              previousStop: false,
              nextStop: false,
              previousEvent: true,
              nextEvent: true,
            },
            movesAtTheResult: {
              previousStop: true,
              nextStop: false,
              previousEvent: true,
              nextEvent: false,
            },
          }),
      })
      /** Counts the rendered lines of an element by the height of a one-word copy of it, so a clamp to two lines is measured as the learner sees it. */
      const renderedLines = (shownIn, selector) =>
        shownIn.evaluate((selector) => {
          const shown = document.querySelector(selector),
            probe = shown.cloneNode(false)
          probe.removeAttribute('id')
          probe.textContent = 'X'
          shown.after(probe)
          const lines = Math.round(
            shown.getBoundingClientRect().height /
              probe.getBoundingClientRect().height,
          )
          probe.remove()
          return lines
        }, selector)
      // Act: the stop's section at three widths (DS19).
      await publish(atStop)
      const studyWidths = []
      for (const width of [320, 480, 760]) {
        await page.setViewportSize({ width, height: 720 })
        studyWidths.push({
          width,
          ...(await page.evaluate(() => {
            const diagram = document.querySelector(
              '#node-learning-sequence .sequence-diagram',
            )
            return {
              pageScrolls:
                document.documentElement.scrollWidth >
                document.documentElement.clientWidth,
              diagramFitsOrScrollsInside:
                diagram.scrollWidth <= diagram.clientWidth ||
                getComputedStyle(diagram).overflowX === 'auto',
            }
          })),
          titleLines: await renderedLines(page, '#node-learning-title'),
        })
      }
      await page.setViewportSize({ width: 600, height: 800 })
      await page.locator('#node-learning-steps-details').evaluate((details) => {
        details.open = false
      })
      // Assert
      // Moves with D8 (the later region-2 composition): this Study-pane pin follows the test replay section to wherever D8 places it.
      // Value: protects=the section never widens the page at 320, 480 or 760 px, keeps the learning title to two lines and lets the diagram scroll inside itself; fails_when=a long title, a wide diagram or a long event line widens the page; why_new=PR-B1 (Design 8, DS19) added the section's widths to the pane; seam=none; no_claim=native pixels (a screenshot is kept beside the result)
      cases.push({
        name: 'a test replay section at 320, 480 and 760 px has no page-level horizontal scroll, a title of at most two lines and a sequence diagram that scrolls inside itself (Design 8)',
        actual: studyWidths,
        passed: studyWidths.every(
          (reading) =>
            !reading.pageScrolls &&
            reading.diagramFitsOrScrollsInside &&
            reading.titleLines >= 1 &&
            reading.titleLines <= 2,
        ),
      })
      // Moves with D8 (the later region-2 composition): this Study-pane pin follows the test replay section to wherever D8 places it.
      // Value: protects=the test replay's learning title, clamped to two lines, follows the browser summary's title rule: a cut title is a tab stop that is shown whole while it has the keyboard focus, a title that fits is no tab stop, and the tooltip keeps the whole sentence; fails_when=a cut title can be read only from its hover tooltip, it is not shown whole on focus, or a fitting title takes a tab stop; why_new=F144 (pass 3 maintainability): unlike #learning-title, #node-learning-title had no tab stop; seam=none; no_claim=the Application header's test line (its case follows the Application widths)
      // Arrange: the stop's section at 320 px with a long learning title, then with its short one.
      const longTitle =
        'How the job scheduler delays a job until its timer fires and then reports the result of the test to the caller'
      const titleStop = (title) => ({
        ...atStop,
        nodeHistoryLearningSummary: {
          ...atStop.nodeHistoryLearningSummary,
          content: { ...atStop.nodeHistoryLearningSummary.content, title },
        },
      })
      const readLearningTitle = async () => ({
        tabindex: await page
          .locator('#node-learning-title')
          .getAttribute('tabindex'),
        lines: await renderedLines(page, '#node-learning-title'),
        tooltip: await page
          .locator('#node-learning-title')
          .getAttribute('title'),
      })
      // Act
      await page.setViewportSize({ width: 320, height: 720 })
      await publish(titleStop(longTitle))
      const clampedLearningTitle = await readLearningTitle()
      await page.locator('#node-learning-title').focus()
      const focusedLearningTitle = await readLearningTitle()
      await page.evaluate(() => document.activeElement.blur())
      await publish(titleStop('Delayed job'))
      const fittingLearningTitle = await readLearningTitle()
      await page.setViewportSize({ width: 600, height: 800 })
      // Assert
      cases.push({
        name: 'a test replay’s learning title that the two-line clamp cuts is a tab stop shown whole on focus, and a title that fits is no tab stop',
        actual: {
          clampedLearningTitle,
          focusedLearningTitle,
          fittingLearningTitle,
        },
        passed:
          clampedLearningTitle.tabindex === '0' &&
          clampedLearningTitle.lines === 2 &&
          clampedLearningTitle.tooltip === longTitle &&
          focusedLearningTitle.lines > 2 &&
          fittingLearningTitle.tabindex === null &&
          fittingLearningTitle.lines === 1,
      })
      // Moves with D8 (the later region-2 composition): this Study-pane pin follows the test replay section to wherever D8 places it.
      // Value: protects=markup in a test replay's learning material (title, question, summary, participants, step labels and explanations) is shown as text in the Study section and never becomes an element or runs; fails_when=an agent-written `<img onerror>` or `<script>` becomes an element of the section, runs, or is dropped from the text; why_new=F124 (S3-1): the escaping was tested for the Application document only; seam=none; no_claim=the Application document (its own case) (stand-ins: a Study message with hostile learning text)
      // Arrange: a stop whose saved material holds markup in every text.
      const hostile = '<img src=x onerror="window.invented=true">'
      const hostileStop = {
        ...atStop,
        nodeHistoryLearningSummary: {
          content: {
            ...atStop.nodeHistoryLearningSummary.content,
            title: `Title ${hostile}`,
            question: `Question ${hostile}`,
            summary: `Summary <script>window.invented=true</script>`,
            participants: [
              { id: 'test', label: `Test ${hostile}` },
              { id: 'scheduler', label: 'schedule' },
            ],
            steps: atStop.nodeHistoryLearningSummary.content.steps.map(
              (step) => ({
                ...step,
                label: `${step.label} ${hostile}`,
                explanation: `${step.explanation} <b>bold</b>`,
              }),
            ),
          },
          positions: atStop.nodeHistoryLearningSummary.positions,
        },
      }
      await page.evaluate(() => {
        window.invented = undefined
      })
      // Act
      await publish(hostileStop)
      const hostileReading = await page.evaluate(() => {
        const block = document.getElementById('node-history-learning')
        return {
          elements: block.querySelectorAll('img, script, b').length,
          invented: window.invented === true,
          title: document.getElementById('node-learning-title').textContent,
          summary: document.getElementById('node-learning-summary').textContent,
          explanation: block.querySelector('#node-learning-steps p')
            ?.textContent,
        }
      })
      await publish(atStop)
      // Assert
      cases.push({
        name: 'markup in a test replay’s learning material is shown as text in the Study section and never becomes an element',
        actual: hostileReading,
        passed:
          hostileReading.elements === 0 &&
          !hostileReading.invented &&
          hostileReading.title === `Title ${hostile}` &&
          hostileReading.summary ===
            'Summary <script>window.invented=true</script>' &&
          hostileReading.explanation?.endsWith(' <b>bold</b>') === true,
      })
      // Moves with D8 (the later region-2 composition): this Study-pane pin follows the test replay section to wherever D8 places it.
      // Value: protects=the sticky test replay transport is counted in the pane's focus scroll room, so a control reached by Shift+Tab (Step details, a step, the learner's choice, Events) is never scrolled under it; the transport sticks below the live strip of a running study, not over it; a transport taller than the fraction of the pane that may stay fixed flows with the page; fails_when=a focused control's top lies under the transport (focus obscured, also with the live strip pinned above it at 960 x 600, F294), the transport and the live strip cover each other, or a pane too short for a fixed bar still pins it; why_new=F128 (pass 1b red team): --codebook-sticky-height measured the live strip only and the transport had no flowing fallback; seam=none; no_claim=native pixels (stand-ins: the Study message of a stop at 960 x 420 px, real Shift+Tab presses)
      // Arrange: the stop's section in a short pane with Step details and the event list open, scrolled to the end.
      await page.setViewportSize({ width: 960, height: 420 })
      await publish(atStop)
      await page.evaluate(() => {
        document.getElementById('node-learning-steps-details').open = true
        document.getElementById('node-history-events-details').open = true
      })
      await publish(atStop)
      const readStickyBars = () =>
        page.evaluate(() => {
          const transport = document.getElementById('node-history-transport'),
            strip = document.querySelector('.live-strip'),
            transportBox = transport.getBoundingClientRect(),
            focusedBox = document.activeElement.getBoundingClientRect()
          return {
            position: getComputedStyle(transport).position,
            transportTop: Math.round(transportBox.top),
            transportBottom: Math.round(transportBox.bottom),
            stripBottom: strip
              ? Math.round(strip.getBoundingClientRect().bottom)
              : 0,
            stripSticky: strip
              ? getComputedStyle(strip).position === 'sticky'
              : false,
            focusedId: document.activeElement.id,
            focusedInTransport: transport.contains(document.activeElement),
            focusedTop: Math.round(focusedBox.top),
          }
        })
      // Act: Shift+Tab from the event list back to Step details, reading where each focused control lies.
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      )
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.locator('#node-history-events-details > summary').focus()
      const focusReadings = [await readStickyBars()]
      for (let press = 0; press < 12; press++) {
        await page.keyboard.press('Shift+Tab')
        const reading = await readStickyBars()
        focusReadings.push(reading)
        if (reading.focusedInTransport) break
      }
      // Act: a short pane flows the transport, a taller one pins it again, and a running study keeps the transport below its strip.
      await page.setViewportSize({ width: 960, height: 150 })
      await publish(atStop)
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      )
      const inShortPane = await readStickyBars()
      await page.setViewportSize({ width: 960, height: 600 })
      await publish({ ...atStop, liveState: 'running' })
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      )
      const withRunningStudy = await readStickyBars()
      // Act: with both bars pinned (the live strip and the transport at 960 x 600), Shift+Tab from the event list back toward the transport, reading each focused control's clearance (F294).
      await page.locator('#node-history-events-details > summary').focus()
      const withBothBars = [await readStickyBars()]
      for (let press = 0; press < 12; press++) {
        await page.keyboard.press('Shift+Tab')
        const reading = await readStickyBars()
        withBothBars.push(reading)
        if (reading.focusedInTransport) break
      }
      await publish({ ...atStop, liveState: undefined })
      await page.setViewportSize({ width: 600, height: 800 })
      // Assert
      const scrolledBelowBothBars = withBothBars.filter(
        (reading) => !reading.focusedInTransport,
      )
      const scrolledBelowTransport = focusReadings.filter(
        (reading) => !reading.focusedInTransport,
      )
      cases.push({
        name: 'a control reached by Shift+Tab is never scrolled under the test replay transport, a pane too short for a fixed bar flows it, and a running study keeps it below the live strip',
        actual: { focusReadings, inShortPane, withRunningStudy, withBothBars },
        passed:
          scrolledBelowTransport.length >= 3 &&
          scrolledBelowTransport.every(
            (reading) =>
              reading.position === 'sticky' &&
              reading.transportTop === 0 &&
              reading.focusedTop >= reading.transportBottom - 1,
          ) &&
          inShortPane.position === 'static' &&
          withRunningStudy.stripSticky &&
          withRunningStudy.transportTop >= withRunningStudy.stripBottom - 1 &&
          // Both bars pinned: the focused control lies below the lower of the two (a focus scroll room without the strip scrolls it under the transport).
          scrolledBelowBothBars.length >= 3 &&
          scrolledBelowBothBars.every(
            (reading) =>
              reading.stripSticky &&
              reading.focusedTop >= reading.transportBottom - 1,
          ),
      })
      // Arrange: the section's states before it has a replay or an event to show (DS7), in the pane's fixed words (the String catalog): no replay saved, replays saved and none chosen, then a replay with no event selected and no saved learning, then the same replay with its learning again.
      /** Reads the section's status and locator lines, whether it says that no learning was saved, and what of the replay's diagram and steps is drawn. */
      const sectionReading = () =>
        page.evaluate(() => {
          const noMaterial = document.getElementById('node-history-no-material')
          return {
            status: document.getElementById('node-history-status').textContent,
            position: document.getElementById('node-history-position')
              .textContent,
            noMaterial: noMaterial.hidden ? 'hidden' : noMaterial.textContent,
            learning: document.getElementById('node-history-learning').hidden
              ? 'hidden'
              : 'shown',
            drawn:
              document.getElementById('node-learning-sequence').children
                .length +
              document.getElementById('node-learning-steps').children.length,
          }
        })
      // Act
      await publish({ ...options.message, revision: revisionAt(5) })
      const noReplaySaved = await sectionReading()
      await publish({
        ...options.message,
        revision: revisionAt(5),
        nodeHistoryCatalog: [{ studyId: 'job-study' }],
      })
      const noneChosen = await sectionReading()
      await publish(atStop)
      const withLearning = await sectionReading()
      await publish({
        ...atStop,
        nodeHistoryPosition: undefined,
        nodeHistoryPlayback: undefined,
        nodeHistoryLearningSummary: undefined,
        nodeHistorySection: {
          ...replaySection,
          previousStop: false,
          nextStop: true,
        },
      })
      const withoutSelectionAndLearning = await sectionReading()
      await publish(atStop)
      const learningAgain = await sectionReading()
      // Assert
      const withTheStop = {
        status:
          'Test passed · exit code 0 · capture complete · 1 of 1 stops explained',
        position: 'Stop 1 of 1 · 0.42 s',
        noMaterial: 'hidden',
        learning: 'shown',
        drawn: 2,
      }
      // Moves with D8 (the later region-2 composition): this Study-pane pin follows the test replay section to wherever D8 places it.
      // Value: protects=the Study pane's test replay section is never blank and never stale: it says that no replay is saved, to choose one, or to select an event, says when no learning summary was saved, and keeps no diagram or steps of the replay before it; fails_when=a state shows another's line or none, the no-learning line is missing or stays after learning returns, or a replay without learning shows the diagram of the replay before; why_new=PR-B1 reworded and moved these states (the String catalog) and no test, new or old, read any of them; seam=none; no_claim=what the host projects for each state (projectNodeTestSection's tests) or the line for a closed Application pane (stand-ins: the pane's page and the Study messages the host posts)
      cases.push({
        name: 'a test replay section says that no replay is saved, to choose one and to select an event, says when no learning summary was saved and draws no diagram of the replay before it (Design 8, DS7)',
        actual: {
          noReplaySaved,
          noneChosen,
          withLearning,
          withoutSelectionAndLearning,
          learningAgain,
        },
        passed:
          JSON.stringify({
            noReplaySaved,
            noneChosen,
            withLearning,
            withoutSelectionAndLearning,
            learningAgain,
          }) ===
          JSON.stringify({
            noReplaySaved: {
              status: 'No test replay has been saved in this workspace.',
              position: '',
              noMaterial: 'hidden',
              learning: 'hidden',
              drawn: 0,
            },
            noneChosen: {
              status:
                'Choose a test replay from Saved studies to step through its output and debugger stops.',
              position: '',
              noMaterial: 'hidden',
              learning: 'hidden',
              drawn: 0,
            },
            withLearning: withTheStop,
            withoutSelectionAndLearning: {
              status: withTheStop.status,
              position:
                'Select an event to move through the recorded test history.',
              noMaterial: 'No learning summary was saved for this test replay.',
              learning: 'hidden',
              drawn: 0,
            },
            learningAgain: withTheStop,
          }),
      })
      // Arrange: the Application pane's document of the same replay at its first output (Design 3), in a page of its own; the stand-in for the webview API records what the document tells the host (D22); the Study page stays as it is for the cases that follow.
      const applicationPage = await page.context().newPage()
      await applicationPage.setViewportSize({ width: 760, height: 360 })
      await applicationPage.goto(options.url)
      await applicationPage.evaluate(() => {
        window.sent = []
        window.acquireVsCodeApi = () => ({
          getState: () => undefined,
          setState() {},
          postMessage: (message) => window.sent.push(structuredClone(message)),
        })
      })
      await applicationPage.setContent(options.html.application)
      const twoFrames = () =>
        applicationPage.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        )
      await twoFrames()
      const firstOutputDocument = await applicationPage.evaluate(() => ({
        time: document.getElementById('test-output-time').textContent,
        lines: Array.from(
          document.querySelectorAll('#test-output .output-text'),
          (line) => line.textContent,
        ).length,
        firstLine: document.querySelector('#test-output .output-text')
          ?.textContent,
        endHidden: document.getElementById('test-output-end').hidden,
      }))
      // Act: the learner scrolls up, selects a line and leaves the keyboard in the output; the host then posts the result's view, and a late older one.
      await applicationPage.evaluate(() => {
        document.getElementById('test-output').scrollTop = 0
      })
      await twoFrames()
      await applicationPage.evaluate(() => {
        const output = document.getElementById('test-output')
        getSelection().selectAllChildren(
          output.querySelectorAll('.output-text')[4],
        )
        output.focus()
      })
      await applicationPage.evaluate((views) => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'node-history-output',
              generation: 2,
              view: views.result,
            },
          }),
        )
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'node-history-output',
              generation: 1,
              view: views.first,
            },
          }),
        )
      }, options.testReplayViews)
      await twoFrames()
      const afterUpdate = await applicationPage.evaluate(() => {
        const output = document.getElementById('test-output')
        return {
          scrollTop: output.scrollTop,
          selection: getSelection().toString(),
          focused: document.activeElement?.id,
          lines: output.querySelectorAll('.output-line').length,
          stderrMarks: output.querySelectorAll('.stderr-mark').length,
          end: document.getElementById('test-output-end').textContent,
          time: document.getElementById('test-output-time').textContent,
          jumpShown: !document.getElementById('test-output-jump').hidden,
        }
      })
      // Act: Jump to latest by keyboard.
      await applicationPage.locator('#test-output-jump').focus()
      await applicationPage.keyboard.press('Enter')
      await twoFrames()
      const afterJump = await applicationPage.evaluate(() => {
        const output = document.getElementById('test-output')
        return {
          atEnd:
            output.scrollHeight - output.scrollTop - output.clientHeight <= 2,
          jumpShown: !document.getElementById('test-output-jump').hidden,
          focused: document.activeElement?.id,
          follow: window.sent
            .filter((message) => message.type === 'node-history-output-state')
            .at(-1)?.follow,
        }
      })
      // Assert
      // Value: protects=the Application document shows only the output up to its moment, and an in-place update to the result keeps the learner's scroll position, text selection and focus, ignores an older view and returns to the end with Jump to latest; fails_when=an update rewrites the page (the selection or focus is lost), an older view overwrites a newer one, or the end cannot be reached again; why_new=PR-B1 (Design 8, EN3) posts each later moment into one document; seam=none; no_claim=VS Code's webview (stand-ins: the page's message event and a stub of the webview API)
      cases.push({
        name: 'the Application document of a test replay shows only the output up to its moment, and an in-place update to the result keeps the learner’s scroll position, selection and focus, ignores an older view and returns to the end with Jump to latest (Design 8)',
        actual: { firstOutputDocument, afterUpdate, afterJump },
        passed:
          JSON.stringify({ firstOutputDocument, afterUpdate, afterJump }) ===
          JSON.stringify({
            firstOutputDocument: {
              time: 'Recorded test output · 0.10 s',
              lines: 40,
              firstLine: 'RUN src/jobs.test.ts',
              endHidden: true,
            },
            afterUpdate: {
              scrollTop: 0,
              selection: 'job 4 scheduled',
              focused: 'test-output',
              lines: 41,
              stderrMarks: 1,
              end: 'Test passed · exit code 0',
              time: 'Recorded test output · 0.90 s',
              jumpShown: true,
            },
            afterJump: {
              atEnd: true,
              jumpShown: false,
              focused: 'test-output',
              follow: true,
            },
          }),
      })
      // Act: the Application document at three widths (DS19).
      const applicationWidths = []
      for (const width of [320, 480, 760]) {
        await applicationPage.setViewportSize({ width, height: 360 })
        applicationWidths.push({
          width,
          pageScrolls: await applicationPage.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          ),
          testLines: await renderedLines(applicationPage, '#test-output-test'),
        })
      }
      // Act: the host posts two views of a long recorded output, 32,768 one-character lines, the second without the first line and with one more (EN3: the update matches lines by their number in time linear in the lines).
      const longUpdate = await applicationPage.evaluate(async () => {
        const frames = () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          )
        const lines = Array.from({ length: 32768 }, (_, index) => ({
          channel: 'stdout',
          text: String(index % 10),
          number: index + 1000,
        }))
        const view = {
          time: 'Recorded test output · 0.90 s',
          test: 'src/jobs.test.ts',
          name: 'Recorded test output · src/jobs.test.ts · 0.90 s',
          region: 'Recorded test output up to 0.90 s',
        }
        const post = (generation, shown) =>
          window.dispatchEvent(
            new MessageEvent('message', {
              data: {
                type: 'node-history-output',
                generation,
                view: { ...view, generation, lines: shown },
              },
            }),
          )
        post(10, lines)
        await frames()
        const started = performance.now()
        post(11, [
          ...lines.slice(1),
          { channel: 'stdout', text: 'last', number: 33768 },
        ])
        await frames()
        const elapsed = performance.now() - started
        return {
          // gstack-timing-ok: the bound guards a hang, not a speed: the earlier per-line lookup took 3.5 s and this update 61 ms on the Mac, so 1 s keeps a wide margin each way.
          underASecond: elapsed < 1000,
          lines: document.querySelectorAll('#test-output .output-line').length,
          last: document.querySelector('#test-output .output-line:last-child')
            ?.textContent,
        }
      })
      // Assert
      // Value: protects=an in-place update of the longest recorded output (32,768 one-character lines, then one line dropped and one added) matches lines by their number and takes under a second; fails_when=the update rebuilds the output or matches lines in quadratic time, so Play on a long output stalls the pane; why_new=PR-B1 (EN3): the update path is new and its cost is bounded by this case; seam=the page's performance clock; no_claim=the speed of another machine (the bound is a second, not a benchmark)
      cases.push({
        name: 'an in-place update of a recorded test output of 32,768 lines takes less than a second in the Application pane (Design 8, EN3)',
        actual: longUpdate,
        passed:
          longUpdate.underASecond &&
          longUpdate.lines === 32768 &&
          longUpdate.last === 'last\n',
      })
      // Arrange: Application documents the way the editor loads them, each in a page of its own (a webview loads a new document in a fresh page), with a stand-in for the webview API that records what the document tells the host.
      /** Waits two frames, so a view queued for the next frame is drawn and the layout has settled. */
      const settleFrames = (target) =>
        target.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        )
      /** Opens an Application document in a fresh page; `prepare` runs in the page before the document is set. */
      const openApplication = async (html, prepare) => {
        const documentPage = await page.context().newPage()
        await documentPage.setViewportSize({ width: 760, height: 360 })
        await documentPage.goto(options.url)
        await documentPage.evaluate(() => {
          window.sent = []
          window.acquireVsCodeApi = () => ({
            // State an earlier document of the replay left in the webview: the document must not read it (D22).
            getState: () => window.priorState,
            setState() {},
            postMessage: (message) =>
              window.sent.push(structuredClone(message)),
          })
        })
        if (prepare) await documentPage.evaluate(prepare)
        await documentPage.setContent(html)
        await settleFrames(documentPage)
        return documentPage
      }
      /** Posts a message into a document as the host does. */
      const postToDocument = (target, data) =>
        target.evaluate(
          (message) =>
            window.dispatchEvent(
              new MessageEvent('message', { data: message }),
            ),
          data,
        )
      /** Reads where a document stands: its header time, whether it is at the end of the output, whether Jump to latest shows, the first line in view with how far its top is above the region's, the last reported state and the scroll position. */
      const readDocument = (target) =>
        target.evaluate(() => {
          const output = document.getElementById('test-output')
          const regionTop = output.getBoundingClientRect().top
          const firstInView = Array.from(output.children).find(
            (line) => line.getBoundingClientRect().bottom > regionTop,
          )
          const reports = window.sent.filter(
            (message) => message.type === 'node-history-output-state',
          )
          return {
            time: document.getElementById('test-output-time').textContent,
            atEnd:
              output.scrollHeight - output.scrollTop - output.clientHeight <= 2,
            jumpShown: !document.getElementById('test-output-jump').hidden,
            firstLine: Number(firstInView?.dataset.line),
            offsetPx: Math.round(
              regionTop - firstInView.getBoundingClientRect().top,
            ),
            lastReport: reports.at(-1) && {
              follow: reports.at(-1).follow,
              anchorLine: reports.at(-1).anchor?.line,
            },
            reportCount: reports.length,
            scrollTop: output.scrollTop,
          }
        })
      /** Gives the document's HTML another reading of the learner, as the host writes a document of the same replay. */
      const withReading = (html, reading) =>
        html.replace(
          '"reading":{"follow":true}',
          `"reading":${JSON.stringify(reading)}`,
        )
      const learnerScrolledTo = (target, top) =>
        target.evaluate((scrollTop) => {
          document.getElementById('test-output').scrollTop = scrollTop
        }, top)
      const resultView = options.testReplayViews.result
      // Value: protects=a document written for a replay opens where the host says the learner was, and ignores state an earlier document left in the webview: a stored choice not to follow does not outlive the host's choice to follow (F151), a choice not to follow with a scroll anchor opens at that line with Jump to latest, and the learner's place is found again by the line's number and offset (F120, F138); fails_when=the document reads the webview state (it opens at the top of the output for a replay the learner left following), drops the anchor (it opens at the oldest kept line), or follows the output although the host kept the learner reading higher up; why_new=D22 moves the follow choice and the scroll anchor from the webview's state to the host, which passes them in the document's options; seam=none; no_claim=how the host files the reading (the workspace tests), VS Code's own webview state, which the stand-in plays
      // Act: three documents of the same replay at its result: the host's reading is following (with stale webview state saying otherwise), not following at line 20 and 7 px, and the reading a scroll in a first document reported.
      const followingPage = await openApplication(
        options.html.applicationAtResult,
        () => {
          window.priorState = {
            testOutputFollow: false,
            testOutputHistory: 'an earlier document of this replay',
          }
        },
      )
      const followingDespitePriorState = await readDocument(followingPage)
      await followingPage.close()
      const anchoredPage = await openApplication(
        withReading(options.html.applicationAtResult, {
          follow: false,
          anchor: { line: 20, offsetPx: 7 },
        }),
      )
      const openedAtAnchor = await readDocument(anchoredPage)
      await anchoredPage.close()
      const readingPage = await openApplication(
        options.html.applicationAtResult,
      )
      await learnerScrolledTo(readingPage, 250)
      await settleFrames(readingPage)
      const whereLearnerRead = await readDocument(readingPage)
      const reported = await readingPage.evaluate(() =>
        window.sent
          .filter((message) => message.type === 'node-history-output-state')
          .at(-1),
      )
      await readingPage.close()
      const restoredPage = await openApplication(
        withReading(options.html.applicationAtResult, {
          follow: reported.follow,
          anchor: reported.anchor,
        }),
      )
      const restoredReading = await readDocument(restoredPage)
      await restoredPage.close()
      // Assert
      cases.push({
        name: 'an Application document opens where the host says the learner was: following, at a scroll anchor, or where the learner’s own scroll had been reported, and ignores state an earlier document left (D22, F120, F138, F151)',
        actual: {
          followingDespitePriorState,
          openedAtAnchor,
          whereLearnerRead,
          reported,
          restoredReading,
        },
        passed:
          followingDespitePriorState.atEnd &&
          !followingDespitePriorState.jumpShown &&
          followingDespitePriorState.time === 'Recorded test output · 0.90 s' &&
          !openedAtAnchor.atEnd &&
          openedAtAnchor.jumpShown &&
          openedAtAnchor.firstLine === 20 &&
          openedAtAnchor.offsetPx === 7 &&
          reported.follow === false &&
          reported.anchor.line === whereLearnerRead.firstLine &&
          restoredReading.firstLine === whereLearnerRead.firstLine &&
          Math.abs(restoredReading.offsetPx - whereLearnerRead.offsetPx) <= 1 &&
          restoredReading.jumpShown,
      })
      // Value: protects=a document that the editor reloads in place from an earlier write (Developer: Reload Webviews) tells the host it is ready with the generation it shows, and the host's answer with its current view and reading brings it to the host's moment and the learner's place; fails_when=the document sends no ready message (the host cannot tell its view is older), ignores the answer's view or reading, or draws it above an older generation; why_new=F141: the reloaded document showed an earlier moment until the next move; seam=none; no_claim=the host's decision to answer, which the workspace tests pin
      // Act: a document written with the first moment; the host answers its ready message with the result and a reading not following at line 12 and 4 px.
      const readyPage = await openApplication(options.html.application)
      const readyMessage = await readyPage.evaluate(() =>
        window.sent.find(
          (message) => message.type === 'node-history-output-ready',
        ),
      )
      const beforeAnswer = await readDocument(readyPage)
      await postToDocument(readyPage, {
        type: 'node-history-output',
        generation: 2,
        view: resultView,
        reading: { follow: false, anchor: { line: 12, offsetPx: 4 } },
      })
      await settleFrames(readyPage)
      const afterAnswer = await readDocument(readyPage)
      await readyPage.close()
      // Assert
      cases.push({
        name: 'an Application document tells the host it is ready, and the host’s answer brings it to the current moment and the learner’s place (F141)',
        actual: { readyMessage, beforeAnswer, afterAnswer },
        passed:
          readyMessage?.generation === 1 &&
          readyMessage.follow === true &&
          typeof readyMessage.history === 'string' &&
          beforeAnswer.time === 'Recorded test output · 0.10 s' &&
          afterAnswer.time === 'Recorded test output · 0.90 s' &&
          !afterAnswer.atEnd &&
          afterAnswer.jumpShown &&
          afterAnswer.firstLine === 12 &&
          afterAnswer.offsetPx === 4,
      })
      // Value: protects=the host's reading, delivered with the answer to `ready`, survives another view posted in the same animation frame (Play posts up to twenty a second), so the learner's place is still taken; fails_when=the newer queued view replaces the answer whole and the document stays following at the end of the output; why_new=F290: a queued update replaced the queued one with its reading; seam=none; no_claim=the host's decision to answer, which the workspace tests pin
      // Act: the answer (a result view with a reading not following at line 12 and 4 px) and a newer view without a reading arrive in the same task.
      const queuedReadingPage = await openApplication(options.html.application)
      await queuedReadingPage.evaluate((result) => {
        const post = (data) =>
          window.dispatchEvent(new MessageEvent('message', { data }))
        post({
          type: 'node-history-output',
          generation: 2,
          view: { ...result, generation: 2 },
          reading: { follow: false, anchor: { line: 12, offsetPx: 4 } },
        })
        post({
          type: 'node-history-output',
          generation: 3,
          view: {
            ...result,
            generation: 3,
            time: 'Recorded test output · newer',
          },
        })
      }, resultView)
      await settleFrames(queuedReadingPage)
      const afterQueuedReading = await readDocument(queuedReadingPage)
      await queuedReadingPage.close()
      // Assert
      cases.push({
        name: 'the host’s reading in an answer survives a newer view posted in the same frame (F290)',
        actual: { afterQueuedReading },
        passed:
          afterQueuedReading.time === 'Recorded test output · newer' &&
          !afterQueuedReading.atEnd &&
          afterQueuedReading.jumpShown &&
          afterQueuedReading.firstLine === 12 &&
          afterQueuedReading.offsetPx === 4,
      })
      // Value: protects=an answer to `ready` that the host built before the learner scrolled does not pull the learner back: the scroll after `ready` is fresher than the reading the answer carries; fails_when=the answer's follow choice scrolls the output to its end under the learner; why_new=F290: the answer overrode a scroll made after `ready`; seam=none; no_claim=a reading the host files after the scroll's report, which agrees with the scroll
      // Act: the document at the result follows the end; the learner scrolls up; then the answer built before that scroll (following) arrives with a newer view.
      const staleAnswerPage = await openApplication(
        options.html.applicationAtResult,
      )
      await learnerScrolledTo(staleAnswerPage, 250)
      await settleFrames(staleAnswerPage)
      const afterLearnerScroll = await readDocument(staleAnswerPage)
      await postToDocument(staleAnswerPage, {
        type: 'node-history-output',
        generation: 5,
        view: { ...resultView, generation: 5 },
        reading: { follow: true },
      })
      await settleFrames(staleAnswerPage)
      const afterStaleAnswer = await readDocument(staleAnswerPage)
      await staleAnswerPage.close()
      // Assert
      cases.push({
        name: 'an answer built before the learner’s scroll does not override that scroll (F290)',
        actual: { afterLearnerScroll, afterStaleAnswer },
        passed:
          afterLearnerScroll.jumpShown &&
          !afterLearnerScroll.atEnd &&
          !afterStaleAnswer.atEnd &&
          afterStaleAnswer.jumpShown &&
          afterStaleAnswer.firstLine === afterLearnerScroll.firstLine &&
          afterStaleAnswer.lastReport?.follow === false,
      })
      // Value: protects=following is decided by the scroll position alone: a scroll to the end that moves nothing (a view of the same height) leaves no mark that swallows the learner's next scroll up, so Jump to latest shows, following is reported off and the next moment does not pull the output back to its end; fails_when=the document's scroll that moved nothing is remembered, the learner's scroll up is read as the document's own, and the next moment scrolls to the end (DS20); why_new=F106: `scrolledByDocument` stayed set when the scroll to the end caused no scroll event; seam=none; no_claim=a clamp to a shorter output, which the in-place case below pins
      // Act: the result's output followed to its end; a view of the same height arrives (no scroll to make); the learner scrolls up; another view arrives.
      const sameHeightPage = await openApplication(
        options.html.applicationAtResult,
      )
      const changedLine = (generation, text) => ({
        ...resultView,
        generation,
        lines: resultView.lines.map((line) =>
          line.number === 1 ? { ...line, text } : line,
        ),
      })
      await postToDocument(sameHeightPage, {
        type: 'node-history-output',
        generation: 3,
        view: changedLine(3, 'job 1 changed'),
      })
      await settleFrames(sameHeightPage)
      await sameHeightPage.evaluate(() => {
        const output = document.getElementById('test-output')
        output.scrollTop = output.scrollTop - 120
      })
      await settleFrames(sameHeightPage)
      const afterScrollUp = await readDocument(sameHeightPage)
      await postToDocument(sameHeightPage, {
        type: 'node-history-output',
        generation: 4,
        view: changedLine(4, 'job 1 changed again'),
      })
      await settleFrames(sameHeightPage)
      const afterNextMoment = await readDocument(sameHeightPage)
      await sameHeightPage.close()
      // Assert
      cases.push({
        name: 'a scroll up after a scroll to the end that moved nothing stops following, shows Jump to latest and is not undone by the next moment (DS20, F106)',
        actual: { afterScrollUp, afterNextMoment },
        passed:
          afterScrollUp.jumpShown &&
          afterScrollUp.lastReport?.follow === false &&
          !afterNextMoment.atEnd &&
          afterNextMoment.jumpShown &&
          afterNextMoment.scrollTop === afterScrollUp.scrollTop,
      })
      // Value: protects=a clamp of the scroll position caused by hiding the verdict and muted lines is the document's own: at the result, scrolled 6 px above the end, the next moment (the same output without the verdict) leaves following off and Jump to latest shown; fails_when=the clamp is read as the learner's return to the end and turns following on; why_new=F142 (not reproduced in Cycle 0049; the host's native check in VS Code is the driving agent's, D25); seam=none; no_claim=the native editor's own scrolling, which the native check covers
      // Act: the learner scrolls to 6 px above the end of the result's output; the same lines arrive without the verdict.
      const clampPage = await openApplication(options.html.applicationAtResult)
      await clampPage.evaluate(() => {
        const output = document.getElementById('test-output')
        output.scrollTop = output.scrollHeight - output.clientHeight - 6
      })
      await settleFrames(clampPage)
      const sixAboveEnd = await readDocument(clampPage)
      const withoutVerdict = { ...resultView, generation: 3 }
      delete withoutVerdict.end
      await postToDocument(clampPage, {
        type: 'node-history-output',
        generation: 3,
        view: withoutVerdict,
      })
      await settleFrames(clampPage)
      const afterClamp = await readDocument(clampPage)
      await clampPage.close()
      // Assert
      cases.push({
        name: 'a clamp of the scroll position caused by hiding the verdict leaves following off (F142)',
        actual: { sixAboveEnd, afterClamp },
        passed:
          sixAboveEnd.jumpShown &&
          sixAboveEnd.lastReport?.follow === false &&
          afterClamp.jumpShown &&
          afterClamp.lastReport?.follow === false,
      })
      // Value: protects=moments posted in a burst, as Play posts them (up to twenty a second), are drawn once per animation frame, the newest only, and an older one that arrives after is ignored; fails_when=each moment is drawn in full (twenty draws of the output for twenty moments), or the older view that came last wins; why_new=F140: a log-heavy replay fell behind Play's 50 ms tick; seam=Element.prototype.setAttribute, counted for the document's main region, which every draw sets once; no_claim=the draw's cost, which the long-output case bounds
      // Act: twenty moments in one task, then one older.
      const burstPage = await openApplication(options.html.application, () => {
        window.draws = 0
        const setAttribute = Element.prototype.setAttribute
        Element.prototype.setAttribute = function (name, value) {
          if (this.id === 'test-output-main' && name === 'aria-label')
            window.draws += 1
          return setAttribute.call(this, name, value)
        }
      })
      const drawsAtOpen = await burstPage.evaluate(() => window.draws)
      await burstPage.evaluate((result) => {
        for (let generation = 2; generation <= 21; generation += 1)
          window.dispatchEvent(
            new MessageEvent('message', {
              data: {
                type: 'node-history-output',
                generation,
                view: {
                  ...result,
                  generation,
                  time: `Recorded test output · burst ${generation}`,
                },
              },
            }),
          )
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'node-history-output',
              generation: 5,
              view: { ...result, generation: 5, time: 'older' },
            },
          }),
        )
      }, resultView)
      await settleFrames(burstPage)
      const burst = await burstPage.evaluate(() => ({
        draws: window.draws,
        time: document.getElementById('test-output-time').textContent,
      }))
      await burstPage.close()
      // Assert
      cases.push({
        name: 'moments posted in a burst are drawn once per frame, the newest only, and an older one that comes last is ignored (F140)',
        actual: { drawsAtOpen, burst },
        passed:
          drawsAtOpen === 1 &&
          burst.draws === 2 &&
          burst.time === 'Recorded test output · burst 21',
      })
      // Value: protects=the learner's scroll anchor reaches the host at most once per TEST_OUTPUT_STATE_REPORT_INTERVAL_MS (500 ms), the anchors of the scrolls in between are joined into one report when the interval ends, a change of the follow choice is reported at once, and the joined anchor is also reported when the document is left; fails_when=each scroll event reports (a message per event), the timer forgets the scrolls joined during the interval, or the pagehide report is missing; why_new=D22: the anchor is reported to the host, and scrolling produces events faster than the host needs them; seam=the page's setTimeout, replaced to hold the document's timers of 100 ms or more until the case runs them; no_claim=the real passage of time, which the held timer stands in for
      // Act: the learner scrolls up (a change of the follow choice) and then scrolls four more times inside the interval.
      const intervalPage = await openApplication(
        options.html.applicationAtResult,
        () => {
          window.heldTimers = []
          const realSetTimeout = window.setTimeout.bind(window)
          window.setTimeout = (callback, delay) => {
            if (delay === undefined || delay >= 100) {
              window.heldTimers.push({ callback, delay })
              return window.heldTimers.length
            }
            return realSetTimeout(callback, delay)
          }
        },
      )
      const stateReports = () =>
        intervalPage.evaluate(
          () =>
            window.sent.filter(
              (message) => message.type === 'node-history-output-state',
            ).length,
        )
      for (const top of [300, 250, 200, 150, 100]) {
        await learnerScrolledTo(intervalPage, top)
        await settleFrames(intervalPage)
      }
      const duringInterval = {
        reports: await stateReports(),
        timers: await intervalPage.evaluate(() =>
          window.heldTimers.map((timer) => timer.delay),
        ),
      }
      await intervalPage.evaluate(() => window.heldTimers[0].callback())
      const afterInterval = await stateReports()
      await learnerScrolledTo(intervalPage, 60)
      await settleFrames(intervalPage)
      const beforeLeaving = await stateReports()
      await intervalPage.evaluate(() =>
        window.dispatchEvent(new Event('pagehide')),
      )
      const afterLeaving = await stateReports()
      await intervalPage.close()
      // Assert
      cases.push({
        name: 'the learner’s scroll anchor is reported to the host once per interval, the follow choice at once and the joined anchor when the document is left (D22)',
        actual: { duringInterval, afterInterval, beforeLeaving, afterLeaving },
        passed:
          JSON.stringify({
            duringInterval,
            afterInterval,
            beforeLeaving,
            afterLeaving,
          }) ===
          JSON.stringify({
            duringInterval: { reports: 2, timers: [500] },
            afterInterval: 3,
            beforeLeaving: 3,
            afterLeaving: 4,
          }),
      })
      // Value: protects=a clamped test line in the Application header is a tab stop that shows the whole name while it has the keyboard focus, as the browser summary's title does, and a test line that fits is no tab stop; fails_when=a name cut at two lines can be read only from its tooltip (a keyboard or touch learner cannot read it), the cut line is not shown whole on focus, or a fitting line takes a tab stop; why_new=F144 (pass 3 maintainability): the clamp had a hover tooltip only; seam=none; no_claim=the Study pane's own title (its case follows the test replay section widths) (stand-ins: the document's own resize measure after the page sets the name)
      // Arrange: the header's test line at 320 px, first with a name of many titles, then with a short one.
      await applicationPage.setViewportSize({ width: 320, height: 360 })
      const readTestLine = () =>
        applicationPage.evaluate(() => {
          const line = document.getElementById('test-output-test')
          return {
            tabindex: line.getAttribute('tabindex'),
            lines: Math.round(
              line.scrollHeight /
                Number.parseFloat(getComputedStyle(line).lineHeight),
            ),
            displayed: getComputedStyle(line).display,
          }
        })
      const setTestLine = (name) =>
        applicationPage.evaluate((value) => {
          const line = document.getElementById('test-output-test')
          line.textContent = value
          line.title = value
          window.dispatchEvent(new Event('resize'))
        }, name)
      // Act
      await setTestLine(
        'src/jobs.test.ts › job scheduler › runs a delayed job after its timer fires and reports the result to the caller › even when the fake clock advances twice',
      )
      const clampedTestLine = await readTestLine()
      await applicationPage.locator('#test-output-test').focus()
      const focusedTestLine = await readTestLine()
      await applicationPage.evaluate(() => document.activeElement.blur())
      await setTestLine('src/jobs.test.ts')
      const fittingTestLine = await readTestLine()
      // Assert
      cases.push({
        name: 'a test line of the Application header that the clamp cuts is a tab stop shown whole on focus, and a test line that fits is no tab stop',
        actual: { clampedTestLine, focusedTestLine, fittingTestLine },
        passed:
          clampedTestLine.tabindex === '0' &&
          clampedTestLine.lines > 2 &&
          focusedTestLine.displayed === 'block' &&
          fittingTestLine.tabindex === null,
      })
      // Value: protects=a test line that fits after the learner has focused and left it drops its tab stop (the stop is decided again on blur); fails_when=a line that was cut while it held the focus, came to fit meanwhile and kept tabindex=0 after the focus left it, so a keyboard learner tabs through a title that needs no stop; why_new=F297 (OCR batch C): installClampedTitleStop measured only at load and resize, and not while the heading held the focus; seam=none; no_claim=the Study pane's own titles (they are measured after every message and were not red)
      // Arrange: a cut test line that holds the keyboard focus.
      await setTestLine(
        'src/jobs.test.ts › job scheduler › runs a delayed job after its timer fires and reports the result to the caller › even when the fake clock advances twice',
      )
      await applicationPage.locator('#test-output-test').focus()
      // Act: the name becomes short while focused (the resize skips a focused line), then the focus leaves.
      await setTestLine('src/jobs.test.ts')
      const whileFocused = await readTestLine()
      await applicationPage.evaluate(() => document.activeElement.blur())
      const afterBlur = await readTestLine()
      // Assert
      cases.push({
        name: 'a test line that came to fit while it held the focus drops its tab stop when the focus leaves it',
        actual: { whileFocused, afterBlur },
        passed: whileFocused.tabindex === '0' && afterBlur.tabindex === null,
      })
      // Value: protects=three cells of the Application document's follow state that no case read, each its own case below: a document that follows the output ignores an older view and stays at the end; a learner who stopped following and scrolls back to the end follows again, with Jump to latest gone; a document loaded again never uses the newer view or the choice not to follow that another replay left in the webview's kept state (it shows its own first view, at the end, with Jump to latest hidden, as its options say); fails_when=an older view moves a following document off its latest moment, scrolling back to the end leaves Jump to latest and the choice behind, or another replay's kept view (a newer generation) or kept choice not to follow is read by this replay's document; why_new=F125 (the document's following x an older view, not-following x a scroll back to the end) and F147 (another replay's newer kept view); seam=none; no_claim=VS Code's own state transport (stand-ins: a stub of the webview API with a kept state)
      // Arrange: a document of its own in a page, as the cases above build one.
      const cellPage = await page.context().newPage()
      await cellPage.setViewportSize({ width: 760, height: 360 })
      const loadCellDocument = async (kept) => {
        await cellPage.goto(options.url)
        await cellPage.evaluate((state) => {
          window.savedState = state
          window.acquireVsCodeApi = () => ({
            getState: () => window.savedState,
            setState(next) {
              window.savedState = next
            },
            postMessage: () => {},
          })
        }, kept)
        await cellPage.setContent(options.html.application)
        await cellPage.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        )
      }
      const postCellView = async (generation, view) => {
        await cellPage.evaluate(
          ({ generation, view }) =>
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  type: 'node-history-output',
                  generation,
                  view: { ...view, generation },
                },
              }),
            ),
          { generation, view },
        )
        await cellPage.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        )
      }
      const readCell = () =>
        cellPage.evaluate(() => {
          const output = document.getElementById('test-output')
          return {
            time: document.getElementById('test-output-time').textContent,
            atEnd:
              output.scrollHeight - output.scrollTop - output.clientHeight <= 2,
            jumpHidden: document.getElementById('test-output-jump').hidden,
          }
        })
      await loadCellDocument(undefined)
      // Act: a following document is told a newer moment, then an older one.
      await postCellView(6, options.testReplayViews.result)
      const followingAtNewest = await readCell()
      await postCellView(4, {
        ...options.testReplayViews.result,
        time: 'Recorded test output · 0.05 s',
      })
      const followingAfterOlder = await readCell()
      // Act: the learner scrolls up (not following), then back to the end.
      await cellPage.evaluate(() => {
        const output = document.getElementById('test-output')
        output.scrollTop = 0
        output.dispatchEvent(new Event('scroll'))
      })
      await cellPage.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      )
      const notFollowing = await readCell()
      await cellPage.evaluate(() => {
        const output = document.getElementById('test-output')
        output.scrollTop = output.scrollHeight
        output.dispatchEvent(new Event('scroll'))
      })
      await cellPage.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      )
      const followingAgain = await readCell()
      // Act: a document of this replay, written with the host's reading (following), loaded in a webview whose kept state holds the newer view and the choice not to follow that another replay left (D22: the document reads only the host's reading in its options, never the kept state).
      await loadCellDocument({
        testOutputHistory: 'another-replay',
        testOutputFollow: false,
        testOutputView: {
          ...options.testReplayViews.result,
          time: 'Recorded test output · 9.99 s',
          generation: 99,
        },
      })
      const withOtherReplaysState = await readCell()
      await cellPage.close()
      // Assert
      cases.push({
        name: 'a following Application document ignores an older view and stays at the end of its latest moment (DS20)',
        actual: { followingAtNewest, followingAfterOlder },
        passed:
          followingAtNewest.atEnd &&
          followingAfterOlder.time === followingAtNewest.time &&
          followingAfterOlder.atEnd,
      })
      cases.push({
        name: 'a learner who stopped following and scrolls back to the end follows again, with Jump to latest gone (DS20)',
        actual: { notFollowing, followingAgain },
        passed:
          !notFollowing.atEnd &&
          !notFollowing.jumpHidden &&
          followingAgain.atEnd &&
          followingAgain.jumpHidden,
      })
      cases.push({
        name: 'a document loaded again never shows the newer view that another replay left in the kept state (DS20)',
        actual: { withOtherReplaysState },
        passed:
          withOtherReplaysState.time === 'Recorded test output · 0.10 s' &&
          withOtherReplaysState.atEnd &&
          withOtherReplaysState.jumpHidden,
      })
      await applicationPage.close()
      // Assert
      // Value: protects=the Application document never widens the page at 320, 480 or 760 px and keeps the test name to two lines; fails_when=a long test name or output line widens the page; why_new=PR-B1 (Design 8, DS19) added the document's widths; seam=none; no_claim=native pixels
      cases.push({
        name: 'the Application document of a test replay at 320, 480 and 760 px has no page-level horizontal scroll and a test name of at most two lines (Design 8)',
        actual: applicationWidths,
        passed: applicationWidths.every(
          (reading) =>
            !reading.pageScrolls &&
            reading.testLines >= 1 &&
            reading.testLines <= 2,
        ),
      })
      // Arrange: a second Application document of the same replay, in a page of its own, for the in-place updates that move to another moment (Design 3, EN3, DS20); the page above is closed, and the cases below keep their own.
      const updatePage = await page.context().newPage()
      await updatePage.setViewportSize({ width: 760, height: 360 })
      await updatePage.goto(options.url)
      await updatePage.evaluate(() => {
        window.sent = []
        window.acquireVsCodeApi = () => ({
          getState: () => undefined,
          setState() {},
          postMessage: (message) => window.sent.push(structuredClone(message)),
        })
      })
      await updatePage.setContent(options.html.application)
      /** Posts one view into the document as the host does for a later moment, then waits two frames so the layout has settled. */
      const postOutputView = async (generation, view) => {
        await updatePage.evaluate(
          ({ generation, view }) =>
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  type: 'node-history-output',
                  generation,
                  view: { ...view, generation },
                },
              }),
            ),
          { generation, view },
        )
        await updatePage.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        )
      }
      /** Reads what the document shows after an update: the numbers of its lines, its header and names, its muted lines (`hidden` when one is left out) and whether it stands at the end of the output. */
      const readOutputUpdate = () =>
        updatePage.evaluate(() => {
          const output = document.getElementById('test-output')
          const mutedLine = (id) => {
            const shown = document.getElementById(id)
            return shown.hidden ? 'hidden' : shown.textContent
          }
          const numbers = Array.from(output.children, (line) =>
            Number(line.dataset.line),
          )
          return {
            first: numbers[0],
            last: numbers.at(-1),
            count: numbers.length,
            ascending: numbers.every(
              (number, index) =>
                index === 0 || number === numbers[index - 1] + 1,
            ),
            time: document.getElementById('test-output-time').textContent,
            title: document.title,
            region: output.getAttribute('aria-label'),
            inspector: mutedLine('test-output-inspector'),
            cut: mutedLine('test-output-cut'),
            placeholder: mutedLine('test-output-placeholder'),
            end: mutedLine('test-output-end'),
            atEnd:
              output.scrollHeight - output.scrollTop - output.clientHeight <= 2,
          }
        })
      const atTheResult = options.testReplayViews.result
      const withoutEnd = { ...atTheResult }
      delete withoutEnd.end
      const earlierName = `Recorded test output · ${atTheResult.test} · 0.05 s`
      /** The view of an earlier moment: jobs `from` to 25 of the output, with the lines it leaves out named. */
      const earlierWindow = (from) => ({
        ...withoutEnd,
        time: 'Recorded test output · 0.05 s',
        name: earlierName,
        region: 'Recorded test output up to 0.05 s',
        lines: Array.from({ length: 26 - from }, (_, index) => ({
          channel: 'stdout',
          text: `job ${from + index} scheduled`,
          number: from + index,
        })),
        cut: '… 120 earlier characters not shown',
        inspector: '2 Node inspector lines hidden',
      })
      // Act: the document follows the output to the result; the host then moves back to an earlier window of the output, widens it at its start and moves to a moment with no output yet.
      await postOutputView(2, atTheResult)
      const followedToResult = await readOutputUpdate()
      await postOutputView(3, earlierWindow(10))
      const windowFromTen = await readOutputUpdate()
      await postOutputView(4, earlierWindow(5))
      const windowFromFive = await readOutputUpdate()
      await postOutputView(5, {
        ...withoutEnd,
        time: 'Recorded test output · 0.05 s',
        name: earlierName,
        region: 'Recorded test output up to 0.05 s',
        lines: [],
        placeholder: 'No test output recorded up to this moment.',
      })
      const noOutputYet = await readOutputUpdate()
      // Assert
      const mutedWhenShown = {
        inspector: '2 Node inspector lines hidden',
        cut: '… 120 earlier characters not shown',
        placeholder: 'hidden',
        end: 'hidden',
        atEnd: true,
      }
      // Value: protects=the Application document's in-place update: while the learner follows the output it ends at the latest line, an update to an earlier moment drops the later lines and the verdict, inserts lines at the start, and shows then hides the lines for what the output leaves out and for no output yet, with the header, the title and the region name following the moment; fails_when=a verdict, a later line or a muted line stays after the move back, the lines come out of order, the document stops following the end, or a name keeps the earlier moment's time; why_new=PR-B1 posts every later moment into one document and no other case posts a view that shortens or restarts the output, shows the cut and inspector lines or hides the verdict; seam=none; no_claim=the host's choice of views (the workspace and projection tests) or VS Code's own webview (stand-ins: the page's message event as the host posts it and a stub of the webview API)
      cases.push({
        name: 'an in-place update of the Application document follows the output to the result, then at an earlier moment drops the later lines and the verdict, shows what the output leaves out and hides it again (Design 8, EN3, DS20)',
        actual: {
          followedToResult,
          windowFromTen,
          windowFromFive,
          noOutputYet,
        },
        passed:
          JSON.stringify({
            followedToResult,
            windowFromTen,
            windowFromFive,
            noOutputYet,
          }) ===
          JSON.stringify({
            followedToResult: {
              first: 0,
              last: 40,
              count: 41,
              ascending: true,
              time: 'Recorded test output · 0.90 s',
              title: atTheResult.name,
              region: 'Recorded test output up to 0.90 s',
              inspector: 'hidden',
              cut: 'hidden',
              placeholder: 'hidden',
              end: 'Test passed · exit code 0',
              atEnd: true,
            },
            windowFromTen: {
              first: 10,
              last: 25,
              count: 16,
              ascending: true,
              time: 'Recorded test output · 0.05 s',
              title: earlierName,
              region: 'Recorded test output up to 0.05 s',
              ...mutedWhenShown,
            },
            windowFromFive: {
              first: 5,
              last: 25,
              count: 21,
              ascending: true,
              time: 'Recorded test output · 0.05 s',
              title: earlierName,
              region: 'Recorded test output up to 0.05 s',
              ...mutedWhenShown,
            },
            noOutputYet: {
              count: 0,
              ascending: true,
              time: 'Recorded test output · 0.05 s',
              title: earlierName,
              region: 'Recorded test output up to 0.05 s',
              inspector: 'hidden',
              cut: 'hidden',
              placeholder: 'No test output recorded up to this moment.',
              end: 'hidden',
              atEnd: true,
            },
          }),
      })
      // Act: a line the test was still printing at one moment is finished at the next, and a later line holds markup as a repository's test may print it.
      const markup = '<img src=x onerror="window.invented=true">'
      const runLine = {
        channel: 'stdout',
        text: 'RUN src/jobs.test.ts',
        number: 0,
      }
      await postOutputView(6, {
        ...withoutEnd,
        lines: [runLine, { channel: 'stdout', text: 'job 1 sch', number: 1 }],
      })
      await updatePage.evaluate(() => {
        window.runNode = document.querySelector('#test-output [data-line="0"]')
        window.unfinishedNode = document.querySelector(
          '#test-output [data-line="1"]',
        )
      })
      await postOutputView(7, {
        ...withoutEnd,
        lines: [
          runLine,
          { channel: 'stdout', text: 'job 1 scheduled', number: 1 },
          { channel: 'stderr', text: markup, number: 2 },
        ],
      })
      const finishedLine = await updatePage.evaluate(() => {
        const output = document.getElementById('test-output')
        return {
          unchangedLineKeepsItsNode:
            output.querySelector('[data-line="0"]') === window.runNode,
          finishedText: output.querySelector('[data-line="1"] .output-text')
            .textContent,
          unfinishedNodeLeft: !window.unfinishedNode.isConnected,
          markupText: output.querySelector('[data-line="2"] .output-text')
            .textContent,
          markupMark: output.querySelector('[data-line="2"] .stderr-mark')
            ?.textContent,
          elementsInOutput: output.querySelectorAll('img, script, [onerror]')
            .length,
          scriptRan: window.invented === true,
        }
      })
      // Value: protects=a move back to a shorter moment while the learner has stopped following leaves following off: the browser's clamp of the scroll position to the shorter output is the document's change, not the learner's scroll back to the end; fails_when=the clamp turns following on, hides Jump to latest and saves that choice, so the next moment scrolls the learner to the end although they never scrolled back or pressed Jump to latest (DS20); why_new=Step 9 pass 2's state-machines review (wrong row: not following × a newer view whose output is shorter); seam=none; no_claim=a scroll the learner makes back to the end, which turns following on
      // Arrange: the result's whole output, which the learner scrolls to its end and then just above it.
      const settleUpdatePage = () =>
        updatePage.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        )
      const readFollow = () =>
        updatePage.evaluate(() => ({
          jumpShown: !document.getElementById('test-output-jump').hidden,
          follow: window.sent
            .filter((message) => message.type === 'node-history-output-state')
            .at(-1)?.follow,
        }))
      await postOutputView(8, atTheResult)
      await updatePage.evaluate(() => {
        const output = document.getElementById('test-output')
        output.scrollTop = output.scrollHeight
      })
      await settleUpdatePage()
      await updatePage.evaluate(() => {
        const output = document.getElementById('test-output')
        output.scrollTop = output.scrollHeight - output.clientHeight - 40
      })
      await settleUpdatePage()
      const stoppedFollowing = await readFollow()
      // Act: an earlier moment whose output is shorter than the scroll position.
      await postOutputView(9, earlierWindow(20))
      const afterShorter = await readFollow()
      // Assert
      cases.push({
        name: 'a move back to a shorter moment leaves the Application document not following when the learner stopped following (DS20)',
        actual: { stoppedFollowing, afterShorter },
        passed:
          JSON.stringify({ stoppedFollowing, afterShorter }) ===
          JSON.stringify({
            stoppedFollowing: { jumpShown: true, follow: false },
            afterShorter: { jumpShown: true, follow: false },
          }),
      })
      await updatePage.close()
      // Assert
      // Value: protects=the in-place update replaces exactly the line whose text changed (a line finished at the next moment), keeps the nodes of the lines that did not change, and shows output that holds markup as text, never as elements; fails_when=a finished line keeps its earlier text, an unchanged line's node is replaced (the learner's selection and focus there are lost), or markup in recorded output becomes an element; why_new=PR-B1's update path builds the line nodes in the browser, which the escaping test of the first document does not cover; seam=none; no_claim=the document's Content Security Policy, which the browser enforces (stand-ins: the page's message event and a stub of the webview API)
      cases.push({
        name: 'an in-place update replaces a line whose text changed, keeps the nodes of the other lines and shows output that holds markup as text (Design 8, EN3, S3-1)',
        actual: finishedLine,
        passed:
          JSON.stringify(finishedLine) ===
          JSON.stringify({
            unchangedLineKeepsItsNode: true,
            finishedText: 'job 1 scheduled',
            unfinishedNodeLeft: true,
            markupText: markup,
            markupMark: '[stderr] ',
            elementsInOutput: 0,
            scriptRan: false,
          }),
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
      // Golden DOM (Design 5, AC14): the browser's saved sequence renders the markup it rendered before the summary renderer was shared with test replays.
      // Changed once on purpose (F206, D24): a step that loops on one participant centers its label over that participant's lifeline (x 260 -> 240) so the label of the last participant stays inside the diagram; names and labels wrap at word boundaries inside their boxes, which this sample's short text does not show.
      const sequenceMarkup = await page.evaluate(
        () => document.getElementById('learning-sequence').innerHTML,
      )
      // Value: protects=the browser summary's sequence renders the markup of the golden fixture, so a change of the shared renderer shows as a change of this fixture with a reason; fails_when=the shared renderer changes the diagram's elements or attributes without the fixture and its reason changing together (the fixture changed once, for F206: a loop's label is centered on its lifeline); why_new=PR-B1 shared the renderer with test replays (Design 5, AC14); seam=none; no_claim=how the diagram looks (native pixels)
      cases.push({
        name: 'the saved learning sequence of a browser replay renders the markup of its golden fixture: the same elements and attributes as before the renderer was shared with test replays, with a loop label centered on its lifeline',
        actual: sequenceMarkup,
        passed: sequenceMarkup === options.goldenLearningSequence,
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
      /** Reads where a sequence diagram's names and labels lie: outside its bounds, over each other, below their own arrow or beyond its top and bottom. Runs in the page. */
      const readSequenceGeometry = (region) => {
        const svg = region.querySelector('svg'),
          participants = svg.querySelectorAll('line').length,
          diagramWidth = Number(svg.getAttribute('width')),
          diagramHeight = Number(svg.getAttribute('height')),
          read = (text) =>
            [...text.querySelectorAll('tspan')].length
              ? [...text.querySelectorAll('tspan')]
                  .map((span) => span.textContent)
                  .join('')
              : text.textContent,
          boxes = [...svg.querySelectorAll('text')].map((text) => {
            const box = text.getBBox()
            return {
              words: read(text),
              left: box.x,
              right: box.x + box.width,
              top: box.y,
              bottom: box.y + box.height,
            }
          }),
          arrows = [...svg.querySelectorAll('path')].map((path) => {
            const [, x, y] = path
              .getAttribute('d')
              .match(/^M ([\d.]+) ([\d.]+)/)
            return { x: Number(x), y: Number(y) }
          }),
          labels = boxes.slice(participants),
          overlapping = []
        for (let first = 0; first < boxes.length; first++)
          for (let second = first + 1; second < boxes.length; second++) {
            const a = boxes[first],
              b = boxes[second]
            if (
              a.left < b.right - 0.5 &&
              b.left < a.right - 0.5 &&
              a.top < b.bottom - 0.5 &&
              b.top < a.bottom - 0.5
            )
              overlapping.push(`${a.words} / ${b.words}`)
          }
        return {
          diagramWidth,
          diagramHeight,
          outside: boxes
            .filter((box) => box.left < -0.5 || box.right > diagramWidth + 0.5)
            .map((box) => box.words),
          overlapping,
          belowArrow: labels
            .filter((label, index) => label.bottom > arrows[index].y + 0.5)
            .map((label) => label.words),
          aboveTop: boxes
            .filter((box) => box.top < -0.5)
            .map((box) => box.words),
          beyondBottom: boxes
            .filter((box) => box.bottom > diagramHeight + 0.5)
            .map((box) => box.words),
        }
      }
      // Value: protects=the shared sequence renderer at the Study pane's width names every interaction: participant names and step labels break between words and never inside one, no label ends in an ellipsis, the diagram grows taller for the extra lines, every name and label stays inside the diagram's bounds, and a diagram wider than the pane scrolls inside its own region so the last participant is reachable by keyboard; fails_when=a word is cut (`fetchFilteredInvoice` / `s`), a label is shortened with `…`, a fourth participant lies beyond the right edge with no way to scroll to it, or the page itself scrolls sideways; why_new=F206 (N49 VS Code, Minor, AC-LEARNING) and D24: the renderer cut names every 20 characters and labels at 20 characters with an ellipsis; seam=none; no_claim=native pixels (a screenshot is kept beside the result) (stand-ins: the Study message of a browser summary at 420 px, the width of a Study pane)
      // Arrange: four participants, one with a long identifier, and labels longer than one line, in a Study pane of 420 px.
      await page.setViewportSize({ width: 420, height: 720 })
      const namedLearning = JSON.parse(JSON.stringify(learning))
      namedLearning.recording.learningSummary.content.participants = [
        { id: 'page', label: 'Invoice page' },
        { id: 'action', label: 'fetchFilteredInvoices' },
        { id: 'database', label: 'Database client' },
        { id: 'cache', label: 'Revalidation cache' },
      ]
      namedLearning.recording.learningSummary.content.steps = [
        {
          id: 'ask',
          from: 'page',
          to: 'action',
          label: 'Ask for the invoices that match the search',
          explanation: 'The page passes the search text.',
          evidence: 'observed',
          reference,
        },
        {
          id: 'query',
          from: 'action',
          to: 'cache',
          label: 'Query and then refresh the cached list',
          explanation: 'The action reads and writes.',
          evidence: 'source-derived',
          reference,
        },
        {
          id: 'loop',
          from: 'cache',
          to: 'cache',
          label: 'Mark the cached list as fresh again',
          explanation: 'The cache keeps its state.',
          evidence: 'unknown',
        },
      ]
      namedLearning.recording.learningSummary.positions = [
        { stepId: 'ask', elapsedMs: 1000 },
        { stepId: 'query', elapsedMs: 2000 },
      ]
      // Act
      await publish(namedLearning)
      await page.locator('.sequence-diagram').scrollIntoViewIfNeeded()
      const namedDiagram = await page
        .locator('#learning-sequence .sequence-diagram')
        .evaluate((region) => {
          const svg = region.querySelector('svg'),
            texts = [...svg.querySelectorAll('text')],
            diagramWidth = Number(svg.getAttribute('width')),
            read = (text) =>
              [...text.querySelectorAll('tspan')].length
                ? [...text.querySelectorAll('tspan')]
                    .map((span) => span.textContent)
                    .join(' ')
                : text.textContent
          return {
            lines: texts.map((text) => ({
              words: read(text),
              tspans: text.querySelectorAll('tspan').length,
            })),
            hasEllipsis: texts.some((text) => read(text).includes('…')),
            outside: texts
              .filter((text) => {
                const box = text.getBBox()
                return box.x < -0.5 || box.x + box.width > diagramWidth + 0.5
              })
              .map((text) => read(text)),
            height: Number(svg.getAttribute('height')),
            diagramWidth,
            regionWidth: region.clientWidth,
            regionScrollWidth: region.scrollWidth,
            pageOverflow:
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          }
        })
      const namedGeometry = await page
        .locator('#learning-sequence .sequence-diagram')
        .evaluate(readSequenceGeometry)
      await page.locator('#learning-sequence .sequence-diagram').focus()
      for (let index = 0; index < 40; index++)
        await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(400)
      const namedDiagramScrolled = await page
        .locator('#learning-sequence .sequence-diagram')
        .evaluate((region) => ({
          focused: document.activeElement === region,
          reachesEnd:
            region.scrollLeft + region.clientWidth >= region.scrollWidth - 1,
        }))
      await page.screenshot({
        path: `${options.output}/named-sequence-study-width.png`,
      })
      // Assert
      cases.push({
        name: 'a sequence at the Study pane’s width wraps names and labels at word boundaries without an ellipsis, keeps them inside the diagram and scrolls to its last participant by keyboard',
        actual: { namedDiagram, namedGeometry, namedDiagramScrolled },
        passed:
          namedDiagram.lines.some(
            (line) => line.words === 'fetchFilteredInvoices',
          ) &&
          namedDiagram.lines.some(
            (line) =>
              line.words === '1. Ask for the invoices that match the search',
          ) &&
          namedDiagram.lines.some((line) => line.tspans > 1) &&
          !namedDiagram.hasEllipsis &&
          namedDiagram.outside.length === 0 &&
          // Vertical placement: no two texts overlap, each label sits above its own arrow, and nothing lies above or below the diagram (F296).
          namedGeometry.overlapping.length === 0 &&
          namedGeometry.belowArrow.length === 0 &&
          namedGeometry.aboveTop.length === 0 &&
          namedGeometry.beyondBottom.length === 0 &&
          namedDiagram.height > 72 + 3 * 64 &&
          namedDiagram.regionScrollWidth > namedDiagram.regionWidth &&
          !namedDiagram.pageOverflow &&
          namedDiagramScrolled.focused &&
          namedDiagramScrolled.reachesEnd,
      })
      // Value: protects=a sequence diagram shows Japanese participant names and step labels (text without spaces, about 12 px a glyph) and an upper-case label whole at the Study pane's width: every name and label lies inside the diagram (no clip at the left edge), no two texts overlap, each step's label sits above its own arrow and inside the span of its columns, and the diagram grows taller for the extra lines; fails_when=columns are sized at the width of a lower-case Latin letter and lines break only at spaces, so a Japanese label stays one line wider than its column and overlaps its neighbours, or an upper-case label is cut by the next column; why_new=F293 (OCR batch C, F206's scope; the owner reads Japanese): the renderer measured 6.5 px a character and wrapped at spaces only; seam=none; no_claim=native pixels or the font a host substitutes (stand-ins: the Study message of a browser summary at 420 px)
      // Arrange: Japanese and upper-case participant names and labels, in a Study pane of 420 px.
      const japaneseLearning = JSON.parse(JSON.stringify(learning))
      japaneseLearning.recording.learningSummary.content.participants = [
        { id: 'page', label: '請求書の一覧ページ' },
        { id: 'action', label: '請求書を取得するサーバーアクション' },
        { id: 'gateway', label: 'API GATEWAY' },
      ]
      japaneseLearning.recording.learningSummary.content.steps = [
        {
          id: 'ask',
          from: 'page',
          to: 'action',
          label: '検索条件に一致する請求書をまとめて取得するよう依頼する',
          explanation: 'ページが検索語を渡す。',
          evidence: 'observed',
          reference,
        },
        {
          id: 'forward',
          from: 'action',
          to: 'gateway',
          label: 'VALIDATE THE REQUEST BODY AND FORWARD IT',
          explanation: 'The action forwards the request.',
          evidence: 'source-derived',
          reference,
        },
        {
          id: 'loop',
          from: 'gateway',
          to: 'gateway',
          label: '応答をキャッシュに保存して、次の依頼に備える',
          explanation: 'ゲートウェイが状態を保つ。',
          evidence: 'unknown',
        },
      ]
      japaneseLearning.recording.learningSummary.positions = [
        { stepId: 'ask', elapsedMs: 1000 },
        { stepId: 'forward', elapsedMs: 2000 },
      ]
      // Act
      await publish(japaneseLearning)
      await page.locator('.sequence-diagram').scrollIntoViewIfNeeded()
      const japaneseDiagram = await page
        .locator('#learning-sequence .sequence-diagram')
        .evaluate(readSequenceGeometry)
      await page.screenshot({
        path: `${options.output}/japanese-sequence-study-width.png`,
      })
      // Assert
      cases.push({
        name: 'a sequence with Japanese and upper-case names and labels keeps every text inside the diagram, above its own arrow and clear of its neighbours at the Study pane’s width',
        actual: japaneseDiagram,
        passed:
          japaneseDiagram.outside.length === 0 &&
          japaneseDiagram.overlapping.length === 0 &&
          japaneseDiagram.belowArrow.length === 0 &&
          japaneseDiagram.aboveTop.length === 0 &&
          japaneseDiagram.beyondBottom.length === 0 &&
          japaneseDiagram.diagramHeight > 72 + 3 * 64,
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
      /** Reads the transport's second status region, which announces the remedy for a covered application: its role, its text and whether it is rendered (`checkVisibility` is false when it or an ancestor is `display:none`), so its first text changes a region that already exists. */
      const coveredRemedy = () =>
        page.evaluate(() => {
          const region = document.getElementById('application-covered-remedy')
          return {
            role: `${region.getAttribute('role')}/${region.getAttribute('aria-live')}`,
            text: region.textContent,
            isRendered: region.checkVisibility(),
          }
        })
      await publish(learning)
      const remedyBeforeCovered = await coveredRemedy()
      // Act
      await publish(coveredLearning)
      const whileCovered = await page.evaluate(() => {
        const shownText = (id) =>
          document.getElementById(id).getClientRects().length
            ? document.getElementById(id).textContent
            : null
        return {
          line: shownText('loading'),
          lineRole: document.getElementById('loading').getAttribute('role'),
          selectedShown:
            document.getElementById('selected').getClientRects().length > 0,
          transportStatus: shownText('recording-status'),
        }
      })
      const remedyWhileCovered = await coveredRemedy()
      await publish(learning)
      const afterReturnToFront = await page.evaluate(() => ({
        lineShown:
          document.getElementById('loading').getClientRects().length > 0,
        transportStatus:
          document.getElementById('recording-status').textContent,
      }))
      const remedyAfterReturnToFront = await coveredRemedy()
      // Assert
      cases.push({
        name: 'while another tab covers the recorded application the Learning summary says so and names the remedy, not that the observation is loading',
        actual: {
          remedyBeforeCovered,
          whileCovered,
          remedyWhileCovered,
          afterReturnToFront,
          remedyAfterReturnToFront,
        },
        passed:
          whileCovered.line ===
            'Recorded application is covered by another tab. Bring the Recorded application tab to the front to show this moment again.' &&
          // The visible line is no live region: "Loading the selected observation…" must not be announced at every seek.
          whileCovered.lineRole === null &&
          whileCovered.selectedShown &&
          whileCovered.transportStatus ===
            'Paused · finalized · Not recorded at this moment · Recorded application is covered by another tab' &&
          !afterReturnToFront.lineShown &&
          afterReturnToFront.transportStatus ===
            'Paused · finalized · Not recorded at this moment' &&
          // The remedy is announced from a status region that is rendered and empty before the cover begins.
          remedyBeforeCovered.role === 'status/polite' &&
          remedyBeforeCovered.text === '' &&
          remedyBeforeCovered.isRendered &&
          remedyWhileCovered.text ===
            'Bring the Recorded application tab to the front to show this moment again.' &&
          remedyWhileCovered.isRendered &&
          remedyAfterReturnToFront.text === '',
      })

      // Act: the covered recording fails (row 26, DR-3).
      await publish({
        ...coveredLearning,
        recording: {
          ...coveredLearning.recording,
          readiness: 'failed',
          reason: 'Recorded source unavailable',
        },
      })
      const coveredAndFailed = {
        line: await page.locator('#loading').textContent(),
        lineShown: await page.locator('#loading').isVisible(),
        remedy: (await coveredRemedy()).text,
      }
      await publish(learning)
      // Assert
      cases.push({
        name: 'a covered recorded application whose replay failed shows that the recorded context is unavailable and announces no remedy',
        actual: coveredAndFailed,
        passed:
          coveredAndFailed.lineShown &&
          coveredAndFailed.line ===
            'Recorded context unavailable. Reload after resolving the reported problem.' &&
          coveredAndFailed.remedy === '',
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
      // Arrange: the saved sequence again, with the keyboard focus on a step's inspection control (row 85).
      await publish(learning)
      await page.locator('[data-summary-step="derive"]').focus()
      const focusOnSequenceStep = await page.evaluate(
        () => document.activeElement.dataset.summaryStep,
      )
      // Act: the reader shows a history without learning material, so the sequence leaves under the focus.
      await publish({ ...replay, revision: revisionAt(10) })
      const focusAfterSequenceLeft = await focusName()
      // Assert
      cases.push({
        name: 'in the Study pane, when the learning material leaves while a step’s inspection control holds the keyboard focus, the focus goes to the selected content tab, not to the document body',
        actual: { focusOnSequenceStep, focusAfterSequenceLeft },
        passed:
          focusOnSequenceStep === 'derive' &&
          focusAfterSequenceLeft === 'recording-tab',
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
      // The Node test history offers the same button under its own hint.
      await publish({
        ...withoutValues,
        nodeHistoryPosition: { ...nodeStop, nativeValuesUninspected: true },
      })
      const nodeShowVariablesHeight = await page
        .locator('#node-history-show-variables')
        .evaluate((control) =>
          Math.round(control.getBoundingClientRect().height),
        )
      await publish(withoutValues)
      // Assert
      cases.push({
        name: 'Show Variables in the replay footer keeps the pane’s 44 px height and 16 px text, and Play keeps the transport’s 32 px rule',
        actual: { ...footerButton, nodeShowVariablesHeight },
        passed:
          footerButton.showVariablesHeight === 44 &&
          footerButton.showVariablesMinHeight === '44px' &&
          footerButton.showVariablesFontSize === '16px' &&
          footerButton.playMinHeight === '32px' &&
          footerButton.playHeight === 34 &&
          footerButton.hintFontSize === '12px' &&
          nodeShowVariablesHeight === 44,
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

      /** Says for each named part of the replay transport whether its whole box lies inside the transport's visible box. */
      const insideTransport = (selectors) =>
        page.evaluate((parts) => {
          const box = document
            .getElementById('recording-transport')
            .getBoundingClientRect()
          return Object.fromEntries(
            parts.map((selector) => {
              const part = document
                .querySelector(selector)
                .getBoundingClientRect()
              return [
                selector,
                part.height > 0 &&
                  part.top >= box.top &&
                  part.bottom <= box.bottom,
              ]
            }),
          )
        }, selectors)

      // Arrange: the moment whose values are not loaded, in a side bar at two widths (row 26, DR-1).
      const footerWithDetails = {},
        allPartsInside = {
          '#playback-toggle': true,
          '#playhead': true,
          '#playback-options > summary': true,
          '[data-action="reload-recording"]': true,
        }
      for (const width of [300, 600]) {
        await page.setViewportSize({ width, height: 720 })
        await publish(withoutValues)
        // Act: the learner opens Playback details by keyboard, and closes them again.
        await toggleByKeyboard('playback-options')
        const opened = await page
          .locator('#recording-transport')
          .evaluate((footer) => ({
            height: Math.round(footer.getBoundingClientRect().height),
            maxHeight: getComputedStyle(footer).maxHeight,
            focusedSummaryOf: document.activeElement.parentElement.id,
          }))
        const partsInside = await insideTransport([
          '#playback-toggle',
          '#playhead',
          '#playback-options > summary',
          '[data-action="reload-recording"]',
        ])
        await toggleByKeyboard('playback-options')
        footerWithDetails[width] = {
          ...opened,
          partsInside,
          scrollsAfterClosing: await page
            .locator('#recording-transport')
            .evaluate((footer) => footer.scrollHeight > footer.clientHeight),
          maxHeightAfterClosing: await page
            .locator('#recording-transport')
            .evaluate((footer) => getComputedStyle(footer).maxHeight),
        }
      }
      // Assert: 40vh of 720 px is 288 px; the closed footer keeps its 60vh (432 px).
      cases.push({
        name: 'with the values hint shown, opening Playback details in the Learning summary keeps the transport within 40% of a 720 px pane with Play, the playhead, the summary and Reload saved recording in view, and closing them leaves a footer that does not scroll',
        actual: footerWithDetails,
        passed:
          footerWithDetails[300].height <= 288 &&
          footerWithDetails[300].maxHeight === '288px' &&
          footerWithDetails[300].focusedSummaryOf === 'playback-options' &&
          JSON.stringify(footerWithDetails[300].partsInside) ===
            JSON.stringify(allPartsInside) &&
          !footerWithDetails[300].scrollsAfterClosing &&
          footerWithDetails[300].maxHeightAfterClosing === '432px' &&
          footerWithDetails[600].height <= 288 &&
          footerWithDetails[600].maxHeight === '288px' &&
          footerWithDetails[600].focusedSummaryOf === 'playback-options' &&
          JSON.stringify(footerWithDetails[600].partsInside) ===
            JSON.stringify(allPartsInside) &&
          !footerWithDetails[600].scrollsAfterClosing &&
          footerWithDetails[600].maxHeightAfterClosing === '432px',
      })

      // Arrange: a short side bar whose replay failed with a diagnostic of 12 lines (row 26, DR-1).
      await page.setViewportSize({ width: 960, height: 600 })
      const failedWithDiagnostic = {
        ...withValues,
        recording: {
          ...replay.recording,
          readiness: 'failed',
          reason: Array.from(
            { length: 12 },
            (_, line) => `Recorded source unavailable (line ${line + 1})`,
          ).join('\n'),
        },
      }
      await publish(failedWithDiagnostic)
      // Act: the learner opens Playback details and then Recording error details by keyboard.
      await toggleByKeyboard('playback-options')
      await toggleByKeyboard('playback-diagnostics', 'Space')
      const shortSideBar = await page.evaluate(() => {
        const transport = document.getElementById('recording-transport'),
          box = transport.getBoundingClientRect(),
          diagnosticText = document.getElementById(
            'playback-diagnostic',
          ).firstChild,
          firstLine = document.createRange()
        firstLine.setStart(diagnosticText, 0)
        firstLine.setEnd(diagnosticText, diagnosticText.data.indexOf('\n'))
        const firstLineBox = firstLine.getBoundingClientRect()
        return {
          transportHeight: Math.round(box.height),
          paneAboveTransport: Math.round(box.top),
          scrollsInside: transport.scrollHeight > transport.clientHeight,
          firstDiagnosticLine: firstLine.toString(),
          firstDiagnosticLineInside:
            firstLineBox.height > 0 &&
            firstLineBox.top >= box.top &&
            firstLineBox.bottom <= box.bottom,
          focusedSummaryOf: document.activeElement.parentElement.id,
        }
      })
      const errorDetailsInside = await insideTransport([
        '#playback-diagnostics > summary',
      ])
      await page.screenshot({
        path: `${options.output}/replay-recovery-short-side-bar.png`,
      })
      // Assert: 40% of 600 px is 240 px, so 360 px of the pane stay above the transport.
      cases.push({
        name: 'in a 960 x 600 Learning summary a failed replay with Playback details and Recording error details open leaves 60% of the pane above the transport, which scrolls inside itself and shows the opened error details',
        actual: { ...shortSideBar, errorDetailsInside },
        passed:
          shortSideBar.transportHeight <= 240 &&
          shortSideBar.paneAboveTransport >= 360 &&
          shortSideBar.scrollsInside &&
          errorDetailsInside['#playback-diagnostics > summary'] &&
          shortSideBar.firstDiagnosticLine ===
            'Recorded source unavailable (line 1)' &&
          shortSideBar.firstDiagnosticLineInside &&
          shortSideBar.focusedSummaryOf === 'playback-diagnostics',
      })

      // Act: both disclosures of the transport are measured as targets, and their label against the status beside it (row 62).
      const disclosureTargets = await page.evaluate(() => {
        const summaryHeight = (id) =>
            Math.round(
              document.querySelector(`#${id} > summary`).getBoundingClientRect()
                .height,
            ),
          // The top of an element's first line of text.
          textTop = (element) => {
            const text = document.createRange()
            text.selectNodeContents(element)
            return Math.round(text.getClientRects()[0].top)
          }
        return {
          playbackDetails: summaryHeight('playback-options'),
          recordingErrorDetails: summaryHeight('playback-diagnostics'),
          summaryMinHeight: getComputedStyle(
            document.querySelector('#playback-options > summary'),
          ).minHeight,
          labelTop: textTop(
            document.querySelector('#playback-options > summary'),
          ),
          statusTop: textTop(document.getElementById('recording-status')),
          marker: getComputedStyle(
            document.querySelector('#playback-options > summary'),
          ).display,
        }
      })
      // Assert
      cases.push({
        name: 'Playback details and Recording error details are targets 44 px high like the other controls of the pane, with their label on the line of the transport’s status',
        actual: disclosureTargets,
        passed:
          disclosureTargets.playbackDetails === 44 &&
          disclosureTargets.recordingErrorDetails === 44 &&
          disclosureTargets.summaryMinHeight === '44px' &&
          disclosureTargets.labelTop === disclosureTargets.statusTop &&
          // The summary keeps its disclosure triangle.
          disclosureTargets.marker === 'list-item',
      })
      // The details are closed again: a learner's footer starts without them.
      await page.locator('#playback-options').evaluate((details) => {
        details.open = false
        document.getElementById('playback-diagnostics').open = false
      })
      await page.setViewportSize({ width: 600, height: 800 })

      // Arrange: a replay with nothing to report: no error, no hint, no removal, no saved study, no layout notice (row 63, ND-5).
      await publish(withValues)
      // Act: every status region that can be empty is read before it has text.
      const emptyStatusRegions = await page.evaluate(() =>
        [
          'errors',
          'presentation-status',
          'recording-save-state',
          'playback-hint',
          'application-covered-remedy',
          'node-history-hint',
          'delete-study-status',
        ].map((id) => {
          const region = document.getElementById(id),
            // False when the region or an ancestor is `display:none`, or a closed disclosure holds it.
            isRendered = region.checkVisibility()
          // What the region adds to the height of its parent: none when the parent is as tall without it.
          const parentHeight = () =>
              region.parentElement.getBoundingClientRect().height,
            withRegion = parentHeight()
          region.style.display = 'none'
          const withoutRegion = parentHeight()
          region.style.display = ''
          return {
            id,
            role: region.getAttribute('role'),
            text: region.textContent,
            isRendered,
            height: region.getBoundingClientRect().height,
            roomTaken: withRegion - withoutRegion,
          }
        }),
      )
      // Assert
      cases.push({
        name: 'each status region of the Study pane is in the page before it has text, rendered and taking no room, so its first text is a change of a region that exists',
        actual: emptyStatusRegions,
        passed:
          JSON.stringify(emptyStatusRegions) ===
          JSON.stringify(
            [
              ['errors', 0],
              ['presentation-status', 0],
              ['recording-save-state', 0],
              ['playback-hint', 0],
              // Hidden from sight in the summary by a 1 px clip; the bottom panel shows it as a line.
              ['application-covered-remedy', 1],
              ['node-history-hint', 0],
              ['delete-study-status', 0],
            ].map(([id, height]) => ({
              id,
              role: 'status',
              text: '',
              isRendered: true,
              height,
              roomTaken: 0,
            })),
          ),
      })

      // Arrange: Live, then Overview, then Recording: the Recording tab closes "Study view and pane controls", and the presentation has nothing to report (row 74).
      const presentationOf = (layoutConfirmed) =>
        openPresentation({ layoutConfirmed })
      await publish({ ...options.message, contentTab: 'live' })
      await publish({ ...options.message, contentTab: 'overview' })
      await publish({ ...withValues, presentation: presentationOf(true) })
      /** Reads the presentation status and the disclosure it stands under: the region, whether the disclosure is open, the line's height and how far it starts below the disclosure. */
      const presentationLine = () =>
        page.evaluate(() => {
          const line = document
              .getElementById('presentation-status')
              .getBoundingClientRect(),
            disclosure = document.getElementById('reader-options')
          return {
            disclosureOpen: disclosure.open,
            height: Math.round(line.height),
            belowDisclosure: Math.round(
              line.top - disclosure.getBoundingClientRect().bottom,
            ),
          }
        })
      const statusBeforeNotice = {
        region: await statusRegion('presentation-status'),
        line: await presentationLine(),
        looks: await looksAsWithout('#presentation-status'),
      }
      // Act: the host reports that the layout is not confirmed, and then that it is.
      await publish({ ...withValues, presentation: presentationOf(false) })
      const statusWithNotice = {
        region: await statusRegion('presentation-status'),
        line: await presentationLine(),
      }
      await publish({ ...withValues, presentation: presentationOf(true) })
      const statusAfterNotice = {
        region: await statusRegion('presentation-status'),
        line: await presentationLine(),
        looks: await looksAsWithout('#presentation-status'),
      }
      // Assert
      cases.push({
        name: 'on the Recording tab, which closes Study view and pane controls, the presentation status is in the page, rendered and empty, and the pane looks as it does without it; a layout that is not confirmed is its first text, shown under the closed disclosure, and a confirmed layout empties it again',
        actual: { statusBeforeNotice, statusWithNotice, statusAfterNotice },
        passed:
          JSON.stringify(statusBeforeNotice) ===
            JSON.stringify({
              region: emptyRegion('presentation-status'),
              line: { disclosureOpen: false, height: 0, belowDisclosure: 8 },
              looks: { moved: [], samePixels: true },
            }) &&
          JSON.stringify(statusWithNotice) ===
            JSON.stringify({
              region: {
                ...emptyRegion('presentation-status'),
                text: 'Layout not confirmed. Restore it or focus a pane below.',
              },
              line: { disclosureOpen: false, height: 24, belowDisclosure: 8 },
            }) &&
          JSON.stringify(statusAfterNotice) ===
            JSON.stringify(statusBeforeNotice),
      })

      // Arrange: native Summary can be 299 px wide within an ordinary expanded editor.
      await page.setViewportSize({ width: 299, height: 928 })
      await publish({ ...withValues, presentation: presentationOf(true) })
      const compactEmptyBefore = await statusRegion('presentation-status')
      const compactLooksBefore = await looksAsWithout('#presentation-status')
      // Act: disclose an unconfirmed layout, then expand its controls and confirm it.
      await publish({ ...withValues, presentation: presentationOf(false) })
      const compactClosedNotice = await presentationLine()
      await page.locator('#reader-options > summary').click()
      const compactOpenNotice = await presentationLine()
      await publish({ ...withValues, presentation: presentationOf(true) })
      const compactEmptyAfter = await statusRegion('presentation-status')
      const compactLooksAfter = await looksAsWithout('#presentation-status')
      // Assert: compact replay retains the status gap required in both native hosts.
      cases.push({
        name: 'a 299 px learning summary places its layout notice eight pixels below closed and expanded pane controls and clears it without an empty band',
        actual: {
          compactClosedNotice,
          compactOpenNotice,
          compactEmptyBefore,
          compactEmptyAfter,
          compactLooksBefore,
          compactLooksAfter,
        },
        passed:
          compactClosedNotice.disclosureOpen === false &&
          compactClosedNotice.belowDisclosure === 8 &&
          compactOpenNotice.disclosureOpen === true &&
          compactOpenNotice.belowDisclosure === 8 &&
          JSON.stringify(compactEmptyBefore) ===
            JSON.stringify(emptyRegion('presentation-status')) &&
          JSON.stringify(compactEmptyAfter) ===
            JSON.stringify(emptyRegion('presentation-status')) &&
          JSON.stringify(compactLooksBefore) ===
            JSON.stringify({ moved: [], samePixels: true }) &&
          JSON.stringify(compactLooksAfter) ===
            JSON.stringify({ moved: [], samePixels: true }),
      })
      await page.locator('#reader-options > summary').click()
      await page.setViewportSize({ width: 600, height: 800 })

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
      await leavePane()
      // Act: the values load while the learner is in Run and Debug; later the learner returns to the pane.
      await publish(withValues)
      const focusWhileAway = await focusedControl()
      await returnToPane()
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
          nodeHistoryPosition: nodeStop,
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

      // Value: protects=a keyboard learner on Inspect in native debugger keeps the pane's focus when the control is hidden (the stop's values load, or Play moves to an output), as with Show Variables: it goes to the first usable control of the transport, never to the document body; fails_when=Inspect is hidden through `hidden` alone, so the focused control disappears and the focus falls to the body; why_new=F292 (OCR batch C): the Inspect control was hidden with no focus handling; seam=none; no_claim=the host's answer to the press or native pixels
      // Arrange: the selected stop has no native values, so Inspect in native debugger is offered, and the keyboard stands on it.
      await publish(nodeWithoutNativeValues)
      await page.locator('#node-history-inspect').focus()
      const inspectFocused = await page.evaluate(
        () => document.activeElement?.id,
      )
      // Act: the values load, so the control is hidden.
      await publish(nodeWithNativeValues)
      const afterInspectHidden = await page.evaluate(() => ({
        inspectHidden: document.getElementById('node-history-inspect').hidden,
        focusedId: document.activeElement?.id ?? '',
        inTransport: document
          .getElementById('node-history-transport')
          .contains(document.activeElement),
      }))
      // Assert
      cases.push({
        name: 'when Inspect in native debugger is hidden while the keyboard stands on it, the focus goes to the test replay transport, not to the document body',
        actual: { inspectFocused, afterInspectHidden },
        passed:
          inspectFocused === 'node-history-inspect' &&
          afterInspectHidden.inspectHidden &&
          afterInspectHidden.inTransport,
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
      // Act: a Node test history with a single event, whose transport has no usable control, with its event list collapsed as it opens (DS16).
      await page.locator('#node-history-events-details').evaluate((details) => {
        details.open = false
      })
      const singleEvent = {
        ...nodeReader,
        nodeHistorySection: nodeSection,
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
          nativeValuesUninspected: true,
        },
      })
      await page.locator('#node-history-show-variables').focus()
      await publish({
        ...singleEvent,
        nodeHistoryPosition: nodeStop,
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
        name: "when Play cannot be used as Show Variables leaves, focus goes to the first transport control that can: at the end of a recording and while a moment loads; in a history with a single event it goes to the collapsed event list's summary, Events (1)",
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
          focusWithSingleEvent.focused === 'Events (1)' &&
          focusWithSingleEvent.focusedSequence === undefined,
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
      // Act: the hint and its button are measured against the panel, which is 180 px high here.
      const panelHint = await page.evaluate(() => {
        const hint = document
            .getElementById('playback-hint')
            .getBoundingClientRect(),
          control = document
            .getElementById('playback-show-variables')
            .getBoundingClientRect()
        return {
          panelHeight: window.innerHeight,
          buttonHeight: Math.round(control.height),
          buttonBottom: Math.round(control.bottom),
          hintBottom: Math.round(hint.bottom),
          buttonRightOfHint: control.left >= hint.right,
          buttonBesideHint:
            control.top < hint.bottom && control.bottom > hint.top,
        }
      })
      await page.screenshot({
        path: `${options.output}/bottom-panel-values-hint.png`,
      })
      // Assert
      cases.push({
        name: 'in a bottom panel 180 px high the values hint and its 44 px Show Variables button stand side by side under the controls, both inside the panel',
        actual: panelHint,
        passed:
          panelHint.panelHeight === 180 &&
          panelHint.buttonHeight === 44 &&
          panelHint.buttonBottom <= 180 &&
          panelHint.hintBottom <= 180 &&
          panelHint.buttonRightOfHint &&
          panelHint.buttonBesideHint,
      })

      // Arrange: the bottom panel alone shows the replay (the summary is collapsed), and its transport has no line above the moment (rows 26 and 60, DR-3, ND-2).
      await publish(panelReplay)
      /** Reads the bottom panel's remedy line: its text, whether it is rendered and takes room, where it stands and how tall the transport is with it. */
      const panelRemedy = () =>
        page.evaluate(() => {
          const region = document.getElementById('application-covered-remedy'),
            box = region.getBoundingClientRect(),
            style = getComputedStyle(region)
          return {
            role: `${region.getAttribute('role')}/${region.getAttribute('aria-live')}`,
            text: region.textContent,
            display: style.display,
            fontSize: style.fontSize,
            isMuted: region.classList.contains('muted'),
            height: Math.round(box.height),
            width: Math.round(box.width),
            belowStatus:
              box.top >=
              document
                .getElementById('recording-status')
                .getBoundingClientRect().bottom,
            insideViewport: box.top >= 0 && box.bottom <= window.innerHeight,
            status: document.getElementById('recording-status').textContent,
            transportHeight: Math.round(
              document
                .getElementById('recording-transport')
                .getBoundingClientRect().height,
            ),
          }
        })
      const panelBeforeCovered = await panelRemedy()
      // Act: another tab comes in front of the recorded application, and leaves again.
      await publish({
        ...panelReplay,
        recording: { ...panelReplay.recording, applicationCovered: true },
      })
      const panelWhileCovered = await panelRemedy()
      await page.screenshot({
        path: `${options.output}/bottom-panel-covered-remedy.png`,
      })
      await publish(panelReplay)
      const panelAfterReturnToFront = await panelRemedy()
      // Assert
      cases.push({
        name: 'in the bottom panel a covered recorded application is named in the transport’s status and the remedy is a visible 12 px line under it, in a status region that is rendered and takes no room before',
        actual: {
          panelBeforeCovered,
          panelWhileCovered,
          panelAfterReturnToFront,
        },
        passed:
          panelBeforeCovered.role === 'status/polite' &&
          panelBeforeCovered.text === '' &&
          panelBeforeCovered.display !== 'none' &&
          panelBeforeCovered.height === 0 &&
          panelWhileCovered.status ===
            'Paused · finalized · Recorded application is covered by another tab' &&
          panelWhileCovered.text ===
            'Bring the Recorded application tab to the front to show this moment again.' &&
          panelWhileCovered.height === 18 &&
          panelWhileCovered.width > 400 &&
          panelWhileCovered.fontSize === '12px' &&
          panelWhileCovered.isMuted &&
          panelWhileCovered.belowStatus &&
          panelWhileCovered.insideViewport &&
          panelWhileCovered.transportHeight ===
            panelBeforeCovered.transportHeight + 18 &&
          panelAfterReturnToFront.text === '' &&
          panelAfterReturnToFront.transportHeight ===
            panelBeforeCovered.transportHeight,
      })

      // Act: the learner opens Playback details in the bottom panel, whose transport starts at the panel's top and is not a scroller (row 26, DR-1).
      await page.locator('#playback-options > summary').click()
      const panelTransportBound = await page
        .locator('#recording-transport')
        .evaluate((transport) => getComputedStyle(transport).maxHeight)
      await page.locator('#playback-options > summary').click()
      // Assert
      cases.push({
        name: 'in the bottom panel the transport is not bounded while Playback details are open',
        actual: panelTransportBound,
        passed: panelTransportBound === 'none',
      })

      // Arrange: the bottom panel during a replay; it has no pane controls, so a presentation's status is the Study pane's to report (row 74).
      await publish(panelReplay)
      const panelStatusBeforeNotice = {
        region: await statusRegion('presentation-status'),
        looks: await looksAsWithout('#presentation-status'),
      }
      // Act: the host reports a layout that is not confirmed.
      await publish({
        ...panelReplay,
        presentation: openPresentation({ layoutConfirmed: false }),
      })
      const panelStatusWithNotice = {
        region: await statusRegion('presentation-status'),
        looks: await looksAsWithout('#presentation-status'),
      }
      // Assert
      cases.push({
        name: 'in the bottom panel, which has no pane controls, the presentation status is in the page, rendered and empty, and stays empty when the layout is not confirmed, so only the Study pane reports it; the panel looks as it does without the line',
        actual: { panelStatusBeforeNotice, panelStatusWithNotice },
        passed:
          JSON.stringify(panelStatusBeforeNotice) ===
            JSON.stringify({
              region: emptyRegion('presentation-status'),
              looks: { moved: [], samePixels: true },
            }) &&
          JSON.stringify(panelStatusWithNotice) ===
            JSON.stringify(panelStatusBeforeNotice),
      })

      // Arrange: the bottom panel during a replay, which shows the transport alone; no run is live and no study is shown (row 176).
      await publish(panelReplay)
      /** Reads the two status regions the bottom panel leaves out during a replay, the strip's height and whether the panel looks as it does without each of them. */
      const leftOutDuringReplay = async () => ({
        runtime: await statusRegion('runtime'),
        saveState: await statusRegion('recording-save-state'),
        stripHeight: await page
          .locator('.live-strip')
          .evaluate((strip) =>
            Math.round(strip.getBoundingClientRect().height),
          ),
        looksWithoutStrip: await looksAsWithout('.live-strip'),
        looksWithoutSaveState: await looksAsWithout('#recording-save-state'),
      })
      const replayAlone = await leftOutDuringReplay()
      // Act: a run starts during the replay and the shown study's recording is saved; then the replay is left while the run goes on.
      const runAndSavedStudy = {
        liveState: 'running',
        liveTitle: 'Repository operation',
        study: {
          terminal: true,
          studyOutcome: 'demonstrated',
          historyOutcome: 'saved',
          finalOutcome: 'demonstrated',
          recordingSave: { status: 'finalized', contextStatus: 'saved' },
        },
      }
      await publish({ ...panelReplay, ...runAndSavedStudy })
      const runStartedDuringReplay = await leftOutDuringReplay()
      await publish({
        ...options.message,
        revision: revisionAt(8),
        ...runAndSavedStudy,
      })
      const replayLeft = {
        runtime: await statusRegion('runtime'),
        saveState: await statusRegion('recording-save-state'),
        stopShown: await page.locator('[data-action="stop"]').isVisible(),
      }
      // Assert
      const emptyAndUnseen = {
        runtime: emptyRegion('runtime'),
        saveState: emptyRegion('recording-save-state'),
        stripHeight: 0,
        looksWithoutStrip: { moved: [], samePixels: true },
        looksWithoutSaveState: { moved: [], samePixels: true },
      }
      cases.push({
        name: 'in the bottom panel during a replay the live strip’s status and the recording’s save state are in the page, rendered and empty, and the panel looks as it does without them, also when a run starts and the recording is saved meanwhile; when the replay is left, the run’s state and the save state are their first texts',
        actual: { replayAlone, runStartedDuringReplay, replayLeft },
        passed:
          JSON.stringify(replayAlone) === JSON.stringify(emptyAndUnseen) &&
          JSON.stringify(runStartedDuringReplay) ===
            JSON.stringify(emptyAndUnseen) &&
          JSON.stringify(replayLeft) ===
            JSON.stringify({
              runtime: {
                ...emptyRegion('runtime'),
                text: 'Repository operation — running',
              },
              saveState: {
                ...emptyRegion('recording-save-state'),
                text: 'Recording saved.',
              },
              stopShown: true,
            }),
      })

      // Arrange: a retained Node journal must not add another transport to application replay (row 509).
      const nodeJournalWithoutReplay = {
        ...options.message,
        nodeHistory: {
          header: { studyId: 'node-study' },
          status: 'complete',
          entries: [
            {
              type: 'output',
              sequence: 1,
              elapsedMs: 0,
              channel: 'stdout',
              text: 'First recorded output',
            },
            {
              type: 'output',
              sequence: 2,
              elapsedMs: 1000,
              channel: 'stdout',
              text: 'Second recorded output',
            },
          ],
        },
        nodeHistoryEventCount: 2,
        nodeHistoryPosition: { sequence: 1, eventIndex: 0 },
        nodeHistoryPlayback: {
          mode: 'paused',
          sequence: 1,
          loading: false,
          startMs: 0,
          endMs: 1000,
          positionMs: 0,
        },
        nodeHistorySection: {
          status:
            'No result recorded · capture complete · 0 of 0 stops explained',
          position: 'Output · 0.00 s',
          notRecorded: 'Source and debugger not recorded at this moment.',
          pointer: 'Output up to this moment is in the Application pane.',
          applicationClosed: false,
          sameMomentStepIds: [],
          stepActions: {},
          events: 'Events (2)',
          verdict: 'No result recorded',
          previousStop: false,
          nextStop: false,
        },
      }
      await publish({
        ...panelReplay,
        ...nodeJournalWithoutReplay,
        recording: panelReplay.recording,
      })
      // Act: inspect the unrelated controls and status regions, then return to the independent Node reader.
      const nodeDuringApplicationReplay = {
        regions: [
          await statusRegion('node-history-status'),
          await statusRegion('node-history-moment'),
          await statusRegion('node-history-hint'),
        ],
        height: await page
          .locator('#node-history')
          .evaluate((section) =>
            Math.round(section.getBoundingClientRect().height),
          ),
        nodePlayVisible: await page
          .locator('#node-history-playback-toggle')
          .isVisible(),
        nodePlayDisabled: await page
          .locator('#node-history-playback-toggle')
          .isDisabled(),
        nodeTimelineVisible: await page
          .locator('#node-history-playhead')
          .isVisible(),
        applicationPlayVisible: await page
          .locator('#playback-toggle')
          .isVisible(),
        looks: await looksAsWithout('#node-history'),
      }
      await publish(nodeJournalWithoutReplay)
      const nodeAfterApplicationReplay = {
        status: await page.locator('#node-history-status').textContent(),
        nodePlayVisible: await page
          .locator('#node-history-playback-toggle')
          .isVisible(),
        nodePlayEnabled: await page
          .locator('#node-history-playback-toggle')
          .isEnabled(),
        nodeTimelineVisible: await page
          .locator('#node-history-playhead')
          .isVisible(),
        understood: await page.locator('#node-history-understood').isChecked(),
      }
      // Assert: empty rendered status nodes take no space; the normal Node reader keeps its own controls.
      cases.push({
        name: 'application replay in the bottom panel shows one transport and empty rendered Node status regions; leaving it restores the independent Node journal without marking understanding',
        actual: { nodeDuringApplicationReplay, nodeAfterApplicationReplay },
        passed:
          JSON.stringify(nodeDuringApplicationReplay) ===
            JSON.stringify({
              regions: [
                { ...emptyRegion('node-history-status'), role: 'status/null' },
                emptyRegion('node-history-moment'),
                emptyRegion('node-history-hint'),
              ],
              height: 0,
              nodePlayVisible: false,
              nodePlayDisabled: true,
              nodeTimelineVisible: false,
              applicationPlayVisible: true,
              looks: { moved: [], samePixels: true },
            }) &&
          JSON.stringify(nodeAfterApplicationReplay) ===
            JSON.stringify({
              status:
                'No result recorded · capture complete · 0 of 0 stops explained',
              nodePlayVisible: true,
              nodePlayEnabled: true,
              nodeTimelineVisible: true,
              understood: false,
            }),
      })
      // Value: protects=while a browser replay holds the bottom panel the test replay's learning block is not drawn, so no step reads `No recorded event is linked to this step.` beside the recording, and the block returns with the replay's own Study message; fails_when=the block stays visible under the recording, its steps read the missing-event line, or it does not return when the browser replay is left; why_new=F153 (D20): a suppressed section still drew the learning block of the retired replay; seam=none; no_claim=the host's retiring of the test replay (studyWorkspaceTestReplayBrowser.test.ts) (stand-ins: the Study messages the host posts)
      // Arrange: a test replay with learning material and a browser replay in the bottom panel.
      const journalWithLearning = {
        ...nodeJournalWithoutReplay,
        nodeHistoryLearningSummary: {
          content: {
            question: 'Why does the job wait?',
            title: 'Job wait',
            summary: 'The job waits for its timer.',
            participants: [
              { id: 'test', label: 'Test' },
              { id: 'job', label: 'Job' },
            ],
            steps: [
              {
                id: 'wait',
                from: 'test',
                to: 'job',
                label: 'Wait for the timer',
                explanation: 'The timer fires after the delay.',
                evidence: 'observed',
                reference: {
                  type: 'stop',
                  sequence: 9,
                  sourceHash: 'a'.repeat(64),
                },
              },
            ],
          },
          positions: [],
        },
      }
      const learningBlock = () =>
        page.evaluate(() => ({
          blockHidden: document.getElementById('node-history-learning').hidden,
          noMaterialHidden: document.getElementById('node-history-no-material')
            .hidden,
          missingEventLines: Array.from(
            document.querySelectorAll('#node-learning-steps .muted'),
          ).filter((line) =>
            line.textContent.includes('No recorded event is linked'),
          ).length,
        }))
      // Act
      await publish({
        ...panelReplay,
        ...journalWithLearning,
        recording: panelReplay.recording,
      })
      const learningDuringReplay = await learningBlock()
      await publish(journalWithLearning)
      const learningAfterReplay = await learningBlock()
      // Assert
      cases.push({
        name: 'while a browser replay holds the bottom panel the test replay’s learning block and its missing-material line are not drawn, and the block returns when the replay is left',
        actual: { learningDuringReplay, learningAfterReplay },
        passed:
          JSON.stringify(learningDuringReplay) ===
            JSON.stringify({
              blockHidden: true,
              noMaterialHidden: true,
              missingEventLines: 0,
            }) &&
          JSON.stringify(learningAfterReplay) ===
            JSON.stringify({
              blockHidden: false,
              noMaterialHidden: true,
              missingEventLines: 1,
            }),
      })
    }
  }
  // The keyboard focus when a part of the pane leaves while it holds it (row 85): each case puts the focus on a control of that part, publishes the Study message under which the part leaves, and reads where the focus is; the same step with the focus on a control that stays must move nothing.
  /** Loads a fresh document of one pane at a size and waits until it is ready for its first Study message; `html` is the pane's document unless a case gives its own. */
  const openPane = async (kind, size, html = options.html[kind]) => {
    await page.setViewportSize(size)
    await page.goto(options.url)
    await page.evaluate(() => {
      window.sent = []
      window.acquireVsCodeApi = () => ({
        getState: () => undefined,
        setState() {},
        postMessage: (message) => window.sent.push(message),
      })
    })
    await page.setContent(html)
    await page.waitForFunction(() =>
      window.sent.some((message) => message.type === 'ready'),
    )
  }
  /** Opens the disclosures a case needs by script, as an arrangement: the pane then closes or hides them itself. */
  const openDisclosures = (ids) =>
    page.evaluate((ids) => {
      for (const id of ids) document.getElementById(id).open = true
    }, ids)
  /**
   * Runs one situation twice from the same start: with the focus on a control of the part that leaves, and with it on a control that stays. `between` are Study messages the host publishes before the part leaves, as while it works on a pressed control.
   * @returns The focus before and after the part left, and the focus of the second run after it, which must be the staying control.
   */
  const focusWhenPartLeaves = async ({
    before,
    opened = [],
    leaving,
    staying,
    between = [],
    after,
  }) => {
    const run = async (selector) => {
      await publish(before)
      await openDisclosures(opened)
      await page.locator(selector).first().focus()
      const held = await focusName()
      for (const message of between) await publish(message)
      await publish(after)
      return { held, then: await focusName() }
    }
    return { leaving: await run(leaving), staying: await run(staying) }
  }
  const storageError = 'Error: History not saved: disk is read-only',
    liveRun = {
      ...options.message,
      liveState: 'running',
      liveTitle: 'Repository operation',
    },
    stoppedRun = { ...liveRun, liveState: 'stopped' },
    openRecording = {
      ...options.message,
      contentTab: 'recording',
      recording: {
        revision: revisionAt(1),
        mode: 'paused',
        readiness: 'ready',
        cleared: false,
        presentedMs: 2000,
        range: { startMs: 0, endMs: 5000, endKnown: true },
        recordingStatus: 'finalized',
      },
    },
    overview = { ...options.message, contentTab: 'overview' },
    savedOne = {
      id: 'window_run-focus01',
      savedAt: '2026-09-20T00:00:10.000Z',
      profile: 'repository-browser',
      format: 'v3',
      outcome: 'demonstrated',
      metadata: 'validated',
    }
  const helpButtonName = 'button: Keyboard shortcuts ?'
  /**
   * Runs one situation in which the host disables a control while it works and then offers it again, twice from the same start: with the focus left where the press put it, and with the learner moving the focus to another control while the first is disabled.
   * @returns The focus on the control, while it is disabled and when it is offered again; and for the second run the focus after the control is offered again, which must still be the other control.
   */
  const focusWhenControlReturns = async ({
    before,
    opened = [],
    control,
    working,
    after,
    other,
  }) => {
    const press = async () => {
      await publish(before)
      await openDisclosures(opened)
      await page.locator(control).first().focus()
      const held = await focusName()
      await publish(working)
      return { held, whileDisabled: await focusName() }
    }
    const kept = await press()
    await publish(after)
    kept.offeredAgain = await focusName()
    await press()
    await page.locator(other).first().focus()
    await publish(after)
    return { kept, movedOn: await focusName() }
  }
  const recordedStops = [1000, 3000, 4000].map((elapsedMs, index) => ({
      id: `recorded-stop-${index}`,
      itemId: options.message.model.selection.itemId,
      title: 'Recorded stop',
      elapsedMs,
      at: '2026-09-27T00:00:00.000Z',
    })),
    /** A recording with three recorded stops, shown at one position: Next recorded stop can be used at 2 s and at 3 s. */
    recordingAt = (presentedMs, extra = {}) => ({
      ...openRecording,
      moments: recordedStops,
      ...extra,
      recording: { ...openRecording.recording, presentedMs },
    }),
    /** The same recording while a requested moment is not shown yet, which disables the recorded steps. */
    recordingPendingAt = (presentedMs, extra = {}) => {
      const shown = recordingAt(presentedMs, extra)
      return {
        ...shown,
        recording: { ...shown.recording, readiness: 'loading', cleared: true },
      }
    }
  const returningSituations = (paneName, otherBesideStop, extra = {}) => [
    {
      name: `in the ${paneName}, after Next recorded stop is pressed by keyboard and the requested moment is shown, the keyboard focus is on Next recorded stop again, so a second press steps on; a learner who moved the focus meanwhile keeps it`,
      before: recordingAt(2000, extra),
      control: '#next-moment',
      working: recordingPendingAt(2000, extra),
      after: recordingAt(3000, extra),
      other: '#playback-toggle',
      expected: ['next-moment', 'playback-toggle'],
    },
    {
      name: `in the ${paneName}, when Stop is disabled while the host works and offered again because the run goes on, the keyboard focus is on Stop again; a learner who moved the focus meanwhile keeps it`,
      before: { ...liveRun, ...extra },
      control: '[data-action="stop"]',
      working: { ...liveRun, ...extra, busy: true },
      after: { ...liveRun, ...extra },
      other: otherBesideStop.selector,
      expected: ['stop', otherBesideStop.name],
    },
  ]
  /** Adds one case a situation of {@link focusWhenControlReturns}. */
  const addReturningCases = async (situations) => {
    for (const situation of situations) {
      const actual = await focusWhenControlReturns(situation)
      cases.push({
        name: situation.name,
        actual,
        passed:
          JSON.stringify(actual) ===
          JSON.stringify({
            kept: {
              held: situation.expected[0],
              whileDisabled: 'body',
              offeredAgain: situation.expected[0],
            },
            movedOn: situation.expected[1],
          }),
      })
    }
  }

  // Arrange: the Study pane.
  await openPane('context', { width: 600, height: 800 })
  await publish(options.message)
  const studyPaneSituations = [
    {
      name: 'in the Study pane, when the run stops while Stop holds the keyboard focus, the live strip leaves and the focus goes to the selected content tab, not to the document body; a focus outside the strip stays where it was',
      before: liveRun,
      leaving: '[data-action="stop"]',
      staying: '[data-action="outline"]',
      after: stoppedRun,
      expected: ['stop', 'live-tab', 'outline'],
    },
    {
      name: 'in the Study pane, when Stop is pressed, the host first reports that it is working, which disables Stop under the focus, and then that the run stopped: the focus goes to the selected content tab, not to the document body; a focus outside the strip stays where it was',
      before: liveRun,
      leaving: '[data-action="stop"]',
      staying: '[data-action="outline"]',
      between: [{ ...liveRun, busy: true }],
      after: stoppedRun,
      expected: ['stop', 'live-tab', 'outline'],
    },
    {
      name: 'in the Study pane, when the bottom panel takes the transport over while Play holds the keyboard focus, the focus goes to the selected content tab, not to the document body; a focus outside the transport stays where it was',
      before: openRecording,
      leaving: '#playback-toggle',
      staying: '[data-action="outline"]',
      after: { ...openRecording, playbackPanelVisible: true },
      expected: ['playback-toggle', 'recording-tab', 'outline'],
    },
    {
      name: 'in the Study pane, when the recording is left while Play holds the keyboard focus, the transport leaves and the focus goes to the selected content tab, not to the document body; a focus outside the transport stays where it was',
      before: openRecording,
      leaving: '#playback-toggle',
      staying: '[data-action="outline"]',
      after: options.message,
      expected: ['playback-toggle', 'live-tab', 'outline'],
    },
    {
      name: 'in the Study pane, when Retry storage / refresh leaves after its press because the error is gone, the focus goes to the selected content tab, not to the document body; a focus on another control stays where it was',
      before: { ...options.message, errors: [storageError] },
      leaving: '#study-content > [data-action="retry"]',
      staying: '[data-action="outline"]',
      after: options.message,
      expected: ['retry', 'live-tab', 'outline'],
    },
    {
      name: 'in the Study pane, when Save preference leaves after its press because the preference is saved, the focus goes to the summary of View options, which holds the button, not to the document body; a focus on another control stays where it was',
      before: {
        ...overview,
        presentation: openPresentation({ preference: { status: 'failed' } }),
      },
      opened: ['reader-options', 'presentation-options'],
      leaving: '[data-presentation="save-preference"]',
      staying: '[data-action="outline"]',
      after: {
        ...overview,
        presentation: openPresentation({ preference: { status: 'saved' } }),
      },
      expected: ['button: Save preference', 'summary: View options', 'outline'],
    },
    {
      name: 'in the Study pane, when the Recording tab closes Study view and pane controls while a control inside holds the keyboard focus, the focus goes to that disclosure’s summary, not to the document body; a focus outside the disclosure stays where it was',
      before: overview,
      opened: ['reader-options'],
      leaving: '[data-action="read-app"]',
      staying: '[data-action="outline"]',
      after: openRecording,
      expected: [
        'read-app',
        'summary: Study view and pane controls',
        'outline',
      ],
    },
    {
      name: 'in the Study pane, when Recording error details leave because the replay no longer fails while their summary holds the keyboard focus, the focus goes to the summary of Playback details, which holds them, not to the document body; a focus outside stays where it was',
      before: {
        ...openRecording,
        recording: {
          ...openRecording.recording,
          readiness: 'failed',
          reason: 'A recorded frame is missing.',
        },
      },
      opened: ['playback-options', 'playback-diagnostics'],
      leaving: '#playback-diagnostics > summary',
      staying: '[data-action="outline"]',
      after: openRecording,
      expected: [
        'summary: Recording error details',
        'summary: Playback details',
        'outline',
      ],
    },
    {
      name: 'in the Study pane, when Open article leaves after its press because the article is open, the focus goes to the selected content tab, not to the document body; a focus on another control stays where it was',
      before: { ...options.message, repositoryArticleAvailable: true },
      leaving: '[data-action="open-article"]',
      staying: '[data-action="outline"]',
      after: {
        ...options.message,
        repositoryArticleAvailable: true,
        repositoryReturnAvailable: true,
      },
      expected: ['open-article', 'live-tab', 'outline'],
    },
    {
      name: 'in the Study pane, when the selected observation starts to load while Open current file holds the keyboard focus, the observation’s part leaves and the focus goes to the selected content tab, not to the document body; a focus outside that part stays where it was',
      before: options.message,
      leaving: '[data-action="current-file"]',
      staying: '[data-action="outline"]',
      after: { ...options.message, loading: true },
      expected: ['current-file', 'live-tab', 'outline'],
    },
    {
      name: 'in the Study pane, when the host changes the content tab while Read the linked source of the Overview holds the keyboard focus, the Overview leaves and the focus goes to the selected content tab, not to the document body; a focus outside the Overview stays where it was',
      before: overview,
      leaving: '#overview [data-action="source"]',
      staying: '[data-action="outline"]',
      after: { ...options.message, contentTab: 'live' },
      expected: ['source', 'live-tab', 'outline'],
    },
    {
      name: 'in the Study pane, when a recording opens while the summary of Study controls holds the keyboard focus, Study controls leave and the focus goes to the selected content tab, not to the document body; a focus on a control that stays is left alone',
      before: options.message,
      leaving: '#study-controls > summary',
      staying: '[data-action="outline"]',
      after: openRecording,
      expected: ['summary: Study controls', 'recording-tab', 'outline'],
    },
    {
      name: 'in the Study pane, when a study is no longer shown while the summary of Evidence status holds the keyboard focus, Evidence status leaves and the focus goes to the selected content tab, not to the document body; a focus on a control that stays is left alone',
      before: {
        ...options.message,
        study: {
          terminal: true,
          studyOutcome: 'demonstrated',
          historyOutcome: 'saved',
          finalOutcome: 'demonstrated',
          recordingSave: { status: 'finalized', contextStatus: 'saved' },
        },
      },
      leaving: '#evidence-details > summary',
      staying: '[data-action="outline"]',
      after: options.message,
      expected: ['evidence-summary', 'live-tab', 'outline'],
    },
    {
      name: 'in the Study pane, when Return to Wiki leaves after its press because the reader is back in the Wiki, the focus goes to the selected content tab, not to the document body; a focus on another control stays where it was',
      before: { ...options.message, repositoryReturnAvailable: true },
      leaving: '[data-action="return-wiki"]',
      staying: '[data-action="outline"]',
      after: options.message,
      expected: ['return-wiki', 'live-tab', 'outline'],
    },
    {
      name: 'in the Study pane, when Later annotations leave because the recorded time has none while their summary holds the keyboard focus, the focus goes to the selected content tab, not to the document body; a focus on a control that stays is left alone',
      before: {
        ...openRecording,
        recording: {
          ...openRecording.recording,
          laterInterpretations: [
            { text: 'A revision saved later.', availableMs: 7000 },
          ],
        },
      },
      leaving: '#later-annotations > summary',
      staying: '[data-action="outline"]',
      after: openRecording,
      expected: [
        'summary: Later annotations — not available at this recorded time',
        'recording-tab',
        'outline',
      ],
    },
    {
      name: 'in the Study pane, when the observed moment whose control holds the keyboard focus is no longer listed, the focus goes to the selected content tab, not to the document body; a focus on a control that stays is left alone',
      before: {
        ...options.message,
        moments: [
          {
            id: 'observed-1',
            itemId: 'no-item-of-the-next-list',
            title: 'Observed stop',
            at: '2026-09-27T00:00:00.000Z',
          },
        ],
      },
      leaving: '#moments button',
      staying: '[data-action="outline"]',
      after: options.message,
      expected: [
        `button: Observed stop · ${new Date('2026-09-27T00:00:00.000Z').toLocaleTimeString()}`,
        'live-tab',
        'outline',
      ],
    },
    {
      name: 'in the Study pane, when the last saved study leaves the library by another pane’s removal while Delete saved study… holds the keyboard focus, the button leaves and the focus goes to the selected content tab, not to the document body; a focus on the Saved studies list stays where it was',
      before: {
        ...options.message,
        studies: [savedOne],
        model: {
          ...options.message.model,
          selection: {
            ...options.message.model.selection,
            studyId: savedOne.id,
          },
        },
      },
      leaving: '#delete-study',
      staying: '#studies',
      after: options.message,
      expected: ['delete-study', 'live-tab', 'studies'],
    },
  ]
  // Act
  for (const situation of studyPaneSituations)
    situation.actual = await focusWhenPartLeaves(situation)
  // Assert
  for (const { name, actual, expected } of studyPaneSituations)
    cases.push({
      name,
      actual,
      passed:
        JSON.stringify(actual) ===
        JSON.stringify({
          leaving: { held: expected[0], then: expected[1] },
          staying: { held: expected[2], then: expected[2] },
        }),
    })

  // Arrange: controls of the Study pane the host disables while it works on their press (found with row 85): the browser hands the focus of a disabled control to the document body.
  await addReturningCases([
    ...returningSituations('Study pane', {
      selector: '[data-action="outline"]',
      name: 'outline',
    }),
    {
      name: 'in the Study pane, when Restore is disabled while the presentation changes and offered again, the keyboard focus is on Restore again; a learner who moved the focus meanwhile keeps it',
      before: { ...overview, presentation: openPresentation({}) },
      opened: ['reader-options'],
      control: '[data-presentation="restore"]',
      working: {
        ...overview,
        presentation: openPresentation({ state: 'applying' }),
      },
      after: { ...overview, presentation: openPresentation({}) },
      other: '[data-action="read-app"]',
      expected: ['button: Restore', 'read-app'],
    },
  ])
  // Arrange: Play holds the focus in the pane, which has the focus (found with row 85, rewritten with row 326: until then the case let the learner take the focus off Play by the click that returned to the pane, and such a click must give the focus back).
  await publish(recordingAt(2000))
  await page.locator('#playback-toggle').focus()
  const paneBackground = await backgroundPoint()
  // Act: the learner presses the pane's background, which takes the focus off Play; then leaves the pane, a message arrives, and the learner returns.
  await page.mouse.click(paneBackground.x, paneBackground.y)
  const focusAfterPressOnBackground = await focusName()
  await leavePane()
  await publish(recordingAt(2000))
  await returnToPane()
  const focusAfterLearnerLeftControl = await focusName()
  // Assert
  cases.push({
    name: 'a focus the learner took off a control that is shown and can be used, by a press on the pane’s background, is not put back when the learner leaves the pane and returns',
    actual: { focusAfterPressOnBackground, focusAfterLearnerLeftControl },
    passed:
      focusAfterPressOnBackground === 'body' &&
      focusAfterLearnerLeftControl === 'body',
  })

  // Arrange: Play holds the focus, and nothing changes while the learner is away (row 326: the editor takes the focus from the control when the pane is left, and the pane gives it back).
  await page.locator('#playback-toggle').focus()
  // Act: the learner leaves and returns four times: by the editor's command, by a press on the pane's background in either order of the focus event and the press, and by a press on another control.
  await leavePane()
  const focusWhileAway = await focusName()
  await publish(recordingAt(2000))
  const focusAfterMessageWhileAway = await focusName()
  await returnToPane()
  const focusOnReturnByCommand = await focusName()
  await leavePane()
  await returnToPaneByPressAt(paneBackground, 'focus-first')
  const focusOnReturnByPressAfterFocusEvent = await focusName()
  await leavePane()
  await returnToPaneByPressAt(paneBackground, 'press-first')
  const focusOnReturnByPressBeforeFocusEvent = await focusName()
  await leavePane()
  await returnToPaneByPressAt(await middleOf('#next-moment'), 'focus-first')
  const focusOnReturnByPressOnAnotherControl = await focusName()
  await page.locator('#playback-toggle').focus()
  await leavePane()
  await returnToPaneByPressAt(await middleOf('#next-moment'), 'press-first')
  const focusOnReturnByEarlierPressOnAnotherControl = await focusName()
  // Assert
  cases.push({
    name: 'a learner who leaves the pane while a control has the keyboard and returns finds the keyboard on that control again when nothing changed: after the editor’s focus command, and after a press on the pane’s background whichever of the focus event and the press comes first; a return by a press on another control leaves the keyboard on that control; and the pane takes no focus while it is away',
    actual: {
      focusWhileAway,
      focusAfterMessageWhileAway,
      focusOnReturnByCommand,
      focusOnReturnByPressAfterFocusEvent,
      focusOnReturnByPressBeforeFocusEvent,
      focusOnReturnByPressOnAnotherControl,
      focusOnReturnByEarlierPressOnAnotherControl,
    },
    passed:
      focusWhileAway === 'body' &&
      focusAfterMessageWhileAway === 'body' &&
      focusOnReturnByCommand === 'playback-toggle' &&
      focusOnReturnByPressAfterFocusEvent === 'playback-toggle' &&
      focusOnReturnByPressBeforeFocusEvent === 'playback-toggle' &&
      focusOnReturnByPressOnAnotherControl === 'next-moment' &&
      focusOnReturnByEarlierPressOnAnotherControl === 'next-moment',
  })

  // Arrange: Stop holds the focus of a running study, and the learner has left the pane (rows 85 and 326: the control the learner left is the one the editor took the focus from).
  await publish(liveRun)
  await page.locator('[data-action="stop"]').focus()
  await leavePane()
  // Act: the run stops while the learner is away, so the live strip leaves; later the learner returns.
  await publish(stoppedRun)
  const stopFocusWhileAway = await focusName()
  await returnToPane()
  const stopFocusOnReturn = await focusName()
  // Assert
  cases.push({
    name: 'when the run stops while the learner, who left the pane with the keyboard on Stop, is away, the pane takes no focus, and on return the keyboard is on the selected content tab, not on the document body',
    actual: { stopFocusWhileAway, stopFocusOnReturn },
    passed: stopFocusWhileAway === 'body' && stopFocusOnReturn === 'live-tab',
  })

  // Arrange: the presentation is changing, the keyboard stands on the Overview tab, and the learner has left the pane for the editor (row 329: the host captures the pane's reading pose, replaces the pane's document and restores the pose in the new one).
  const changingPresentation = {
      ...overview,
      presentation: openPresentation({ state: 'applying' }),
    },
    poseIdentity = {
      captureId: '22222222-2222-4222-8222-222222222222',
      presentationId: changingPresentation.presentation.presentationId,
      expectedRevision:
        changingPresentation.presentation.presentationControlRevision,
      revision: changingPresentation.revision,
      itemId: changingPresentation.model.selection.itemId,
      sourceHash: changingPresentation.model.source.hash,
      studyId: changingPresentation.model.selection.studyId,
      observationId: changingPresentation.model.observation?.id,
      contentTab: 'overview',
    }
  /** Waits until the pane has answered a pose restore: the restore runs in an animation frame. */
  const poseAnswer = () =>
    page
      .waitForFunction(() =>
        window.sent.some(
          (message) =>
            message.type === 'presentation-pose-restored' ||
            message.type === 'presentation-pose-invalidated',
        ),
      )
      .then(() =>
        page.evaluate(
          () =>
            window.sent.findLast((message) =>
              message.type.startsWith('presentation-pose-'),
            ).type,
        ),
      )
  /** Replaces the pane's document as a change of the presentation does and publishes the Study message of that change; the new document does not have the focus when `isAway`, as while the learner works in the editor. */
  const replacePaneDocument = async (isAway) => {
    await openPane('context', { width: 600, height: 800 })
    if (isAway)
      await page.evaluate(() => {
        document.hasFocus = () => false
      })
    await publish(changingPresentation)
  }
  await publish(changingPresentation)
  await page.locator('#overview-tab').focus()
  await leavePane()
  // Act: the host captures the pose and replaces the document, restores the pose in the new document, which has no focus, and the learner returns.
  await publish({ type: 'capture-presentation-pose', ...poseIdentity })
  const capturedPose = await page.evaluate(
    () =>
      window.sent.findLast((message) => message.type === 'presentation-pose')
        ?.pose,
  )
  await replacePaneDocument(true)
  await publish({
    type: 'restore-presentation-pose',
    ...poseIdentity,
    pose: capturedPose,
  })
  const answerInReplacedPane = await poseAnswer()
  const focusInReplacedPaneWhileAway = await focusName()
  await returnToPane()
  const focusInReplacedPaneOnReturn = await focusName()
  // The same pose restored in a new document that has the focus: the learner returned while the presentation was changing.
  await replacePaneDocument(false)
  await publish({
    type: 'restore-presentation-pose',
    ...poseIdentity,
    pose: capturedPose,
  })
  await poseAnswer()
  const focusInReplacedPaneWithFocus = await focusName()
  // Assert
  cases.push({
    name: 'when a change of the presentation replaces the pane’s document while the learner, who left the pane with the keyboard on a control, is away, the pose names that control, the new document takes no focus, and on return the keyboard is on the same control; a new document that has the focus gives it to the control at once',
    actual: {
      capturedFocus: capturedPose?.focus,
      answerInReplacedPane,
      focusInReplacedPaneWhileAway,
      focusInReplacedPaneOnReturn,
      focusInReplacedPaneWithFocus,
    },
    passed:
      JSON.stringify(capturedPose?.focus) ===
        JSON.stringify({ kind: 'id', id: 'overview-tab' }) &&
      answerInReplacedPane === 'presentation-pose-restored' &&
      focusInReplacedPaneWhileAway === 'body' &&
      focusInReplacedPaneOnReturn === 'overview-tab' &&
      focusInReplacedPaneWithFocus === 'overview-tab',
  })

  // Arrange: the bottom panel's pane, which has no content tabs: a focus that loses its control goes to Play while the transport is shown, else to the first control the pane shows.
  await openPane('moments', { width: 1200, height: 400 })
  await publish(options.message)
  const panelRecording = {
      ...openRecording,
      playbackPanelVisible: true,
      errors: [storageError],
    },
    panelWithoutRecording = {
      ...options.message,
      errors: [storageError],
      studies: [savedOne],
      moments: [
        {
          id: 'observed-1',
          itemId: options.message.model.selection.itemId,
          title: 'Observed stop',
          at: '2026-09-27T00:00:00.000Z',
        },
      ],
    },
    mainRetry = '#study-content > [data-action="retry"]'
  const bottomPanelSituations = [
    {
      name: 'in the bottom panel, when the run stops while Stop holds the keyboard focus, the live strip leaves and the focus goes to the first control the pane shows, not to the document body; a focus outside the strip stays where it was',
      before: { ...liveRun, studies: [savedOne] },
      leaving: '[data-action="stop"]',
      staying: '#studies',
      after: { ...stoppedRun, studies: [savedOne] },
      expected: ['stop', helpButtonName, 'studies'],
    },
    {
      name: 'in the bottom panel, when Stop is pressed, the host first reports that it is working, which disables Stop under the focus, and then that the run stopped: the focus goes to the first control the pane shows, not to the document body; a focus outside the strip stays where it was',
      before: { ...liveRun, studies: [savedOne] },
      leaving: '[data-action="stop"]',
      staying: '#studies',
      between: [{ ...liveRun, studies: [savedOne], busy: true }],
      after: { ...stoppedRun, studies: [savedOne] },
      expected: ['stop', helpButtonName, 'studies'],
    },
    {
      name: 'in the bottom panel, when the recording is left while Play holds the keyboard focus, the transport leaves and the focus goes to the first control the pane shows, not to the document body; a focus outside the transport stays where it was',
      before: panelRecording,
      leaving: '#playback-toggle',
      staying: mainRetry,
      after: panelWithoutRecording,
      expected: ['playback-toggle', helpButtonName, 'retry'],
    },
    {
      name: 'in the bottom panel, when a recording opens while the Saved studies list holds the keyboard focus, Saved studies leave and the focus goes to Play, not to the document body; a focus on a control that stays is left alone',
      before: panelWithoutRecording,
      leaving: '#studies',
      staying: mainRetry,
      after: { ...panelRecording, studies: [savedOne] },
      expected: ['studies', 'playback-toggle', 'retry'],
    },
    {
      name: 'in the bottom panel, when a recording opens while an observed moment holds the keyboard focus, Observed moments leave and the focus goes to Play, not to the document body; a focus on a control that stays is left alone',
      before: panelWithoutRecording,
      leaving: '#moments button',
      staying: mainRetry,
      after: { ...panelRecording, moments: panelWithoutRecording.moments },
      expected: [
        `button: Observed stop · ${new Date('2026-09-27T00:00:00.000Z').toLocaleTimeString()}`,
        'playback-toggle',
        'retry',
      ],
    },
    {
      name: 'in the bottom panel, when a recording opens while Keyboard shortcuts of the heading holds the keyboard focus, the heading leaves and the focus goes to Play, not to the document body; a focus on a control that stays is left alone',
      before: panelWithoutRecording,
      leaving: '.learning-header [data-shortcut-help]',
      staying: mainRetry,
      after: panelRecording,
      expected: [helpButtonName, 'playback-toggle', 'retry'],
    },
    {
      name: 'in the bottom panel, when Retry storage / refresh leaves after its press because the error is gone, the focus goes to the first control the pane shows, not to the document body; a focus on another control stays where it was',
      before: panelWithoutRecording,
      leaving: mainRetry,
      staying: '#studies',
      after: { ...panelWithoutRecording, errors: [] },
      expected: ['retry', helpButtonName, 'studies'],
    },
  ]
  // Act
  for (const situation of bottomPanelSituations)
    situation.actual = await focusWhenPartLeaves(situation)
  // Assert
  for (const { name, actual, expected } of bottomPanelSituations)
    cases.push({
      name,
      actual,
      passed:
        JSON.stringify(actual) ===
        JSON.stringify({
          leaving: { held: expected[0], then: expected[1] },
          staying: { held: expected[2], then: expected[2] },
        }),
    })

  await addReturningCases(
    returningSituations(
      'bottom panel',
      { selector: '#studies', name: 'studies' },
      { playbackPanelVisible: true },
    ),
  )

  // Arrange: the bottom panel's pane lists one observed moment, which holds the focus, and the learner has left the panel for the editor (row 326, the run of the native round).
  const panelMoment = (number) => ({
    id: `observed-${number}`,
    itemId: options.message.model.selection.itemId,
    title: 'Observed stop',
    at: '2026-09-27T00:00:00.000Z',
  })
  const panelMoments = (count) => ({
    ...options.message,
    studies: [savedOne],
    moments: Array.from({ length: count }, (_, index) =>
      panelMoment(index + 1),
    ),
  })
  await publish(panelMoments(1))
  await page.locator('#moments button').first().focus()
  await leavePane()
  // Act: a run observes five more moments, so the list is rendered again five times under the moment the learner left; later the learner returns with the editor's command.
  const panelFocusWhileAway = []
  for (let count = 2; count <= 6; count++) {
    await publish(panelMoments(count))
    panelFocusWhileAway.push(await focusName())
  }
  await returnToPane()
  const panelMomentOnReturn = await page.evaluate(
    () => document.activeElement.dataset.observation,
  )
  // Assert
  cases.push({
    name: 'in the bottom panel, when five more moments are observed while the learner, who left the panel with the keyboard on an observed moment, is in the editor, the panel takes no focus, and on return the keyboard is on the same moment of the list that was rendered again',
    actual: { panelFocusWhileAway, panelMomentOnReturn },
    passed:
      panelFocusWhileAway.join() === 'body,body,body,body,body' &&
      panelMomentOnReturn === 'observed-1',
  })

  // Arrange: the bottom panel's pane with one saved study chosen, in a window with a Trash; no removal has an outcome (row 200).
  const withStudyChosen = {
      ...options.message,
      studies: [savedOne],
      model: {
        ...options.message.model,
        selection: {
          ...options.message.model.selection,
          studyId: savedOne.id,
        },
      },
    },
    replayWithStudyChosen = {
      ...withStudyChosen,
      contentTab: 'recording',
      playbackPanelVisible: true,
      recording: openRecording.recording,
    },
    refusedDuringRecording = {
      status: 'refused',
      studyId: savedOne.id,
      text: 'Choose Overview or Live to leave Recording before deleting this study.',
    },
    movedDuringRecording = {
      status: 'moved',
      studyId: 'window_run-gone0002',
      text: 'Saved study moved to the Trash. The library now holds 1 of 64 saved studies.',
    }
  /** Reads the three status regions of the Saved studies part and whether Remove by hand is open. */
  const savedStudiesStatus = async () => ({
    removal: await statusRegion('delete-study-status'),
    filesNote: await statusRegion('study-files-note'),
    copyLine: await statusRegion('copy-study-files-status'),
    removeByHandOpen: await page
      .locator('#study-files')
      .evaluate((disclosure) => disclosure.open),
  })
  await publish(withStudyChosen)
  // Act: a replay opens; the learner's delete request in the Study pane is refused during it, and then another window's removal ends; each time the replay is left with that outcome still in the host's message. After the replay a new refusal arrives.
  await publish(replayWithStudyChosen)
  await publish({
    ...replayWithStudyChosen,
    studyRemoval: refusedDuringRecording,
  })
  const refusalDuringReplay = (await savedStudiesStatus()).removal
  await publish({ ...withStudyChosen, studyRemoval: refusedDuringRecording })
  const leftWithRefusal = (await savedStudiesStatus()).removal
  await publish({
    ...replayWithStudyChosen,
    studyRemoval: movedDuringRecording,
  })
  await publish({ ...withStudyChosen, studyRemoval: movedDuringRecording })
  const leftWithRemoval = (await savedStudiesStatus()).removal
  await publish({
    ...withStudyChosen,
    studyRemoval: {
      status: 'refused',
      studyId: savedOne.id,
      text: 'Stop the run before deleting its study.',
    },
  })
  const refusalAfterReplay = (await savedStudiesStatus()).removal
  // A window without a Trash: Remove by hand is open with the study's file listed and a copy confirmed, when a replay opens and is left again.
  const listedWithoutTrash = {
    ...withStudyChosen,
    removalWithoutTrash: true,
    studyFiles: {
      [savedOne.id]: ['/home/learner/studies/focus01.study.v3.json'],
    },
  }
  await publish(listedWithoutTrash)
  await toggleByKeyboard('study-files')
  await page.locator('#copy-study-files').focus()
  await page.keyboard.press('Enter')
  await publish({
    type: 'study-files-copied',
    studyId: savedOne.id,
    status: 'copied',
    count: 1,
  })
  const openBeforeReplay = await savedStudiesStatus()
  // The note is read in the turn that handles the replay's message, before the browser has told the pane that the disclosure closed.
  const noteAsTheReplayOpens = await page.evaluate(
    (message) => {
      window.dispatchEvent(new MessageEvent('message', { data: message }))
      return document.getElementById('study-files-note').textContent
    },
    {
      ...replayWithStudyChosen,
      removalWithoutTrash: true,
      studyFiles: listedWithoutTrash.studyFiles,
    },
  )
  const openDuringReplay = await savedStudiesStatus()
  await publish(listedWithoutTrash)
  const leftWithFilesListed = await savedStudiesStatus()
  // Arrange and Act: the Study pane, where the learner asked, gets the same refusal during the replay.
  await openPane('context', { width: 600, height: 800 })
  await publish({
    ...replayWithStudyChosen,
    playbackPanelVisible: false,
    studyRemoval: refusedDuringRecording,
  })
  const refusalInTheStudyPane = (await savedStudiesStatus()).removal
  // Assert
  const emptyStatus = (id, isRendered = true) => ({
    ...emptyRegion(id),
    isRendered,
  })
  cases.push({
    name: 'the bottom panel takes no status of a removal while a replay keeps Saved studies out of it: a refusal and a removal that arrive during the replay leave its status region empty when the replay is left, the Study pane shows the refusal, and a refusal after the replay is shown again; Remove by hand that was open comes back closed, with its note and its copy line empty',
    actual: {
      refusalDuringReplay,
      leftWithRefusal,
      leftWithRemoval,
      refusalAfterReplay,
      openBeforeReplay,
      noteAsTheReplayOpens,
      openDuringReplay,
      leftWithFilesListed,
      refusalInTheStudyPane,
    },
    passed:
      JSON.stringify(refusalDuringReplay) ===
        JSON.stringify(emptyStatus('delete-study-status', false)) &&
      JSON.stringify(leftWithRefusal) ===
        JSON.stringify(emptyStatus('delete-study-status')) &&
      JSON.stringify(leftWithRemoval) ===
        JSON.stringify(emptyStatus('delete-study-status')) &&
      refusalAfterReplay.text === 'Stop the run before deleting its study.' &&
      openBeforeReplay.removeByHandOpen &&
      openBeforeReplay.filesNote.text ===
        'This window has no Trash, so Codebook cannot delete a saved study here. Remove these files by hand, then press Retry storage / refresh.' &&
      openBeforeReplay.copyLine.text === 'Copied 1 path.' &&
      noteAsTheReplayOpens === '' &&
      JSON.stringify(openDuringReplay) ===
        JSON.stringify({
          removal: emptyStatus('delete-study-status', false),
          filesNote: emptyStatus('study-files-note', false),
          copyLine: emptyStatus('copy-study-files-status', false),
          removeByHandOpen: false,
        }) &&
      JSON.stringify(leftWithFilesListed) ===
        JSON.stringify({
          removal: emptyStatus('delete-study-status'),
          filesNote: emptyStatus('study-files-note', false),
          copyLine: emptyStatus('copy-study-files-status', false),
          removeByHandOpen: false,
        }) &&
      refusalInTheStudyPane.text ===
        'Choose Overview or Live to leave Recording before deleting this study.',
  })

  // Arrange: a page whose own content carries the two ids the Keyboard shortcuts list names its dialog and its tooltip by, as a Wiki page published before the publisher kept such ids apart can (row 101); the Study pane's document stands in for it, with two such elements ahead of the pane.
  /** Reads what Chrome's accessibility tree holds for one element: its role, its name and its description. */
  const accessibleNode = async (selector) => {
    const accessibility = await page.context().newCDPSession(page)
    const { root } = await accessibility.send('DOM.getDocument')
    const { nodeId } = await accessibility.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector,
    })
    const { nodes } = await accessibility.send(
      'Accessibility.getPartialAXTree',
      { nodeId, fetchRelatives: false },
    )
    await accessibility.detach()
    return {
      role: nodes[0]?.role?.value,
      name: nodes[0]?.name?.value,
      description: nodes[0]?.description?.value,
    }
  }
  /** Puts the focus on the heading's Keyboard shortcuts button, which shows the tooltip, opens the dialog with it, and reads how both are named: the ids they refer to and what Chrome's accessibility tree gives. */
  const keyboardHelpNaming = async () => {
    const helpSelector = '.learning-header [data-shortcut-help]'
    await page.locator(helpSelector).focus()
    const button = await accessibleNode(helpSelector)
    const describedBy = await page
      .locator(helpSelector)
      .getAttribute('aria-describedby')
    await page.locator(helpSelector).press('Enter')
    const dialog = await accessibleNode('.shortcut-dialog')
    const labelledBy = await page
      .locator('.shortcut-dialog')
      .getAttribute('aria-labelledby')
    await page.keyboard.press('Escape')
    return { button, describedBy, dialog, labelledBy }
  }
  await openPane(
    'context',
    { width: 600, height: 800 },
    options.html.context.replace(
      '<p id="bootstrap-status"',
      '<h2 id="shortcut-title">A heading of the page</h2><p id="shortcut-tooltip">A paragraph of the page</p><p id="bootstrap-status"',
    ),
  )
  await publish(options.message)
  // Act: the same reading on that page and on the Study pane as it is.
  const namingBesideThePagesIds = await keyboardHelpNaming()
  await openPane('context', { width: 600, height: 800 })
  await publish(options.message)
  const namingInTheStudyPane = await keyboardHelpNaming()
  // Assert
  const helpNaming = (describedBy, labelledBy) => ({
    button: {
      role: 'button',
      name: 'Keyboard shortcuts',
      description: 'Keyboard shortcuts — ? (Codebook, outside text inputs)',
    },
    describedBy,
    dialog: { role: 'dialog', name: 'Keyboard shortcuts' },
    labelledBy,
  })
  cases.push({
    name: 'on a page whose content carries the ids shortcut-title and shortcut-tooltip, Chrome names the Keyboard shortcuts dialog Keyboard shortcuts and describes the focused Keyboard shortcuts button by the tooltip, not by the page’s elements; the Study pane keeps both ids as they were',
    actual: { namingBesideThePagesIds, namingInTheStudyPane },
    passed:
      JSON.stringify(namingBesideThePagesIds) ===
        JSON.stringify(helpNaming('shortcut-tooltip-2', 'shortcut-title-2')) &&
      JSON.stringify(namingInTheStudyPane) ===
        JSON.stringify(helpNaming('shortcut-tooltip', 'shortcut-title')),
  })

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
  /** Builds one Study message for the Saved studies cases under the counter's revision; `chosen` is the study the reader shows. */
  const libraryMessage = (studies, chosen, extra) => ({
    ...options.message,
    revision: savedRevision,
    studies,
    model: {
      ...options.message.model,
      selection: { ...options.message.model.selection, studyId: chosen },
    },
    ...extra,
  })
  /** Publishes one Study message for the Saved studies cases under a new revision, as the host does when it renders: it shows another study, or the Study workspace is open while Retry storage / refresh ends. */
  const library = (studies, chosen, extra = {}) => {
    savedRevision += 1
    return publish(libraryMessage(studies, chosen, extra))
  }
  /** Publishes one Study message under the revision of the message before it, as the host does when it answers a pane's request (a removal's state, a study's files, a refusal) or reports its own progress: its revision changes only with a render, a navigation or a close, so an answer carries the revision the request was sent with. */
  const libraryAnswer = (studies, chosen, extra = {}) =>
    publish(libraryMessage(studies, chosen, extra))
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
        // The "Remove by hand" disclosure of a window without a Trash; null while it is hidden. What a closed disclosure holds is not rendered, which `checkVisibility` tells and a client rectangle does not.
        removeByHand: visible('study-files')
          ? {
              open: document.getElementById('study-files').open,
              summary: document.querySelector('#study-files > summary')
                .textContent,
              note: document
                .getElementById('study-files-note')
                .checkVisibility()
                ? document.getElementById('study-files-note').textContent
                : null,
              noteIsError: document
                .getElementById('study-files-note')
                .classList.contains('error'),
              // The paths the learner can see, in order.
              files: [...document.querySelectorAll('#study-files-list li')]
                .filter((item) => item.checkVisibility())
                .map((item) => item.textContent),
              copyVisible: document
                .getElementById('copy-study-files')
                .checkVisibility(),
              retryVisible: document
                .querySelector('#study-files [data-action="retry"]')
                .checkVisibility(),
              copyStatus: document.getElementById('copy-study-files-status')
                .textContent,
              copyStatusIsError: document
                .getElementById('copy-study-files-status')
                .classList.contains('error'),
            }
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
  /** Opens "Remove by hand" by keyboard where the pane then asks the host for the chosen study's files, and waits until that request is sent, five seconds at most. A request that does not come is left to the case, which counts the requests and fails on its own comparison. */
  const openRemoveByHandAndAwaitRequest = async () => {
    const requestCount = () =>
      window.sent.filter((message) => message.type === 'delete-study').length
    const requestsBefore = await page.evaluate(requestCount)
    await toggleByKeyboard('study-files')
    await page
      .waitForFunction(
        (requestsBefore) =>
          window.sent.filter((message) => message.type === 'delete-study')
            .length > requestsBefore,
        requestsBefore,
        { timeout: 5_000 },
      )
      .catch(() => undefined)
  }
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
      nodeReason === 'Test replays cannot be deleted here yet.' &&
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
  // Arrange (row 329): the editor's confirming dialog takes the focus from the pane when Delete saved study… is pressed, so the pane is away while the host answers.
  await library([shownStudy, otherStudy], shownStudy.id)
  await deleteButton.click()
  await leavePane()
  // Act: the learner confirms, the study moves and the host answers before the pane has the focus back; then the focus returns to the pane.
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: await answering(confirming),
  })
  await library([otherStudy], otherStudy.id, {
    studyRemoval: await answering(movedShown),
  })
  const removalFocusWhileDialogOpen = await focusName()
  await returnToPane()
  const removalFocusAfterDialog = await focusName()
  // The same with Cancel: the request ends without an outcome while the pane is away.
  await library([shownStudy, otherStudy], shownStudy.id)
  await deleteButton.click()
  await leavePane()
  await library([shownStudy, otherStudy], shownStudy.id, {
    studyRemoval: await answering(confirming),
  })
  await library([shownStudy, otherStudy], shownStudy.id)
  await returnToPane()
  const cancelFocusAfterDialog = await focusName()
  cases.push({
    name: 'when the host answers a pane’s own delete request while the confirming dialog still has the focus, the pane takes none, and when the focus returns it is on the Saved studies list after a removal, not on the delete button of the next study, and on the delete button after Cancel',
    actual: {
      removalFocusWhileDialogOpen,
      removalFocusAfterDialog,
      cancelFocusAfterDialog,
    },
    passed:
      removalFocusWhileDialogOpen === 'body' &&
      removalFocusAfterDialog === 'studies' &&
      cancelFocusAfterDialog === 'delete-study',
  })
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
      // Repair is the primary action of the row: filled like Play, while Delete saved study… keeps the standard button.
      repairIsPrimary: document
        .getElementById('repair-study')
        .classList.contains('primary'),
      repairBackground: getComputedStyle(
        document.getElementById('repair-study'),
      ).backgroundColor,
      playBackground: getComputedStyle(
        document.getElementById('playback-toggle'),
      ).backgroundColor,
      deleteBackground: getComputedStyle(
        document.getElementById('delete-study'),
      ).backgroundColor,
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
      repairLayout.repairIsPrimary &&
      repairLayout.repairBackground === repairLayout.playBackground &&
      repairLayout.repairBackground !== repairLayout.deleteBackground &&
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

  // Arrange: a window without a Trash (a WSL remote window); the host names a study's files only in its answer to a delete request (RT-7, DR-14), which the pane sends when the learner opens Remove by hand (row 27, DR-5).
  const withoutTrash = { removalWithoutTrash: true },
    listedSentence =
      'This window has no Trash, so Codebook cannot delete a saved study here. Remove these files by hand, then press Retry storage / refresh.',
    studyFiles = [
      '/home/learner/.config/Code/User/workspaceStorage/0123/laststance.codebook/recordings/window_run-shown01',
      '/home/learner/.config/Code/User/workspaceStorage/0123/laststance.codebook/studies/window_run-shown01.study.v4.json',
      '/home/learner/.config/Code/User/workspaceStorage/0123/laststance.codebook/studies/window_run-shown01.study.v4.meta.json',
      '/home/learner/.config/Code/User/globalStorage/laststance.codebook/agent/window/run-shown01',
    ],
    otherStudyFile =
      '/home/learner/.config/Code/User/workspaceStorage/0123/laststance.codebook/studies/window_run-other02.study.v4.json'
  await library([otherStudy], undefined, withoutTrash)
  const withoutTrashNothingChosen = await removalControl()
  // Act: the host shows a study, which asks for nothing; the learner opens Remove by hand by keyboard, and the host answers.
  await library([shownStudy, otherStudy], shownStudy.id, withoutTrash)
  const studyChosen = await removalControl()
  await openRemoveByHandAndAwaitRequest()
  const askedForFiles = await removalControl()
  const filesAnswer = await answering({
    status: 'refused',
    studyId: shownStudy.id,
    text: listedSentence,
    files: studyFiles,
  })
  await libraryAnswer([shownStudy, otherStudy], shownStudy.id, {
    ...withoutTrash,
    studyRemoval: filesAnswer,
    studyFiles: { [shownStudy.id]: studyFiles },
  })
  await libraryAnswer([shownStudy, otherStudy], shownStudy.id, {
    ...withoutTrash,
    studyRemoval: filesAnswer,
    studyFiles: { [shownStudy.id]: studyFiles },
    busy: true,
  })
  const filesListed = await removalControl()
  // Another pane asked for the other study's files: the removal state answers that request, and the host keeps both lists by study.
  const bothListed = {
    ...withoutTrash,
    studyRemoval: {
      status: 'refused',
      studyId: otherStudy.id,
      text: listedSentence,
      files: [otherStudyFile],
      request: 1,
    },
    studyFiles: {
      [shownStudy.id]: studyFiles,
      [otherStudy.id]: [otherStudyFile],
    },
  }
  await libraryAnswer([shownStudy, otherStudy], shownStudy.id, bothListed)
  const besideAnotherPanesAnswer = await removalControl()
  const removeByHandSummary = await page
    .locator('#study-files > summary')
    .evaluate((summary) => ({
      height: Math.round(summary.getBoundingClientRect().height),
      focused: document.activeElement === summary,
    }))
  await page
    .locator('#saved-studies')
    .screenshot({ path: `${options.output}/saved-studies-without-trash.png` })
  // The learner chooses the other study: the disclosure leaves while that study opens, and is offered closed once the host shows it.
  await page.selectOption('#studies', otherStudy.id)
  const whileOtherOpens = await removalControl()
  await library([shownStudy, otherStudy], otherStudy.id, bothListed)
  const otherChosen = await removalControl()
  await page
    .locator('#saved-studies')
    .screenshot({ path: `${options.output}/saved-studies-remove-by-hand.png` })
  // Assert
  cases.push({
    name: 'in a window without a Trash, Saved studies lists the chosen study’s files after Remove by hand is opened, offers Copy paths and shows no delete button',
    actual: {
      withoutTrashNothingChosen,
      studyChosen,
      askedForFiles,
      filesListed,
      besideAnotherPanesAnswer,
      removeByHandSummary,
      whileOtherOpens,
      otherChosen,
    },
    passed:
      // (1) With no study chosen the reason says what choosing one and opening the disclosure gives.
      !withoutTrashNothingChosen.buttonVisible &&
      withoutTrashNothingChosen.reason ===
        'This window has no Trash, so Codebook cannot delete a saved study here. Choose a saved study, then open Remove by hand to list its files.' &&
      withoutTrashNothingChosen.removeByHand === null &&
      withoutTrashNothingChosen.deletes.length ===
        afterLaterRefusal.deletes.length &&
      // (2) A chosen study asks the host for nothing and shows the closed disclosure, with no sentence under the hidden delete button.
      studyChosen.deletes.length === afterLaterRefusal.deletes.length &&
      !studyChosen.buttonVisible &&
      studyChosen.reason === null &&
      studyChosen.status === '' &&
      studyChosen.removeByHand.open === false &&
      studyChosen.removeByHand.summary === 'Remove by hand' &&
      studyChosen.removeByHand.files.length === 0 &&
      // (3) Opening it sends one numbered request for the shown study's files and says that they are being listed.
      askedForFiles.deletes.length === afterLaterRefusal.deletes.length + 1 &&
      askedForFiles.deletes.at(-1)[0] === shownStudy.id &&
      Number.isInteger(askedForFiles.removalRequests?.at(-1)) &&
      askedForFiles.removeByHand.open &&
      askedForFiles.removeByHand.note === "Listing this study's files…" &&
      askedForFiles.removeByHand.files.length === 0 &&
      !askedForFiles.removeByHand.copyVisible &&
      !askedForFiles.removeByHand.retryVisible &&
      // (4) The host's answer is shown inside the disclosure only, in order, with both buttons.
      !filesListed.buttonVisible &&
      filesListed.reason === null &&
      filesListed.status === '' &&
      !filesListed.statusIsError &&
      filesListed.removeByHand.note === listedSentence &&
      !filesListed.removeByHand.noteIsError &&
      JSON.stringify(filesListed.removeByHand.files) ===
        JSON.stringify(studyFiles) &&
      filesListed.removeByHand.copyVisible &&
      filesListed.removeByHand.retryVisible &&
      // A later Study message with the answer asks nothing again.
      filesListed.deletes.length === askedForFiles.deletes.length &&
      // The answer to another pane's request leaves this pane's list as it is, and this pane asks nothing again.
      JSON.stringify(besideAnotherPanesAnswer.removeByHand.files) ===
        JSON.stringify(studyFiles) &&
      besideAnotherPanesAnswer.deletes.length ===
        askedForFiles.deletes.length &&
      // The summary is a 44 px target and keeps the focus while the files arrive.
      removeByHandSummary.height === 44 &&
      removeByHandSummary.focused &&
      // (5) Another study closes the disclosure and asks for nothing, although the host already lists that study's files.
      whileOtherOpens.removeByHand === null &&
      otherChosen.chosen === otherStudy.id &&
      otherChosen.removeByHand.open === false &&
      otherChosen.removeByHand.files.length === 0 &&
      otherChosen.deletes.length === askedForFiles.deletes.length,
  })

  // Arrange: Remove by hand is offered closed for the other study, whose file the host already lists; its note is a status region (row 175).
  await library([shownStudy, otherStudy], otherStudy.id, bothListed)
  /** Reads the note of Remove by hand as the page holds it: its text, whether it is rendered, and how many paths the list holds. */
  const filesNote = () =>
    page.evaluate(() => {
      const note = document.getElementById('study-files-note')
      return {
        text: note.textContent,
        isRendered: note.checkVisibility(),
        paths: document.querySelectorAll('#study-files-list li').length,
      }
    })
  const noteWhileClosed = await filesNote()
  // The note is read once more at the toggle event that reports the opened disclosure, ahead of the pane's own handler: a capturing listener of the document runs before the listeners of the disclosure.
  await page.evaluate(() => {
    window.noteAtOpening = undefined
    document.addEventListener(
      'toggle',
      (event) => {
        if (
          event.target.id !== 'study-files' ||
          !event.target.open ||
          window.noteAtOpening
        )
          return
        const note = document.getElementById('study-files-note')
        window.noteAtOpening = {
          text: note.textContent,
          isRendered: note.checkVisibility(),
        }
      },
      { capture: true },
    )
  })
  // Act: the learner opens the disclosure by keyboard and closes it again.
  await toggleByKeyboard('study-files')
  const noteAtOpening = await page.evaluate(() => window.noteAtOpening)
  const noteWhileOpen = await filesNote()
  await toggleByKeyboard('study-files')
  const noteAfterClosing = await filesNote()
  // Assert
  cases.push({
    name: 'the note of Remove by hand is empty while the disclosure is closed, also when the host already lists the study’s files, is rendered and still empty when the disclosure has opened, and gets its sentence then, as a change of a status region that exists; closing empties it again',
    actual: { noteWhileClosed, noteAtOpening, noteWhileOpen, noteAfterClosing },
    passed:
      JSON.stringify(noteWhileClosed) ===
        JSON.stringify({ text: '', isRendered: false, paths: 0 }) &&
      JSON.stringify(noteAtOpening) ===
        JSON.stringify({ text: '', isRendered: true }) &&
      JSON.stringify(noteWhileOpen) ===
        JSON.stringify({ text: listedSentence, isRendered: true, paths: 1 }) &&
      JSON.stringify(noteAfterClosing) === JSON.stringify(noteWhileClosed),
  })

  // Arrange: the same window with the shown study's four files listed and Remove by hand open (row 27, DR-6).
  const copyButton = page.getByRole('button', {
    name: 'Copy paths',
    exact: true,
  })
  /** Posts the host's answer to Copy paths into the pane, as the host does to the pane that asked. */
  const answerCopy = (answer) =>
    publish({ type: 'study-files-copied', ...answer })
  await library([shownStudy, otherStudy], shownStudy.id, bothListed)
  await toggleByKeyboard('study-files')
  const copyStatusWhileEmpty = await page
    .locator('#copy-study-files-status')
    .evaluate((line) => ({
      role: `${line.getAttribute('role')}/${line.getAttribute('aria-live')}`,
      display: getComputedStyle(line).display,
      height: line.getBoundingClientRect().height,
    }))
  // Act: the learner presses Copy paths by keyboard, and the host answers once the clipboard took the four paths.
  await copyButton.focus()
  await page.keyboard.press('Enter')
  const afterFirstPress = await removalControl()
  // An answer for another study than the one whose files are listed changes nothing.
  await answerCopy({ studyId: otherStudy.id, status: 'copied', count: 1 })
  const afterForeignAnswer = await removalControl()
  await answerCopy({ studyId: shownStudy.id, status: 'copied', count: 4 })
  const afterFirstAnswer = await removalControl()
  // A second press empties the line before the host answers again.
  await page.keyboard.press('Enter')
  const afterSecondPress = await removalControl()
  await answerCopy({ studyId: shownStudy.id, status: 'copied', count: 4 })
  const afterSecondAnswer = await removalControl()
  // The clipboard refuses a third copy.
  await page.keyboard.press('Enter')
  await answerCopy({ studyId: shownStudy.id, status: 'failed' })
  const afterRefusedCopy = await removalControl()
  // The learner closes the disclosure and opens it again.
  await toggleByKeyboard('study-files')
  await toggleByKeyboard('study-files')
  const afterReopening = await removalControl()
  // The other study has one listed file.
  await library([shownStudy, otherStudy], otherStudy.id, bothListed)
  await toggleByKeyboard('study-files')
  await copyButton.focus()
  await page.keyboard.press('Enter')
  await answerCopy({ studyId: otherStudy.id, status: 'copied', count: 1 })
  const afterCopyOfOne = await removalControl()
  await library([shownStudy, otherStudy], shownStudy.id, bothListed)
  await toggleByKeyboard('study-files')
  const afterAnotherStudy = await removalControl()
  // Assert
  cases.push({
    name: 'Copy paths confirms with the number of paths the host copied, again after a second press, says when the clipboard took nothing, and the line is cleared when the disclosure closes or another study is chosen',
    actual: {
      copyStatusWhileEmpty,
      afterFirstPress,
      afterForeignAnswer,
      afterFirstAnswer,
      afterSecondPress,
      afterSecondAnswer,
      afterRefusedCopy,
      afterReopening,
      afterCopyOfOne,
      afterAnotherStudy,
    },
    passed:
      (await copyButton.count()) === 1 &&
      // The confirmation line is a status region that is rendered while empty and takes no room.
      copyStatusWhileEmpty.role === 'status/polite' &&
      copyStatusWhileEmpty.display !== 'none' &&
      copyStatusWhileEmpty.height === 0 &&
      JSON.stringify(afterFirstPress.copies) ===
        JSON.stringify([shownStudy.id]) &&
      afterFirstPress.removeByHand.copyStatus === '' &&
      afterForeignAnswer.removeByHand.copyStatus === '' &&
      afterFirstAnswer.removeByHand.copyStatus === 'Copied 4 paths.' &&
      !afterFirstAnswer.removeByHand.copyStatusIsError &&
      afterFirstAnswer.focus === 'copy-study-files' &&
      afterSecondPress.removeByHand.copyStatus === '' &&
      afterSecondAnswer.removeByHand.copyStatus === 'Copied 4 paths.' &&
      afterRefusedCopy.removeByHand.copyStatus ===
        'Could not copy the paths. Select them in the list above and copy them by hand.' &&
      afterRefusedCopy.removeByHand.copyStatusIsError &&
      afterRefusedCopy.focus === 'copy-study-files' &&
      afterReopening.removeByHand.open &&
      afterReopening.removeByHand.copyStatus === '' &&
      !afterReopening.removeByHand.copyStatusIsError &&
      // The files were listed before: opening again asks the host for nothing.
      afterReopening.deletes.length === otherChosen.deletes.length &&
      afterCopyOfOne.removeByHand.copyStatus === 'Copied 1 path.' &&
      afterAnotherStudy.removeByHand.copyStatus === '' &&
      JSON.stringify(afterAnotherStudy.copies) ===
        JSON.stringify([
          shownStudy.id,
          shownStudy.id,
          shownStudy.id,
          otherStudy.id,
        ]),
  })

  // Arrange: a study none of whose files is left, and one whose files the host refuses to list (row 27, DR-5).
  const thirdStudy = savedStudy('window_run-third09'),
    emptiedStudy = savedStudy('window_run-empty10'),
    threeStudies = [shownStudy, thirdStudy, emptiedStudy]
  await library(threeStudies, emptiedStudy.id, withoutTrash)
  await openRemoveByHandAndAwaitRequest()
  // Act: the host answers with a list that holds no file.
  await libraryAnswer(threeStudies, emptiedStudy.id, {
    ...withoutTrash,
    studyRemoval: await answering({
      status: 'refused',
      studyId: emptiedStudy.id,
      text: listedSentence,
      files: [],
    }),
    studyFiles: { [emptiedStudy.id]: [] },
  })
  const noFileLeft = await removalControl()
  // Act: the host refuses the request for the third study's files, because a recording began to open meanwhile.
  const refusalSentence =
    "Choose Overview or Live to leave Recording before removing this study's files by hand."
  await library(threeStudies, thirdStudy.id, withoutTrash)
  await openRemoveByHandAndAwaitRequest()
  const beforeRefusal = await removalControl()
  const refusedFiles = {
    ...withoutTrash,
    studyRemoval: await answering({
      status: 'refused',
      studyId: thirdStudy.id,
      text: refusalSentence,
    }),
  }
  await libraryAnswer(threeStudies, thirdStudy.id, refusedFiles)
  const filesRefused = await removalControl()
  // A later Study message that still carries the refusal asks nothing again.
  await libraryAnswer(threeStudies, thirdStudy.id, {
    ...refusedFiles,
    busy: true,
  })
  const afterRefusalStayed = await removalControl()
  // The learner closes the disclosure and opens it again: that asks the host once more, and this time it lists the files.
  await toggleByKeyboard('study-files')
  await openRemoveByHandAndAwaitRequest()
  const askedAgain = await removalControl()
  await libraryAnswer(threeStudies, thirdStudy.id, {
    ...withoutTrash,
    studyRemoval: await answering({
      status: 'refused',
      studyId: thirdStudy.id,
      text: listedSentence,
      files: [otherStudyFile],
    }),
    studyFiles: { [thirdStudy.id]: [otherStudyFile] },
  })
  const listedAfterAskingAgain = await removalControl()
  // Assert
  cases.push({
    name: 'Remove by hand says when no file of the study is left and shows a refusal of the host as an error, each with Retry storage / refresh only; opening it again asks the host again',
    actual: {
      noFileLeft,
      beforeRefusal,
      filesRefused,
      afterRefusalStayed,
      askedAgain,
      listedAfterAskingAgain,
    },
    passed:
      noFileLeft.removeByHand.note ===
        'No file of this study is left. Press Retry storage / refresh to update the list.' &&
      !noFileLeft.removeByHand.noteIsError &&
      noFileLeft.removeByHand.files.length === 0 &&
      !noFileLeft.removeByHand.copyVisible &&
      noFileLeft.removeByHand.retryVisible &&
      noFileLeft.status === '' &&
      beforeRefusal.removeByHand.note === "Listing this study's files…" &&
      filesRefused.removeByHand.note === refusalSentence &&
      filesRefused.removeByHand.noteIsError &&
      filesRefused.removeByHand.files.length === 0 &&
      !filesRefused.removeByHand.copyVisible &&
      filesRefused.removeByHand.retryVisible &&
      // The refusal stands inside the disclosure only: nothing is written above the summary the learner pressed.
      filesRefused.status === '' &&
      afterRefusalStayed.deletes.length === filesRefused.deletes.length &&
      askedAgain.deletes.length === filesRefused.deletes.length + 1 &&
      askedAgain.deletes.at(-1)[0] === thirdStudy.id &&
      askedAgain.removeByHand.note === "Listing this study's files…" &&
      !askedAgain.removeByHand.noteIsError &&
      !askedAgain.removeByHand.retryVisible &&
      listedAfterAskingAgain.removeByHand.note === listedSentence &&
      JSON.stringify(listedAfterAskingAgain.removeByHand.files) ===
        JSON.stringify([otherStudyFile]) &&
      listedAfterAskingAgain.removeByHand.copyVisible,
  })

  // Arrange: the listed files of the third study, with the keyboard focus on a control inside Remove by hand (PC-3.10 for the disclosure).
  const thirdListed = {
    ...withoutTrash,
    studyFiles: {
      [thirdStudy.id]: [otherStudyFile],
      [shownStudy.id]: studyFiles,
    },
  }
  await library(threeStudies, thirdStudy.id, thirdListed)
  await copyButton.focus()
  // Act: another pane makes the host show another study, so the disclosure closes under the focused button.
  await library(threeStudies, shownStudy.id, thirdListed)
  const focusAfterClosing = await page.evaluate(() => ({
    summaryOf: document.activeElement.parentElement?.id,
    tag: document.activeElement.tagName,
  }))
  // Act: the learner removed the files by hand and presses Retry storage / refresh inside the disclosure; the study leaves the list.
  await toggleByKeyboard('study-files')
  await page.locator('#study-files [data-action="retry"]').focus()
  await page.keyboard.press('Enter')
  const retriesAfterPress = (await removalControl()).retries
  await library([thirdStudy, emptiedStudy], undefined, withoutTrash)
  const afterStudyLeft = await removalControl()
  // Assert
  cases.push({
    name: 'when Remove by hand closes or leaves under the focused control, the keyboard focus stays in Saved studies: on its summary while it is offered, on the list after Retry storage / refresh took the study away',
    actual: { focusAfterClosing, retriesAfterPress, afterStudyLeft },
    passed:
      focusAfterClosing.tag === 'SUMMARY' &&
      focusAfterClosing.summaryOf === 'study-files' &&
      retriesAfterPress === listedAfterAskingAgain.retries + 1 &&
      afterStudyLeft.removeByHand === null &&
      afterStudyLeft.chosen === '' &&
      afterStudyLeft.focus === 'studies',
  })

  // Arrange: three listed files of the third study, Remove by hand open, and the keyboard focus on Retry storage / refresh inside it (row 73).
  const threeListedFiles = [
    '/home/learner/.config/Code/User/globalStorage/laststance.codebook/agent/window/run-third09',
    '/home/learner/.config/Code/User/workspaceStorage/0123/laststance.codebook/studies/window_run-third09.study.meta.v2.json',
    '/home/learner/.config/Code/User/workspaceStorage/0123/laststance.codebook/studies/window_run-third09.study.v2.json',
  ]
  /** Reads which control of Remove by hand holds the keyboard focus: its tag, and the element it stands in. */
  const focusInRemoveByHand = () =>
    page.evaluate(() => ({
      tag: document.activeElement.tagName,
      within: document.activeElement.parentElement?.id,
    }))
  await library(threeStudies, thirdStudy.id, withoutTrash)
  await openRemoveByHandAndAwaitRequest()
  await libraryAnswer(threeStudies, thirdStudy.id, {
    ...withoutTrash,
    studyRemoval: await answering({
      status: 'refused',
      studyId: thirdStudy.id,
      text: listedSentence,
      files: threeListedFiles,
    }),
    studyFiles: { [thirdStudy.id]: threeListedFiles },
  })
  const threeListed = await removalControl()
  await page.locator('#study-files [data-action="retry"]').focus()
  // Act: the learner, who removed two of the files by hand, presses Retry storage / refresh; the host forgets its lists and names no files for the study, and then answers the pane's new request.
  await page.keyboard.press('Enter')
  // The Study workspace is closed (Saved studies stand in the bottom panel), so Retry ends without a render and its message carries the revision before it.
  await libraryAnswer(threeStudies, thirdStudy.id, withoutTrash)
  const askedAfterRetry = await removalControl(),
    focusWhileListing = await focusInRemoveByHand()
  await libraryAnswer(threeStudies, thirdStudy.id, {
    ...withoutTrash,
    studyRemoval: await answering({
      status: 'refused',
      studyId: thirdStudy.id,
      text: listedSentence,
      files: [threeListedFiles[2]],
    }),
    studyFiles: { [thirdStudy.id]: [threeListedFiles[2]] },
  })
  const oneLeft = await removalControl(),
    focusAfterAnswer = await focusInRemoveByHand()
  // Assert
  cases.push({
    name: 'after Retry storage / refresh, for which the host forgets its file lists, an open Remove by hand asks the host again by itself and shows the one file that is left of three, and the keyboard focus that stood on Retry storage / refresh rests on the disclosure’s summary',
    actual: {
      threeListed,
      askedAfterRetry,
      focusWhileListing,
      oneLeft,
      focusAfterAnswer,
    },
    passed:
      // The pane asked for the list under the revision every later message of this case carries.
      threeListed.removeByHand.open &&
      JSON.stringify(threeListed.removeByHand.files) ===
        JSON.stringify(threeListedFiles) &&
      askedAfterRetry.retries === threeListed.retries + 1 &&
      // One new request for the same study, under the Study message that names no files.
      askedAfterRetry.deletes.length === threeListed.deletes.length + 1 &&
      askedAfterRetry.deletes.at(-1)[0] === thirdStudy.id &&
      askedAfterRetry.removeByHand.open &&
      askedAfterRetry.removeByHand.note === "Listing this study's files…" &&
      askedAfterRetry.removeByHand.files.length === 0 &&
      !askedAfterRetry.removeByHand.copyVisible &&
      !askedAfterRetry.removeByHand.retryVisible &&
      // The pressed button is not rendered while the host is asked; the focus stays with the disclosure.
      JSON.stringify(focusWhileListing) ===
        JSON.stringify({ tag: 'SUMMARY', within: 'study-files' }) &&
      oneLeft.removeByHand.note === listedSentence &&
      JSON.stringify(oneLeft.removeByHand.files) ===
        JSON.stringify([threeListedFiles[2]]) &&
      oneLeft.removeByHand.copyVisible &&
      oneLeft.removeByHand.retryVisible &&
      oneLeft.deletes.length === askedAfterRetry.deletes.length &&
      JSON.stringify(focusAfterAnswer) ===
        JSON.stringify({ tag: 'SUMMARY', within: 'study-files' }),
  })

  // Arrange: the parts of Saved studies that name the place of a lost focus themselves, each with the pane out of focus: the learner works in another part of the editor while the host's message arrives (row 172).
  await library(threeStudies, thirdStudy.id, thirdListed)
  await copyButton.focus()
  await leavePane()
  // Act: another pane makes the host show another study, so Remove by hand closes under the focused button; later the learner returns.
  await library(threeStudies, shownStudy.id, thirdListed)
  const disclosureFocusWhileAway = await focusName()
  await returnToPane()
  const disclosureFocusOnReturn = await focusName()
  // The repair button leaves under the focus because the host repaired the entry.
  const libraryToRepair = [shownStudy, repairableStudy, legacyStudy]
  await library(libraryToRepair, shownStudy.id)
  await page.selectOption('#studies', repairableStudy.id)
  await page.locator('#repair-study').focus()
  await leavePane()
  await library(
    [
      shownStudy,
      { ...repairableStudy, metadata: 'validated', reason: undefined },
      legacyStudy,
    ],
    shownStudy.id,
  )
  const repairFocusWhileAway = await focusName()
  await returnToPane()
  const repairFocusOnReturn = await focusName()
  // An observed moment's control is rendered again because another moment was observed.
  const observedMoment = (id) => ({
    id,
    itemId: options.message.model.selection.itemId,
    title: 'Observed stop',
    at: '2026-09-27T00:00:00.000Z',
  })
  await library([shownStudy], shownStudy.id, {
    moments: [observedMoment('observed-1')],
  })
  await page.locator('#moments button').first().focus()
  await leavePane()
  await library([shownStudy], shownStudy.id, {
    moments: [observedMoment('observed-1'), observedMoment('observed-2')],
  })
  const momentFocusWhileAway = await focusName()
  await returnToPane()
  const momentFocusOnReturn = await page.evaluate(
    () => document.activeElement.dataset.observation,
  )
  // Assert
  cases.push({
    name: 'while the pane does not have the focus, a part of it that leaves or is rendered again under the control the learner left takes no focus, and when the learner returns the focus is where that part puts it: on the summary of Remove by hand, on the Saved studies list after a repair, on the same item of the observed moments',
    actual: {
      disclosureFocusWhileAway,
      disclosureFocusOnReturn,
      repairFocusWhileAway,
      repairFocusOnReturn,
      momentFocusWhileAway,
      momentFocusOnReturn,
    },
    passed:
      disclosureFocusWhileAway === 'body' &&
      disclosureFocusOnReturn === 'summary: Remove by hand' &&
      repairFocusWhileAway === 'body' &&
      repairFocusOnReturn === 'studies' &&
      momentFocusWhileAway === 'body' &&
      momentFocusOnReturn === 'observed-1',
  })

  // Arrange: Remove by hand opened for the other study, whose files the host has not listed; every message until the host renders again carries the revision the pane asked under (row 168).
  const othersFiles = { [shownStudy.id]: studyFiles },
    studiesWithOther = [shownStudy, otherStudy, thirdStudy]
  /** The state of the host's removal that answers another pane's request for the shown study's files. */
  const anotherPanesAnswer = (request) => ({
    status: 'refused',
    studyId: shownStudy.id,
    text: listedSentence,
    files: studyFiles,
    request,
  })
  await library(studiesWithOther, otherStudy.id, withoutTrash)
  await openRemoveByHandAndAwaitRequest()
  const askedFirst = await removalControl()
  // Act: a run of this study turns out not to have stopped, so the disclosure leaves beside that reason, and the host's refusal of the request arrives while the disclosure is not offered; then the run has stopped and another pane's answer stands in the message.
  await libraryAnswer(studiesWithOther, otherStudy.id, {
    ...withoutTrash,
    unstoppedStudyId: otherStudy.id,
    studyRemoval: await answering({
      status: 'refused',
      studyId: otherStudy.id,
      text: "Stop the run before removing its study's files by hand.",
    }),
  })
  const besideReason = await removalControl()
  await libraryAnswer(studiesWithOther, otherStudy.id, {
    ...withoutTrash,
    studyRemoval: anotherPanesAnswer(1),
    studyFiles: othersFiles,
  })
  // The learner opens the disclosure that is offered again: the request before is nobody's any more, so the pane asks anew.
  await openRemoveByHandAndAwaitRequest()
  const answerOwed = await removalControl()
  // The host answers another pane's request first.
  await libraryAnswer(studiesWithOther, otherStudy.id, {
    ...withoutTrash,
    studyRemoval: anotherPanesAnswer(1),
    studyFiles: othersFiles,
  })
  const besideForeignAnswer = await removalControl()
  // The host refuses this pane's request.
  await libraryAnswer(studiesWithOther, otherStudy.id, {
    ...withoutTrash,
    studyRemoval: await answering({
      status: 'refused',
      studyId: otherStudy.id,
      text: refusalSentence,
    }),
    studyFiles: othersFiles,
  })
  const ownRefusal = await removalControl()
  // The answer to another pane's next request takes the refusal's place in the host's message.
  await libraryAnswer(studiesWithOther, otherStudy.id, {
    ...withoutTrash,
    studyRemoval: anotherPanesAnswer(2),
    studyFiles: othersFiles,
  })
  const refusalAfterForeignAnswer = await removalControl()
  // The learner presses Retry storage / refresh beside the refusal, and the host reports that it is working.
  await page.locator('#study-files [data-action="retry"]').focus()
  await page.keyboard.press('Enter')
  await libraryAnswer(studiesWithOther, otherStudy.id, {
    ...withoutTrash,
    saving: true,
    studyRemoval: anotherPanesAnswer(2),
    studyFiles: othersFiles,
  })
  const askedAtRetry = await removalControl()
  // The host renders again before the pane has an answer: under the new revision the pane asks again. (The host answers a request the pane sent by itself, like this one, also after it rendered again; a request the learner made on the old view it refuses with a line and never answers. The pane cannot tell the two apart from here and asks again in both.)
  await library(studiesWithOther, otherStudy.id, {
    ...withoutTrash,
    studyRemoval: anotherPanesAnswer(2),
    studyFiles: othersFiles,
  })
  const askedUnderNewRevision = await removalControl()
  // The host lists the study's file for that request.
  await libraryAnswer(studiesWithOther, otherStudy.id, {
    ...withoutTrash,
    studyRemoval: await answering({
      status: 'refused',
      studyId: otherStudy.id,
      text: listedSentence,
      files: [otherStudyFile],
    }),
    studyFiles: { ...othersFiles, [otherStudy.id]: [otherStudyFile] },
  })
  const listedAtLast = await removalControl()
  // Assert
  /** Reads which of the pane's last requests for files were marked as sent by the pane itself, newest last. */
  const lastRequestMarks = (count) =>
    page.evaluate(
      (count) =>
        window.sent
          .filter((message) => message.type === 'delete-study')
          .slice(-count)
          .map((message) => message.unprompted === true),
      count,
    )
  // The four requests of this case, in order: the learner opened the disclosure twice, then the pane asked by itself after Retry storage / refresh and again under the host's new revision.
  const requestMarks = await lastRequestMarks(4)
  cases.push({
    name: 'a request for a study’s files that the learner makes by opening Remove by hand carries no mark, and one the pane sends by itself (after Retry storage / refresh, and again when the host has rendered since) is marked unprompted, so the host answers it without a line when it arrives late',
    actual: requestMarks,
    passed:
      JSON.stringify(requestMarks) ===
      JSON.stringify([false, false, true, true]),
  })
  const requests = (control) => control.deletes.length
  cases.push({
    name: 'Remove by hand knows the host’s answer to its request by the request’s number, under a revision the host does not change: another pane’s answer is not taken for it and nothing is asked twice while it is owed; a refusal stays when another pane’s answer takes its place in the message; Retry storage / refresh beside a refusal asks again; a disclosure that left beside a reason asks anew when it is opened again; and a request the host left behind with a new revision is sent again',
    actual: {
      askedFirst,
      besideReason,
      answerOwed,
      besideForeignAnswer,
      ownRefusal,
      refusalAfterForeignAnswer,
      askedAtRetry,
      askedUnderNewRevision,
      listedAtLast,
    },
    passed:
      // A disclosure that left beside a reason and is offered again asks anew when it is opened, under the same revision.
      besideReason.removeByHand === null &&
      requests(besideReason) === requests(askedFirst) &&
      requests(answerOwed) === requests(askedFirst) + 1 &&
      answerOwed.removeByHand.note === "Listing this study's files…" &&
      // Another pane's answer under the same revision: still listing, nothing asked again.
      besideForeignAnswer.removeByHand.note === "Listing this study's files…" &&
      !besideForeignAnswer.removeByHand.retryVisible &&
      requests(besideForeignAnswer) === requests(answerOwed) &&
      // The answer with this pane's number under the same revision is shown.
      ownRefusal.removeByHand.note === refusalSentence &&
      ownRefusal.removeByHand.noteIsError &&
      ownRefusal.removeByHand.retryVisible &&
      requests(ownRefusal) === requests(answerOwed) &&
      // It stays, and the pane does not ask again, when the host's message no longer carries it.
      refusalAfterForeignAnswer.removeByHand.note === refusalSentence &&
      refusalAfterForeignAnswer.removeByHand.retryVisible &&
      requests(refusalAfterForeignAnswer) === requests(answerOwed) &&
      // Retry storage / refresh beside it: one new request with the next message, and the disclosure lists again.
      requests(askedAtRetry) === requests(answerOwed) + 1 &&
      askedAtRetry.deletes.at(-1)[0] === otherStudy.id &&
      askedAtRetry.removeByHand.note === "Listing this study's files…" &&
      !askedAtRetry.removeByHand.noteIsError &&
      // A new revision without an answer: the request is sent again, once.
      requests(askedUnderNewRevision) === requests(answerOwed) + 2 &&
      askedUnderNewRevision.removeByHand.note ===
        "Listing this study's files…" &&
      listedAtLast.removeByHand.note === listedSentence &&
      JSON.stringify(listedAtLast.removeByHand.files) ===
        JSON.stringify([otherStudyFile]) &&
      requests(listedAtLast) === requests(askedUnderNewRevision),
  })

  // Arrange: Remove by hand opened for a study whose files the host cannot list (row 251).
  const listingFailed =
    "Codebook could not list this study's files. Press Retry storage / refresh to try again. EACCES: permission denied, lstat '/library/recordings.v2'"
  // Another study is shown first, so the disclosure is offered closed for the study the learner then looks at.
  await library(studiesWithOther, shownStudy.id, withoutTrash)
  await library(studiesWithOther, otherStudy.id, withoutTrash)
  await openRemoveByHandAndAwaitRequest()
  // Act: the host answers the request with the listing's failure; the learner presses Retry storage / refresh, and the host lists the file for the request that follows.
  await libraryAnswer(studiesWithOther, otherStudy.id, {
    ...withoutTrash,
    studyRemoval: await answering({
      status: 'refused',
      studyId: otherStudy.id,
      text: listingFailed,
    }),
  })
  const listingFailure = await removalControl()
  await page.locator('#study-files [data-action="retry"]').focus()
  await page.keyboard.press('Enter')
  await libraryAnswer(studiesWithOther, otherStudy.id, {
    ...withoutTrash,
    saving: true,
  })
  const askedAfterFailure = await removalControl()
  await libraryAnswer(studiesWithOther, otherStudy.id, {
    ...withoutTrash,
    studyRemoval: await answering({
      status: 'refused',
      studyId: otherStudy.id,
      text: listedSentence,
      files: [otherStudyFile],
    }),
    studyFiles: { [otherStudy.id]: [otherStudyFile] },
  })
  const listedAfterFailure = await removalControl()
  // Assert
  cases.push({
    name: 'when the host could not list a study’s files, Remove by hand shows the host’s reason as an error with Retry storage / refresh and no Copy paths, and a press on Retry asks again and lists the files',
    actual: { listingFailure, askedAfterFailure, listedAfterFailure },
    passed:
      listingFailure.removeByHand.note === listingFailed &&
      listingFailure.removeByHand.noteIsError &&
      listingFailure.removeByHand.retryVisible &&
      !listingFailure.removeByHand.copyVisible &&
      listingFailure.removeByHand.files.length === 0 &&
      askedAfterFailure.deletes.length === listingFailure.deletes.length + 1 &&
      askedAfterFailure.removeByHand.note === "Listing this study's files…" &&
      listedAfterFailure.removeByHand.note === listedSentence &&
      JSON.stringify(listedAfterFailure.removeByHand.files) ===
        JSON.stringify([otherStudyFile]),
  })

  // Arrange: Remove by hand opened for the third study and closed again before the host has answered (row 252).
  await library(studiesWithOther, thirdStudy.id, withoutTrash)
  await openRemoveByHandAndAwaitRequest()
  const askedThenClosed = await removalControl()
  await toggleByKeyboard('study-files')
  // Act: the host's refusal arrives while the disclosure is closed, and another pane's answer then takes its place in the message; the learner opens the disclosure again, and the host lists the file.
  await libraryAnswer(studiesWithOther, thirdStudy.id, {
    ...withoutTrash,
    studyRemoval: await answering({
      status: 'refused',
      studyId: thirdStudy.id,
      text: listingFailed,
    }),
  })
  await libraryAnswer(studiesWithOther, thirdStudy.id, {
    ...withoutTrash,
    studyRemoval: anotherPanesAnswer(3),
    studyFiles: othersFiles,
  })
  const closedWithAnswer = await removalControl()
  await toggleByKeyboard('study-files')
  await page
    .waitForFunction(
      (requestsBefore) =>
        window.sent.filter((message) => message.type === 'delete-study')
          .length > requestsBefore,
      closedWithAnswer.deletes.length,
      { timeout: 2_000 },
    )
    .catch(() => undefined)
  const reopened = await removalControl()
  await libraryAnswer(studiesWithOther, thirdStudy.id, {
    ...withoutTrash,
    studyRemoval: await answering({
      status: 'refused',
      studyId: thirdStudy.id,
      text: listedSentence,
      files: [otherStudyFile],
    }),
    studyFiles: { ...othersFiles, [thirdStudy.id]: [otherStudyFile] },
  })
  const listedAfterReopening = await removalControl()
  // Assert
  cases.push({
    name: 'a refusal that arrives while Remove by hand is closed does not leave the disclosure waiting: opened again, it asks the host again and shows the files, not Listing this study’s files… with no button',
    actual: {
      askedThenClosed,
      closedWithAnswer,
      reopened,
      listedAfterReopening,
    },
    passed:
      closedWithAnswer.removeByHand.open === false &&
      closedWithAnswer.deletes.length === askedThenClosed.deletes.length &&
      // Opening again sends one new request, marked as the learner's own.
      reopened.deletes.length === askedThenClosed.deletes.length + 1 &&
      reopened.deletes.at(-1)[0] === thirdStudy.id &&
      reopened.removeByHand.note === "Listing this study's files…" &&
      listedAfterReopening.removeByHand.note === listedSentence &&
      JSON.stringify(listedAfterReopening.removeByHand.files) ===
        JSON.stringify([otherStudyFile]) &&
      listedAfterReopening.removeByHand.retryVisible,
  })

  // Arrange: a window without a Trash and the states in which a study cannot be removed (row 59, ND-1).
  const deletesBeforeReasons = (await removalControl()).deletes.length
  /** Reads the reason shown under the list and whether Remove by hand is offered beside it. */
  const reasonWithoutTrash = async () => {
    const shown = await removalControl()
    return {
      reason: shown.reason,
      removeByHandOffered: shown.removeByHand !== null,
      buttonVisible: shown.buttonVisible,
    }
  }
  // Act
  await library([shownStudy, nodeHistory], nodeHistory.id, {
    ...withoutTrash,
    unstoppedStudyId: nodeHistory.id,
    ...replaying,
  })
  const nodeWithoutTrash = await reasonWithoutTrash()
  await library([shownStudy, otherStudy], shownStudy.id, {
    ...withoutTrash,
    unstoppedStudyId: shownStudy.id,
    ...replaying,
  })
  const liveWithoutTrash = await reasonWithoutTrash()
  await library([shownStudy, otherStudy], shownStudy.id, {
    ...withoutTrash,
    ...replaying,
  })
  const recordingWithoutTrash = await reasonWithoutTrash()
  await library([shownStudy, newerStudy], shownStudy.id, withoutTrash)
  await page.selectOption('#studies', newerStudy.id)
  const newerWithoutTrash = await reasonWithoutTrash()
  const newerNoteWithoutTrash = (await removalControl()).newerNote
  const shownReasons = [
    nodeWithoutTrash,
    liveWithoutTrash,
    recordingWithoutTrash,
    newerWithoutTrash,
  ]
  // Assert
  cases.push({
    name: 'in a window without a Trash each reason under Saved studies speaks of removing the study’s files by hand, none of deleting, and Remove by hand is not offered beside a reason',
    actual: {
      nodeWithoutTrash,
      liveWithoutTrash,
      recordingWithoutTrash,
      newerWithoutTrash,
      newerNoteWithoutTrash,
    },
    passed:
      nodeWithoutTrash.reason ===
        'Codebook cannot list the files of a test replay for removal by hand yet.' &&
      liveWithoutTrash.reason ===
        "Stop the run before removing its study's files by hand." &&
      recordingWithoutTrash.reason ===
        "Choose Overview or Live to leave Recording before removing this study's files by hand." &&
      newerWithoutTrash.reason ===
        'This study was saved by a newer Codebook and is kept as it is. Update the extension to list its files for removal by hand.' &&
      newerNoteWithoutTrash === newerSentence &&
      shownReasons.every(
        (shown) =>
          !shown.reason.includes('delet') &&
          !shown.removeByHandOffered &&
          !shown.buttonVisible,
      ) &&
      (await removalControl()).deletes.length === deletesBeforeReasons,
  })

  // Arrange: an entry that cannot be opened and one whose checkpoint can be repaired, in a window with a Trash and in one without (row 27, DR-4 and DR-7).
  /** Reads the shown note, what it describes and how the row under it is filled, for the entry chosen in the list. */
  const noteAndRow = async () => {
    const shown = await removalControl()
    const row = await page.evaluate(() => {
      const background = (id) =>
        getComputedStyle(document.getElementById(id)).backgroundColor
      return {
        repairDescribedBy: document
          .getElementById('repair-study')
          .getAttribute('aria-describedby'),
        repairIsPrimary: document
          .getElementById('repair-study')
          .classList.contains('primary'),
        repairBackground: background('repair-study'),
        playBackground: background('playback-toggle'),
        deleteBackground: background('delete-study'),
      }
    })
    return {
      note: shown.note,
      repairNote: shown.repairNote,
      listDescribedBy: shown.listDescribedBy,
      repairVisible: shown.repairVisible,
      deleteVisible: shown.buttonVisible,
      removeByHandOffered: shown.removeByHand !== null,
      ...row,
    }
  }
  const unopenableAndRepairable = [shownStudy, repairableStudy, legacyStudy]
  // Act
  await library(unopenableAndRepairable, shownStudy.id)
  await page.selectOption('#studies', legacyStudy.id)
  const unopenableWithTrash = await noteAndRow()
  await page.selectOption('#studies', repairableStudy.id)
  const repairableWithTrash = await noteAndRow()
  await library(unopenableAndRepairable, shownStudy.id, withoutTrash)
  await page.selectOption('#studies', legacyStudy.id)
  const unopenableWithoutTrash = await noteAndRow()
  await page.selectOption('#studies', repairableStudy.id)
  const repairableWithoutTrash = await noteAndRow()
  await page
    .locator('#saved-studies')
    .screenshot({ path: `${options.output}/saved-studies-repair-no-trash.png` })
  // Assert
  cases.push({
    name: 'the note of a saved study that cannot be opened or can be repaired names what a window with a Trash and one without can still do, and describes the list and Repair saved study, which is the filled button',
    actual: {
      unopenableWithTrash,
      repairableWithTrash,
      unopenableWithoutTrash,
      repairableWithoutTrash,
    },
    passed:
      unopenableWithTrash.note ===
        'This saved study cannot be opened. It can still be deleted.' &&
      unopenableWithTrash.listDescribedBy === 'study-unopenable' &&
      repairableWithTrash.repairNote ===
        "This saved study's catalog checkpoint is missing or out of date. Repair it, or delete the study." &&
      repairableWithTrash.listDescribedBy === 'study-repairable' &&
      repairableWithTrash.repairDescribedBy === 'study-repairable' &&
      repairableWithTrash.repairVisible &&
      repairableWithTrash.deleteVisible &&
      unopenableWithoutTrash.note ===
        'This saved study cannot be opened. This window has no Trash, so it can only be removed by hand.' &&
      unopenableWithoutTrash.listDescribedBy === 'study-unopenable' &&
      unopenableWithoutTrash.removeByHandOffered &&
      !unopenableWithoutTrash.deleteVisible &&
      repairableWithoutTrash.repairNote ===
        "This saved study's catalog checkpoint is missing or out of date. Repair it, or remove its files by hand." &&
      repairableWithoutTrash.listDescribedBy === 'study-repairable' &&
      repairableWithoutTrash.repairDescribedBy === 'study-repairable' &&
      // Without a Trash the row holds Repair alone, and the manual removal stays offered under it.
      repairableWithoutTrash.repairVisible &&
      !repairableWithoutTrash.deleteVisible &&
      repairableWithoutTrash.removeByHandOffered &&
      // Repair is the filled button like Play; Delete saved study… stays the standard one.
      [repairableWithTrash, repairableWithoutTrash].every(
        (shown) =>
          shown.repairIsPrimary &&
          shown.repairBackground === shown.playBackground &&
          shown.repairBackground !== shown.deleteBackground,
      ),
  })

  // Arrange: what is left of a study without its archive, as the library lists it since it lists such rests: an entry that cannot be opened and has no reason, because nothing Retry storage does brings the archive back (row 181).
  const restOfStudy = savedStudy('window_run-rest0011', {
    profile: undefined,
    format: 'archive-missing',
    outcome: 'Archive missing; remaining files kept',
    metadata: 'unavailable',
  })
  await library([shownStudy, restOfStudy], shownStudy.id)
  const opensBeforeRest = (await removalControl()).histories
  // Act: the learner chooses the rest in a window with a Trash and presses the delete button by keyboard; then the same entry in a window without a Trash, where the learner opens Remove by hand.
  await page.selectOption('#studies', restOfStudy.id)
  const restWithTrash = await removalControl()
  await deleteButton.focus()
  await page.keyboard.press('Enter')
  const askedToDeleteRest = await removalControl()
  await library([shownStudy, restOfStudy], shownStudy.id, withoutTrash)
  const restWithoutTrash = await removalControl()
  await openRemoveByHandAndAwaitRequest()
  const askedForRestFiles = await removalControl()
  // Assert
  cases.push({
    name: 'what is left of a saved study without its archive is listed as an entry that cannot be opened: it is chosen without asking the host to open it, its note says that it can still be deleted where the window has a Trash and that it can only be removed by hand where it has none, no repair is offered, and the delete button or Remove by hand asks the host for that entry',
    actual: {
      restWithTrash,
      askedToDeleteRest,
      restWithoutTrash,
      askedForRestFiles,
    },
    passed:
      restWithTrash.chosen === restOfStudy.id &&
      restWithTrash.shownText.includes(
        ' · Archive missing; remaining files kept · rest0011',
      ) &&
      restWithTrash.histories === opensBeforeRest &&
      restWithTrash.note ===
        'This saved study cannot be opened. It can still be deleted.' &&
      restWithTrash.repairNote === null &&
      !restWithTrash.repairVisible &&
      restWithTrash.buttonVisible &&
      restWithTrash.ariaDisabled === null &&
      restWithTrash.reason === null &&
      askedToDeleteRest.deletes.length === restWithTrash.deletes.length + 1 &&
      askedToDeleteRest.deletes.at(-1)[0] === restOfStudy.id &&
      // Without a Trash the same entry stays chosen and offers the removal by hand in place of the delete button.
      restWithoutTrash.chosen === restOfStudy.id &&
      restWithoutTrash.note ===
        'This saved study cannot be opened. This window has no Trash, so it can only be removed by hand.' &&
      !restWithoutTrash.repairVisible &&
      !restWithoutTrash.buttonVisible &&
      restWithoutTrash.reason === null &&
      restWithoutTrash.removeByHand.open === false &&
      restWithoutTrash.removeByHand.summary === 'Remove by hand' &&
      askedForRestFiles.deletes.length ===
        askedToDeleteRest.deletes.length + 1 &&
      askedForRestFiles.deletes.at(-1)[0] === restOfStudy.id &&
      askedForRestFiles.removeByHand.note === "Listing this study's files…" &&
      askedForRestFiles.histories === opensBeforeRest,
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
      '<strong>Update failed</strong> at 11:05 AM: An earlier chat or another editor window appears to be updating this Wiki (candidate wiki.stage-c34c9bc0-55bd-4a45-9bc0-eecfaa647e2b, written 11:04 AM GMT+9). Codebook waits for it until 11:19 AM GMT+9. If that chat was stopped, choose Update anyway in the editor’s notification. Nothing had been replaced by then.'
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
 * @param shell - The text of `skills/codebook/reader-shell.html`, with LF line endings as the publisher reads it.
 * @returns The page: every field of the shell replaced, with an outline entry that cannot break and the open control as the publisher prints it: the link with its label alone and, beside it, the file and line it opens, shown and, as written, as the link's description.
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
      '<p class="open-in-editor"><a href="#source" aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" aria-hidden="true">src/<wbr>utils/<wbr>a.ts<wbr>:12</span><span class="sr-only" id="codebook-open-target">src/utils/a.ts:12</span></p>',
    SETTINGS: '#settings',
    // The policy in the page's head names the shell's one script by its hash, as the publisher fills it.
    SHELL_SCRIPT_HASH: `'sha256-${createHash('sha256')
      .update(/<script>([\s\S]*?)<\/script>/.exec(shell)?.[1] ?? '')
      .digest('base64')}'`,
  }
  return shell.replace(/\{\{([A-Z_]+)\}\}/g, (field, name) => {
    assert.ok(Object.hasOwn(fields, name), `no text for the field ${field}`)
    return fields[name]
  })
}

// The job scheduler's test replay in the Application pane (Design 8): its first output, forty lines so the region scrolls, then its result, with a test name long enough to wrap; worded as projectNodeTestApplication words them.
const replayTestName =
  'src/jobs.test.ts › job scheduler › runs a delayed job after its timer even when the clock jumps forward by more than one interval'
const replayFirstLines = [
  { channel: 'stdout', text: 'RUN src/jobs.test.ts', number: 0 },
  ...Array.from({ length: 39 }, (_, index) => ({
    channel: 'stdout',
    text: `job ${index + 1} scheduled`,
    number: index + 1,
  })),
]
const testReplayViews = {
  first: {
    generation: 1,
    time: 'Recorded test output · 0.10 s',
    test: replayTestName,
    name: `Recorded test output · ${replayTestName} · 0.10 s`,
    region: 'Recorded test output up to 0.10 s',
    lines: replayFirstLines,
  },
  result: {
    generation: 2,
    time: 'Recorded test output · 0.90 s',
    test: replayTestName,
    name: `Recorded test output · ${replayTestName} · 0.90 s`,
    region: 'Recorded test output up to 0.90 s',
    lines: [
      ...replayFirstLines,
      { channel: 'stderr', text: 'slow timer', number: 40 },
    ],
    end: 'Test passed · exit code 0',
  },
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
// The check and its fixtures reach `run-code` as one function in a file it loads itself (`--filename`): together they exceed the size a single command argument may have on Linux (E2BIG), and this script turns no text into code on its own. `run-code` calls that function outside Node's module system, so the check cannot import and takes everything it uses from `options`. {@link readerDomFlowText} writes the file's text, in which the check runs inside {@link runFlowKeepingCases}: a step that throws then ends as one failed case after the cases that passed, instead of a call without a result.
const flowPath = `${output}/flow.js`
let recording = false
try {
  await writeFile(
    flowPath,
    readerDomFlowText(check, {
      html: {
        context: studyHtml('context'),
        moments: studyHtml('moments'),
        application: capturedAppHtml({
          ...message,
          nodeHistoryApplication: testReplayViews.first,
        }),
        applicationAtResult: capturedAppHtml({
          ...message,
          nodeHistoryApplication: testReplayViews.result,
        }),
      },
      testReplayViews,
      // With LF line endings, as the publisher writes a page and a browser hashes its script, also from a checkout that holds the shell with CRLF.
      wikiShell: wikiShellPage(
        (
          await readFile(
            new URL('../skills/codebook/reader-shell.html', import.meta.url),
            'utf8',
          )
        ).replace(/\r\n?/g, '\n'),
      ),
      // The browser sequence's markup before the shared renderer (Design 5): a text fixture, which the formatter leaves as it is.
      goldenLearningSequence: (
        await readFile(
          new URL('./fixtures/learning-sequence-golden.txt', import.meta.url),
          'utf8',
        )
      ).trimEnd(),
      // The browser transport's slider markup before the shared drawing (PR-B2, AC14): a text fixture.
      goldenHistoryTransport: (
        await readFile(
          new URL('./fixtures/history-transport-golden.txt', import.meta.url),
          'utf8',
        )
      ).trimEnd(),
      message,
      output,
      url: `http://127.0.0.1:${server.address().port}/`,
    }),
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
