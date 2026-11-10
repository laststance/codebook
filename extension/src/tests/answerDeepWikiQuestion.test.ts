import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type * as AnswerDeepWikiQuestionModule from '../utils/answerDeepWikiQuestion'

import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

test('Wiki question cites only lines from unchanged repository source', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-wiki-answer-'))
  const root = await realpath(directory)
  const source = 'export function createInvoice() {\n  return "saved";\n}\n'
  await writeFile(join(root, 'actions.ts'), source)
  const hash = createHash('sha256').update(source).digest('hex')
  const boundary = await loadModule<typeof AnswerDeepWikiQuestionModule>(
    resolve(__dirname, '../utils/answerDeepWikiQuestion.js'),
    {
      vscode: {
        LanguageModelChatMessage: { User: (text: string) => ({ text }) },
      },
    },
  )
  let prompt = ''
  const model = {
    sendRequest: async (messages: { text: string }[]) => {
      prompt = messages[0]!.text
      return {
        text: (async function* () {
          yield JSON.stringify({
            answer: 'It saves the invoice.',
            citations: [{ id: 'S1', line: 2 }],
          })
        })(),
      }
    },
  }
  try {
    // Act
    const answer = await boundary.answerDeepWikiQuestion(
      model as never,
      root,
      [{ path: 'actions.ts', sha256: hash }],
      'Where is createInvoice saved?',
      'vscode',
    )
    // Assert
    assert.match(prompt, /2:   return/)
    assert.equal(answer.answer, 'It saves the invoice.')
    assert.equal(answer.citations[0]?.path, 'actions.ts')
    assert.equal(answer.citations[0]?.line, 2)
    assert.match(
      answer.citations[0].uri,
      /^vscode:\/\/laststance\.codebook\/source\?/,
    )
    assert.equal(answer.sourceChanged, false)
  } finally {
    await removeTestFolder(directory)
  }
})

test('Wiki question refuses changed source rather than presenting stale model context', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-wiki-answer-stale-'))
  const root = await realpath(directory)
  await writeFile(join(root, 'actions.ts'), 'export const answer = 2;\n')
  const boundary = await loadModule<typeof AnswerDeepWikiQuestionModule>(
    resolve(__dirname, '../utils/answerDeepWikiQuestion.js'),
    {
      vscode: {
        LanguageModelChatMessage: { User: (text: string) => ({ text }) },
      },
    },
  )
  let calls = 0
  const model = {
    sendRequest: async () => {
      calls += 1
      throw new Error('Model must not see changed source.')
    },
  }
  try {
    // Act / Assert
    await assert.rejects(
      boundary.answerDeepWikiQuestion(
        model,
        root,
        [{ path: 'actions.ts', sha256: 'a'.repeat(64) }],
        'What does it do?',
        'vscode',
      ),
      /No unchanged, readable Wiki source/,
    )
    assert.equal(calls, 0)
  } finally {
    await removeTestFolder(directory)
  }
})

test('Japanese Wiki question routes to a relevant English source before answering', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-answer-japanese-'),
  )
  const root = await realpath(directory)
  const paths = [
    'alpha.ts',
    'beta.ts',
    'gamma.ts',
    'delta.ts',
    'epsilon.ts',
    'zeta.ts',
    'invoice.ts',
  ]
  const sources = await Promise.all(
    paths.map(async (path) => {
      const content =
        path === 'invoice.ts'
          ? 'export function createInvoice() { return "saved"; }\n'
          : 'export const item = 1;\n'
      await writeFile(join(root, path), content)
      return {
        path,
        sha256: createHash('sha256').update(content).digest('hex'),
      }
    }),
  )
  const boundary = await loadModule<typeof AnswerDeepWikiQuestionModule>(
    resolve(__dirname, '../utils/answerDeepWikiQuestion.js'),
    {
      vscode: {
        LanguageModelChatMessage: { User: (text: string) => ({ text }) },
      },
    },
  )
  const prompts: string[] = []
  const model = {
    sendRequest: async (messages: { text: string }[]) => {
      prompts.push(messages[0]!.text)
      const result =
        prompts.length === 1
          ? { paths: ['invoice.ts'] }
          : {
              answer: 'The invoice function saves it.',
              citations: [{ id: 'S1', line: 1 }],
            }
      return {
        text: (async function* () {
          yield JSON.stringify(result)
        })(),
      }
    },
  }
  try {
    // Act
    const answer = await boundary.answerDeepWikiQuestion(
      model as never,
      root,
      sources,
      '請求書はどこで作成されますか？',
      'vscode',
    )
    // Assert
    assert.equal(prompts.length, 2)
    assert.match(prompts[0]!, /Choose up to/)
    assert.match(prompts[1]!, /createInvoice/)
    assert.equal(answer.citations[0]?.path, 'invoice.ts')
  } finally {
    await removeTestFolder(directory)
  }
})

