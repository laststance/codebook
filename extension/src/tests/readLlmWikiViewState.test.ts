import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  readLlmWikiViewState,
  type LlmWikiViewFacts,
  type LlmWikiViewWording,
} from '../utils/readLlmWikiViewState'

type ReadyFacts = Extract<LlmWikiViewFacts, { kind: 'ready' }>

const START_MS = Date.UTC(2026, 9, 26, 12, 0, 0)
const MINUTE_MS = 60_000
const wording: LlmWikiViewWording = {
  formatTime: (epochMs) => new Date(epochMs).toISOString().slice(11, 16),
  formatDate: () => 'Oct 26, 2026',
}

/** A ready window twelve minutes after the run started, in VS Code, with no Wiki and no run. */
function ready(overrides: Partial<ReadyFacts> = {}): ReadyFacts {
  return {
    kind: 'ready',
    host: 'vscode',
    repositoryName: 'nextjs-dashboard',
    outputLabel: '.codebook/wiki',
    outputDirectory: '/repo/.codebook/wiki',
    nowMs: START_MS + 12 * MINUTE_MS,
    ...overrides,
  }
}

const publishedWiki: ReadyFacts['wiki'] = {
  freshness: { status: 'current' },
  generation: {
    revision: '1936e41913729663cc99081e3224db89bb2d8e56',
    publishedAtMs: START_MS,
  },
}
const generationRun: ReadyFacts['run'] = {
  kind: 'generate',
  startedAtMs: START_MS,
  timeoutMs: 3_300_000,
  isAwaitingChat: false,
}

/** The ids of the rows of a model, in order. */
const idsOf = (facts: LlmWikiViewFacts): string[] =>
  readLlmWikiViewState(facts, wording).rows.map((row) => row.id)

// Value: protects=AC 2 (folder and trust rows); fails_when=a window without a folder shows no way to open one, or an untrusted folder shows no way to manage trust; no_claim=what the commands do; seam=the pure row function
test('a window without a folder offers Open Folder and an untrusted folder offers Manage Workspace Trust', () => {
  // Arrange
  const noFolder: LlmWikiViewFacts = { kind: 'no-folder' }
  const untrusted: LlmWikiViewFacts = { kind: 'untrusted' }

  // Act
  const rows = [noFolder, untrusted].map(
    (facts) => readLlmWikiViewState(facts, wording).rows[0],
  )

  // Assert
  assert.deepEqual(
    rows.map((row) => [row?.id, row?.label, row?.actions]),
    [
      ['folder', 'Open a folder to use the LLM Wiki', ['open-folder']],
      ['trust', 'Trust this folder to use the LLM Wiki', ['manage-trust']],
    ],
  )
})

// Value: protects=AC 1 (empty state shows the welcome); fails_when=a folder with no Wiki and no run returns a row or leaves state other, so the welcome content never shows; no_claim=the welcome text (manifest test); seam=the pure row function
test('a folder with no Wiki and no run has no rows and state none so the welcome content shows', () => {
  // Arrange
  const facts = ready()

  // Act
  const model = readLlmWikiViewState(facts, wording)

  // Assert
  assert.deepEqual(model, { state: 'none', rows: [] })
})

// Value: protects=AC 2 row 1; fails_when=the Wiki row loses its label, the reader's freshness wording, the generation tooltip, the open command or the Update action; no_claim=the browser opening; seam=the pure row function
test('a published Wiki shows its folder name, the reader freshness label, its generation and opens in the browser', () => {
  // Arrange
  const facts = ready({ wiki: publishedWiki })

  // Act
  const model = readLlmWikiViewState(facts, wording)

  // Assert
  assert.deepEqual(model.rows[0], {
    id: 'wiki',
    label: 'nextjs-dashboard Wiki',
    description: 'Wiki source current',
    tooltip:
      'Generated from 1936e41 on Oct 26, 2026\nClick to open the Wiki in the browser.',
    icon: 'book',
    command: { command: 'codebook.openDeepWiki' },
    actions: ['update'],
  })
  assert.equal(model.state, 'other')
})

