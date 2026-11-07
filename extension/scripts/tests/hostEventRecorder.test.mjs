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
  readHostVersion,
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
  assert.equal(sanitized, 'src/a.ts')
})

// Value: protects=a trace never revealing a path outside the repository; fails_when=a URI outside the workspace (or in a sibling folder sharing the name prefix) keeps its path; why_new=Cycle 0094 task 12; seam=none; no_claim=none beyond protects
test('a URI outside the repository is left out of the trace', () => {
  // Arrange
  const sibling = { scheme: 'file', path: '/work/repo2/src/a.ts' }
  const untitled = { scheme: 'untitled', path: 'Untitled-1' }
  const home = { scheme: 'file', path: '/home/alice/notes/todo.md' }

  // Act
  const results = [sibling, untitled, home].map((uri) =>
    sanitizeUri(uri, context),
  )

  // Assert
  assert.deepEqual(results, [undefined, 'untitled:Untitled-1', undefined])
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
  assert.equal(sanitized.input.uri, undefined)
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
    activeGroupIndex: 0,
  })
})

// Value: protects=a trace saying where and with what it was recorded; fails_when=a header field is missing; why_new=Cycle 0094 task 12; seam=none; no_claim=none beyond protects
test('the header names host, host version, host API version, OS, sequence, Codebook version, recorder version and start time', () => {
  // Arrange
  const fields = {
    host: 'Cursor',
    hostVersion: '3.29.9',
    hostApiVersion: '1.128.0',
    os: 'darwin',
    sequence: 'arrange-restore',
    codebookVersion: '0.2.93.0',
    recorderVersion: '0.1.0',
    startedAt: '2026-11-07T00:00:00.000Z',
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
      { orientation: 0, groups: [] },
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
  assert.equal(parsed[1].data.groups[0].tabs[0].input.uri, 'a.ts')
})

// Value: protects=no absolute path leaking through a group event (the Cycle 0094 native take wrote full group objects with `/Users/...` tab inputs); fails_when=a groupsChanged payload keeps a group's tabs or any path outside groupIndex; why_new=Cycle 0094 task 12 sanitizer leak; seam=none (pure writer); no_claim=that the editor's real groupsChanged entries have this shape
test('a group event carrying tab inputs with absolute paths is written as group indexes only', () => {
  // Arrange
  const writer = createEventWriter({ context })
  const groupWithAbsolutePath = {
    groupIndex: 2,
    viewColumn: 3,
    isActive: false,
    tabs: [
      {
        label: 'data.ts',
        isActive: true,
        isPreview: false,
        input: {
          kind: 'text',
          uri: { scheme: 'file', path: '/work/repo/app/lib/data.ts' },
        },
      },
    ],
  }
  const snapshot = { groups: [] }

  // Act
  const [eventLine] = writer.lines(
    'groupsChanged',
    { opened: [], closed: [], changed: [groupWithAbsolutePath] },
    5,
    snapshot,
  )

  // Assert
  assert.deepEqual(JSON.parse(eventLine).data, {
    opened: [],
    closed: [],
    changed: [{ groupIndex: 2 }],
  })
  assert.ok(!eventLine.includes('/work/repo'))
})

// Value: protects=a tab event naming its group by index and its tab by label and kind, the shape the replay parser reads, with outside labels hidden; fails_when=tabsChanged writes groupViewColumn or a whole tab, or keeps the label of a file outside the repository; why_new=Cycle 0094 task 12 format decision; seam=the parser lane reads the committed sample; no_claim=none beyond protects
test('a tab event is written as groupIndex, label and input kind with the label of an outside file hidden', () => {
  // Arrange
  const writer = createEventWriter({ context })
  const insideTab = {
    label: 'a.ts',
    isActive: true,
    isPreview: false,
    input: { kind: 'text', uri: { scheme: 'file', path: '/work/repo/a.ts' } },
  }
  const outsideTab = {
    label: 'notes.md',
    isActive: false,
    isPreview: false,
    input: {
      kind: 'text',
      uri: { scheme: 'file', path: '/home/alice/notes.md' },
    },
  }

  // Act
  const [eventLine] = writer.lines(
    'tabsChanged',
    {
      opened: [{ groupIndex: 1, tab: insideTab }],
      closed: [{ groupIndex: 0, tab: outsideTab }],
      changed: [],
    },
    7,
    { groups: [] },
  )

  // Assert
  assert.deepEqual(JSON.parse(eventLine).data, {
    opened: [{ groupIndex: 1, label: 'a.ts', inputKind: 'text' }],
    closed: [{ groupIndex: 0, label: 'text', inputKind: 'text' }],
    changed: [],
  })
})

// Value: protects=the replay parser's input kinds and Codebook's own virtual documents staying matchable in a public trace; fails_when=a diff tab keeps the recorder-side kind textDiff, or a codebook-source tab loses its file name and label; why_new=Cycle 0094 task 12 format decision; seam=none; no_claim=other virtual schemes of other extensions, which stay out of the trace
test('a diff tab is written as kind diff and a codebook-source tab keeps its file name and label', () => {
  // Arrange
  const groups = [
    {
      viewColumn: 1,
      isActive: true,
      tabs: [
        {
          label: 'a.ts (Working Tree)',
          isActive: true,
          isPreview: false,
          input: {
            kind: 'textDiff',
            original: { scheme: 'file', path: '/work/repo/a.ts' },
            modified: { scheme: 'file', path: '/work/repo/b.ts' },
          },
        },
        {
          label: 'Captured-cards.tsx',
          isActive: false,
          isPreview: false,
          input: {
            kind: 'text',
            uri: {
              scheme: 'codebook-source',
              path: '/study/repository%2Fa/hash/app/ui/Captured-cards.tsx',
            },
          },
        },
      ],
    },
  ]

  // Act
  const [diffTab, virtualTab] = snapshotTabGroups(groups, context).groups[0]
    .tabs

  // Assert
  assert.deepEqual(diffTab.input, {
    kind: 'diff',
    original: 'a.ts',
    modified: 'b.ts',
  })
  assert.equal(virtualTab.label, 'Captured-cards.tsx')
  assert.equal(virtualTab.input.uri, 'codebook-source:Captured-cards.tsx')
})

// Value: protects=the trace header telling the editor product version, not the VS Code API version (Cursor 3.29.9 reported 1.128.0 through vscode.version); fails_when=the version is not read from product.json or a missing or broken file does not give unknown; why_new=Cycle 0094 task 12 host version; seam=extension.js reads product.json and passes the text; no_claim=that appRoot resolves to the product folder in every host
test('the host version is the product.json version and unknown when it cannot be read', () => {
  // Arrange
  const cursorProduct = '{"nameShort":"Cursor","version":"3.29.12"}'

  // Act
  const versions = [
    readHostVersion(cursorProduct),
    readHostVersion(undefined),
    readHostVersion('not json'),
    readHostVersion('{"nameShort":"Cursor"}'),
  ]

  // Assert
  assert.deepEqual(versions, ['3.29.12', 'unknown', 'unknown', 'unknown'])
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
    'mark',
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

// Value: protects=a take's step boundaries: the recorder writing the author's label as a mark event with a snapshot after it, which the replay cuts windows at; fails_when=a mark loses its label, keeps extra fields, or is written without the snapshot that follows every event; why_new=Cycle 0094 task 12 (contract revision R13, recorder marks); seam=createEventWriter; no_claim=that the Mark command's input box reaches the writer (extension.js needs a host)
test('a mark is written with only its label and a snapshot of the tab groups after it', () => {
  // Arrange
  const writer = createEventWriter({ context })
  const snapshot = { groups: [{ viewColumn: 1, isActive: true, tabs: [] }] }

  // Act
  const lines = writer
    .lines(
      'mark',
      { label: 'arrange', secret: '/Users/alice' },
      95_270,
      snapshot,
    )
    .map((line) => JSON.parse(line))

  // Assert
  assert.deepEqual(lines, [
    { seq: 1, tMs: 95270, kind: 'mark', data: { label: 'arrange' } },
    {
      seq: 2,
      tMs: 95270,
      kind: 'tabGroups',
      data: {
        groups: [{ viewColumn: 1, isActive: true, tabs: [] }],
        activeGroupIndex: 0,
      },
    },
  ])
})

// Value: protects=Cursor chat tab titles (user prompts) staying out of a public trace; fails_when=a tab without any resource and with input kind unknown or terminal keeps its label in a snapshot, a tab event or a re-sanitized written line; why_new=Cycle 0094 task 12 review finding (resource-less labels); seam=none; no_claim=webview and custom tabs, which keep their labels
test('the label of a tab without a resource and of kind unknown or terminal becomes its input kind', () => {
  // Arrange
  const chatTab = {
    label: 'Dashboard total amount calculation',
    isActive: true,
    isPreview: false,
    input: { kind: 'unknown' },
  }
  const terminalTab = {
    label: 'zsh - /Users/alice',
    isActive: false,
    isPreview: false,
    input: { kind: 'terminal' },
  }
  const writer = createEventWriter({ context })

  // Act
  const snapshot = snapshotTabGroups(
    [{ viewColumn: 1, isActive: true, tabs: [chatTab, terminalTab] }],
    context,
  )
  const [eventLine] = writer.lines(
    'tabsChanged',
    {
      opened: [{ groupIndex: 0, tab: chatTab }],
      closed: [],
      // An already written entry, as a committed fixture holds it.
      changed: [
        {
          groupIndex: 0,
          label: 'Invoice update process',
          inputKind: 'unknown',
        },
      ],
    },
    3,
    { groups: [] },
  )

  // Assert
  assert.deepEqual(
    snapshot.groups[0].tabs.map((tab) => tab.label),
    ['unknown', 'terminal'],
  )
  assert.deepEqual(JSON.parse(eventLine).data, {
    opened: [{ groupIndex: 0, label: 'unknown', inputKind: 'unknown' }],
    closed: [],
    changed: [{ groupIndex: 0, label: 'unknown', inputKind: 'unknown' }],
  })
})

// Value: protects=a Windows-built codebook-source URI keeping only its file name; fails_when=a backslash separated path keeps its folders in the written uri; why_new=Cycle 0094 task 12 review finding (separator split); seam=none; no_claim=none beyond protects
test('a codebook-source uri with backslash separators keeps only its file name', () => {
  // Arrange
  const uri = {
    scheme: 'codebook-source',
    path: '\\study\\repository\\app\\ui\\Captured-cards.tsx',
  }

  // Act
  const sanitized = sanitizeUri(uri, context)

  // Assert
  assert.equal(sanitized, 'codebook-source:Captured-cards.tsx')
})

// Value: protects=a mark label or sequence name never carrying a path or a name into a trace; fails_when=a label with slashes, a name or more than 64 characters is written as typed; why_new=Cycle 0094 task 12 review finding (label charset); seam=none; no_claim=the input box validation (hostEventRecorderExtension.test.mjs)
test('a mark label and a header sequence keep only letters, digits, dash, underscore, dot and space and at most 64 characters', () => {
  // Arrange
  const writer = createEventWriter({ context })
  const snapshot = { groups: [] }

  // Act
  const [markLine] = writer.lines(
    'mark',
    { label: '/Users/alice/open study' },
    1,
    snapshot,
  )
  const [longLine] = writer.lines(
    'mark',
    { label: 'a'.repeat(100) },
    2,
    snapshot,
  )
  const header = buildHeader({
    host: 'Cursor',
    hostVersion: '3.29.9',
    hostApiVersion: '1.128.0',
    os: 'darwin',
    sequence: 'C:\\work\\arrange',
    codebookVersion: '0.2.93.0',
    recorderVersion: '0.1.0',
    startedAt: '2026-11-07T00:00:00.000Z',
  })

  // Assert
  assert.equal(JSON.parse(markLine).data.label, '-Users-alice-open study')
  assert.equal(JSON.parse(longLine).data.label, 'a'.repeat(64))
  assert.equal(header.sequence, 'C--work-arrange')
})

// Value: protects=an event carrying only the fields its kind defines; fails_when=an unknown field on an editor, selection, reload or layout payload, a tab or a tab input reaches the written line; why_new=Cycle 0094 task 12 review finding (field allow-list); seam=none; no_claim=fields a future format version adds
test('every event kind writes only its own fields and drops unknown ones', () => {
  // Arrange
  const writer = createEventWriter({ context })
  const snapshot = {
    groups: [
      {
        viewColumn: 1,
        isActive: true,
        extraGroupField: 'x',
        tabs: [
          {
            label: 'a.ts',
            isActive: true,
            isPreview: false,
            tooltip: '/Users/alice/a.ts',
            input: {
              kind: 'text',
              uri: { scheme: 'file', path: '/work/repo/a.ts' },
              extra: 'x',
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
      { uri: null, viewColumn: 1, secret: 'x' },
      1,
      snapshot,
    ),
    ...writer.lines(
      'selection',
      {
        uri: { scheme: 'file', path: '/work/repo/a.ts' },
        viewColumn: 1,
        selectionKind: 3,
        secret: 'x',
        selections: [
          {
            anchor: { line: 1, character: 2, secret: 'x' },
            active: { line: 3, character: 4 },
            secret: 'x',
          },
        ],
      },
      2,
      snapshot,
    ),
    ...writer.lines(
      'reload',
      {
        unrecordedFromMs: 1,
        unrecordedToMs: 5,
        unrecordedMs: 4,
        secret: 'x',
      },
      3,
      snapshot,
    ),
    ...writer.lines(
      'editorLayout',
      { orientation: 1, groups: [{ size: 1, secret: 'x' }], secret: 'x' },
      4,
      snapshot,
    ),
  ].map((line) => JSON.parse(line))

  // Assert
  const dataOf = (kind) => lines.find((line) => line.kind === kind).data
  assert.deepEqual(dataOf('activeTextEditor'), { viewColumn: 1 })
  assert.deepEqual(dataOf('selection'), {
    uri: 'a.ts',
    viewColumn: 1,
    selectionKind: 3,
    selections: [
      { anchor: { line: 1, character: 2 }, active: { line: 3, character: 4 } },
    ],
  })
  assert.deepEqual(dataOf('reload'), {
    unrecordedFromMs: 1,
    unrecordedToMs: 5,
    unrecordedMs: 4,
  })
  assert.deepEqual(dataOf('editorLayout'), {
    orientation: 1,
    groups: [{ size: 1 }],
  })
  assert.deepEqual(dataOf('tabGroups'), {
    groups: [
      {
        viewColumn: 1,
        isActive: true,
        tabs: [
          {
            label: 'a.ts',
            input: { kind: 'text', uri: 'a.ts' },
            isActive: true,
            isPreview: false,
          },
        ],
      },
    ],
    activeGroupIndex: 0,
  })
})