test('a large Wiki index keeps the source-routing request within the Cursor prompt limit and still offers the best-matching source', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-wiki-route-budget-'))
  const root = await realpath(directory)
  const filler = `export const setting = "${'x'.repeat(380)}";\n`
  const sources = await Promise.all(
    Array.from({ length: 600 }, async (_, index) => {
      const path = `module-${String(index).padStart(3, '0')}.ts`
      const content =
        index === 437
          ? 'export function createInvoice() { return "saved"; }\n'
          : filler
      await writeFile(join(root, path), content)
      return {
        path,
        sha256: createHash('sha256').update(content).digest('hex'),
      }
    }),
  )
  const boundary = await loadModule<typeof AnswerDeepWikiQuestionModule>(
    resolve(__dirname, '../utils/answerDeepWikiQuestion.js'),
    {
      vscode: {
        LanguageModelChatMessage: { User: (text: string) => ({ text }) },
      },
    },
  )
  const prompts: string[] = []
  const model = {
    sendRequest: async (messages: { text: string }[]) => {
      prompts.push(messages[0]!.text)
      const result =
        prompts.length === 1
          ? { paths: ['module-437.ts'] }
          : {
              answer: 'createInvoice returns saved.',
              citations: [{ id: 'S1', line: 1 }],
            }
      return {
        text: (async function* () {
          yield JSON.stringify(result)
        })(),
      }
    },
  }
  try {
    // Act
    const answer = await boundary.answerDeepWikiQuestion(
      model as never,
      root,
      sources,
      'Where is createInvoice saved?',
      'cursor',
    )

    // Assert
    assert.ok(
      Buffer.byteLength(prompts[0]!, 'utf8') <= 131_072,
      `route request was ${Buffer.byteLength(prompts[0]!, 'utf8')} bytes`,
    )
    assert.match(
      prompts[0]!,
      /"path":"module-437\.ts","opening":"export function createInvoice/,
    )
    assert.equal(answer.citations[0]?.path, 'module-437.ts')
  } finally {
    await removeTestFolder(directory)
  }
})

test('Wiki question still cites verified source when optional model routing is malformed', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-route-fallback-'),
  )
  const root = await realpath(directory)
  await mkdir(join(root, 'app', 'lib'), { recursive: true })
  const paths = [
    'alpha.ts',
    'beta.ts',
    'gamma.ts',
    'delta.ts',
    'epsilon.ts',
    'zeta.ts',
    'app/lib/utils.ts',
    'app/lib/utils.test.ts',
  ]
  const sources = await Promise.all(
    paths.map(async (path) => {
      const content =
        path === 'app/lib/utils.ts'
          ? 'export function generateYAxis(revenue: number[]) {\n  if (revenue.length === 0) return "$0K";\n  return "$1K";\n}\n'
          : path === 'app/lib/utils.test.ts'
            ? 'import { generateYAxis } from "./utils";\ntest("empty revenue uses a zero axis", () => {\n  expect(generateYAxis([])).toEqual("$0K");\n});\n'
            : 'export const unrelated = 1;\n'
      await writeFile(join(root, path), content)
      return {
        path,
        sha256: createHash('sha256').update(content).digest('hex'),
      }
    }),
  )
  const boundary = await loadModule<typeof AnswerDeepWikiQuestionModule>(
    resolve(__dirname, '../utils/answerDeepWikiQuestion.js'),
    {},
  )
  const prompts: string[] = []
  try {
    // Act
    const answer = await boundary.answerDeepWikiQuestionWithPrompt(
      async (prompt) => {
        prompts.push(prompt)
        if (prompts.length === 1)
          return 'I found relevant sources, but cannot format the route.'
        return JSON.stringify({
          answer:
            'Empty revenue uses the $0K axis, covered by the empty revenue test.',
          citations: [
            { id: 'S1', line: 2 },
            { id: 'S2', line: 2 },
          ],
        })
      },
      root,
      sources,
      'How does generateYAxis handle empty revenue, and which test covers it?',
      'vscode',
    )
    // Assert
    assert.equal(prompts.length, 2)
    assert.match(prompts[0]!, /Choose up to/)
    assert.match(prompts[1]!, /app\/lib\/utils\.test\.ts/)
    assert.match(prompts[1]!, /app\/lib\/utils\.ts/)
    assert.equal(answer.citations[0]?.path, 'app/lib/utils.test.ts')
    assert.equal(answer.citations[1]?.path, 'app/lib/utils.ts')
    assert.equal(answer.citations[0]?.line, 2)
    assert.equal(answer.citations[1]?.line, 2)
  } finally {
    await removeTestFolder(directory)
  }
})