// Value: protects=AC 2 (row 1 description takes each freshness label); fails_when=a freshness answer gets another wording than the reader page; no_claim=the freshness check; seam=the pure row function
test('the Wiki row takes the checking, changed, unknown and no-Git freshness labels', () => {
  // Arrange
  const descriptionFor = (
    freshness: NonNullable<ReadyFacts['wiki']>['freshness'],
  ) =>
    readLlmWikiViewState(
      ready({ wiki: { ...publishedWiki, freshness } }),
      wording,
    ).rows[0]?.description

  // Act
  const descriptions = [
    descriptionFor({ status: 'checking' }),
    descriptionFor({ status: 'changed' }),
    descriptionFor({ status: 'unknown', reason: 'Git is not installed.' }),
    descriptionFor({ status: 'current', isAdditionUnchecked: true }),
  ]

  // Assert
  assert.deepEqual(descriptions, [
    'Checking freshness…',
    'Source changed · Update available',
    'Wiki freshness unknown: Git is not installed.',
    'Wiki source current (no Git revision recorded, so added files are not checked)',
  ])
})

// Value: protects=AC 10 (accepted X1), the four forms of the generation line; fails_when=a form names the wrong revision or date, keeps a short non-commit revision, or shows a line when neither is known; no_claim=the manifest read; seam=the pure row function
test('the Wiki row tooltip names the generation in each of its four forms', () => {
  // Arrange
  const tooltipFor = (
    generation: NonNullable<ReadyFacts['wiki']>['generation'],
  ) =>
    readLlmWikiViewState(
      ready({ wiki: { freshness: { status: 'current' }, generation } }),
      wording,
    ).rows[0]?.tooltip?.split('\n')[0]
  const revision = '1936e41913729663cc99081e3224db89bb2d8e56'

  // Act
  const lines = [
    tooltipFor({ revision, publishedAtMs: START_MS }),
    tooltipFor({ publishedAtMs: START_MS }),
    tooltipFor({ revision: 'main', publishedAtMs: START_MS }),
    tooltipFor({ revision }),
    tooltipFor({}),
  ]

  // Assert
  assert.deepEqual(lines, [
    'Generated from 1936e41 on Oct 26, 2026',
    'Generated on Oct 26, 2026 (no Git revision)',
    'Generated on Oct 26, 2026 (no Git revision)',
    'Generated from 1936e41',
    'Click to open the Wiki in the browser.',
  ])
})

// Value: protects=AC 2 (row 1 stays beside row 2 and a published Wiki can be read during an update); fails_when=the Wiki row disappears during a run, or still offers Update beside it; no_claim=the update's own refusal; seam=the pure row function
test('the Wiki row stays beside a running update and hides its Update action', () => {
  // Arrange
  const facts = ready({
    wiki: publishedWiki,
    run: { ...generationRun, kind: 'update', timeoutMs: 900_000 },
  })

  // Act
  const model = readLlmWikiViewState(facts, wording)

  // Assert
  assert.deepEqual(
    model.rows.map((row) => [row.id, row.actions]),
    [
      ['wiki', []],
      ['run', ['stop-watching', 'open-chat', 'show-output']],
      ['output', ['change-location']],
    ],
  )
})

// Value: protects=AC 2 row 2 in VS Code; fails_when=the run row loses Stop watching, Open Chat or Show Output as inline actions, shows them as its click, or words the chat progress wrongly; no_claim=the status bar entry; seam=the pure row function
test('a VS Code generation row shows the chat progress and carries Stop watching, Open Chat and Show Output', () => {
  // Arrange
  const facts = ready({ run: generationRun })

  // Act
  const row = readLlmWikiViewState(facts, wording).rows[0]

  // Assert
  assert.deepEqual(row, {
    id: 'run',
    label: 'Generating…',
    description: 'In chat · 12 min of 55',
    tooltip:
      'Codebook is watching the chat for the new Wiki. Stop watching ends Codebook’s watch, not the chat.',
    icon: 'sync~spin',
    actions: ['stop-watching', 'open-chat', 'show-output'],
  })
})

// Value: protects=AC 2 row 2 before the first sign; fails_when=a VS Code run that waits for the chat shows the minutes instead of the waiting text; no_claim=the first-sign detection; seam=the pure row function
test('a VS Code run that waits for the chat reads Waiting for the chat to start', () => {
  // Arrange
  const facts = ready({ run: { ...generationRun, isAwaitingChat: true } })

  // Act
  const description = readLlmWikiViewState(facts, wording).rows[0]?.description

  // Assert
  assert.equal(description, 'Waiting for the chat to start')
})

