import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(
  new URL('../sanitizeHostTrace.mjs', import.meta.url),
)
const sample = fileURLToPath(
  new URL('./fixtures/host-trace-sample.jsonl', import.meta.url),
)

/** Runs the sanitizer command on `input` text and returns its result and the output file's text (or undefined). */
async function runSanitizer(context, input, extraArgs = []) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-sanitize-trace-'))
  // Retrying removal, as a just-exited child can still hold the folder for a moment.
  context.after(() =>
    rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    }),
  )
  const take = join(directory, 'take.jsonl')
  const out = join(directory, 'out.jsonl')
  await writeFile(take, input)
  const result = spawnSync(
    process.execPath,
    [script, take, out, '--repository', '/work/repo', ...extraArgs],
    { encoding: 'utf8' },
  )
  const output = await readFile(out, 'utf8').catch(() => undefined)
  return { result, output }
}

// Value: protects=a clean take passing the defense-in-depth step unchanged; fails_when=the committed sample (already sanitized) is rewritten or refused; why_new=Cycle 0094 task 12; seam=real child process; no_claim=that a real take is clean (the script checks each take)
test('a clean trace passes the sanitizer command unchanged', async (context) => {
  // Arrange
  const clean = await readFile(sample, 'utf8')

  // Act
  const { result, output } = await runSanitizer(context, clean)

  // Assert
  assert.equal(result.status, 0, result.stderr)
  assert.equal(output, clean)
})

// Value: protects=no absolute path reaching a committed fixture; fails_when=a trace still holding an absolute path exits 0 or does not name its line; why_new=Cycle 0094 task 12; seam=real child process; no_claim=paths the detector's pattern does not describe
test('a trace that still holds an absolute path is refused with exit 2 naming the line', async (context) => {
  // Arrange
  const header = JSON.stringify({ type: 'header', sequence: 'sample' })
  const leaky = JSON.stringify({
    seq: 1,
    tMs: 0,
    kind: 'tabGroups',
    data: {
      groups: [
        {
          viewColumn: 1,
          isActive: true,
          tabs: [
            {
              label: '/Users/alice/secret/plans.md',
              isActive: true,
              isPreview: false,
              input: { kind: 'webview', viewType: 'codebook.x' },
            },
          ],
        },
      ],
    },
  })

  // Act
  const { result, output } = await runSanitizer(
    context,
    `${header}\n${leaky}\n`,
  )

  // Assert
  assert.equal(result.status, 2)
  assert.match(result.stderr, /^E_TRACE_NOT_CLEAN: line 2 .* an absolute path/m)
  assert.equal(output, undefined)
})

// Value: protects=a user name not reaching a committed fixture; fails_when=a forbidden text inside a label passes; why_new=Cycle 0094 task 12; seam=real child process; no_claim=the user name of the machine running the test (--forbid stands in)
test('a trace that names a forbidden user name is refused with exit 2', async (context) => {
  // Arrange
  const leaky = JSON.stringify({
    seq: 1,
    tMs: 0,
    kind: 'tabGroups',
    data: {
      groups: [
        {
          viewColumn: 1,
          isActive: true,
          tabs: [
            {
              label: 'notes of alice',
              isActive: true,
              isPreview: false,
              input: { kind: 'webview', viewType: 'codebook.x' },
            },
          ],
        },
      ],
    },
  })

  // Act
  const { result } = await runSanitizer(context, `${leaky}\n`, [
    '--forbid',
    'alice',
  ])

  // Assert
  assert.equal(result.status, 2)
  assert.match(result.stderr, /^E_TRACE_NOT_CLEAN: line 1 .*user name/m)
})

// Value: protects=no absolute path reaching a committed fixture through a group event (the Cycle 0094 native take carried `/Users/...` tab inputs inside groupsChanged); fails_when=the command refuses such a take instead of cleaning it, or the output still holds the path; why_new=Cycle 0094 task 12 sanitizer leak; seam=real child process; no_claim=takes of another format version
test('a raw take whose group event carries absolute tab paths is written without them', async (context) => {
  // Arrange
  const header = JSON.stringify({ type: 'header', sequence: 'sample' })
  const groupEvent = JSON.stringify({
    seq: 1,
    tMs: 0,
    kind: 'groupsChanged',
    data: {
      opened: [],
      closed: [],
      changed: [
        {
          groupIndex: 1,
          viewColumn: 2,
          isActive: true,
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
        },
      ],
    },
  })
  const editorEvent = JSON.stringify({
    seq: 2,
    tMs: 5,
    kind: 'activeTextEditor',
    data: { uri: '/work/repo/app/lib/data.ts', viewColumn: 2 },
  })

  // Act
  const { result, output } = await runSanitizer(
    context,
    `${header}\n${groupEvent}\n${editorEvent}\n`,
  )

  // Assert
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(output.trim().split('\n').slice(1).map(JSON.parse), [
    {
      seq: 1,
      tMs: 0,
      kind: 'groupsChanged',
      data: { opened: [], closed: [], changed: [{ groupIndex: 1 }] },
    },
    {
      seq: 2,
      tMs: 5,
      kind: 'activeTextEditor',
      data: { uri: 'app/lib/data.ts', viewColumn: 2 },
    },
  ])
})