test('application database questions include the runtime client instead of only the seed client', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-wiki-runtime-db-'))
  const root = await realpath(directory)
  await mkdir(join(root, 'app', 'lib'), { recursive: true })
  await mkdir(join(root, 'db'), { recursive: true })
  const contentByPath = new Map([
    [
      'app/lib/data.ts',
      "import { db } from '@/db'\nexport const rows = db.select()\n",
    ],
    [
      'db/index.ts',
      "import { drizzle } from 'drizzle-orm/postgres-js'\nimport postgres from 'postgres'\nconst client = postgres(process.env.POSTGRES_URL!)\nexport const db = drizzle(client)\n",
    ],
    [
      'db/seed.ts',
      `${'const seedValue = db.select()\n'.repeat(120)}const db = drizzle(client)\n`,
    ],
    ['app/lib/definitions.ts', 'export type Row = { id: string }\n'],
    ['app/lib/actions.ts', 'export const action = db.select()\n'],
    ['app/lib/utils.ts', 'export const format = (db: string) => db\n'],
    ['app/lib/billing.ts', 'export const billing = db.select()\n'],
    ['app/lib/auth.ts', 'export const auth = db.select()\n'],
    ['app/lib/format.ts', 'export const display = db.select()\n'],
    ['app/ui.ts', 'export const title = "database"\n'],
    ['app/page.ts', 'export const page = "dashboard"\n'],
  ])
  const sources = await Promise.all(
    [...contentByPath].map(async ([path, content]) => {
      await writeFile(join(root, path), content)
      return {
        path,
        sha256: createHash('sha256').update(content).digest('hex'),
      }
    }),
  )
  const boundary = await loadModule<typeof AnswerDeepWikiQuestionModule>(
    resolve(__dirname, '../utils/answerDeepWikiQuestion.js'),
    {},
  )
  let answerPrompt = ''
  try {
    // Act
    const answer = await boundary.answerDeepWikiQuestionWithPrompt(
      async (prompt) => {
        answerPrompt = prompt
        const runtimeSource = JSON.parse(
          prompt.split('Source excerpts: ')[1] ?? '[]',
        ).find((source: { path: string }) => source.path === 'db/index.ts')
        return JSON.stringify({
          answer: 'The runtime client uses postgres-js.',
          citations: [{ id: runtimeSource.id, line: 4 }],
        })
      },
      root,
      sources,
      'In the application runtime, where is the exported db imported by app/lib/data.ts constructed, and which driver does it use?',
      'cursor',
    )
    // Assert
    assert.match(answerPrompt, /db\/index\.ts/)
    assert.match(answerPrompt, /drizzle-orm\/postgres-js/)
    assert.match(answerPrompt, /postgres\(process\.env/)
    assert.equal(answer.citations[0]?.path, 'db/index.ts')
    assert.equal(answer.citations[0]?.line, 4)
  } finally {
    await removeTestFolder(directory)
  }
})

