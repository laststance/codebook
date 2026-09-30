import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test('Cursor Wiki update refuses a failed Agent response', () => {
  // Arrange
  const failed = JSON.stringify({
    type: 'result',
    subtype: 'error',
    is_error: true,
    result: 'Authentication failed',
  })
  // Act / Assert
  assert.throws(() => parseCursorWikiUpdateResult(failed), /did not complete/)
  assert.throws(() => parseCursorWikiUpdateResult('not json'), /unreadable/)
})
