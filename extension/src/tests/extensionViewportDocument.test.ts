import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import {
  viewportHtml,
  type ExtensionPaneState,
} from '../runtimeSupport/utils/viewportHtml'

const PANE: ExtensionPaneState = {
  surface: 'popup',
  title: 'codebook · Bookmark Notes · Extension popup',
  phase: 'Running the click',
  provenance:
    'Operated by chat · Test profile · seeded data · Live only · replay unavailable',
  message: '',
  imageAlt: 'Extension popup of Bookmark Notes, captured from the test browser',
  detail: 'Declared clicks: Add note.',
  dimmed: false,
}

/** A fake element that keeps what the document's script writes. */
function element() {
  return {
    textContent: '',
    hidden: false,
    alt: '',
    src: '',
    style: {} as Record<string, string>,
  }
}

/** Runs the real serialized document script of {@link viewportHtml} against a fake DOM and returns what it wrote. */
function runDocument(
  html: string,
  naturalSize: { width: number; height: number } = { width: 0, height: 0 },
  devicePixelRatio = 1,
) {
  const script = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)?.[1]
  assert.ok(script)
  const elements: Record<string, ReturnType<typeof element>> = {
    page: element(),
    phase: element(),
    title: element(),
    provenance: element(),
    message: element(),
    detail: element(),
  }
  const toggled: [string, boolean][] = []
  const handlers: ((event: { data: unknown }) => unknown)[] = []
  const posted: Record<string, unknown>[] = []
  class FakeImage {
    src = ''
    naturalWidth = naturalSize.width
    naturalHeight = naturalSize.height
    decode(): Promise<void> {
      return Promise.resolve()
    }
  }
  runInNewContext(script, {
    crypto: { randomUUID: () => '11111111-1111-1111-1111-111111111111' },
    Image: FakeImage,
    setTimeout,
    requestAnimationFrame: (callback: () => void) => callback(),
    acquireVsCodeApi: () => ({
      postMessage: (message: Record<string, unknown>) => posted.push(message),
    }),
    window: {
      devicePixelRatio,
      addEventListener: (
        name: string,
        handler: (event: { data: unknown }) => unknown,
      ) => {
        if (name === 'message') handlers.push(handler)
      },
    },
    document: {
      visibilityState: 'visible',
      hasFocus: () => true,
      body: {
        clientWidth: 300,
        clientHeight: 300,
        classList: {
          toggle: (name: string, on: boolean) => toggled.push([name, on]),
        },
      },
      getElementById: (id: string) => elements[id],
      addEventListener: () => undefined,
    },
  })
  const epoch = '11111111-1111-1111-1111-111111111111'
  return {
    elements,
    toggled,
    posted,
    async send(message: Record<string, unknown>): Promise<void> {
      for (const handler of handlers)
        await handler({ data: { epoch, ...message } })
    },
  }
}

// protects=DR13: every profile's document takes the editor's font family and size and never the system font; fails_when=system-ui returns or the variables are dropped; no_claim=how the editor resolves the variables
test('the image document uses the editor font variables and no system font for every profile', () => {
  // Arrange
  const documents = [
    viewportHtml('live'),
    viewportHtml('recording'),
    viewportHtml('live', 'popup'),
    viewportHtml('live', 'page'),
  ]
  // Act
  const results = documents.map((html) => [
    html.includes('system-ui'),
    html.includes('var(--vscode-font-family'),
    html.includes('var(--vscode-font-size'),
  ])
  // Assert
  assert.deepEqual(results, [
    [false, true, true],
    [false, true, true],
    [false, true, true],
    [false, true, true],
  ])
})

// protects=DR1: the repository browser's header stays as it was: no extension title, provenance or status role; fails_when=extension markup leaks into another profile; no_claim=the repository header's own wording beyond what is asserted
test('the repository document keeps its single-line header without the extension elements', () => {
  // Arrange
  const html = viewportHtml('live')
  // Act
  const header = html.match(/<header>[\s\S]*?<\/header>/)?.[0]
  // Assert
  assert.equal(
    header,
    '<header>codebook · actual page stream <span id="phase">Connecting…</span></header>',
  )
  assert.equal(html.includes('role="status"'), false)
  assert.equal(html.includes('id="provenance"'), false)
})

// protects=DR1 and DR8: an extension document has the title, then the polite status element, then the provenance line, and a hidden detail after the image; fails_when=the order changes or the status loses its role; no_claim=the rendered layout
test('the extension document orders title, polite status and provenance and ends with hidden text', () => {
  // Arrange
  const html = viewportHtml('live', 'popup')
  // Act
  const header = html.match(/<header>[\s\S]*?<\/header>/)?.[0]
  // Assert
  assert.equal(
    header,
    '<header><span id="title"></span><span id="phase" role="status" aria-live="polite">Connecting…</span><div id="provenance"></div></header>',
  )
  assert.match(
    html,
    /<img id="page" hidden alt="[^"]*"><\/div><div id="detail" class="visually-hidden"><\/div>/,
  )
})