test('natural database question reaches the runtime driver without naming a source file', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-wiki-generic-db-'))
  const root = await realpath(directory)
  await mkdir(join(root, 'app', 'lib'), { recursive: true })
  await mkdir(join(root, 'app', 'ui'), { recursive: true })
  await mkdir(join(root, 'db'), { recursive: true })
  const contentByPath = new Map([
    [
      'app/lib/data.ts',
      "import { db } from '@/db'\nexport const rows = db.select()\n",
    ],
    [
      'db/index.ts',
      "import { drizzle } from 'drizzle-orm/postgres-js'\nimport postgres from 'postgres'\nconst client = postgres(process.env.POSTGRES_URL!)\nexport const db = drizzle(client)\n",
    ],
    [
      'db/seed.ts',
      `${'const seedValue = db.select()\n'.repeat(120)}const db = drizzle(client)\n`,
    ],
    ['app/ui/nav.tsx', "'use client'\n// This application has a database.\n"],
    [
      'app/ui/error.tsx',
      "'use client'\nexport const message = 'Database error'\n",
    ],
    ['app/lib/actions.ts', 'export const action = db.select()\n'],
    ['app/lib/utils.ts', 'export const format = (db: string) => db\n'],
    ['app/layout.tsx', 'export const title = "Application"\n'],
  ])
  const sources = await Promise.all(
    [...contentByPath].map(async ([path, content]) => {
      await writeFile(join(root, path), content)
      return {
        path,
        sha256: createHash('sha256').update(content).digest('hex'),
      }
    }),
  )
  const boundary = await loadModule<typeof AnswerDeepWikiQuestionModule>(
    resolve(__dirname, '../utils/answerDeepWikiQuestion.js'),
    {},
  )
  const prompts: string[] = []
  try {
    // Act
    const answer = await boundary.answerDeepWikiQuestionWithPrompt(
      async (prompt) => {
        prompts.push(prompt)
        if (prompts.length === 1)
          return `I found the runtime module. ${JSON.stringify({ paths: ['db/index.ts', 'app/lib/data.ts'] })}`
        return `The cited driver is clear. ${JSON.stringify({ answer: 'The runtime client uses postgres-js.', citations: [{ id: 'S1', line: 4 }] })}`
      },
      root,
      sources,
      'Where is the application database client created and what driver does it use?',
      'cursor',
    )
    // Assert
    assert.equal(prompts.length, 2)
    assert.match(prompts[0]!, /Choose up to/)
    assert.match(prompts[1]!, /drizzle-orm\/postgres-js/)
    assert.match(prompts[1]!, /postgres\(process\.env/)
    assert.equal(answer.citations[0]?.path, 'db/index.ts')
    assert.equal(answer.citations[0]?.line, 4)
  } finally {
    await removeTestFolder(directory)
  }
})

test('Wiki explains a later invoice update guard after routing to a long source file', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-late-function-'),
  )
  const root = await realpath(directory)
  const paths = [
    'actions.ts',
    'alpha.ts',
    'beta.ts',
    'gamma.ts',
    'delta.ts',
    'epsilon.ts',
    'zeta.ts',
  ]
  const sources = await Promise.all(
    paths.map(async (path) => {
      const content =
        path === 'actions.ts'
          ? `${'// unrelated setup\n'.repeat(100)}export async function updateInvoice(input: unknown) {\n  const validatedFields = schema.safeParse(input);\n  if (!validatedFields.success) {\n    return { errors: validatedFields.error };\n  }\n  await database.update(validatedFields.data);\n}\n`
          : 'export const unrelated = 1;\n'
      await writeFile(join(root, path), content)
      return {
        path,
        sha256: createHash('sha256').update(content).digest('hex'),
      }
    }),
  )
  const boundary = await loadModule<typeof AnswerDeepWikiQuestionModule>(
    resolve(__dirname, '../utils/answerDeepWikiQuestion.js'),
    {},
  )
  const prompts: string[] = []
  try {
    // Act
    const answer = await boundary.answerDeepWikiQuestionWithPrompt(
      async (prompt) => {
        prompts.push(prompt)
        if (prompts.length === 1)
          return JSON.stringify({ paths: ['actions.ts'] })
        return JSON.stringify({
          answer: 'Validation returns errors before the database update.',
          citations: [{ id: 'S1', line: 104 }],
        })
      },
      root,
      sources,
      'What prevents an invoice with invalid fields from reaching the database when it is updated?',
      'cursor',
    )
    // Assert
    assert.equal(prompts.length, 2)
    assert.match(prompts[1]!, /101: export async function updateInvoice/)
    assert.match(prompts[1]!, /103:   if \(!validatedFields.success\)/)
    assert.match(prompts[1]!, /104:     return/)
    assert.match(prompts[1]!, /106:   await database.update/)
    assert.equal(answer.citations[0]?.path, 'actions.ts')
    assert.equal(answer.citations[0]?.line, 104)
  } finally {
    await removeTestFolder(directory)
  }
})

