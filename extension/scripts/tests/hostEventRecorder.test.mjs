import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { SAMPLE_CONTEXT, buildSampleTrace } from './utils/hostTraceSample.mjs'

const require = createRequire(import.meta.url)
const {
  EVENT_KINDS,
  buildHeader,
  createEventWriter,
  decideResume,
  sanitizeTab,
  sanitizeUri,
  snapshotTabGroups,
} = require('../../../tools/host-event-recorder/traceFormat.js')

const context = { workspaceFolders: [{ scheme: 'file', path: '/work/repo' }] }

// Value: protects=a public trace naming repository files by repository-relative path instead of the author's folders; fails_when=a file URI inside the workspace keeps its absolute path or loses its relative path; why_new=Cycle 0094 task 12 (recorder, eng review sanitizer proof); seam=none (pure function); no_claim=the recorder's choice of which URIs it passes in
test('a file inside the repository is recorded by its repository-relative path', () => {
  // Arrange
  const uri = { scheme: 'file', path: '/work/repo/src/a.ts' }

  // Act
  const sanitized = sanitizeUri(uri, context)

  // Assert
  assert.deepEqual(sanitized, { scheme: 'file', path: 'src/a.ts' })
})

// Value: protects=a trace never revealing a path outside the repository; fails_when=a URI outside the workspace (or in a sibling folder sharing the name prefix) keeps its path; why_new=Cycle 0094 task 12; seam=none; no_claim=none beyond protects
test('a URI outside the repository keeps only its scheme', () => {
  // Arrange
  const sibling = { scheme: 'file', path: '/work/repo2/src/a.ts' }
  const untitled = { scheme: 'untitled', path: 'Untitled-1' }
  const home = { scheme: 'file', path: '/home/alice/notes/todo.md' }

  // Act
  const results = [sibling, untitled, home].map((uri) =>
    sanitizeUri(uri, context),
  )

  // Assert
  assert.deepEqual(results, [
    { scheme: 'file' },
    { scheme: 'untitled', path: 'Untitled-1' },
    { scheme: 'file' },
  ])
})

// Value: protects=tab labels (file names) of resources outside the repository staying out of a public trace; fails_when=such a tab keeps its label; why_new=Cycle 0094 task 12; seam=none; no_claim=labels of tabs without a resource (webviews), which stay
test('the label of a tab outside the repository becomes its input kind', () => {
  // Arrange
  const tab = {
    label: 'secret-plans.md',
    isActive: false,
    isPreview: false,
    input: {
      kind: 'text',
      uri: { scheme: 'file', path: '/home/alice/secret-plans.md' },
    },
  }

  // Act
  const sanitized = sanitizeTab(tab, context)

  // Assert
  assert.equal(sanitized.label, 'text')
  assert.deepEqual(sanitized.input.uri, { scheme: 'file' })
})

// Value: protects=Codebook's own webview panels being identifiable in a trace; fails_when=a webview tab loses its viewType or its label; why_new=Cycle 0094 task 12; seam=none; no_claim=none beyond protects
test('a webview tab keeps its viewType and label in the snapshot', () => {
  // Arrange
  const groups = [
    {
      viewColumn: 2,
      isActive: true,
      tabs: [
        {
          label: 'Study',
          isActive: true,
          isPreview: false,
          input: {
            kind: 'webview',
            viewType: 'mainThreadWebview-codebook.study',
          },
        },
      ],
    },
  ]

  // Act
  const snapshot = snapshotTabGroups(groups, context)

  // Assert
  assert.deepEqual(snapshot, {
    groups: [
      {
        viewColumn: 2,
        isActive: true,
        tabs: [
          {
            label: 'Study',
            input: {
              kind: 'webview',
              viewType: 'mainThreadWebview-codebook.study',
            },
            isActive: true,
            isPreview: false,
          },
        ],
      },
    ],
  })
})

// Value: protects=a trace saying where and with what it was recorded; fails_when=a header field is missing; why_new=Cycle 0094 task 12; seam=none; no_claim=none beyond protects
test('the header names host, host version, OS, sequence, Codebook version, recorder version and start time', () => {
  // Arrange
  const fields = {
    host: 'Cursor',
    hostVersion: '3.27.0',
    os: 'darwin',
    sequence: 'arrange-restore',
    codebookVersion: '0.2.93.0',
    recorderVersion: '0.1.0',
    startTime: '2026-11-07T00:00:00.000Z',
  }

  // Act
  const header = buildHeader(fields)

  // Assert
  assert.deepEqual(header, { type: 'header', formatVersion: 1, ...fields })
})

