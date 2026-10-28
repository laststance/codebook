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

// protects=text held for a possible root that shows no private name yet is released as typed when the stream ends; fails_when=the held tail is dropped at the end of output; no_claim=a held start that already shows part of a name (it ends as the placeholder, its own test)
test('a held candidate that never becomes a root is released at the end of the stream', () => {
  // Arrange
  const stage = createRootHidingStage(ROOTS)

  // Act
  const first = stage.write('see /Users/')
  const rest = stage.end()

  // Assert
  assert.equal(first, 'see ')
  assert.equal(rest, '/Users/')
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

// protects=text written after a timed release of a held shared parent (/Users/) that finishes a root never releases the private name; fails_when=the rest of the root ('ada/app/x.ts') is released as typed after the hold; no_claim=real timers
test('a root finished after the timed release of its held shared parent releases no name characters', () => {
  // Arrange
  const clock = fakeHoldTimer()
  const stage = createRootHidingStage(ROOTS, clock.timer)

  // Act
  const first = stage.write('cwd is /Users/')
  clock.fire()
  const second = stage.write('ada/app/x.ts\n')

  // Assert
  assert.equal(first, 'cwd is ')
  assert.deepEqual(clock.released, ['/Users/'])
  assert.equal(second, '<workspace>/x.ts\n')
})

// protects=endless separators (collapsed by the comparison) keep the held text under the hold cap and every character is released; fails_when=the held run grows with every write; no_claim=timing of the rescans
test('endless separators keep the held text bounded and release every character', () => {
  // Arrange
  const stage = createRootHidingStage(ROOTS)
  const chunk = '/'.repeat(64 * 1024)
  let releasedCharacters = 0

  // Act
  for (let index = 0; index < 32; index++)
    releasedCharacters += stage.write(chunk).length
  const heldCharacters = stage.end().length

  // Assert
  assert.equal(heldCharacters <= 8_192, true)
  assert.equal(releasedCharacters + heldCharacters, 32 * 64 * 1024)
})

// protects=a Codebook storage path under the home directory reads <storage>, not ~/…, when the stage knows the storage roots; fails_when=the stage hides the home prefix first because the storage root is missing from its roots; no_claim=the run's wiring (its own test)
test('a storage path under home in a write reads as the storage placeholder', () => {
  // Arrange
  const stage = createRootHidingStage({
    storage: [
      '/Users/ada/Library/Application Support/Code/User/workspaceStorage/x',
    ],
    home: ['/Users/ada'],
  })

  // Act
  const output =
    stage.write(
      'wrote /Users/ada/Library/Application Support/Code/User/workspaceStorage/x/events.jsonl\n',
    ) + stage.end()

  // Assert
  assert.equal(output, 'wrote <storage>/events.jsonl\n')
})

// protects=a name written in several pieces after the timed release of a held shared parent is still held and hidden when the root completes; fails_when=a middle piece ('ada') is released as typed or the released '/Users/' is delivered twice; no_claim=real timers
test('a root finished over several writes after a timed release releases no name characters', () => {
  // Arrange
  const clock = fakeHoldTimer()
  const stage = createRootHidingStage(ROOTS, clock.timer)

  // Act
  stage.write('cwd is /Users/')
  clock.fire()
  const middle = stage.write('ada')
  const last = stage.write('/app/x.ts\n')

  // Assert
  assert.equal(middle, '')
  assert.equal(last, '<workspace>/x.ts\n')
})

// protects=a stream that ends while it holds the start of a private root that already shows part of the name ends with that root's placeholder, as a timed release would, so the end never leaks the partial name; fails_when=the end releases the held start as typed ('/Users/ad'); no_claim=a start that shows no name yet (it is released as typed, like a timed release)
test('a stream that ends on a held start showing part of a name ends with the placeholder', () => {
  // Arrange
  const stage = createRootHidingStage(ROOTS)

  // Act
  const written = stage.write('cwd is /Users/ad')
  const ended = stage.end()

  // Assert
  assert.equal(written, 'cwd is ')
  assert.equal(ended, '~')
})

// protects=after a timed release let out a shared parent as typed, a second timed release of the same held start delivers only what was not let out yet, so the parent is never repeated; fails_when=the second release repeats '/Users/' or the name is let out; no_claim=none
test('a second timed release after a typed parent delivers only the new part, never the parent again', () => {
  // Arrange
  const clock = fakeHoldTimer()
  const stage = createRootHidingStage(ROOTS, clock.timer)

  // Act
  const first = stage.write('cwd /Users/')
  clock.fire()
  const second = stage.write('a')
  clock.fire()
  const ended = stage.end()

  // Assert
  assert.equal(first, 'cwd ')
  assert.equal(second, '')
  assert.deepEqual(clock.released, ['/Users/', '~'])
  assert.equal(ended, '')
})

// protects=a stream that ends after a timed release let out a shared parent as typed delivers only the part not let out yet; fails_when=the end repeats the released parent; no_claim=none
test('a stream that ends after a timed release of a typed parent does not repeat the parent', () => {
  // Arrange
  const clock = fakeHoldTimer()
  const stage = createRootHidingStage(ROOTS, clock.timer)

  // Act
  stage.write('cwd /Users/')
  clock.fire()
  const written = stage.write('a')
  const ended = stage.end()

  // Assert
  assert.deepEqual(clock.released, ['/Users/'])
  assert.equal(written, '')
  assert.equal(ended, '~')
})

// protects=once a timed release showed a root's placeholder, a later timed release of the same, longer held start delivers nothing more, so the placeholder is never shown twice; fails_when=the second release delivers the placeholder again ('~~'); no_claim=none
test('a second timed release after a placeholder was shown never repeats the placeholder', () => {
  // Arrange
  const clock = fakeHoldTimer()
  const stage = createRootHidingStage(ROOTS, clock.timer)

  // Act
  const first = stage.write('cwd /Users/a')
  clock.fire()
  const second = stage.write('d')
  clock.fire()
  const ended = stage.end()

  // Assert
  assert.equal(first, 'cwd ')
  assert.equal(second, '')
  assert.deepEqual(clock.released, ['~'])
  assert.equal(ended, '')
})

// protects=a timed release that finds a shorter root complete (home) keeps the text held while it can still grow into a longer root (workspace), so the longer root's name is never released; fails_when=the name 'private-project' is let out after the timed release; no_claim=the placeholder kind of the part already released
test('a home root released by time then continued into the workspace root releases no workspace name', () => {
  // Arrange
  const clock = fakeHoldTimer()
  const stage = createRootHidingStage(
    {
      storage: [],
      workspace: ['/Users/ada/private-project'],
      home: ['/Users/ada'],
    },
    clock.timer,
  )

  // Act
  const first = stage.write('cwd /Users/ada')
  clock.fire()
  const second = stage.write('/private-project/file.ts\n')

  // Assert
  assert.equal(first, 'cwd ')
  assert.deepEqual(clock.released, ['~'])
  assert.equal(second, '/file.ts\n')
})

// protects=a timed release that finds home complete keeps the text held while it can grow into a storage root under home, so the storage folder's id is never released; fails_when=the id 'abc123' is let out after the timed release; no_claim=the placeholder kind of the part already released
test('a home root released by time then continued into a storage root releases no storage id', () => {
  // Arrange
  const clock = fakeHoldTimer()
  const stage = createRootHidingStage(
    {
      storage: ['/Users/ada/Library/workspaceStorage/abc123'],
      home: ['/Users/ada'],
    },
    clock.timer,
  )

  // Act
  stage.write('at /Users/ada/Library/workspaceStorage/')
  clock.fire()
  const second = stage.write('abc123/events.jsonl\n')

  // Assert
  assert.equal(`${clock.released.join('')}${second}`.includes('abc123'), false)
  assert.equal(second, '/events.jsonl\n')
})

// protects=a Windows root preceded by thousands of doubled separators never has its name released as typed when the raw-length cap cuts inside the held run; fails_when=any 'ada' is released; no_claim=the exact placeholder spelling of the cut head
test('a doubled-separator Windows root cut by the raw-length cap releases no private name', () => {
  // Arrange
  const stage = createRootHidingStage({
    storage: [],
    home: ['C:\\Users\\ada'],
  })
  const chunks = ['C:\\', '\\'.repeat(9000), 'Users\\ada\\app\n']

  // Act
  const output =
    chunks.map((chunk) => stage.write(chunk)).join('') + stage.end()

  // Assert
  assert.equal(output.includes('ada'), false)
})

// protects=a held prefix of a longer root (workspace) released by time under a shorter root (home) reads as the longer-guaranteed root's placeholder, so a path that then diverges is not corrupted into the workspace; fails_when=the output holds 'ada' or a '<workspace>' for a path that is not the workspace; no_claim=exact wording of the fail-closed form
test('a held workspace-name prefix released by time that diverges into another path under home reads as home', () => {
  // Arrange
  const clock = fakeHoldTimer()
  const stage = createRootHidingStage(
    { storage: [], workspace: ['/Users/ada/app'], home: ['/Users/ada'] },
    clock.timer,
  )

  // Act
  const first = stage.write('/Users/ada/ap')
  clock.fire()
  const second = stage.write('ple/x\n')
  const output = `${first}${clock.released.join('')}${second}${stage.end()}`

  // Assert
  assert.equal(output.includes('ada'), false)
  assert.equal(output.includes('<workspace>'), false)
  assert.equal(output, '~/apple/x\n')
})

/**
 * Drives a stage over `chunks`, firing the hold timer after the chunk indexes in `fireAfter`, then ends it.
 * @param stage - The stage under test, built with `clock.timer`.
 * @param clock - The hand-driven timer of `stage`.
 * @param chunks - The writes, in order.
 * @param fireAfter - Indexes of the chunks after which the pending timer fires.
 * @returns Everything the stage delivered, in delivery order.
 * @example driveStage(stage, clock, ['C:\\'], new Set([0]))
 */
function driveStage(
  stage: ReturnType<typeof createRootHidingStage>,
  clock: ReturnType<typeof fakeHoldTimer>,
  chunks: string[],
  fireAfter: ReadonlySet<number>,
): string {
  let output = ''
  let seenReleases = 0
  const collectReleases = (): void => {
    output += clock.released.slice(seenReleases).join('')
    seenReleases = clock.released.length
  }
  chunks.forEach((chunk, index) => {
    output += stage.write(chunk)
    if (fireAfter.has(index)) {
      clock.fire()
      collectReleases()
    }
  })
  output += stage.end()
  collectReleases()
  return output
}

// protects=a Windows root whose drive letter a timed release already let out is still hidden when thousands of separators then reach the raw-length cap; fails_when=the cap drops the drive letter and 'Users\ada\app' is released as typed; no_claim=the placeholder wording of the already released drive letter
test('a doubled-separator Windows root cut by the raw-length cap after a timed release releases no private name', () => {
  // Arrange
  const clock = fakeHoldTimer()
  const stage = createRootHidingStage(
    { storage: [], home: ['C:\\Users\\ada'] },
    clock.timer,
  )

  // Act
  const output = driveStage(
    stage,
    clock,
    ['C:\\', '\\'.repeat(9000), 'Users\\ada\\app\n'],
    new Set([0]),
  )

  // Assert
  assert.equal(output, 'C:\\~\\app\n')
  assert.equal(output.includes('ada'), false)
})

// protects=a POSIX root whose leading separator a timed release already let out is still hidden when a separator run past the raw-length cap precedes the rest of the root; fails_when=the cap loses the root-matching state and 'Users/ada/app' is released as typed; no_claim=the placeholder wording of the already released separator
test('a doubled-separator POSIX root cut by the raw-length cap after a timed release releases no private name', () => {
  // Arrange
  const clock = fakeHoldTimer()
  const stage = createRootHidingStage(
    { storage: [], home: ['/Users/ada'] },
    clock.timer,
  )

  // Act
  const output = driveStage(
    stage,
    clock,
    ['/', '/'.repeat(9000), 'Users/ada/app\n'],
    new Set([0]),
  )

  // Assert
  assert.equal(output.includes('ada'), false)
  assert.equal(output, `${'/'.repeat(9000)}~/app\n`)
})

// protects=the placeholder a raw-length cap let out is delivered once even when the timed release then fires; fails_when=the timed release repeats the placeholder or lets out part of the name; no_claim=text written after the release
test('a placeholder let out by the raw-length cap is not repeated by the timed release', () => {
  // Arrange
  const clock = fakeHoldTimer()
  const stage = createRootHidingStage(
    { storage: [], home: ['C:\\Users\\ada'] },
    clock.timer,
  )

  // Act
  const output = driveStage(
    stage,
    clock,
    ['C:\\', '\\'.repeat(9000)],
    new Set([1]),
  )

  // Assert
  assert.equal(output, '~')
  assert.equal(output.includes('ada'), false)
})

// protects=the placeholder a raw-length cap let out is delivered once when the stream then ends; fails_when=the end repeats the placeholder or lets out part of the name; no_claim=text written after the cap
test('a placeholder let out by the raw-length cap is not repeated when the stream ends', () => {
  // Arrange
  const stage = createRootHidingStage({
    storage: [],
    home: ['C:\\Users\\ada'],
  })

  // Act
  const written = stage.write('C:\\') + stage.write('\\'.repeat(9000))
  const ended = stage.end()

  // Assert
  assert.equal(written + ended, '~')
  assert.equal((written + ended).includes('ada'), false)
})

/**
 * Makes a small deterministic pseudo-random generator, so a property test replays the same interleavings on every run.
 * @param seed - The generator's starting state.
 * @returns A function giving the next number in [0, 1).
 * @example const next = seededRandom(7)
 */
function seededRandom(seed: number): () => number {
  let state = seed
  return (): number => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

// protects=over random splits of roots, timed releases and an end, no character of a private name leaks, no ordinary character is dropped or repeated, and no placeholder is invented; fails_when=a timed release, the end or a split root releases 'a' or 'd' of a name, swallows or doubles text, or shows more placeholders than roots; no_claim=inputs outside the generated alphabet, real timers
for (const shape of [
  {
    label: 'POSIX',
    home: '/Users/ada',
    workspace: '/Users/ada/proj',
    separator: '/',
  },
  {
    label: 'Windows',
    home: 'C:\\Users\\ada',
    workspace: 'C:\\Users\\ada\\proj',
    separator: '\\',
  },
]) {
  test(`${shape.label} roots split at random points with random timed releases never leak a name or lose ordinary text`, () => {
    for (let seed = 1; seed <= 300; seed++) {
      // Arrange
      const next = seededRandom(seed)
      const pick = <Item>(items: readonly Item[]): Item =>
        items[Math.floor(next() * items.length)] as Item
      let input = ''
      let rootStarts = 0
      const segmentCount = 3 + Math.floor(next() * 6)
      for (let index = 0; index < segmentCount; index++) {
        const kind = next()
        if (kind < 0.45) {
          input += pick(['x', 'y', ' ', '\n', 'xy '])
        } else {
          // A root always stands after a space and before a boundary, so it is a real root occurrence.
          rootStarts++
          const root = pick([shape.home, shape.workspace])
          const terminator = pick([shape.separator, ' ', '\n'])
          input += ` ${root}${terminator}`
        }
      }
      const chunks: string[] = []
      for (let at = 0; at < input.length;) {
        const size = 1 + Math.floor(next() * 6)
        chunks.push(input.slice(at, at + size))
        at += size
      }
      const fireAfter = new Set(
        chunks.flatMap((_, index) => (next() < 0.4 ? [index] : [])),
      )
      const clock = fakeHoldTimer()
      const stage = createRootHidingStage(
        {
          storage: [],
          workspace: [shape.workspace],
          home: [shape.home],
        },
        clock.timer,
      )

      // Act
      const output = driveStage(stage, clock, chunks, fireAfter)

      // Assert
      const withoutPlaceholders = output.replaceAll('<workspace>', '')
      const ordinary = (text: string): string => text.replace(/[^xy \n]/g, '')
      const placeholderCount = output.split(/<workspace>|~/).length - 1
      const context = `seed ${seed}: ${JSON.stringify(chunks)} fired after ${JSON.stringify([...fireAfter])} gave ${JSON.stringify(output)}`
      assert.equal(/[ad]/.test(withoutPlaceholders), false, context)
      assert.equal(ordinary(output), ordinary(input), context)
      assert.equal(placeholderCount <= rootStarts, true, context)
    }
  })
}
