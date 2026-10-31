import assert from 'node:assert/strict'
import { test } from 'node:test'

import type {
  ExtensionViewportIdentity,
  FlatCdpConnection,
} from '../chromeExtensionContracts'
import {
  ChromeExtensionViewportView,
  type ExtensionPaneViewport,
} from '../chromeExtensionViewport'
import type { ScreencastCdp } from '../runtimeSupport/browserViewport'
import { readScreencastFrame } from '../runtimeSupport/utils/readScreencastFrame'
import type { ExtensionPaneState } from '../runtimeSupport/utils/viewportHtml'

const POPUP: ExtensionViewportIdentity = {
  manifestName: 'Bookmark Notes',
  surface: { kind: 'popup', path: 'popup.html' },
  clickTitles: ['Add note', 'Clear notes'],
  stopFiles: [],
}
const PAGE: ExtensionViewportIdentity = {
  manifestName: 'Bookmark Notes',
  surface: { kind: 'page', path: 'options.html' },
  clickTitles: [],
  stopFiles: [],
}
const PROVENANCE =
  'Operated by chat · Test profile · seeded data · Recording for replay'

/** What the view asked of the pane viewport, plus the scripted frame time. */
function paneViewport(lastFrameAt?: number) {
  const panes: ExtensionPaneState[] = []
  const attached: { cdp: ScreencastCdp; surface: unknown }[] = []
  const presented: { data: string; phase: string }[] = []
  const calls: string[] = []
  const viewport: ExtensionPaneViewport = {
    setExtensionPane: (pane) => panes.push(pane),
    lastFrameAt: () => lastFrameAt,
    attach: async (cdp, _signal, surface) => {
      attached.push({ cdp, surface })
    },
    present: async (data, phase) => {
      presented.push({ data, phase })
      return { epoch: 'e', id: 1, hash: 'h' }
    },
    resume: () => calls.push('resume'),
    close: () => calls.push('close'),
  }
  return { viewport, panes, attached, presented, calls }
}