test('Cursor browser question shows only answers citing unchanged excerpt lines', async () => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-cursor-answer-'),
  )
  const root = await realpath(directory)
  const content =
    'export function validate(input: string) {\n  return input.length > 0;\n}\n'
  await writeFile(join(root, 'validate.ts'), content)
  const source = {
    path: 'validate.ts',
    sha256: createHash('sha256').update(content).digest('hex'),
  }
  const boundary = await loadModule<typeof AnswerDeepWikiQuestionModule>(
    resolve(__dirname, '../utils/answerDeepWikiQuestion.js'),
    {},
  )
  try {
    // Act / Assert
    await assert.rejects(
      boundary.answerDeepWikiQuestionWithPrompt(
        async () => 'It accepts the input.',
        root,
        [source],
        'What does input.length check?',
        'cursor',
      ),
      /structured Wiki answer/,
    )
    await assert.rejects(
      boundary.answerDeepWikiQuestionWithPrompt(
        async () =>
          '{"answer":"First","citations":[{"id":"S1","line":2}]} {"answer":"Second","citations":[{"id":"S1","line":2}]}',
        root,
        [source],
        'What does input.length check?',
        'cursor',
      ),
      /structured Wiki answer/,
    )
    await assert.rejects(
      boundary.answerDeepWikiQuestionWithPrompt(
        async () =>
          JSON.stringify({
            answer: 'It accepts the input.',
            citations: [{ id: 'S1', line: 8 }],
          }),
        root,
        [source],
        'What does input.length check?',
        'cursor',
      ),
      /outside its source excerpts/,
    )
    const answer = await boundary.answerDeepWikiQuestionWithPrompt(
      async () =>
        JSON.stringify({
          answer: 'It rejects an empty string.',
          citations: [{ id: 'S1', line: 2 }],
        }),
      root,
      [source],
      'What does input.length check?',
      'cursor',
    )
    assert.equal(answer.answer, 'It rejects an empty string.')
    assert.equal(answer.citations[0]?.line, 2)
    assert.match(
      answer.citations[0].uri,
      /^cursor:\/\/laststance\.codebook\/source\?/,
    )
  } finally {
    await removeTestFolder(directory)
  }
})

/**
 * Runs one Wiki question over three sources that all define `createInvoice`, with a model stub that replies as given.
 * @param reply - The model's JSON reply text.
 * @param firstLine - First line of every source file; defaults to a comment without id-shaped words.
 * @returns The prompt the model saw and the answer the reader receives.
 */
async function askWithThreeSources(
  reply: string,
  firstLine = '// saves invoices',
  question = 'Where is createInvoice saved?',
) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-wiki-answer-ids-'))
  const root = await realpath(directory)
  const content = `${firstLine}\nexport function createInvoice() {\n  return "saved";\n}\n`
  const sources = await Promise.all(
    ['a.ts', 'b.ts', 'c.ts'].map(async (path) => {
      await writeFile(join(root, path), content)
      return {
        path,
        sha256: createHash('sha256').update(content).digest('hex'),
      }
    }),
  )
  const boundary = await loadModule<typeof AnswerDeepWikiQuestionModule>(
    resolve(__dirname, '../utils/answerDeepWikiQuestion.js'),
    {
      vscode: {
        LanguageModelChatMessage: { User: (text: string) => ({ text }) },
      },
    },
  )
  let prompt = ''
  const model = {
    sendRequest: async (messages: { text: string }[]) => {
      prompt = messages[0]!.text
      return {
        text: (async function* () {
          yield reply
        })(),
      }
    },
  }
  try {
    const answer = await boundary.answerDeepWikiQuestion(
      model as never,
      root,
      sources,
      question,
      'vscode',
    )
    return { prompt, answer }
  } finally {
    await removeTestFolder(directory)
  }
}

