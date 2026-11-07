import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  buildHeader,
  createEventWriter,
  serializeLine,
} = require('../../../../tools/host-event-recorder/traceFormat.js')

/** The sanitizing context of the sample: one workspace folder. */
export const SAMPLE_CONTEXT = {
  workspaceFolders: [{ scheme: 'file', path: '/work/repo' }],
}

/** Two groups: an in-repository file and a file outside the repository on the left, a Codebook webview on the right. */
const SAMPLE_GROUPS = [
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
          uri: { scheme: 'file', path: '/work/repo/src/a.ts' },
        },
      },
      {
        label: 'todo.md',
        isActive: false,
        isPreview: true,
        input: {
          kind: 'text',
          uri: { scheme: 'file', path: '/home/alice/notes/todo.md' },
        },
      },
      {
        label: 'Captured-a.ts',
        isActive: false,
        isPreview: false,
        input: {
          kind: 'text',
          uri: {
            scheme: 'codebook-source',
            path: '/study-id/repository%2Fa/hash/src/Captured-a.ts',
          },
        },
      },
    ],
  },
  {
    viewColumn: 2,
    isActive: false,
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

/**
 * Builds the sample trace from fixed fake events with the recorder's serializer: one event of every kind.
 *
 * The committed file `fixtures/host-trace-sample.jsonl` is this function's output; the recorder-side test compares them, and the replay parser's test reads the same file.
 *
 * @returns {string} The whole JSONL text.
 */
export function buildSampleTrace() {
  const writer = createEventWriter({ context: SAMPLE_CONTEXT })
  const emit = (kind, data, tMs) =>
    writer.lines(kind, data, tMs, { groups: SAMPLE_GROUPS }).join('')
  const uri = { scheme: 'file', path: '/work/repo/src/a.ts' }
  const closedTab = {
    label: 'todo.md',
    isActive: false,
    isPreview: true,
    input: {
      kind: 'text',
      uri: { scheme: 'file', path: '/home/alice/notes/todo.md' },
    },
  }
  return [
    serializeLine(
      buildHeader({
        host: 'Visual Studio Code',
        hostVersion: '1.142.0',
        hostApiVersion: '1.142.0',
        os: 'darwin',
        sequence: 'sample',
        codebookVersion: '0.2.93.0',
        recorderVersion: '0.1.0',
        startedAt: '2026-11-07T00:00:00.000Z',
      }),
    ),
    emit('tabGroups', { groups: SAMPLE_GROUPS }, 0),
    emit(
      'tabsChanged',
      {
        opened: [],
        closed: [{ groupIndex: 0, tab: closedTab }],
        changed: [{ groupIndex: 0, tab: SAMPLE_GROUPS[0].tabs[0] }],
      },
      40,
    ),
    emit(
      'groupsChanged',
      // The writer keeps only groupIndex of a group entry, whatever else the entry carries.
      {
        opened: [],
        closed: [],
        changed: [{ groupIndex: 1, ...SAMPLE_GROUPS[1] }],
      },
      46,
    ),
    emit('activeTextEditor', { uri, viewColumn: 1 }, 90),
    emit('visibleTextEditors', [{ uri, viewColumn: 1 }], 90),
    emit(
      'selection',
      {
        uri,
        viewColumn: 1,
        selectionKind: 2,
        selections: [
          {
            anchor: { line: 3, character: 0 },
            active: { line: 3, character: 5 },
          },
        ],
      },
      120,
    ),
    emit(
      'editorLayout',
      { orientation: 0, groups: [{ size: 0.5 }, { size: 0.5 }] },
      170,
    ),
    emit(
      'reload',
      { unrecordedFromMs: 170, unrecordedToMs: 2170, unrecordedMs: 2000 },
      2170,
    ),
    emit('tabGroups', { groups: SAMPLE_GROUPS }, 2170),
  ].join('')
}