/** A one-tab `tabGroups` line whose tab label is `label`, as a take would hold it. */
function labelLine(label) {
  return JSON.stringify({
    seq: 1,
    tMs: 0,
    kind: 'tabGroups',
    data: {
      groups: [
        {
          viewColumn: 1,
          isActive: true,
          tabs: [
            {
              label,
              isActive: true,
              isPreview: false,
              input: { kind: 'webview', viewType: 'codebook.x' },
            },
          ],
        },
      ],
    },
  })
}

// Value: protects=a short forbidden user name still being searched for; fails_when=a --forbid text of one or two characters is dropped instead of matched on word boundaries, or matches inside a longer word; why_new=Cycle 0094 task 12 review finding (short forbidden texts); seam=real child process; no_claim=none beyond protects
test('a forbidden text shorter than three characters is refused as a whole word and ignored inside longer words', async (context) => {
  // Arrange
  const named = labelLine('notes of ab')
  const inside = labelLine('about cabs')

  // Act
  const refused = await runSanitizer(context, `${named}\n`, ['--forbid', 'ab'])
  const accepted = await runSanitizer(context, `${inside}\n`, [
    '--forbid',
    'ab',
  ])

  // Assert
  assert.equal(refused.result.status, 2)
  assert.match(refused.result.stderr, /user name/)
  assert.equal(accepted.result.status, 0, accepted.result.stderr)
})

// Value: protects=the recording machine's user and the current user never reaching a fixture in any letter case; fails_when=lume or the current user name passes in upper case; why_new=Cycle 0094 task 12 review finding (forbid list); seam=real child process; no_claim=other users
test('the recording machine user lume and the current user are refused in any letter case', async (context) => {
  // Arrange
  const lume = labelLine('Notes of LUME')
  const current = labelLine(`notes of ${userInfo().username.toUpperCase()}`)

  // Act
  const lumeRun = await runSanitizer(context, `${lume}\n`)
  const currentRun = await runSanitizer(context, `${current}\n`)

  // Assert
  assert.equal(lumeRun.result.status, 2)
  assert.equal(currentRun.result.status, 2)
})

// Value: protects=the path detector catching the forms a committed fixture could still hold; fails_when=a backslash, UNC, ~user, percent-encoded, after-colon or after-comma path, or a path used as an object key, passes; why_new=Cycle 0094 task 12 review finding (path detector); seam=real child process; no_claim=every conceivable path spelling
test('backslash, UNC, ~user, percent-encoded, delimited and object-key paths are refused', async (context) => {
  // Arrange
  const labels = [
    'C:\\Users\\alice\\notes.md',
    '\\\\server\\share\\notes.md',
    '\\Users\\alice\\notes.md',
    '~alice/notes.md',
    '%2FUsers%2Falice%2Fnotes.md',
    'path:/home/alice/notes.md',
    'a,/home/alice/notes.md',
  ]
  const keyLeak = `${JSON.stringify({ type: 'header', '/home/alice/notes.md': 1 })}\n`

  // Act
  const results = []
  for (const label of labels)
    results.push(await runSanitizer(context, `${labelLine(label)}\n`))
  const keyResult = await runSanitizer(context, keyLeak)

  // Assert
  assert.deepEqual(
    results.map(({ result }) => result.status),
    labels.map(() => 2),
  )
  assert.equal(keyResult.result.status, 2)
})

// Value: protects=a take with an unknown field on an event being cleaned to the fields the format defines; fails_when=an extra field survives into the committed output; why_new=Cycle 0094 task 12 review finding (field allow-list); seam=real child process; no_claim=none beyond protects
test('unknown fields on events are dropped from the written trace', async (context) => {
  // Arrange
  const editorEvent = JSON.stringify({
    seq: 1,
    tMs: 0,
    kind: 'activeTextEditor',
    data: { uri: 'a.ts', viewColumn: 1, note: 'x' },
    extra: 'y',
  })

  // Act
  const { result, output } = await runSanitizer(context, `${editorEvent}\n`)

  // Assert
  assert.equal(result.status, 0, result.stderr)
  assert.equal(
    output,
    `${JSON.stringify({ seq: 1, tMs: 0, kind: 'activeTextEditor', data: { uri: 'a.ts', viewColumn: 1 } })}\n`,
  )
})