/** A browser-level connection that keeps its listeners and requests, so a test can deliver events of any session. */
function flatConnection() {
  const listeners = new Map<
    string,
    Set<(params: Record<string, unknown>, sessionId?: string) => void>
  >()
  const requests: {
    method: string
    params: Record<string, unknown>
    sessionId?: string
  }[] = []
  const connection: FlatCdpConnection = {
    request: async (method, params, sessionId) => {
      requests.push({ method, params, sessionId })
      return {}
    },
    on: (method, listener) => {
      const set = listeners.get(method) ?? new Set()
      set.add(listener)
      listeners.set(method, set)
      return () => set.delete(listener)
    },
    onClose: () => () => undefined,
    close: () => undefined,
  }
  return {
    connection,
    requests,
    listenerCount: () =>
      [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    emit(
      method: string,
      params: Record<string, unknown>,
      sessionId?: string,
    ): void {
      for (const listener of listeners.get(method) ?? [])
        listener(params, sessionId)
    },
  }
}

// protects=DR1, C1, C2: the popup view's header names the manifest and the surface, then the provenance line, in every phase; fails_when=the title, its order or the provenance wording changes, or the line vanishes after the run; no_claim=the rendered pixels
test('a popup view writes its header with the manifest name and the provenance line in every phase', () => {
  // Arrange
  const { viewport, panes } = paneViewport(
    new Date(2026, 9, 29, 14, 3, 9).getTime(),
  )
  const view = new ChromeExtensionViewportView(viewport)
  // Act
  view.setRecording({ kind: 'recording' })
  view.setIdentity(POPUP)
  view.setPhase('Running the click')
  view.end('Clicked Add note.')
  // Assert
  assert.equal(panes[1]!.title, 'codebook · Bookmark Notes · Extension popup')
  assert.deepEqual(
    panes.map((pane) => pane.provenance),
    [PROVENANCE, PROVENANCE, PROVENANCE, PROVENANCE],
  )
})

// protects=D16: the header's second line names the recording state in the run's words while it records, once a part is missing and when no history started; fails_when=the old "Live only · replay unavailable" words come back, a partial recording hides its code or a full-library sentence is shown whole; no_claim=how the pane paints the line
test('the header names whether the run is recorded, partially recorded or not recorded', () => {
  // Arrange
  const { viewport, panes } = paneViewport()
  const view = new ChromeExtensionViewportView(viewport)
  // Act
  view.setRecording({ kind: 'recording' })
  view.setRecording({
    kind: 'partial',
    code: 'EXTENSION_HISTORY_SURFACE_ENDED',
  })
  view.setRecording({
    kind: 'not-recorded',
    reason:
      'Study library is full. Increase Codebook: Saved Study Limit in Settings. Existing learning was kept.',
  })
  // Assert
  assert.deepEqual(
    panes.map((pane) => pane.provenance),
    [
      'Operated by chat · Test profile · seeded data · Recording for replay',
      'Operated by chat · Test profile · seeded data · Recording partial · EXTENSION_HISTORY_SURFACE_ENDED',
      'Operated by chat · Test profile · seeded data · Not recorded · Study library is full',
    ],
  )
})

// protects=DR1: an extension page names its path in line 1; fails_when=the page view says popup or omits the path; no_claim=none
test('an extension page view names its path in the header', () => {
  // Arrange
  const { viewport, panes } = paneViewport()
  const view = new ChromeExtensionViewportView(viewport)
  // Act
  view.setIdentity(PAGE)
  // Assert
  assert.equal(
    panes[0]!.title,
    'codebook · Bookmark Notes · Extension page options.html',
  )
})

// protects=DR4: the preparing body counts its steps and names the phase sentence; fails_when=the sentence format changes; no_claim=the phase sentences themselves (the run's)
test('preparing shows the step count and its phase sentence', () => {
  // Arrange
  const { viewport, panes } = paneViewport()
  const view = new ChromeExtensionViewportView(viewport)
  view.setIdentity(POPUP)
  // Act
  view.showPreparing(2, 5, 'Starting the test browser')
  // Assert
  assert.equal(
    panes.at(-1)!.message,
    'Preparing the extension · step 2 of 5: Starting the test browser',
  )
})

// protects=DR4 and DR10: a failure before the surface shows its refusal sentence and the next-step line, and the pane is kept for the learner; fails_when=either line is dropped or the pane is not marked final; no_claim=the refusal sentences themselves
test('a failure before the surface shows the refusal and the next step and marks the view final', () => {
  // Arrange
  const { viewport, panes } = paneViewport()
  let finals = 0
  const view = new ChromeExtensionViewportView(viewport, {
    onFinal: () => finals++,
  })
  view.setIdentity(POPUP)
  // Act
  view.showFailure(
    'The extension could not be loaded.',
    'Fix manifest.json and start again.',
  )
  // Assert
  assert.equal(
    panes.at(-1)!.message,
    'The extension could not be loaded.\nFix manifest.json and start again.',
  )
  assert.equal(finals, 1)
})

// protects=DR3: a pause pins its frame with the phase text the run passed; fails_when=the frame is not presented as a paused one or the phase text is not shown; no_claim=pixel painting
test('a pause pins its frame under the paused phase text', async () => {
  // Arrange
  const { viewport, panes, presented, calls } = paneViewport()
  const view = new ChromeExtensionViewportView(viewport)
  view.setIdentity(POPUP)
  // Act
  await view.pinPause('cGl4ZWxz', 'Paused at stop 1 of 2 · page')
  view.resumeLive()
  // Assert
  assert.equal(panes.at(-1)!.phase, 'Paused at stop 1 of 2 · page')
  assert.deepEqual(presented, [{ data: 'cGl4ZWxz', phase: 'paused-extension' }])
  assert.deepEqual(calls, ['resume'])
})

// protects=DR4: a lost popup keeps its last frame dimmed with Popup closed, a lost page says Page closed; fails_when=the frame is not dimmed or the wording differs; no_claim=the opacity value
test('a lost surface dims the last frame and says which surface closed', () => {
  // Arrange
  const popup = paneViewport()
  const popupView = new ChromeExtensionViewportView(popup.viewport)
  popupView.setIdentity(POPUP)
  const page = paneViewport()
  const pageView = new ChromeExtensionViewportView(page.viewport)
  pageView.setIdentity(PAGE)
  // Act
  popupView.surfaceLost()
  pageView.surfaceLost()
  // Assert
  assert.deepEqual(
    [popup.panes.at(-1)!.phase, popup.panes.at(-1)!.dimmed],
    ['Popup closed', true],
  )
  assert.deepEqual(
    [page.panes.at(-1)!.phase, page.panes.at(-1)!.dimmed],
    ['Page closed', true],
  )
})

// protects=ER22 for a lost surface: the dimmed "Popup closed" frame is the run's final view, so the pane is kept after the run as an ended run's is (Codex review, Cycle 0061 pt2 /ship pass 1); fails_when=surfaceLost does not report the final view and the cleanup closes the Application tab with the last frame; no_claim=the workspace's lease rules
test('a lost surface reports its dimmed frame as the final view so the pane is kept', () => {
  // Arrange
  const { viewport } = paneViewport()
  let finals = 0
  const view = new ChromeExtensionViewportView(viewport, {
    onFinal: () => finals++,
  })
  view.setIdentity(POPUP)
  // Act
  view.surfaceLost()
  // Assert
  assert.equal(finals, 1)
})

// protects=ER22 and DR4: the ended view says when the last frame was captured and shows the result line; fails_when=the time format or the result line is lost; no_claim=the clock of a real run
test('an ended view names the last captured time and keeps the result line', () => {
  // Arrange
  const { viewport, panes } = paneViewport(
    new Date(2026, 9, 29, 14, 3, 9).getTime(),
  )
  let finals = 0
  const view = new ChromeExtensionViewportView(viewport, {
    onFinal: () => finals++,
  })
  view.setIdentity(POPUP)
  // Act
  view.end('Clicked Add note; the saved title read "Bookmark Notes".')
  // Assert
  assert.equal(panes.at(-1)!.phase, 'Run ended · last captured view 14:03:09')
  assert.equal(
    panes.at(-1)!.message,
    'Clicked Add note; the saved title read "Bookmark Notes".',
  )
  assert.equal(finals, 1)
})

// protects=DR8: the image description names the surface, manifest and origin, and the hidden text lists the click titles then the observation; fails_when=the alt wording or the hidden text changes; no_claim=a screen reader's output
test('the image description and hidden text describe the popup for a screen reader', () => {
  // Arrange
  const { viewport, panes } = paneViewport()
  const view = new ChromeExtensionViewportView(viewport)
  view.setIdentity(POPUP)
  // Act
  view.setAccessibleDetail('Context: popup. Observed before: 0 notes.')
  // Assert
  assert.equal(
    panes.at(-1)!.imageAlt,
    'Extension popup of Bookmark Notes, captured from the test browser',
  )
  assert.equal(
    panes.at(-1)!.detail,
    'Declared clicks: Add note; Clear notes. Context: popup. Observed before: 0 notes.',
  )
})

// protects=DR8: an extension page's description names its path; fails_when=the page alt omits the path; no_claim=none
test('the image description of an extension page names its path', () => {
  // Arrange
  const { viewport, panes } = paneViewport()
  const view = new ChromeExtensionViewportView(viewport)
  // Act
  view.setIdentity(PAGE)
  // Assert
  assert.equal(
    panes.at(-1)!.imageAlt,
    'Extension page options.html of Bookmark Notes, captured from the test browser',
  )
})

// protects=SR6: the screencast of a popup starts as a popup and of a page as a page, on the surface's flat session; fails_when=the surface kind is lost or commands carry another session; no_claim=the browser's answers
test('the screencast starts as the surface kind and sends its commands on the surface session', async () => {
  // Arrange
  const { viewport, attached } = paneViewport()
  const flat = flatConnection()
  const view = new ChromeExtensionViewportView(viewport)
  view.setIdentity(POPUP)
  // Act
  await view.attachSurface(flat.connection, 'SURFACE-SESSION')
  await attached[0]!.cdp.request('Page.enable', undefined)
  // Assert
  assert.equal(attached[0]!.surface, 'popup')
  assert.deepEqual(flat.requests, [
    { method: 'Page.enable', params: {}, sessionId: 'SURFACE-SESSION' },
  ])
})

// protects=SR6: only events of the surface's session reach the viewport and the frame's own sessionId stays the acknowledgement number; fails_when=a frame of the blank tab or another target is shown or the number is taken for the session; no_claim=real frames
test('frames of another session are ignored and the frame number stays the acknowledgement number', async () => {
  // Arrange
  const { viewport, attached } = paneViewport()
  const flat = flatConnection()
  const view = new ChromeExtensionViewportView(viewport)
  view.setIdentity(POPUP)
  await view.attachSurface(flat.connection, 'SURFACE-SESSION')
  const frames: { data: string; sessionId: number }[] = []
  attached[0]!.cdp.on('Page.screencastFrame', (frame) =>
    frames.push({ data: frame.data, sessionId: frame.sessionId }),
  )
  // Act
  flat.emit(
    'Page.screencastFrame',
    { data: 'YmxhbmstdGFi', sessionId: 1, metadata: {} },
    'BLANK-TAB-SESSION',
  )
  flat.emit(
    'Page.screencastFrame',
    { data: 'cG9wdXA=', sessionId: 7, metadata: {} },
    'SURFACE-SESSION',
  )
  // Assert
  assert.deepEqual(frames, [{ data: 'cG9wdXA=', sessionId: 7 }])
})

// protects=SR6: every listener the view added to the shared browser connection is removed at close, and the screencast is stopped on the surface session; fails_when=a listener outlives the view or Page.stopScreencast is not sent; no_claim=the browser's stop answer
test('closing removes every listener from the shared connection and stops the screencast', async () => {
  // Arrange
  const { viewport, attached, calls } = paneViewport()
  const flat = flatConnection()
  const view = new ChromeExtensionViewportView(viewport)
  view.setIdentity(POPUP)
  await view.attachSurface(flat.connection, 'SURFACE-SESSION')
  attached[0]!.cdp.on('Page.screencastFrame', () => undefined)
  assert.equal(flat.listenerCount(), 1)
  // Act
  view.close()
  view.close()
  // Assert
  assert.equal(flat.listenerCount(), 0)
  assert.deepEqual(flat.requests, [
    {
      method: 'Page.stopScreencast',
      params: {},
      sessionId: 'SURFACE-SESSION',
    },
  ])
  assert.deepEqual(calls, ['close'])
})

// protects=C2: the screencast metadata's CSS size (deviceWidth, deviceHeight) is read and a frame without it keeps only what it has; fails_when=the CSS size is dropped or a missing size becomes zero; no_claim=what the browser reports for real
test('a screencast frame keeps the CSS size of its metadata and tolerates metadata without it', () => {
  // Arrange
  const withSize = {
    data: 'cGl4ZWxz',
    sessionId: 3,
    metadata: { timestamp: 1, deviceWidth: 400, deviceHeight: 300 },
  }
  const withoutSize = {
    data: 'cGl4ZWxz',
    sessionId: 3,
    metadata: { timestamp: 1 },
  }
  // Act
  const sized = readScreencastFrame(withSize)
  const unsized = readScreencastFrame(withoutSize)
  // Assert
  assert.deepEqual(sized, withSize)
  assert.deepEqual(unsized, withoutSize)
})
