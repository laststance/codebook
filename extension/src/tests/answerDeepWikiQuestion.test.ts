import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadModule } from './utils/loadModule'

test('Wiki question cites only lines from unchanged repository source', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-wiki-answer-'))
  const root = await realpath(directory)
  const source = 'export function createInvoice() {\n  return "saved";\n}\n'
  await writeFile(join(root, 'actions.ts'), source)
  const hash = createHash('sha256').update(source).digest('hex')
  const boundary = await loadModule<
    typeof import('../utils/answerDeepWikiQuestion')
  >(resolve(__dirname, '../utils/answerDeepWikiQuestion.js'), {
    vscode: {
      LanguageModelChatMessage: { User: (text: string) => ({ text }) },
    },
  })
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
      answer.citations[0]!.uri,
      /^vscode:\/\/laststance\.codebook\/source\?/,
    )
    assert.equal(answer.sourceChanged, false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Wiki question refuses changed source rather than presenting stale model context', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-wiki-answer-stale-'))
  const root = await realpath(directory)
  await writeFile(join(root, 'actions.ts'), 'export const answer = 2;\n')
  const boundary = await loadModule<
    typeof import('../utils/answerDeepWikiQuestion')
  >(resolve(__dirname, '../utils/answerDeepWikiQuestion.js'), {
    vscode: {
      LanguageModelChatMessage: { User: (text: string) => ({ text }) },
    },
  })
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
        model as never,
        root,
        [{ path: 'actions.ts', sha256: 'a'.repeat(64) }],
        'What does it do?',
        'vscode',
      ),
      /No unchanged, readable Wiki source/,
    )
    assert.equal(calls, 0)
  } finally {
    await rm(directory, { recursive: true, force: true })
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
  const boundary = await loadModule<
    typeof import('../utils/answerDeepWikiQuestion')
  >(resolve(__dirname, '../utils/answerDeepWikiQuestion.js'), {
    vscode: {
      LanguageModelChatMessage: { User: (text: string) => ({ text }) },
    },
  })
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
    await rm(directory, { recursive: true, force: true })
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
  const boundary = await loadModule<
    typeof import('../utils/answerDeepWikiQuestion')
  >(resolve(__dirname, '../utils/answerDeepWikiQuestion.js'), {
    vscode: {
      LanguageModelChatMessage: { User: (text: string) => ({ text }) },
    },
  })
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
    await rm(directory, { recursive: true, force: true })
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
  const boundary = await loadModule<
    typeof import('../utils/answerDeepWikiQuestion')
  >(resolve(__dirname, '../utils/answerDeepWikiQuestion.js'), {})
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
    await rm(directory, { recursive: true, force: true })
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
  const boundary = await loadModule<
    typeof import('../utils/answerDeepWikiQuestion')
  >(resolve(__dirname, '../utils/answerDeepWikiQuestion.js'), {})
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
    await rm(directory, { recursive: true, force: true })
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
  const boundary = await loadModule<
    typeof import('../utils/answerDeepWikiQuestion')
  >(resolve(__dirname, '../utils/answerDeepWikiQuestion.js'), {})
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
    await rm(directory, { recursive: true, force: true })
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
  const boundary = await loadModule<
    typeof import('../utils/answerDeepWikiQuestion')
  >(resolve(__dirname, '../utils/answerDeepWikiQuestion.js'), {})
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
    await rm(directory, { recursive: true, force: true })
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
  const boundary = await loadModule<
    typeof import('../utils/answerDeepWikiQuestion')
  >(resolve(__dirname, '../utils/answerDeepWikiQuestion.js'), {})
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
      answer.citations[0]!.uri,
      /^cursor:\/\/laststance\.codebook\/source\?/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
