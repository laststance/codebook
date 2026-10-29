import assert from 'node:assert/strict'
import { test } from 'node:test'

import { locateClickCentre } from '../utils/locateClickCentre'

type FakeElement = {
  isConnected: boolean
  scrollArguments: unknown[]
  scrollIntoView(options: unknown): void
  getBoundingClientRect(): {
    x: number
    y: number
    width: number
    height: number
  }
  contains(other: unknown): boolean
}

/** Builds the element `locateClickCentre` runs against, with a rectangle and a recorded scroll call. */
function fakeElement(options: {
  isConnected?: boolean
  width?: number
  height?: number
}): FakeElement {
  const scrollArguments: unknown[] = []
  return {
    isConnected: options.isConnected ?? true,
    scrollArguments,
    scrollIntoView: (scrollOptions) => scrollArguments.push(scrollOptions),
    getBoundingClientRect: () => ({
      x: 100,
      y: 40,
      width: options.width ?? 40,
      height: options.height ?? 16,
    }),
    contains: () => false,
  }
}

/** Runs the in-page function with `document.elementFromPoint` answering `hit`. */
function locate(element: FakeElement, hit: unknown) {
  const original = Reflect.get(globalThis, 'document')
  Reflect.set(globalThis, 'document', { elementFromPoint: () => hit })
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