// Value: protects=AC 2 row 2 in Cursor; fails_when=the Cursor run offers Open Chat or Stop watching, or does not name the agent; no_claim=the agent process; seam=the pure row function
test('a Cursor update row names cursor-agent and carries Cancel and Show Output only', () => {
  // Arrange
  const facts = ready({
    host: 'cursor',
    run: { ...generationRun, kind: 'update', timeoutMs: 900_000 },
  })

  // Act
  const model = readLlmWikiViewState(facts, wording)

  // Assert
  assert.deepEqual(
    [model.rows[0]?.label, model.rows[0]?.description, model.rows[0]?.actions],
    ['Updating…', 'cursor-agent · 12 min of 15', ['cancel-run', 'show-output']],
  )
  assert.equal(model.message, undefined)
})

// Value: protects=the TreeView.message while row 2 or 2c shows in VS Code; fails_when=the wrapping message is missing in VS Code during a watch, or shows in Cursor or without a run; no_claim=the editor's wrapping; seam=the pure row function
test('the watching message shows for a VS Code run and a reservation and never in Cursor', () => {
  // Arrange
  const reservation: ReadyFacts['reservation'] = {
    kind: 'generate',
    host: 'vscode',
    startedAtMs: START_MS,
    retryAtMs: START_MS + 55 * MINUTE_MS,
  }
  const messageOf = (facts: ReadyFacts) =>
    readLlmWikiViewState(facts, wording).message

  // Act
  const messages = [
    messageOf(ready({ run: generationRun })),
    messageOf(ready({ reservation })),
    messageOf(ready({ host: 'cursor', run: generationRun })),
    messageOf(ready({ wiki: publishedWiki })),
  ]

  // Assert
  assert.deepEqual(messages, [
    'Codebook is watching the chat. Stop watching does not stop the chat; stop it in the chat.',
    'Codebook is watching the chat. Stop watching does not stop the chat; stop it in the chat.',
    undefined,
    undefined,
  ])
})

// Value: protects=AC 2 row 2b; fails_when=another window's run is not named by kind and start time, or offers an action; no_claim=marker liveness; seam=the pure row function
test('another window’s update, generation and half-written marker are named with their start time and offer no action', () => {
  // Arrange
  const rowFor = (elsewhere: ReadyFacts['elsewhere']) =>
    readLlmWikiViewState(ready({ elsewhere }), wording).rows[0]

  // Act
  const rows = [
    rowFor({ kind: 'update', startedAtMs: START_MS }),
    rowFor({ kind: 'generate', startedAtMs: START_MS }),
    rowFor({ startedAtMs: START_MS }),
  ]

  // Assert
  assert.deepEqual(
    rows.map((row) => [row?.label, row?.description, row?.actions]),
    [
      ['Updating in another window', 'since 12:00', []],
      ['Generating in another window', 'since 12:00', []],
      ['Starting in another window', 'since 12:00', []],
    ],
  )
})

// Value: protects=AC 2 row 2c; fails_when=a stopped watch's reservation does not show the retry time and the minutes left, its start in the tooltip or Open Chat; no_claim=the reservation's bound; seam=the pure row function
test('a stopped watch’s reservation reads Waiting for chat with its retry time and offers Open Chat', () => {
  // Arrange
  const facts = ready({
    reservation: {
      kind: 'generate',
      host: 'vscode',
      startedAtMs: START_MS,
      retryAtMs: START_MS + 55 * MINUTE_MS,
    },
  })

  // Act
  const row = readLlmWikiViewState(facts, wording).rows[0]

  // Assert
  assert.deepEqual(row, {
    id: 'reservation',
    label: 'Waiting for chat',
    description: 'retry after 12:55 (about 43 min)',
    tooltip:
      'Generating started at 12:00 in VS Code. Open Chat opens the chat view; find the session in the chat history to stop it. Codebook allows a new start after 12:55 even if the chat stopped earlier.',
    icon: 'clock',
    actions: ['open-chat'],
  })
})