// Value: protects=a learner reading a Wiki answer sees file paths where the model wrote excerpt ids, because the reader's citation list carries no ids; fails_when=the answer reaches the reader with `S2` or `S3` still in its text; why_new=Cycle 0113 (C113-W2); seam=answerDeepWikiQuestion over a stubbed editor model; no_claim=which excerpt the editor model prefers or how the reader lays the answer out
test('Wiki answer names files instead of the excerpt ids the model wrote', async () => {
  // Arrange
  const reply = JSON.stringify({
    answer: 'It returns saved (S2, line 2); S3 repeats it.',
    citations: [{ id: 'S2', line: 2 }],
  })
  // Act
  const { answer } = await askWithThreeSources(reply)
  // Assert
  assert.equal(
    answer.answer,
    'It returns saved (b.ts, line 2); c.ts repeats it.',
  )
  assert.equal(answer.citations[0]!.path, 'b.ts')
})

// Value: protects=an id that names no excerpt of this prompt is left as the model wrote it instead of being guessed into a file; fails_when=`S9` is replaced or removed; why_new=Cycle 0113 (C113-W2); seam=answerDeepWikiQuestion over a stubbed editor model; no_claim=how a model's own use of the letter S is read
test('Wiki answer keeps an id that names no excerpt as written', async () => {
  // Arrange
  const reply = JSON.stringify({
    answer: 'See S9 and S1.',
    citations: [{ id: 'S1', line: 2 }],
  })
  // Act
  const { answer } = await askWithThreeSources(reply)
  // Assert
  assert.equal(answer.answer, 'See S9 and a.ts.')
})

// Value: protects=the model is told to name files in its prose, so ids rarely reach the reader at all; fails_when=the prompt drops the instruction to name sources by file path; why_new=Cycle 0113 (C113-W2); seam=the prompt answerDeepWikiQuestion sends to the editor model; no_claim=whether a given model obeys it
test('Wiki prompt asks the model to name files rather than excerpt ids', async () => {
  // Arrange
  const reply = JSON.stringify({
    answer: 'It saves.',
    citations: [{ id: 'S1', line: 2 }],
  })
  // Act
  const { prompt } = await askWithThreeSources(reply)
  // Assert
  assert.match(
    prompt,
    /In the answer text, name a source by its file path \(with line numbers when useful\), never by its excerpt id such as S1; the ids belong only in citations\./,
  )
})

// Value: protects=a real word such as the service name S3 in the source stays in a Wiki answer instead of being rewritten into a file path; fails_when=`S3` becomes `c.ts` although the excerpts mention S3 themselves; why_new=Cycle 0113 (C113-W2); seam=answerDeepWikiQuestion over a stubbed editor model; no_claim=how a model's own prose about S3 is judged
test('Wiki answer keeps an id-shaped word the source itself uses', async () => {
  // Arrange
  const reply = JSON.stringify({
    answer: 'Files go to S3 (see S1).',
    citations: [{ id: 'S1', line: 3 }],
  })
  // Act
  const { answer } = await askWithThreeSources(reply, '// upload to S3')
  // Assert
  assert.equal(answer.answer, 'Files go to S3 (see a.ts).')
})

// Value: protects=an id-shaped word the learner's own question uses (a service named S3) stays in the answer instead of being rewritten into a file path; fails_when=the question is left out of the words the rewrite treats as the learner's own, so `S3` becomes `c.ts`; why_new=C113 review round; seam=answerDeepWikiQuestion over a stubbed editor model with a question naming S3; no_claim=how a model's own prose about S3 is judged
test('Wiki answer keeps an id-shaped word the question itself uses', async () => {
  // Arrange
  const reply = JSON.stringify({
    answer: 'Files go to S3 (see S1).',
    citations: [{ id: 'S1', line: 2 }],
  })
  // Act
  const { answer } = await askWithThreeSources(
    reply,
    '// saves invoices',
    'Does S3 hold files?',
  )
  // Assert
  assert.equal(answer.answer, 'Files go to S3 (see a.ts).')
})

