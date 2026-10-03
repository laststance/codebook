import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  parseCursorWikiUpdateResult,
  runCursorWikiUpdate,
} from '../utils/runCursorWikiUpdate'

test('Cursor Wiki update sends its skill request over stdin and binds the opened project', async () => {
  // Arrange
  const privateHome = await mkdtemp(
    join(tmpdir(), 'codebook-cursor-update-cli-'),
  )
  const projectRoot = join(privateHome, 'project')
  const binaryDirectory = join(privateHome, '.local', 'bin')
  await mkdir(projectRoot)
  await mkdir(binaryDirectory, { recursive: true })
  await writeFile(
    join(binaryDirectory, 'cursor-agent'),
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
let prompt = '';
process.stdin.on('data', chunk => { prompt += chunk; });
process.stdin.on('end', () => {
  fs.writeFileSync(path.join(process.cwd(), 'received.json'), JSON.stringify({ args: process.argv.slice(2), prompt }));
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Updated' }));
});
`,
    { mode: 0o755 },
  )
  const previousHome = process.env.HOME
  process.env.HOME = privateHome
  try {
    // Act
    const result = await runCursorWikiUpdate(
      projectRoot,
      '/codebook Update LLM Wiki for this opened repository.',
    )
    const received = JSON.parse(
      await readFile(join(projectRoot, 'received.json'), 'utf8'),
    )
    // Assert
    assert.equal(result, 'Updated')
    assert.equal(
      received.prompt,
      '/codebook Update LLM Wiki for this opened repository.',
    )
    assert.ok(received.args.includes(projectRoot))
    assert.ok(received.args.includes('--auto-review'))
    assert.ok(received.args.includes('enabled'))
    assert.equal(received.args.includes(received.prompt), false)
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    await rm(privateHome, { recursive: true, force: true })
  }
})

test('a Cursor agent reply that reports an error says the update did not complete and where to read the agent’s own message', () => {
  // Arrange
  const failed = JSON.stringify({
    type: 'result',
    subtype: 'error',
    is_error: true,
    result: 'Authentication failed',
  })

  // Act / Assert
  assert.throws(() => parseCursorWikiUpdateResult(failed), {
    message:
      'Cursor Agent ended without completing the update. Run "/codebook Update LLM Wiki" in Cursor chat to see its own message.',
  })
})

test('a Cursor agent reply that is not the expected envelope says so and what to try', () => {
  // Act / Assert
  assert.throws(() => parseCursorWikiUpdateResult('not json'), {
    message:
      'Cursor Agent returned a result Codebook could not read. Update again; if it repeats, run the update in Cursor chat.',
  })
})

test('a Cursor agent that exits with a code names the code and sends the learner to Cursor chat', async () => {
  // Arrange
  const privateHome = await mkdtemp(
    join(tmpdir(), 'codebook-cursor-update-exit-'),
  )
  const projectRoot = join(privateHome, 'project')
  const binaryDirectory = join(privateHome, '.local', 'bin')
  await mkdir(projectRoot)
  await mkdir(binaryDirectory, { recursive: true })
  await writeFile(
    join(binaryDirectory, 'cursor-agent'),
    `#!${process.execPath}
process.stdin.resume();
process.stdin.on('end', () => process.exit(3));
`,
    { mode: 0o755 },
  )
  const previousHome = process.env.HOME
  process.env.HOME = privateHome
  try {
    // Act
    const failure: unknown = await runCursorWikiUpdate(
      projectRoot,
      '/codebook Update LLM Wiki for this opened repository.',
    ).catch((error: unknown) => error)

    // Assert
    assert.ok(failure instanceof Error)
    assert.equal(
      failure.message,
      'Cursor Agent stopped with exit code 3 before finishing. Run "/codebook Update LLM Wiki" in Cursor chat to see its own message.',
    )
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    await rm(privateHome, { recursive: true, force: true })
  }
})

test('a Cursor agent that runs past its bound is stopped and the failure is named as a timeout', async () => {
  // Arrange
  const privateHome = await mkdtemp(
    join(tmpdir(), 'codebook-cursor-update-bound-'),
  )
  const projectRoot = join(privateHome, 'project')
  const binaryDirectory = join(privateHome, '.local', 'bin')
  await mkdir(projectRoot)
  await mkdir(binaryDirectory, { recursive: true })
  // This agent never answers; only the bound ends it.
  await writeFile(
    join(binaryDirectory, 'cursor-agent'),
    `#!${process.execPath}
setInterval(() => {}, 1000);
`,
    { mode: 0o755 },
  )
  const previousHome = process.env.HOME
  process.env.HOME = privateHome
  try {
    // Act
    const failure: unknown = await runCursorWikiUpdate(
      projectRoot,
      '/codebook Update LLM Wiki for this opened repository.',
      undefined,
      50,
    ).catch((error: unknown) => error)

    // Assert
    assert.ok(failure instanceof Error)
    assert.equal(failure.name, 'WikiUpdateTimedOut')
    assert.equal(failure.message, 'Cursor Agent timed out updating the Wiki.')
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    await rm(privateHome, { recursive: true, force: true })
  }
})