// protects=DR7 and DR8: a popup's scroll container is keyboard focusable with the focus border ring, a page's is not; fails_when=the popup cannot be reached by keyboard or the ring is missing; no_claim=real focus handling in the editor
test('the popup scroll container takes the keyboard and shows the focus border while a page container does not', () => {
  // Arrange
  const popup = viewportHtml('live', 'popup')
  const page = viewportHtml('live', 'page')
  // Act
  const popupContainer = popup.match(/<div id="scroller"[^>]*>/)?.[0]
  const pageContainer = page.match(/<div id="scroller"[^>]*>/)?.[0]
  // Assert
  assert.equal(
    popupContainer,
    '<div id="scroller" tabindex="0" role="region" aria-label="Extension popup view">',
  )
  assert.equal(pageContainer, '<div id="scroller">')
  assert.match(
    popup,
    /#scroller:focus-visible\{outline:1px solid var\(--vscode-focusBorder\)/,
  )
  assert.match(popup, /#scroller\{[^}]*overflow:auto/)
  assert.match(popup, /outline:1px solid var\(--vscode-panel-border\)/)
})

// protects=DR7: a 400 x 300 popup frame in a 300 px pane keeps its 400 x 300 CSS size (so the pane scrolls) and a 2x frame shows at half its pixel size; fails_when=the popup frame is scaled to the pane or its device pixel ratio is ignored; no_claim=real scrolling
test('a popup frame shows at its CSS size whatever the pane size', async () => {
  // Arrange
  const unscaled = runDocument(viewportHtml('live', 'popup'), {
    width: 400,
    height: 300,
  })
  const retina = runDocument(
    viewportHtml('live', 'popup'),
    { width: 800, height: 600 },
    2,
  )
  // Act
  await unscaled.send({ type: 'frame', data: 'cGl4ZWxz', phase: 'live' })
  await retina.send({ type: 'frame', data: 'cGl4ZWxz', phase: 'live' })
  // Assert
  assert.deepEqual(
    [unscaled.elements.page!.style.width, unscaled.elements.page!.style.height],
    ['400px', '300px'],
  )
  assert.deepEqual(
    [retina.elements.page!.style.width, retina.elements.page!.style.height],
    ['400px', '300px'],
  )
})

// protects=DR7: an extension page's frame keeps the fit and gets no fixed size; fails_when=a page surface sizes the image in pixels; no_claim=the 720 x 640 metrics (viewport test)
test('an extension page frame keeps its fitting layout', async () => {
  // Arrange
  const rendered = runDocument(viewportHtml('live', 'page'), {
    width: 720,
    height: 640,
  })
  // Act
  await rendered.send({ type: 'frame', data: 'cGl4ZWxz', phase: 'live' })
  // Assert
  assert.deepEqual(rendered.elements.page!.style, {})
})

// protects=DR1, DR3, DR8: the pane message writes title, status, provenance, message, alt and hidden text as text, and a frame never overwrites the status; fails_when=a frame's phase replaces the pane's status or fields are written as markup; no_claim=announcement by a screen reader
test('an extension pane message fills the header and a later frame leaves the status alone', async () => {
  // Arrange
  const rendered = runDocument(viewportHtml('live', 'popup'), {
    width: 400,
    height: 300,
  })
  // Act
  await rendered.send({
    type: 'extension',
    pane: {
      ...PANE,
      message: 'Preparing the extension · step 1 of 5: Reading the manifest',
    },
  })
  await rendered.send({ type: 'frame', data: 'cGl4ZWxz', phase: 'live' })
  // Assert
  assert.equal(rendered.elements.title!.textContent, PANE.title)
  assert.equal(rendered.elements.phase!.textContent, 'Running the click')
  assert.equal(rendered.elements.provenance!.textContent, PANE.provenance)
  assert.equal(
    rendered.elements.message!.textContent,
    'Preparing the extension · step 1 of 5: Reading the manifest',
  )
  assert.equal(rendered.elements.message!.hidden, false)
  assert.equal(rendered.elements.page!.alt, PANE.imageAlt)
  assert.equal(
    rendered.elements.detail!.textContent,
    'Declared clicks: Add note.',
  )
})

// protects=DR4: a lost surface dims the frame and an empty message hides the message line; fails_when=the dimmed class is not toggled or an empty message stays visible; no_claim=the opacity
test('a dimmed pane toggles the dimmed class and an empty message is hidden', async () => {
  // Arrange
  const rendered = runDocument(viewportHtml('live', 'popup'))
  // Act
  await rendered.send({ type: 'extension', pane: { ...PANE, dimmed: true } })
  // Assert
  assert.deepEqual(rendered.toggled, [['dimmed', true]])
  assert.equal(rendered.elements.message!.hidden, true)
})
