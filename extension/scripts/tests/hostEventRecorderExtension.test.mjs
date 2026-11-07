import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createMemento, loadRecorder } from './utils/fakeVscodeForRecorder.mjs'

/** Makes a workspace folder removed (with retries, as a still-closing file can delay it) when the test ends. */
async function workspaceFolder(context) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-recorder-ext-'))
  context.after(() =>
    rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    }),
  )
  return directory
}

/** Writes a take file with the given text and returns the open-take mark that names it. */
async function writeOpenTake(workspacePath, text) {
  const folder = join(workspacePath, '.codebook-host-traces')
  await mkdir(folder, { recursive: true })
  const file = join(folder, 'take.jsonl')
  await writeFile(file, text)
  return {
    takeId: 't1',
    file,
    sequence: 'reload',
    lastSeq: 1,
    startMs: Date.now() - 1000,
  }
}

const HEADER = `${JSON.stringify({ type: 'header', formatVersion: 1, sequence: 'reload' })}\n`
const GOOD_LINE = `${JSON.stringify({ seq: 1, tMs: 5, kind: 'mark', data: { label: 'a' } })}\n`

/** Parses every line of a take file; a line that is not JSON throws, which fails the test. */
async function parsedLines(file) {
  const text = await readFile(file, 'utf8')
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

// Value: protects=an open take staying with the workspace that recorded it (the editor's global state is read by every window of the extension); fails_when=opening another folder resumes the previous take and appends that window's events to its file; why_new=Cycle 0094 task 12 review finding (take mark scope); seam=the real extension.js against a fake vscode module; no_claim=that the real editor scopes workspaceState per folder
test('opening another workspace does not resume or write into the open take of the first one', async (context) => {
  // Arrange
  const workspaceA = await workspaceFolder(context)
  const workspaceB = await workspaceFolder(context)
  const globalState = createMemento()
  const windowA = loadRecorder({
    workspacePath: workspaceA,
    globalState,
    workspaceState: createMemento(),
    inputs: ['sequence-a'],
  })
  await windowA.recorder.activate(windowA.context)
  await windowA.commands.get('codebookHostRecorder.start')()
  const [takeA] = (
    await readdir(join(workspaceA, '.codebook-host-traces'))
  ).filter((name) => name.endsWith('.jsonl'))
  const takeAPath = join(workspaceA, '.codebook-host-traces', takeA)
  const linesBefore = (await readFile(takeAPath, 'utf8')).split('\n').length

  // Act
  const windowB = loadRecorder({
    workspacePath: workspaceB,
    globalState,
    workspaceState: createMemento(),
  })
  await windowB.recorder.activate(windowB.context)
  await windowB.commands.get('codebookHostRecorder.stop')()

  // Assert
  const linesAfter = (await readFile(takeAPath, 'utf8')).split('\n').length
  assert.equal(linesAfter, linesBefore)
  await assert.rejects(readdir(join(workspaceB, '.codebook-host-traces')))
  await windowA.commands.get('codebookHostRecorder.stop')()
})

// Value: protects=Reload Window still resuming the open take of the same workspace; fails_when=a window reopening the recording folder starts nothing or restarts seq; why_new=Cycle 0094 task 12 review finding (take mark scope); seam=the real extension.js against a fake vscode module; no_claim=that the editor keeps workspaceState across a reload
test('reopening the same workspace resumes its open take with the next seq and a reload marker', async (context) => {
  // Arrange
  const workspace = await workspaceFolder(context)
  const workspaceState = createMemento()
  const globalState = createMemento()
  const first = loadRecorder({
    workspacePath: workspace,
    globalState,
    workspaceState,
    inputs: ['reload'],
  })
  await first.recorder.activate(first.context)
  await first.commands.get('codebookHostRecorder.start')()
  const [name] = (
    await readdir(join(workspace, '.codebook-host-traces'))
  ).filter((entry) => entry.endsWith('.jsonl'))
  const file = join(workspace, '.codebook-host-traces', name)
  const seqBefore = (await parsedLines(file))
    .filter((line) => line.seq)
    .at(-1).seq

  // Act
  const second = loadRecorder({
    workspacePath: workspace,
    globalState,
    workspaceState,
  })
  await second.recorder.activate(second.context)
  await second.commands.get('codebookHostRecorder.stop')()

  // Assert
  const lines = (await parsedLines(file)).filter((line) => line.seq)
  const reload = lines.find((line) => line.kind === 'reload')
  assert.equal(reload.seq, seqBefore + 1)
  assert.deepEqual(
    lines.map((line) => line.seq),
    lines.map((_, index) => index + 1),
  )
})

// Value: protects=a take file staying valid JSON lines after a crash in the middle of a write; fails_when=resume appends the reload line directly after a half-written last line; why_new=Cycle 0094 task 12 review finding (partial last line); seam=the real extension.js against a fake vscode module; no_claim=a crash during the repair itself
test('a resumed take whose last line was cut mid-write drops the cut line and keeps every line parsable', async (context) => {
  // Arrange
  const workspace = await workspaceFolder(context)
  const mark = await writeOpenTake(
    workspace,
    `${HEADER}${GOOD_LINE}{"seq":2,"tMs":9,"ki`,
  )
  const workspaceState = createMemento()
  await workspaceState.update('codebookHostRecorder.openTake', mark)
  const window = loadRecorder({
    workspacePath: workspace,
    globalState: createMemento(),
    workspaceState,
  })

  // Act
  await window.recorder.activate(window.context)
  await window.commands.get('codebookHostRecorder.stop')()

  // Assert
  const lines = (await parsedLines(mark.file)).filter((line) => line.seq)
  assert.deepEqual(
    lines.slice(0, 2).map((line) => [line.seq, line.kind]),
    [
      [1, 'mark'],
      [2, 'reload'],
    ],
  )
})

// Value: protects=a complete last line that only lacks its newline being kept, not discarded; fails_when=resume glues the next line onto it or throws its event away; why_new=Cycle 0094 task 12 review finding (partial last line); seam=the real extension.js against a fake vscode module; no_claim=none beyond protects
test('a resumed take whose last line is complete but unterminated keeps that line and ends it with a newline', async (context) => {
  // Arrange
  const workspace = await workspaceFolder(context)
  const unterminated = JSON.stringify({
    seq: 2,
    tMs: 9,
    kind: 'mark',
    data: { label: 'b' },
  })
  const mark = await writeOpenTake(
    workspace,
    `${HEADER}${GOOD_LINE}${unterminated}`,
  )
  const workspaceState = createMemento()
  await workspaceState.update('codebookHostRecorder.openTake', mark)
  const window = loadRecorder({
    workspacePath: workspace,
    globalState: createMemento(),
    workspaceState,
  })

  // Act
  await window.recorder.activate(window.context)
  await window.commands.get('codebookHostRecorder.stop')()

  // Assert
  const lines = (await parsedLines(mark.file)).filter((line) => line.seq)
  assert.deepEqual(
    lines.slice(0, 3).map((line) => [line.seq, line.kind]),
    [
      [1, 'mark'],
      [2, 'mark'],
      [3, 'reload'],
    ],
  )
})

// Value: protects=a take folder that no repository can commit by accident (only Codebook's own .gitignore lists it); fails_when=starting a take creates the folder without a .gitignore holding *, or overwrites a .gitignore already there; why_new=Cycle 0094 task 12 review finding (private output folder); seam=the real extension.js against a fake vscode module; no_claim=that git honours the file
test('starting a take writes a .gitignore with * into the new take folder and never overwrites an existing one', async (context) => {
  // Arrange
  const fresh = await workspaceFolder(context)
  const existing = await workspaceFolder(context)
  await mkdir(join(existing, '.codebook-host-traces'))
  await writeFile(
    join(existing, '.codebook-host-traces', '.gitignore'),
    'mine\n',
  )
  const startIn = async (workspacePath) => {
    const window = loadRecorder({
      workspacePath,
      globalState: createMemento(),
      workspaceState: createMemento(),
      inputs: ['seq'],
    })
    await window.recorder.activate(window.context)
    await window.commands.get('codebookHostRecorder.start')()
    await window.commands.get('codebookHostRecorder.stop')()
  }

  // Act
  await startIn(fresh)
  await startIn(existing)

  // Assert
  assert.equal(
    await readFile(join(fresh, '.codebook-host-traces', '.gitignore'), 'utf8'),
    '*\n',
  )
  assert.equal(
    await readFile(
      join(existing, '.codebook-host-traces', '.gitignore'),
      'utf8',
    ),
    'mine\n',
  )
})

// Value: protects=a failing disk write being shown to the author instead of crashing the event listener or leaving an unhandled rejection; fails_when=an append error propagates out of the tab listener or is not shown; why_new=Cycle 0094 task 12 review finding (append failure); seam=the real extension.js against a fake vscode module; no_claim=recovery of the lost lines
test('a failed append is shown as an error message and does not throw from the editor listener', async (context) => {
  // Arrange
  const workspace = await workspaceFolder(context)
  const window = loadRecorder({
    workspacePath: workspace,
    globalState: createMemento(),
    workspaceState: createMemento(),
    inputs: ['seq'],
  })
  await window.recorder.activate(window.context)
  await window.commands.get('codebookHostRecorder.start')()
  await rm(join(workspace, '.codebook-host-traces'), {
    recursive: true,
    force: true,
  })

  // Act
  window.fire.tabs({ opened: [], closed: [], changed: [] })
  await window.commands.get('codebookHostRecorder.stop')()

  // Assert
  assert.equal(
    window.messages.filter((message) => message.kind === 'error').length,
    1,
  )
})

// Value: protects=sequence names and mark labels that cannot carry a path or a name into a trace; fails_when=the input box accepts text outside letters, digits, dash, underscore, dot and space, or accepts more than 64 characters; why_new=Cycle 0094 task 12 review finding (label charset); seam=the real extension.js against a fake vscode module; no_claim=that the pure writer's own replacement is exercised here (hostEventRecorder.test.mjs)
test('the sequence name and mark label inputs reject text outside the safe charset', async (context) => {
  // Arrange
  const workspace = await workspaceFolder(context)
  const window = loadRecorder({
    workspacePath: workspace,
    globalState: createMemento(),
    workspaceState: createMemento(),
    inputs: ['seq', 'step'],
  })
  await window.recorder.activate(window.context)

  // Act
  await window.commands.get('codebookHostRecorder.start')()
  await window.commands.get('codebookHostRecorder.mark')()
  await window.commands.get('codebookHostRecorder.stop')()
  const validators = window.inputOptions.map((options) => options.validateInput)

  // Assert
  assert.equal(validators.length, 2)
  for (const validate of validators) {
    assert.equal(typeof validate, 'function')
    assert.equal(validate('open study_1.2'), undefined)
    assert.equal(typeof validate('/Users/alice'), 'string')
    assert.equal(typeof validate('a\\b'), 'string')
    assert.equal(typeof validate('x'.repeat(65)), 'string')
    assert.equal(typeof validate(''), 'string')
  }
})

// Value: protects=a hand-edited or stale workspace-state mark never making the recorder append to a file outside the workspace's take folder; fails_when=a mark naming another path is resumed (its file is repaired, appended to, or kept as the open take); why_new=Cycle 0094 task 12 /ship pass 1 finding (resume mark trust); seam=the real extension.js against a fake vscode module; no_claim=that the editor can produce such a mark
test('a resumed mark naming a file outside the take folder is cleared and its file is left untouched', async (context) => {
  // Arrange
  const workspace = await workspaceFolder(context)
  const elsewhere = await workspaceFolder(context)
  const outsideFile = join(elsewhere, 'victim.jsonl')
  const original = `${HEADER}${GOOD_LINE}{"seq":2,"tMs`
  await writeFile(outsideFile, original)
  const workspaceState = createMemento()
  await workspaceState.update('codebookHostRecorder.openTake', {
    takeId: 't1',
    file: outsideFile,
    sequence: 'reload',
    lastSeq: 1,
    startMs: Date.now() - 1000,
  })
  const window = loadRecorder({
    workspacePath: workspace,
    globalState: createMemento(),
    workspaceState,
  })

  // Act
  await window.recorder.activate(window.context)
  window.fire.tabs({ opened: [], closed: [], changed: [] })
  await window.commands.get('codebookHostRecorder.stop')()

  // Assert
  assert.equal(await readFile(outsideFile, 'utf8'), original)
  assert.equal(workspaceState.get('codebookHostRecorder.openTake'), undefined)
})

// Value: protects=one take per start; fails_when=a second start command, run while the first one's sequence name box is still open, opens a second box and its take replaces the first (orphaned file and timer); why_new=Cycle 0094 task 12 /ship pass 1 finding (start race); seam=the real extension.js against a fake vscode module with an input box that answers later; no_claim=the real input box UI
test('a second start while the first sequence name box is open is refused and creates one take only', async (context) => {
  // Arrange
  const workspace = await workspaceFolder(context)
  const answers = []
  const window = loadRecorder({
    workspacePath: workspace,
    globalState: createMemento(),
    workspaceState: createMemento(),
    inputBox: () => new Promise((resolve) => answers.push(resolve)),
  })
  await window.recorder.activate(window.context)
  const start = window.commands.get('codebookHostRecorder.start')

  // Act
  const first = start()
  const second = start()
  await second
  for (const answer of answers) answer('seq')
  await first
  await window.commands.get('codebookHostRecorder.stop')()

  // Assert
  assert.equal(answers.length, 1)
  assert.equal(
    window.messages.filter((message) => message.kind === 'warning').length,
    1,
  )
  const files = (
    await readdir(join(workspace, '.codebook-host-traces'))
  ).filter((name) => name.endsWith('.jsonl'))
  assert.equal(files.length, 1)
})

// Value: protects=a stopped take taking no more events and a later take receiving none of its layout reads; fails_when=an editor event while stop waits for the final layout read is still recorded into the stopping take or schedules a read that lands in the next take; why_new=Cycle 0094 task 12 /ship pass 1 outside-voice finding (stop drain); seam=the real extension.js against a fake vscode module whose layout read answers later; no_claim=ordering of reads the editor itself delays
test('an editor event during the final layout read of a stopping take is not recorded and nothing of it reaches the next take', async (context) => {
  // Arrange
  const workspace = await workspaceFolder(context)
  let releaseFinalRead
  let isGateOn = false
  const window = loadRecorder({
    workspacePath: workspace,
    globalState: createMemento(),
    workspaceState: createMemento(),
    inputs: ['take-a', 'take-b'],
    layoutRead: () =>
      isGateOn
        ? new Promise((resolve) => {
            releaseFinalRead = () =>
              resolve({ orientation: 1, groups: [{ size: 1 }] })
          })
        : { orientation: 0, groups: [{ size: 1 }] },
  })
  await window.recorder.activate(window.context)
  const folder = join(workspace, '.codebook-host-traces')
  const kindsOf = async (prefix) => {
    const name = (await readdir(folder)).find(
      (entry) => entry.startsWith(prefix) && entry.endsWith('.jsonl'),
    )
    return (await parsedLines(join(folder, name)))
      .filter((line) => line.kind)
      .map((line) => line.kind)
  }
  await window.commands.get('codebookHostRecorder.start')()

  // Act
  isGateOn = true
  const stopping = window.commands.get('codebookHostRecorder.stop')()
  // Let stop reach its awaited final read before the editor event fires.
  await new Promise((resolve) => setTimeout(resolve, 20))
  window.fire.tabs({ opened: [], closed: [], changed: [] })
  releaseFinalRead()
  await stopping
  isGateOn = false
  await window.commands.get('codebookHostRecorder.start')()
  await new Promise((resolve) => setTimeout(resolve, 150))
  await window.commands.get('codebookHostRecorder.stop')()

  // Assert
  // Start and stop each write a snapshot, a layout and the snapshot that follows the layout; no tabsChanged line and no third layout.
  const expected = [
    'tabGroups',
    'editorLayout',
    'tabGroups',
    'tabGroups',
    'editorLayout',
    'tabGroups',
  ]
  assert.deepEqual(await kindsOf('take-a'), expected)
  assert.deepEqual(await kindsOf('take-b'), expected)
})