// Value: protects=AC 2 row 3 and AC 4; fails_when=a generation that ended without a Wiki hides its short cause, or the cause is worded wrongly for each ending; no_claim=the full sentence (host tests); seam=the pure row function
test('the last attempt row words each ending of a generation in a few words and offers Try again', () => {
  // Arrange
  const sentence = 'The generation stopped.'
  const descriptionFor = (
    stopped: NonNullable<ReadyFacts['lastAttempt']>,
  ): [string | undefined, string[] | undefined] => {
    const row = readLlmWikiViewState(ready({ lastAttempt: stopped }), wording)
      .rows[0]
    return [row?.description, row?.actions]
  }

  // Act
  const endings = [
    descriptionFor({ state: 'cancelled', host: 'vscode', sentence }),
    descriptionFor({ state: 'cancelled', host: 'cursor', sentence }),
    descriptionFor({
      state: 'timed-out',
      host: 'cursor',
      timeoutMs: 3_300_000,
      sentence,
    }),
    descriptionFor({ state: 'failed', host: 'cursor', sentence }),
    descriptionFor({
      state: 'failed',
      host: 'cursor',
      agentExitCode: 1,
      sentence,
    }),
    descriptionFor({ state: 'conflict', host: 'vscode', sentence }),
  ]

  // Assert
  assert.deepEqual(endings, [
    ['stopped watching', ['try-again']],
    ['cancelled', ['try-again']],
    ['stopped after 55 minutes', ['try-again']],
    ['no Wiki published', ['try-again']],
    ['agent exit 1', ['try-again']],
    ['files in the way', ['try-again']],
  ])
})

// Value: protects=AC 2 row 3 click; fails_when=the row click does not run the attention command with the row id, or the full sentence is lost; no_claim=the notice; seam=the pure row function
test('the last attempt row click shows its full sentence through the attention command', () => {
  // Arrange
  const facts = ready({
    lastAttempt: {
      state: 'failed',
      host: 'cursor',
      sentence: 'Cursor Agent finished without publishing an LLM Wiki.',
    },
  })

  // Act
  const row = readLlmWikiViewState(facts, wording).rows[0]

  // Assert
  assert.deepEqual(
    [row?.command, row?.detail],
    [
      { command: 'codebook.showLlmWikiAttention', arguments: ['last-attempt'] },
      'Cursor Agent finished without publishing an LLM Wiki.',
    ],
  )
})

// Value: protects=AC 4 and the late publication (row 3 goes away); fails_when=the last attempt row stays beside a published Wiki, or Try again shows beside a run or an attention row; no_claim=the late-publication notice; seam=the pure row function
test('the last attempt row goes away when a Wiki is published and hides Try again beside a run or an attention row', () => {
  // Arrange
  const stopped: ReadyFacts['lastAttempt'] = {
    state: 'cancelled',
    host: 'vscode',
    sentence: 'Stopped.',
  }

  // Act
  const ids = {
    withWiki: idsOf(ready({ lastAttempt: stopped, wiki: publishedWiki })),
    withRun: readLlmWikiViewState(
      ready({ lastAttempt: stopped, run: generationRun }),
      wording,
    ).rows.find((row) => row.id === 'last-attempt')?.actions,
    withAttention: readLlmWikiViewState(
      ready({
        lastAttempt: stopped,
        attention: { cause: 'held-publish-lock', sentence: 'Locked.' },
      }),
      wording,
    ).rows.find((row) => row.id === 'last-attempt')?.actions,
  }

  // Assert
  assert.deepEqual(ids, {
    withWiki: ['wiki', 'output'],
    withRun: [],
    withAttention: [],
  })
})

