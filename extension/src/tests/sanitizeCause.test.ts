import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { cutCauseForDisplay } from '../utils/cutCauseForDisplay'
import { sanitizeCause } from '../utils/sanitizeCause'
import { sanitizedStack } from '../utils/sanitizedStack'

const STORAGE =
  '/Users/ada/Library/Application Support/Code/User/workspaceStorage/4f2a/laststance.codebook'

// Value: protects=the extension's storage path, the opened repository and the home directory in causes the agent and the learner read (POSIX); fails_when=any of the three roots survives in the cause, or a storage folder inside the home directory reads ~/… instead of <storage>; why_new=historyReason and the save's causes were raw String(error) (the service's historyReason and save causes; EN12); seam=none; no_claim=causes of browser runs outside this plan
test('a cause names no storage folder, repository root or home directory of this machine', () => {
  // Arrange
  const error = new Error(
    `ENOSPC: no space left on device, write '${STORAGE}/node-tests.v1/x/events.jsonl' while reading /Users/ada/code/scheduler/src/jobs.ts from /Users/ada/.config`,
  )

  // Act
  const cause = sanitizeCause(error, {
    storage: [STORAGE],
    workspace: '/Users/ada/code/scheduler',
    home: '/Users/ada',
  })

  // Assert
  assert.equal(
    cause,
    "ENOSPC: no space left on device, write '<storage>/node-tests.v1/x/events.jsonl' while reading <workspace>/src/jobs.ts from ~/.config",
  )
})

// Value: protects=the same roots in their Windows forms: either separator, any case and the long-path prefix; fails_when=C:/Users/Ada, c:\users\ada or \\?\C:\Users\Ada survives in a cause; why_new=Windows is a target system (PRODUCT_GOAL.md, Product constraints; EN12); seam=none; no_claim=UNC shares
test('a Windows cause names no repository root or home directory in any of its spellings', () => {
  // Arrange
  const message =
    'EPERM: operation not permitted, open \\\\?\\C:\\Users\\Ada\\repo\\src\\jobs.ts and c:/users/ada/AppData/x'

  // Act
  const cause = sanitizeCause(message, {
    storage: [],
    workspace: 'C:\\Users\\Ada\\repo',
    home: 'C:\\Users\\Ada',
  })

  // Assert
  assert.equal(
    cause,
    'EPERM: operation not permitted, open <workspace>\\src\\jobs.ts and ~/AppData/x',
  )
})

// Value: protects=a storage folder the file system reports through its macOS realpath alias; fails_when=/private/var/folders/… survives because the extension knows the folder as /var/folders/…; why_new=a realpath and a message can name one folder two ways (EN12); seam=none; no_claim=other aliases
test('a storage folder reported through its macOS realpath alias is hidden too', () => {
  // Arrange
  const error = new Error(
    "EACCES: permission denied, open '/private/var/folders/xy/T/codebook/seal.json'",
  )

  // Act
  const cause = sanitizeCause(error, {
    storage: ['/var/folders/xy/T/codebook'],
  })

  // Assert
  assert.equal(cause, "EACCES: permission denied, open '<storage>/seal.json'")
})

// Value: protects=a root that is only the beginning of another folder's name, and control characters a cause can carry; fails_when=/Users/ada is replaced inside /Users/adam, or a line break or bidirectional control reaches a tooltip; why_new=causes are plain strings shown in tooltips and MCP messages (Design 11); seam=none; no_claim=fonts that render other invisible characters
test('a cause keeps another user’s folder whole and shows no control characters', () => {
  // Arrange
  const message = 'open /Users/adam/report.txt\nfailed \u202Eod\u202C'

  // Act
  const cause = sanitizeCause(message, { storage: [], home: '/Users/ada' })

  // Assert
  assert.equal(cause, 'open /Users/adam/report.txt failed od')
})

// Value: protects=a typed error's message with its cause and a plain error without its name; fails_when=a StudyError loses its cause or an error reads with its "Error:" prefix; why_new=sanitizeCause reuses messageNamingCause and withoutErrorName (Design 11); seam=none; no_claim=the error's code (MCP errors keep it apart)
test('a typed error reads as its message naming its cause, and a plain error without its name', () => {
  // Arrange
  const typed = new StudyError(
    'EVIDENCE_UNAVAILABLE',
    'The history could not be sealed.',
    'Error: EIO: i/o error',
  )

  // Act / Assert
  assert.equal(
    sanitizeCause(typed, { storage: [] }),
    'The history could not be sealed. Cause: EIO: i/o error',
  )
  assert.equal(
    sanitizeCause(new TypeError('Cannot read the seal'), { storage: [] }),
    'Cannot read the seal',
  )
})

// Value: protects=the 300-character bound of a cause on display; fails_when=a long cause fills a tooltip or a short one is cut; why_new=UI_CAUSE_MAX_CHARS bounds every shown cause (AC17); seam=none; no_claim=the Output channel, which keeps the whole cause
test('a cause longer than 300 characters is cut for display and a short one is kept', () => {
  // Arrange
  const long = 'x'.repeat(400)

  // Act
  const cut = cutCauseForDisplay(long)

  // Assert
  assert.equal(Array.from(cut).length, 300)
  assert.ok(cut.endsWith('… [cut]'))
  assert.equal(cutCauseForDisplay('EIO: i/o error'), 'EIO: i/o error')
})