// Value: protects=only a whole-word excerpt id becomes a file path, so `AS1` and `S1x` stay as written; fails_when=the id pattern loses its lookaround boundaries and rewrites an id inside a longer word; why_new=C113 review round; seam=answerDeepWikiQuestion over a stubbed editor model; no_claim=other punctuation around ids
test('Wiki answer rewrites an excerpt id only where it stands as a whole word', async () => {
  // Arrange
  const reply = JSON.stringify({
    answer: 'Use AS1 and S1x and S1.',
    citations: [{ id: 'S1', line: 2 }],
  })
  // Act
  const { answer } = await askWithThreeSources(reply)
  // Assert
  assert.equal(answer.answer, 'Use AS1 and S1x and a.ts.')
})

// Value: protects=a full-width excerpt id the model wrote is named by file too; fails_when=`Ｓ２` reaches the reader as written; why_new=Cycle 0113 (C113-W2); seam=answerDeepWikiQuestion over a stubbed editor model; no_claim=other full-width wording
test('Wiki answer names the file for a full-width excerpt id', async () => {
  // Arrange
  const reply = JSON.stringify({
    answer: '返します（Ｓ２、2行）。',
    citations: [{ id: 'S1', line: 2 }],
  })
  // Act
  const { answer } = await askWithThreeSources(reply)
  // Assert
  assert.equal(answer.answer, '返します（b.ts、2行）。')
})

/**
 * Runs one Wiki question over six small sources so a reply can cite several lines of every excerpt.
 * @param reply - The model's JSON reply text.
 * @returns The answer the reader receives, or the error text when the answer is refused.
 */
async function askWithSixSources(reply: string) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-wiki-answer-lines-'))
  const root = await realpath(directory)
  const content =
    '// saves invoices\nexport function createInvoice() {\n  return "saved";\n}\n'
  const sources = await Promise.all(
    ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'].map(async (path) => {
      await writeFile(join(root, path), content)
      return {
        path,
        sha256: createHash('sha256').update(content).digest('hex'),
      }
    }),
  )
  const boundary = await loadModule<typeof AnswerDeepWikiQuestionModule>(
    resolve(__dirname, '../utils/answerDeepWikiQuestion.js'),
    {},
  )
  try {
    return await boundary
      .answerDeepWikiQuestionWithPrompt(
        async () => reply,
        root,
        sources,
        'Where is createInvoice saved?',
        'cursor',
      )
      .then(
        (answer) => ({ answer, error: '' }),
        (error: unknown) => ({
          answer: undefined,
          // The module loads in its own realm, so `instanceof Error` cannot recognize its errors.
          error:
            typeof error === 'object' && error !== null && 'message' in error
              ? String(error.message)
              : String(error),
        }),
      )
  } finally {
    await removeTestFolder(directory)
  }
}

// Value: protects=a Cursor learner whose model cites several lines of each excerpt gets the answer instead of a refusal; fails_when=a reply with more citations than excerpts (14 lines over 6 excerpts) is refused as having no usable citations; why_new=C113-W4 native Cursor Q&A refusal; seam=answerDeepWikiQuestionWithPrompt over a stubbed Cursor reply; no_claim=how many lines a real model chooses to cite
test('answers a Cursor question whose model cites several lines of each excerpt', async () => {
  // Arrange
  const lineCountsPerExcerpt = [3, 3, 3, 2, 2, 1]
  const citations = lineCountsPerExcerpt.flatMap((lineCount, index) =>
    Array.from({ length: lineCount }, (_, lineIndex) => ({
      id: `S${index + 1}`,
      line: lineIndex + 1,
    })),
  )
  const reply = JSON.stringify({ answer: 'It saves.', citations })
  // Act
  const { answer, error } = await askWithSixSources(reply)
  // Assert
  assert.equal(error, '')
  assert.equal(answer?.answer, 'It saves.')
  assert.deepEqual(
    // Spread: the module's realm builds arrays with another prototype, which deepEqual treats as unequal.
    [...(answer?.citations ?? [])].map(
      (citation) => `${citation.path}:${citation.line}`,
    ),
    [
      'a.ts:1',
      'a.ts:2',
      'a.ts:3',
      'b.ts:1',
      'b.ts:2',
      'b.ts:3',
      'c.ts:1',
      'c.ts:2',
      'c.ts:3',
      'd.ts:1',
      'd.ts:2',
      'e.ts:1',
      'e.ts:2',
      'f.ts:1',
    ],
  )
})