const ATTENTION_CASES: Array<{
  cause: string
  label: string
  shortCause: string
  actions: string[]
  hidesWiki: boolean
}> = [
  {
    cause: 'held-publish-lock',
    label: 'Publish in progress or stopped',
    shortCause: 'publish lock found',
    actions: ['copy-recovery', 'refresh'],
    hidesWiki: false,
  },
  {
    cause: 'unfinished-publish',
    label: 'Publish in progress or stopped',
    shortCause: 'unfinished publish',
    actions: ['copy-recovery', 'refresh'],
    hidesWiki: false,
  },
  {
    cause: 'edited-manifest',
    label: 'Wiki manifest needs recovery',
    shortCause: 'manifest edited',
    actions: ['copy-recovery', 'refresh'],
    hidesWiki: true,
  },
  {
    cause: 'unreadable-manifest',
    label: 'Wiki manifest needs recovery',
    shortCause: 'manifest unreadable',
    actions: ['copy-recovery', 'refresh'],
    hidesWiki: true,
  },
  {
    cause: 'not-a-folder',
    label: 'Wiki folder belongs elsewhere',
    shortCause: 'output is a file or link',
    actions: ['change-location'],
    hidesWiki: true,
  },
  {
    cause: 'linked-parent',
    label: 'Wiki folder belongs elsewhere',
    shortCause: 'link on the folder path',
    actions: ['change-location'],
    hidesWiki: true,
  },
  {
    cause: 'foreign-manifest',
    label: 'Wiki folder belongs elsewhere',
    shortCause: 'another checkout',
    actions: ['change-location'],
    hidesWiki: true,
  },
  {
    cause: 'learner-file',
    label: 'Wiki files changed by hand',
    shortCause: 'your file is in the folder',
    actions: ['reveal-folder', 'refresh'],
    hidesWiki: false,
  },
  {
    cause: 'special-file',
    label: 'Wiki files changed by hand',
    shortCause: 'link or special file',
    actions: ['reveal-folder', 'refresh'],
    hidesWiki: false,
  },
  {
    cause: 'edited-page',
    label: 'Wiki files changed by hand',
    shortCause: 'page edited by hand',
    actions: ['reveal-folder', 'refresh'],
    hidesWiki: false,
  },
  {
    cause: 'missing-page',
    label: 'Wiki files changed by hand',
    shortCause: 'page missing',
    actions: ['reveal-folder', 'refresh'],
    hidesWiki: false,
  },
  {
    cause: 'a-cause-added-later',
    label: 'Wiki needs attention',
    shortCause: 'see details',
    actions: ['refresh'],
    hidesWiki: false,
  },
]

for (const attentionCase of ATTENTION_CASES) {
  // Value: protects=AC 2 (each of the ten conflict causes, the foreign manifest and a later cause); fails_when=the cause loses its label, short cause, actions or its row-click sentence, or hides or keeps the Wiki row wrongly; no_claim=how the cause is found (host tests); seam=the pure row function
  test(`the attention cause ${attentionCase.cause} shows ${attentionCase.label} with its sentence and actions`, () => {
    // Arrange
    const facts = ready({
      wiki: publishedWiki,
      attention: { cause: attentionCase.cause, sentence: 'The full sentence.' },
    })

    // Act
    const model = readLlmWikiViewState(facts, wording)

    // Assert
    const attention = model.rows.find((row) => row.id === 'attention')
    assert.deepEqual(
      {
        label: attention?.label,
        description: attention?.description,
        actions: attention?.actions,
        command: attention?.command,
        detail: attention?.detail,
        isWikiShown: model.rows.some((row) => row.id === 'wiki'),
      },
      {
        label: attentionCase.label,
        description: attentionCase.shortCause,
        actions: attentionCase.actions,
        command: {
          command: 'codebook.showLlmWikiAttention',
          arguments: ['attention'],
        },
        detail: 'The full sentence.',
        isWikiShown: !attentionCase.hidesWiki,
      },
    )
  })
}

// Value: protects=AC 2 (fixed order of rows and row 5's presence); fails_when=the rows come in another order, or the Output row shows in the empty state or lacks Change location and the watcher note; no_claim=the settings command; seam=the pure row function
test('every row shows in the fixed order and the Output row comes last with its Change location action and watcher note', () => {
  // Arrange
  const facts = ready({
    wiki: publishedWiki,
    run: generationRun,
    elsewhere: { kind: 'update', startedAtMs: START_MS },
    reservation: {
      kind: 'generate',
      host: 'vscode',
      startedAtMs: START_MS,
      retryAtMs: START_MS + MINUTE_MS,
    },
    lastAttempt: { state: 'failed', host: 'vscode', sentence: 'Failed.' },
    attention: { cause: 'edited-page', sentence: 'Edited.' },
    isWatcherBroken: true,
  })

  // Act
  const model = readLlmWikiViewState(facts, wording)

  // Assert
  assert.deepEqual(
    model.rows.map((row) => row.id),
    ['wiki', 'run', 'elsewhere', 'reservation', 'attention', 'output'],
  )
  assert.deepEqual(model.rows.at(-1), {
    id: 'output',
    label: 'Output: .codebook/wiki',
    description: 'Change location',
    tooltip:
      '/repo/.codebook/wiki\nCodebook could not watch this folder, so the view refreshes when it is shown and with Refresh only.',
    icon: 'folder',
    actions: ['change-location'],
  })
})
