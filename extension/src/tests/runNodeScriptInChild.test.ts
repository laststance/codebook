import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { runNodeScriptInChild } from './utils/runNodeScriptInChild'

// Value: protects=the test runner of every test that runs page workers in a child process (pagesServedInChildProcess hands the child up to 2 MiB on its standard input, more than a pipe holds): a child that ends before it has read its whole input (its script fails to load, it aborts, or it is killed at its time) closes the pipe, and the write to it failed with EPIPE as an error nobody listened to, which ended the test runner instead of the test; fails_when=runNodeScriptInChild writes the input to the child without an 'error' listener on the child's standard input, so the EPIPE escapes as an uncaught exception, or the child's end is not answered once the write failed; why_new=Cycle 0047 row 144 (P3CR-3 = P3OCR2-2); seam=a script of the test's own, written to a temporary folder, that exits at once without reading its input; no_claim=a child that aborts or is killed (the same pipe closes the same way); what a child writes after a failed write (it wrote nothing here)
test('a child script that ends before it reads a 2 MiB input ends as a result with its exit code, and the failed write to its input does not end the test runner', async (context) => {
  // Arrange: a script that exits with code 3 at once, and an input of 2 MiB, more than a pipe holds.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-child-script-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const scriptPath = join(directory, 'exitsAtOnce.js')
  await writeFile(scriptPath, 'process.exit(3)\n')
  const largeInput = { pages: ['x'.repeat(2_097_152)] }

  // Act
  const end = await runNodeScriptInChild(
    scriptPath,
    largeInput,
    30_000,
    (value: unknown): value is number => typeof value === 'number',
  )

  // Assert
  assert.deepEqual(end, { exitCode: 3, signal: null, output: undefined })
})