// Value: protects=the reader's citation list shows each source line once; fails_when=a line the model cites twice appears twice in the list; why_new=C113-W4 native Cursor Q&A refusal; seam=answerDeepWikiQuestionWithPrompt over a stubbed Cursor reply; no_claim=the order a model prefers
test('lists a source line once when the model cites it repeatedly', async () => {
  // Arrange
  const reply = JSON.stringify({
    answer: 'It saves.',
    citations: [
      { id: 'S2', line: 2 },
      { id: 'S1', line: 3 },
      { id: 'S2', line: 2 },
      { id: 'S1', line: 3 },
    ],
  })
  // Act
  const { answer } = await askWithSixSources(reply)
  // Assert
  assert.deepEqual(
    // Spread: the module's realm builds arrays with another prototype, which deepEqual treats as unequal.
    [...(answer?.citations ?? [])].map(
      (citation) => `${citation.path}:${citation.line}`,
    ),
    ['b.ts:2', 'a.ts:3'],
  )
})

// Value: protects=a runaway model reply stays bounded; fails_when=41 citations are accepted instead of refused with the usable-citations sentence; why_new=C113-W4 native Cursor Q&A refusal; seam=answerDeepWikiQuestionWithPrompt over a stubbed Cursor reply; no_claim=that 40 is the right number for every model
test('refuses a Cursor reply carrying 41 citations as unbounded', async () => {
  // Arrange
  const citations = Array.from({ length: 41 }, (_, index) => ({
    id: 'S1',
    line: (index % 4) + 1,
  }))
  const reply = JSON.stringify({ answer: 'It saves.', citations })
  // Act
  const { answer, error } = await askWithSixSources(reply)
  // Assert
  assert.equal(answer, undefined)
  assert.equal(
    error,
    'The editor model returned a Wiki answer without usable source citations.',
  )
})

// Value: protects=a reply at the citation limit is still answered; fails_when=the limit check refuses a reply of exactly 40 citations (the comparison turns from `>` to `>=`); why_new=C113 review round; seam=answerDeepWikiQuestionWithPrompt over a stubbed Cursor reply; no_claim=that 40 is the right number for every model
test('answers a Cursor reply carrying exactly 40 citations', async () => {
  // Arrange
  const citations = Array.from({ length: 40 }, (_, index) => ({
    id: 'S1',
    line: (index % 4) + 1,
  }))
  const reply = JSON.stringify({ answer: 'It saves.', citations })
  // Act
  const { answer, error } = await askWithSixSources(reply)
  // Assert
  assert.equal(error, '')
  assert.deepEqual(
    // Spread: the module's realm builds arrays with another prototype, which deepEqual treats as unequal.
    [...(answer?.citations ?? [])].map(
      (citation) => `${citation.path}:${citation.line}`,
    ),
    ['a.ts:1', 'a.ts:2', 'a.ts:3', 'a.ts:4'],
  )
})

// Value: protects=the prompt keeps the model's citations focused; fails_when=the prompt no longer asks for at most 12 supporting lines; why_new=C113-W4 native Cursor Q&A refusal; seam=the prompt answerDeepWikiQuestion sends to the editor model; no_claim=whether a given model obeys it
test('Wiki prompt asks the model to cite at most 12 directly supporting lines', async () => {
  // Arrange
  const reply = JSON.stringify({
    answer: 'It saves.',
    citations: [{ id: 'S1', line: 2 }],
  })
  // Act
  const { prompt } = await askWithThreeSources(reply)
  // Assert
  assert.match(
    prompt,
    /only the lines that support the answer most directly \(at most 12\)/,
  )
})
