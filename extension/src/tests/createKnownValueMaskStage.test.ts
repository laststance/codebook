import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  NODE_SERVER_OUTPUT_PENDING_LIMIT_BYTES,
  REDACTION_MASK,
} from '../constants'
import { createKnownValueMaskStage } from '../utils/createKnownValueMaskStage'
import type { RootHoldTimer } from '../utils/createRootHidingStage'

/** A manual timer: `fire` runs the scheduled callback; `released` collects timed-release texts. */
function manualTimer(): {
  timer: RootHoldTimer
  fire(): void
  released: string[]
} {
  let pending: (() => void) | undefined
  const released: string[] = []
  return {
    timer: {
      holdMs: 1_000,
      schedule: (callback) => {
        pending = callback
        return (): void => {
          pending = undefined
        }
      },
      release: (text): void => {
        released.push(text)
      },
    },
    fire: (): void => pending?.(),
    released,
  }
}

const SECRET_FORMS = ['hunter2-secret']
const maskSecret = (text: string): string =>
  text.replaceAll('hunter2-secret', REDACTION_MASK)

// protects=text held under an infinite holdback is dropped and reported once it passes the pending cap, and nothing is published; fails_when=the held text grows past the cap unreported, or text under the cap is dropped; no_claim=timed release or finite holdbacks (captureProcessOutput tests)
test('held text past the pending cap is dropped and reported under an infinite holdback', () => {
  // Arrange
  const withheld: number[] = []
  const stage = createKnownValueMaskStage({
    mask: (text) => text,
    holdback: () => Number.POSITIVE_INFINITY,
    onWithheld: (bytes) => withheld.push(bytes),
  })
  const chunk = 'x'.repeat(NODE_SERVER_OUTPUT_PENDING_LIMIT_BYTES / 2)
  // Act
  const first = stage.write(chunk)
  const second = stage.write(chunk)
  const third = stage.write('y')
  // Assert
  assert.deepEqual([first, second, third], ['', '', ''])
  assert.deepEqual(withheld, [NODE_SERVER_OUTPUT_PENDING_LIMIT_BYTES + 1])
  assert.equal(stage.end(), '')
  assert.deepEqual(withheld, [NODE_SERVER_OUTPUT_PENDING_LIMIT_BYTES + 1])
})

// protects=a secret written in two parts with a quiet gap publishes neither fragment; fails_when=the timed release or channel end publishes the first part as plain text; no_claim=real timers or real server output; a manual timer stands for the quiet gap
test('a secret written in two parts with a quiet gap leaks no fragment', () => {
  // Arrange
  const clock = manualTimer()
  const stage = createKnownValueMaskStage(
    {
      mask: maskSecret,
      holdback: () => 14,
      forms: () => SECRET_FORMS,
      onWithheld: () => undefined,
    },
    clock.timer,
  )
  // Act
  const firstPart = stage.write('password: hunter2')
  clock.fire()
  const secondPart = stage.write('-secret done')
  const ended = stage.end()
  // Assert
  assert.equal(firstPart, 'pass')
  assert.deepEqual(clock.released, ['word: [masked]'])
  assert.equal(secondPart + ended, '[masked] done')
})

// protects=the channel end masks a held ending that starts a secret; fails_when=end publishes the partial secret; no_claim=timed release
test('the channel end masks a held tail that starts a known secret', () => {
  // Arrange
  const stage = createKnownValueMaskStage({
    mask: maskSecret,
    holdback: () => 14,
    forms: () => SECRET_FORMS,
    onWithheld: () => undefined,
  })
  // Act
  const settled = stage.write('ok hunter2-sec')
  const ended = stage.end()
  // Assert
  assert.equal(settled + ended, 'ok [masked]')
})

// protects=a held tail that is no secret start is published unchanged; fails_when=ordinary text is masked; no_claim=none
test('a held tail that starts no known secret is published unchanged', () => {
  // Arrange
  const stage = createKnownValueMaskStage({
    mask: maskSecret,
    holdback: () => 14,
    forms: () => SECRET_FORMS,
    onWithheld: () => undefined,
  })
  // Act
  const settled = stage.write('server ready on 4100')
  const ended = stage.end()
  // Assert
  assert.equal(settled + ended, 'server ready on 4100')
})