// Value: protects=replay ordering by seq; fails_when=seq repeats, skips or restarts, or an event line holds more or less than one JSON object; why_new=Cycle 0094 task 12 (R5 rule 7); seam=none; no_claim=that the recorder's real listeners emit these kinds
test('events are written one JSON object per line with a monotonic seq and a full snapshot after each', () => {
  // Arrange
  const writer = createEventWriter({ context })
  const snapshot = {
    groups: [
      {
        viewColumn: 1,
        isActive: true,
        tabs: [
          {
            label: 'a.ts',
            isActive: true,
            isPreview: false,
            input: {
              kind: 'text',
              uri: { scheme: 'file', path: '/work/repo/a.ts' },
            },
          },
        ],
      },
    ],
  }

  // Act
  const lines = [
    ...writer.lines(
      'activeTextEditor',
      { uri: null, viewColumn: null },
      10,
      snapshot,
    ),
    ...writer.lines(
      'editorLayout',
      { layout: { orientation: 0, groups: [] } },
      20,
      snapshot,
    ),
  ]

  // Assert
  const parsed = lines.map((line) => {
    assert.ok(line.endsWith('\n') && !line.slice(0, -1).includes('\n'))
    return JSON.parse(line)
  })
  assert.deepEqual(
    parsed.map((line) => [line.seq, line.tMs, line.kind]),
    [
      [1, 10, 'activeTextEditor'],
      [2, 10, 'tabGroups'],
      [3, 20, 'editorLayout'],
      [4, 20, 'tabGroups'],
    ],
  )
  assert.deepEqual(parsed[1].data.groups[0].tabs[0].input.uri, {
    scheme: 'file',
    path: 'a.ts',
  })
})

// Value: protects=the recorder-side half of the trace format contract (eng review R6); fails_when=the serializer's bytes for the fixed sample events change, or a kind is renamed on this side only; why_new=Cycle 0094 task 12; seam=lane B2's replay parser test reads the same fixture file; no_claim=that the replay parser reads the file (that test is the parser lane's)
test('the serializer still writes exactly the committed sample trace holding every kind', () => {
  // Arrange
  const fixturePath = fileURLToPath(
    new URL('./fixtures/host-trace-sample.jsonl', import.meta.url),
  )

  // Act
  const written = buildSampleTrace()

  // Assert
  assert.equal(written, readFileSync(fixturePath, 'utf8'))
  const kinds = new Set(
    written
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).kind),
  )
  for (const kind of EVENT_KINDS)
    assert.ok(kinds.has(kind), `sample lacks ${kind}`)
  assert.deepEqual(EVENT_KINDS, [
    'tabGroups',
    'tabsChanged',
    'groupsChanged',
    'activeTextEditor',
    'visibleTextEditors',
    'selection',
    'editorLayout',
    'reload',
  ])
  assert.deepEqual(SAMPLE_CONTEXT.workspaceFolders, [
    { scheme: 'file', path: '/work/repo' },
  ])
})

// Value: protects=a Reload Window keeping the open take (eng review R10); fails_when=the next seq restarts, the unrecorded interval is not named, or the mark's start time is lost; why_new=Cycle 0094 task 12; seam=none (the caller passes the file facts); no_claim=that the editor keeps global state across a reload
test('an open take resumes with the next seq and a reload interval from its last line', () => {
  // Arrange
  const mark = {
    takeId: 't1',
    file: '/f.jsonl',
    sequence: 'reload',
    lastSeq: 10,
    startMs: 1_000,
  }

  // Act
  const decision = decideResume({
    mark,
    fileExists: true,
    lastLine: { seq: 12, tMs: 4_000 },
    nowMs: 9_000,
  })

  // Assert
  assert.deepEqual(decision, {
    action: 'resume',
    file: '/f.jsonl',
    nextSeq: 13,
    startMs: 1_000,
    reload: {
      unrecordedFromMs: 4_000,
      unrecordedToMs: 8_000,
      unrecordedMs: 4_000,
    },
  })
})

// Value: protects=no phantom take after a normal start; fails_when=activation without a mark starts or resumes a take; why_new=Cycle 0094 task 12; seam=none; no_claim=none beyond protects
test('activation without an open-take mark does not resume anything', () => {
  // Arrange / Act
  const decision = decideResume({
    mark: undefined,
    fileExists: false,
    lastLine: null,
    nowMs: 1,
  })

  // Assert
  assert.deepEqual(decision, { action: 'none' })
})

// Value: protects=a deleted take file being reported instead of silently resumed; fails_when=a mark whose file is gone resumes or starts without a notice; why_new=Cycle 0094 task 12; seam=none; no_claim=none beyond protects
test('a mark whose take file is missing starts a fresh take and says so', () => {
  // Arrange
  const mark = {
    takeId: 't1',
    file: '/gone.jsonl',
    sequence: 'arrange',
    lastSeq: 3,
    startMs: 1,
  }

  // Act
  const decision = decideResume({
    mark,
    fileExists: false,
    lastLine: null,
    nowMs: 100,
  })

  // Assert
  assert.deepEqual(decision, {
    action: 'fresh',
    sequence: 'arrange',
    notice:
      'The open take file /gone.jsonl is missing; a new take of "arrange" starts.',
  })
})