// Value: protects=an Output entry's stack: one line per frame, without the message line, none naming a storage folder, the repository or the home directory; fails_when=a frame keeps a private path, the message line is repeated, or a stackless error gives an empty stack; why_new=sanitizedStack had no test, and the entries' tests assert the cause only (X5, AC17); seam=none; no_claim=how a real engine words its frames
test('an Output entry’s stack drops the message line and names no storage folder, repository root or home directory', () => {
  // Arrange
  const roots = {
    storage: [STORAGE],
    workspace: '/Users/ada/code/scheduler',
    home: '/Users/ada',
  }
  const failing = new Error('ENOSPC: no space left on device')
  failing.stack = [
    'Error: ENOSPC: no space left on device',
    `    at NodeTestHistoryWriter.finish (${STORAGE}/dist/nodeTestHistoryStore.js:812:13)`,
    '    at async StudyService.sealNodeHistory (/Users/ada/code/scheduler/node_modules/codebook/service.js:3480:7)',
    '    at async Object.<anonymous> (/Users/ada/.vscode/extensions/laststance.codebook-0.2.33/dist/extension.js:90:5)',
  ].join('\n')
  const withoutFrames = new Error('EIO: i/o error')
  withoutFrames.stack = 'Error: EIO: i/o error'

  // Act
  const stack = sanitizedStack(failing, roots)

  // Assert
  assert.equal(
    stack,
    [
      'at NodeTestHistoryWriter.finish (<storage>/dist/nodeTestHistoryStore.js:812:13)',
      'at async StudyService.sealNodeHistory (<workspace>/node_modules/codebook/service.js:3480:7)',
      'at async Object.<anonymous> (~/.vscode/extensions/laststance.codebook-0.2.33/dist/extension.js:90:5)',
    ].join('\n'),
  )
  assert.equal(sanitizedStack(withoutFrames, roots), undefined)
  assert.equal(sanitizedStack('Error: not an error object', roots), undefined)
})

// Value: protects=a root that ends a sentence in a cause; fails_when=`… nothing at /Users/ada/code/scheduler.` keeps the repository path because the full stop counts as part of a name, or `scheduler.ts` is cut at its extension; why_new=the boundary rejected every period after a root (F31); seam=none; no_claim=roots followed by other punctuation
test('a root followed by the full stop of a sentence is hidden, and a file name that continues it is kept', () => {
  // Arrange
  const message =
    'ENOENT: nothing at /Users/ada/code/scheduler. Also /Users/ada/code/scheduler.ts and /Users/ada/code/scheduler.'

  // Act
  const cause = sanitizeCause(message, {
    storage: [],
    workspace: '/Users/ada/code/scheduler',
  })

  // Assert
  assert.equal(
    cause,
    'ENOENT: nothing at <workspace>. Also /Users/ada/code/scheduler.ts and <workspace>.',
  )
})

// Value: protects=roots made of regular-expression characters and a home directory that is `/`; fails_when=a root such as /srv/a.b+c(d) matches loosely or throws, or a `/` home hides every path of the cause; why_new=these cells were untested (F31); seam=none; no_claim=other metacharacter placements
test('a root with regular-expression characters is hidden only when it matches whole, and a root home hides nothing', () => {
  // Arrange
  const message =
    'open /srv/a.b+c(d)/x.ts and /srv/aXb+c(d)/x.ts and /etc/hosts'

  // Act
  const cause = sanitizeCause(message, {
    storage: [],
    workspace: '/srv/a.b+c(d)',
    home: '/',
  })

  // Assert
  assert.equal(
    cause,
    'open <workspace>/x.ts and /srv/aXb+c(d)/x.ts and /etc/hosts',
  )
})

// Value: protects=a workspace or home reached through a symlink; fails_when=the real path a message names survives because only the reported spelling is a root; why_new=causeRoots named the reported paths only (F58); seam=none; no_claim=how the service gathers the real paths
test('a root given by several names hides each of them', () => {
  // Arrange
  const message = 'EACCES /Volumes/work/repo/a.ts via /Users/ada/link/a.ts'

  // Act
  const cause = sanitizeCause(message, {
    storage: [],
    workspace: ['/Users/ada/link', '/Volumes/work/repo'],
  })

  // Assert
  assert.equal(cause, 'EACCES <workspace>/a.ts via <workspace>/a.ts')
})

// Value: protects=a storage folder inside another root that is also named by its macOS realpath alias: the path still reads <storage>; fails_when=the alias spelling (/private/var/…) counts its eight extra characters, so the enclosing workspace sorts before the storage folder and the path reads <workspace>/.cb/…; why_new=Cycle 0050 F214 (found by integrating F58's real paths with F49's test); seam=none; no_claim=which roots the service gathers
test('a storage folder inside a workspace named by both its spellings still reads as storage', () => {
  // Arrange
  const message = "ENOENT: open '/private/var/folders/ab/T/run-1/.cb/x/a.json'"

  // Act
  const cause = sanitizeCause(message, {
    storage: ['/var/folders/ab/T/run-1/.cb'],
    workspace: ['/var/folders/ab/T/run-1', '/private/var/folders/ab/T/run-1'],
  })

  // Assert
  assert.equal(cause, "ENOENT: open '<storage>/x/a.json'")
})
