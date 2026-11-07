import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
  context.after(() => rm(directory, { recursive: true, force: true }))
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
              input: { kind: 'webview', viewType: 'x' },
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
              input: { kind: 'webview', viewType: 'x' },
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
