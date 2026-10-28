import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createRootHidingStage } from '../utils/createRootHidingStage'
import type { RootHoldTimer } from '../utils/createRootHidingStage'

/**
 * Builds a hand-driven {@link RootHoldTimer}: nothing fires until `fire` is called, and a cancelled timer never fires.
 * @returns The timer for {@link createRootHidingStage}, the texts it released, and `fire` to run the pending timer.
 * @example const clock = fakeHoldTimer()
 */
function fakeHoldTimer(): {
  timer: RootHoldTimer
  released: string[]
  delays: number[]
  fire(): void
  pending(): boolean
} {
  const released: string[] = []
  const delays: number[] = []
  let callback: (() => void) | undefined
  return {
    timer: {
      holdMs: 1_000,
      schedule: (run, delayMs) => {
        delays.push(delayMs)
        callback = run
        return (): void => {
          if (callback === run) callback = undefined
        }
      },
      release: (text) => released.push(text),
    },
    released,
    delays,
    fire: (): void => {
      const run = callback
      callback = undefined
      run?.()
    },
    pending: () => callback !== undefined,
  }
}

const ROOTS = {
  storage: [],
  workspace: ['/Users/ada/app'],
  home: ['/Users/ada'],
}

// protects=a root cut between two writes is hidden whole and nothing of it is released early; fails_when=the first half is released unhidden, or the halves are hidden separately and survive; no_claim=roots of a shape hidePrivateRoots does not know
test('a workspace root split between two writes is hidden as one root', () => {
  // Arrange
  const stage = createRootHidingStage(ROOTS)

  // Act
  const first = stage.write('cwd /Users/ada/')
  const second = stage.write('app/src/a.ts\n')
  const rest = stage.end()

  // Assert
  assert.equal(first, 'cwd ')
  assert.equal(second, '<workspace>/src/a.ts\n')
  assert.equal(rest, '')
})

// protects=ordinary text is released at once, so output keeps its arrival order and time; fails_when=a stage holds every chunk back until the next one; no_claim=timing
test('text that cannot start a root is released immediately', () => {
  // Arrange
  const stage = createRootHidingStage(ROOTS)

  // Act
  const released = stage.write('listening on 127.0.0.1:4100\n')

  // Assert
  assert.equal(released, 'listening on 127.0.0.1:4100\n')
})

// protects=text held for a possible root is released, hidden or as is, when the stream ends; fails_when=the held tail is dropped at the end of output; no_claim=none
test('a held candidate that never becomes a root is released at the end of the stream', () => {
  // Arrange
  const stage = createRootHidingStage(ROOTS)

  // Act
  const first = stage.write('see /Users/ad')
  const rest = stage.end()

  // Assert
  assert.equal(first, 'see ')
  assert.equal(rest, '/Users/ad')
})

// protects=a cut is never placed inside a root that is already complete, even when its tail repeats the root's beginning; fails_when=the stage holds from the inner repeat and releases half of a matched root; no_claim=none
test('a complete root whose tail repeats its own beginning is hidden whole', () => {
  // Arrange
  const stage = createRootHidingStage({ storage: [], home: ['/a/a/a'] })

  // Act
  const released = stage.write('x /a/a/a')
  const rest = stage.end()

  // Assert
  assert.equal(released + rest, 'x ~')
})

// protects=a Windows root split between writes is hidden whatever its case and separators; fails_when=the prefix check is case or separator sensitive; no_claim=real Windows paths
test('a Windows workspace root split between two writes is hidden with either separator and any case', () => {
  // Arrange
  const stage = createRootHidingStage({
    storage: [],
    workspace: ['C:\\Users\\Ada\\repo'],
  })

  // Act
  const first = stage.write('at c:/users/')
  const second = stage.write('ada/REPO\\src\\a.ts')
  const rest = stage.end()

  // Assert
  assert.equal(first + second + rest, 'at <workspace>\\src\\a.ts')
})