// protects=settling never cuts inside a surrogate pair; fails_when=a lone high surrogate is published; no_claim=other encodings
test('settling never cuts between the halves of a surrogate pair', () => {
  // Arrange
  const stage = createKnownValueMaskStage({
    mask: maskSecret,
    holdback: () => 4,
    forms: () => SECRET_FORMS,
    onWithheld: () => undefined,
  })
  // Act
  const settled = stage.write('ab\u{1F600}cd')
  // Assert
  assert.equal(settled, 'ab')
  assert.equal(stage.end(), '\u{1F600}cd')
})

// protects=an infinite holdback releases nothing by timer; fails_when=the timer publishes text while a sign-in is in progress; no_claim=the exchange's own release
test('an infinite holdback releases nothing when the timer fires', () => {
  // Arrange
  const clock = manualTimer()
  const stage = createKnownValueMaskStage(
    {
      mask: maskSecret,
      holdback: () => Number.POSITIVE_INFINITY,
      forms: () => SECRET_FORMS,
      onWithheld: () => undefined,
    },
    clock.timer,
  )
  // Act
  const written = stage.write('hunter2')
  clock.fire()
  // Assert
  assert.equal(written, '')
  assert.deepEqual(clock.released, [])
})

/** Runs pieces through one stage, firing the quiet-gap timer after each; returns everything published, in order. */
function publishWithGaps(pieces: readonly string[]): string {
  const clock = manualTimer()
  const stage = createKnownValueMaskStage(
    {
      mask: maskSecret,
      holdback: () => 14,
      forms: () => SECRET_FORMS,
      onWithheld: () => undefined,
    },
    clock.timer,
  )
  let published = ''
  for (const piece of pieces) {
    published += stage.write(piece)
    clock.fire()
    published += clock.released.splice(0).join('')
  }
  return published + stage.end()
}

// protects=a secret written as 3 characters, a quiet gap, then the rest publishes no character of it beyond the mask; fails_when=the first piece under 4 characters or the rest after a masked ending is published raw; no_claim=real timers; a manual timer stands for the quiet gap
test('a 3-character first piece and its rest after a gap leak nothing of the secret', () => {
  // Act
  const published = publishWithGaps(['pw: hun', 'ter2-secret'])
  // Assert
  assert.equal(published, 'pw: [masked][masked]')
  assert.doesNotMatch(published, /hunter2|ter2-secret|hun/)
})

// protects=a 5-character first piece and its rest after a gap leaks nothing; fails_when=the remainder after a masked 4+ character ending is published raw; no_claim=real timers
test('a 5-character first piece and its rest after a gap leak nothing of the secret', () => {
  // Act
  const published = publishWithGaps(['pw: hunte', 'r2-secret done'])
  // Assert
  assert.equal(published, 'pw: [masked][masked] done')
  assert.doesNotMatch(published, /hunter2|r2-secret|hunte/)
})

// protects=a secret in three pieces across two gaps leaks nothing; fails_when=the state is dropped after the middle piece; no_claim=real timers
test('a secret in three pieces across two gaps leaks nothing of the secret', () => {
  // Act
  const published = publishWithGaps(['pw: hun', 'ter2', '-secret!'])
  // Assert
  assert.equal(published, 'pw: [masked][masked][masked]!')
  assert.doesNotMatch(published, /hunter2|ter2|-secret|hun/)
})

// protects=text that does not continue the started secret is published unchanged and clears the state; fails_when=ordinary text after a gap is masked, or the stale state masks a later look-alike; no_claim=real timers
test('text that does not continue the started secret is published unchanged and clears the state', () => {
  // Act
  const published = publishWithGaps(['pw: hun', 'ks ok\n', 'ter2-secret'])
  // Assert
  assert.equal(published, 'pw: [masked]ks ok\nter2-secret')
})

// protects=released text ending in a newline that starts no secret is untouched; fails_when=a newline ending is masked or starts a continuation; no_claim=real timers
test('released text ending in a newline is untouched and starts no continuation', () => {
  // Act
  const published = publishWithGaps(['server ready\n', 'ter2-secret'])
  // Assert
  assert.equal(published, 'server ready\nter2-secret')
})
