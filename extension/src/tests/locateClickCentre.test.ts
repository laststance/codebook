import assert from 'node:assert/strict'
import { test } from 'node:test'

import { locateClickCentre } from '../utils/locateClickCentre'

type FakeRect = { x: number; y: number; width: number; height: number }

type FakeElement = {
  isConnected: boolean
  scrollArguments: unknown[]
  scrollIntoView(options: unknown): void
  getBoundingClientRect(): FakeRect
  getClientRects(): FakeRect[]
  contains(other: unknown): boolean
}

/** Builds the element `locateClickCentre` runs against, with one box (or the given line boxes of a wrapped inline element) and a recorded scroll call. */
function fakeElement(options: {
  isConnected?: boolean
  width?: number
  height?: number
  lineBoxes?: FakeRect[]
  boundingBox?: FakeRect
}): FakeElement {
  const scrollArguments: unknown[] = []
  const box = options.boundingBox ?? {
    x: 100,
    y: 40,
    width: options.width ?? 40,
    height: options.height ?? 16,
  }
  return {
    isConnected: options.isConnected ?? true,
    scrollArguments,
    scrollIntoView: (scrollOptions) => scrollArguments.push(scrollOptions),
    getBoundingClientRect: () => box,
    getClientRects: () => options.lineBoxes ?? [box],
    contains: () => false,
  }
}

/** Runs the in-page function with `document.elementFromPoint` answering `hitAt(x, y)`, or `hit` everywhere. */
function locate(
  element: FakeElement,
  hit: unknown,
  hitAt?: (x: number, y: number) => unknown,
) {
  const original = Reflect.get(globalThis, 'document')
  Reflect.set(globalThis, 'document', {
    elementFromPoint: (x: number, y: number) => (hitAt ? hitAt(x, y) : hit),
  })
  try {
    return locateClickCentre.call(element as unknown as Element)
  } finally {
    Reflect.set(globalThis, 'document', original)
  }
}

// protects=the centre is measured after an instant scroll; fails_when=the scroll is smooth (the page still moves while the centre is read, so the press misses); no_claim=real scrolling
test('scrolls the element into view instantly before measuring its centre', () => {
  // Arrange
  const element = fakeElement({})
  // Act
  const answer = locate(element, element)
  // Assert
  assert.deepEqual(element.scrollArguments, [
    { block: 'center', inline: 'center', behavior: 'instant' },
  ])
  assert.deepEqual(answer, { ready: true, x: 120, y: 48 })
})

// protects=a detached element is never clicked; fails_when=the answer is ready or names another reason; no_claim=how the element got detached
test('answers element-detached for an element that left the document', () => {
  // Arrange
  const element = fakeElement({ isConnected: false })
  // Act
  const answer = locate(element, element)
  // Assert
  assert.deepEqual(answer, { ready: false, reason: 'element-detached' })
  assert.deepEqual(element.scrollArguments, [])
})

// protects=an element without a box is never clicked; fails_when=a zero-size element yields a centre; no_claim=CSS reasons for the size
test('answers element-has-no-size for an element with a zero-size box', () => {
  // Arrange
  const element = fakeElement({ width: 0 })
  // Act
  const answer = locate(element, element)
  // Assert
  assert.deepEqual(answer, { ready: false, reason: 'element-has-no-size' })
})

// protects=a click is never sent where another element covers the target; fails_when=a covered element answers ready; no_claim=which element covers it
test('answers element-obscured when another element is at the centre', () => {
  // Arrange
  const element = fakeElement({})
  // Act
  const answer = locate(element, { other: true })
  // Assert
  assert.deepEqual(answer, { ready: false, reason: 'element-obscured' })
})

// protects=a link that wraps onto two lines is clicked on its text (P07's Options help link at 720 px, Cycle 0092); fails_when=only the bounding box centre is tried, which falls between the line boxes on the paragraph and answers element-obscured; no_claim=real layout
test('clicks a wrapped link on its first line box when its bounding box centre falls on the paragraph', () => {
  // Arrange
  const paragraph = { tagName: 'P' }
  const element = fakeElement({
    boundingBox: { x: 120, y: 268, width: 470, height: 36 },
    lineBoxes: [
      { x: 243, y: 268, width: 348, height: 16 },
      { x: 120, y: 288, width: 35, height: 16 },
    ],
  })
  const isOnLink = (x: number, y: number): boolean =>
    (x >= 243 && x <= 591 && y >= 268 && y <= 284) ||
    (x >= 120 && x <= 155 && y >= 288 && y <= 304)
  // Act
  const answer = locate(element, undefined, (x, y) =>
    isOnLink(x, y) ? element : paragraph,
  )
  // Assert
  assert.deepEqual(answer, { ready: true, x: 417, y: 276 })
})

// protects=a wrapped element whose every line box is covered is never clicked; fails_when=a covered line box answers ready; no_claim=which element covers it
test('answers element-obscured when every line box of a wrapped element is covered', () => {
  // Arrange
  const element = fakeElement({
    boundingBox: { x: 120, y: 268, width: 470, height: 36 },
    lineBoxes: [
      { x: 243, y: 268, width: 348, height: 16 },
      { x: 120, y: 288, width: 35, height: 16 },
    ],
  })
  // Act
  const answer = locate(element, { other: true })
  // Assert
  assert.deepEqual(answer, { ready: false, reason: 'element-obscured' })
})