// protects=a Windows root printed with doubled separators (JSON-escaped) and cut inside its name is hidden whole; fails_when=the hold window counts normalized length against raw characters so the chunk's start is released unhidden; no_claim=POSIX doubled separators (hidePrivateRoots matches those only as written)
test('a JSON-escaped Windows root with doubled separators split inside its last name is hidden whole', () => {
  // Arrange
  const stage = createRootHidingStage({
    storage: [],
    workspace: ['C:\\Users\\ada\\a\\b\\c'],
  })

  // Act
  const first = stage.write('at C:\\\\Users\\\\ada\\\\a\\\\b\\\\')
  const second = stage.write('c\\\\x')
  const rest = stage.end()

  // Assert
  assert.equal(first + second + rest, 'at <workspace>\\\\x')
})

// protects=a chunk ending exactly on a complete root waits for the next character, so a longer name is not cut into the placeholder; fails_when=/Users/ada then m/x stores ~m/x; no_claim=none
test('a chunk ending on a complete root followed by more name characters leaves the longer path unhidden', () => {
  // Arrange
  const stage = createRootHidingStage({ storage: [], home: ['/Users/ada'] })

  // Act
  const first = stage.write('at /Users/ada')
  const second = stage.write('m/x\n')
  const rest = stage.end()

  // Assert
  assert.equal(first, 'at ')
  assert.equal(second, '/Users/adam/x\n')
  assert.equal(rest, '')
})

// protects=a complete root at a chunk end is hidden once the next chunk shows a boundary; fails_when=the placeholder is lost or doubled; no_claim=none
test('a chunk ending on a complete root followed by a separator hides the root', () => {
  // Arrange
  const stage = createRootHidingStage({ storage: [], home: ['/Users/ada'] })

  // Act
  const first = stage.write('at /Users/ada')
  const second = stage.write('/x\n')
  const rest = stage.end()

  // Assert
  assert.equal(first, 'at ')
  assert.equal(second, '~/x\n')
  assert.equal(rest, '')
})

// protects=the last line of a quiet server (a trailing slash) reaches the journal after the hold without more output; fails_when=a bare / stays held until the stream ends; no_claim=real timers
test('a trailing slash held for a possible root is released unchanged after the hold time', () => {
  // Arrange
  const clock = fakeHoldTimer()
  const stage = createRootHidingStage(ROOTS, clock.timer)

  // Act
  const first = stage.write('Ready at http://localhost:3000/')
  clock.fire()

  // Assert
  assert.equal(first, 'Ready at http://localhost:3000')
  assert.deepEqual(clock.released, ['/'])
  assert.deepEqual(clock.delays, [1_000])
  assert.equal(stage.end(), '')
})

// protects=a timed release that already shows part of a private name is replaced by the root's placeholder; fails_when=/Users/ad is stored as typed after the timeout; no_claim=none
test('a held start of a private name released by time reads as the root placeholder', () => {
  // Arrange
  const clock = fakeHoldTimer()
  const stage = createRootHidingStage(ROOTS, clock.timer)

  // Act
  const first = stage.write('see /Users/ad')
  clock.fire()

  // Assert
  assert.equal(first, 'see ')
  assert.deepEqual(clock.released, ['~'])
  assert.equal(stage.end(), '')
})

// protects=a held part that only shows the folder every user shares (/Users/) is released as typed; fails_when=shared parents are replaced by a placeholder; no_claim=none
test('a held shared parent folder released by time is kept as typed', () => {
  // Arrange
  const clock = fakeHoldTimer()
  const stage = createRootHidingStage(ROOTS, clock.timer)

  // Act
  stage.write('see /Users/')
  clock.fire()

  // Assert
  assert.deepEqual(clock.released, ['/Users/'])
})

// protects=chunks that arrive 80 ms apart are still joined across a split root, the hold timer restarting on each chunk; fails_when=the first timer fires between them or a stale timer releases held text; no_claim=real timers
test('two chunks a short time apart still hide a root split between them', () => {
  // Arrange
  const clock = fakeHoldTimer()
  const stage = createRootHidingStage(ROOTS, clock.timer)

  // Act
  const first = stage.write('cwd /Users/')
  const second = stage.write('ada/app/x\n')

  // Assert
  assert.equal(first, 'cwd ')
  assert.equal(second, '<workspace>/x\n')
  assert.equal(clock.pending(), false)
  assert.deepEqual(clock.released, [])
})
