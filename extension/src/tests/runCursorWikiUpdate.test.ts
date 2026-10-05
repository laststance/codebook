import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import * as constants from '../constants'
import { isProcessGone } from '../utils/isProcessGone'
import type * as RunCursorWikiUpdateModule from '../utils/runCursorWikiUpdate'
import {
  parseCursorWikiUpdateResult,
  runCursorWikiUpdate,
} from '../utils/runCursorWikiUpdate'
import { thrownMessage } from '../utils/thrownMessage'

import { loadModule } from './utils/loadModule'

/** Installs a stand-in `cursor-agent` in a private home and makes it the one the run finds, until `restore()`. */
async function installAgent(agentScript: string): Promise<{
  projectRoot: string
  restore(): Promise<void>
}> {
  const privateHome = await mkdtemp(join(tmpdir(), 'codebook-cursor-agent-'))
  const projectRoot = join(privateHome, 'project')
  const binaryDirectory = join(privateHome, '.local', 'bin')
  await mkdir(projectRoot)
  await mkdir(binaryDirectory, { recursive: true })
  await writeFile(
    join(binaryDirectory, 'cursor-agent'),
    `#!${process.execPath}\n${agentScript}\n`,
    { mode: 0o755 },
  )
  const previousHome = process.env.HOME
  process.env.HOME = privateHome
  return {
    projectRoot,
    async restore(): Promise<void> {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
      await rm(privateHome, { recursive: true, force: true })
    },
  }
}

/** Waits until a started process has written its id into a file of the project; fails when the run ends first or nothing is written within the limit, so an agent that never starts cannot hang the file. */
async function readProcessId(
  projectRoot: string,
  fileName: string,
  run: Promise<unknown>,
  limitMs = 5_000,
): Promise<number> {
  let runEnd: { failure: unknown } | undefined
  void run.then((failure) => {
    runEnd = { failure }
  })
  const deadline = Date.now() + limitMs
  for (;;) {
    const written = await readFile(join(projectRoot, fileName), 'utf8').catch(
      () => '',
    )
    if (written) return Number(written)
    // The run's own end means no id will ever be written.
    if (runEnd)
      throw new Error(
        `The agent ended before ${fileName} was written: ${thrownMessage(runEnd.failure)}`,
      )
    if (Date.now() >= deadline)
      throw new Error(`No ${fileName} was written within ${limitMs} ms.`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
}

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
      undefined,
      10_000,
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
      undefined,
      10_000,
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

test(
  'aborting the run stops the Cursor agent process and the run ends as cancelled only after it has closed',
  { timeout: 10_000 },
  async () => {
    // Arrange
    const privateHome = await mkdtemp(
      join(tmpdir(), 'codebook-cursor-update-abort-'),
    )
    const projectRoot = join(privateHome, 'project')
    const binaryDirectory = join(privateHome, '.local', 'bin')
    await mkdir(projectRoot)
    await mkdir(binaryDirectory, { recursive: true })
    // This agent records its process id and then works until it is stopped.
    await writeFile(
      join(binaryDirectory, 'cursor-agent'),
      `#!${process.execPath}
require('node:fs').writeFileSync(require('node:path').join(process.cwd(), 'agent.pid'), String(process.pid));
setInterval(() => {}, 1000);
`,
      { mode: 0o755 },
    )
    const previousHome = process.env.HOME
    process.env.HOME = privateHome
    const controller = new AbortController()
    try {
      const run = runCursorWikiUpdate(
        projectRoot,
        '/codebook Update LLM Wiki for this opened repository.',
        controller.signal,
        // Should the abort be ignored, this bound stops the agent, so a failing test leaves no process behind.
        3_000,
      ).catch((error: unknown) => error)
      const agentPid = await readProcessId(projectRoot, 'agent.pid', run)

      // Act
      controller.abort()
      const failure: unknown = await run

      // Assert
      assert.ok(failure instanceof Error)
      assert.equal(failure.message, 'The Wiki update was cancelled.')
      assert.throws(() => process.kill(agentPid, 0), { code: 'ESRCH' })
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
      await rm(privateHome, { recursive: true, force: true })
    }
  },
)

test('a cancel that arrives while the Cursor agent is still being located stops the agent and ends as cancelled', async () => {
  // Arrange
  const agent = await installAgent('setInterval(() => {}, 1000);')
  const controller = new AbortController()
  try {
    // Act
    const run = runCursorWikiUpdate(
      agent.projectRoot,
      '/codebook Update LLM Wiki for this opened repository.',
      controller.signal,
      // Should the cancel be lost, this bound ends the run, as a timeout.
      1_500,
    ).catch((error: unknown) => error)
    // The run is still looking for the executable: the abort comes in the same turn as the call.
    controller.abort()
    const failure: unknown = await run

    // Assert
    assert.equal(thrownMessage(failure), 'The Wiki update was cancelled.')
  } finally {
    await agent.restore()
  }
})

test('an update cancelled while the agent executable is looked up starts no agent process', async () => {
  // Arrange
  const agent = await installAgent('setInterval(() => {}, 1000);')
  let agentStarts = 0
  const boundary = await loadModule<typeof RunCursorWikiUpdateModule>(
    resolve(__dirname, '../utils/runCursorWikiUpdate.js'),
    {
      'node:child_process': {
        spawn: (...parameters: Parameters<typeof spawn>) => {
          agentStarts += 1
          return spawn(...parameters)
        },
      },
    },
  )
  const controller = new AbortController()
  try {
    // Act
    const run = boundary
      .runCursorWikiUpdate(
        agent.projectRoot,
        '/codebook Update LLM Wiki for this opened repository.',
        controller.signal,
        1_500,
      )
      .catch((error: unknown) => error)
    controller.abort()
    const failure: unknown = await run

    // Assert
    assert.equal(agentStarts, 0)
    assert.equal(thrownMessage(failure), 'The Wiki update was cancelled.')
  } finally {
    await agent.restore()
  }
})

test('a Cursor agent killed by a signal names the signal and sends the learner to Cursor chat', async () => {
  // Arrange
  const agent = await installAgent("process.kill(process.pid, 'SIGTERM');")
  try {
    // Act
    const failure: unknown = await runCursorWikiUpdate(
      agent.projectRoot,
      '/codebook Update LLM Wiki for this opened repository.',
      undefined,
      10_000,
    ).catch((error: unknown) => error)

    // Assert
    assert.equal(
      thrownMessage(failure),
      'Cursor Agent stopped on signal SIGTERM before finishing. Run "/codebook Update LLM Wiki" in Cursor chat to see its own message.',
    )
  } finally {
    await agent.restore()
  }
})

test(
  'a closing window hard-stops an agent that ignores the stop request within its shutdown grace',
  { timeout: 15_000 },
  async () => {
    // Arrange
    const agent = await installAgent(
      "process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(require('node:path').join(process.cwd(), 'agent.pid'), String(process.pid)); setInterval(() => {}, 1000);",
    )
    // A learner's cancel would wait 4 s for this agent; the closing window waits 200 ms.
    const boundary = await loadModule<typeof RunCursorWikiUpdateModule>(
      resolve(__dirname, '../utils/runCursorWikiUpdate.js'),
      {
        '../constants': {
          ...constants,
          WIKI_CURSOR_SHUTDOWN_GRACE_MS: 200,
          WIKI_CURSOR_TERMINATION_GRACE_MS: 4_000,
        },
      },
    )
    const controller = new AbortController()
    try {
      const run = boundary
        .runCursorWikiUpdate(
          agent.projectRoot,
          '/codebook Update LLM Wiki for this opened repository.',
          controller.signal,
          10_000,
        )
        .catch((error: unknown) => error)
      const agentPid = await readProcessId(agent.projectRoot, 'agent.pid', run)

      // Act
      const closedAtMs = Date.now()
      controller.abort('WikiUpdateWindowClosing')
      const failure: unknown = await run
      const stoppedAfterMs = Date.now() - closedAtMs

      // Assert
      assert.equal(thrownMessage(failure), 'The Wiki update was cancelled.')
      assert.equal(isProcessGone(agentPid), true)
      assert.ok(
        stoppedAfterMs >= 200 && stoppedAfterMs < 2_000,
        `the agent was stopped ${stoppedAfterMs} ms after the window began to close, for a shutdown grace of 200 ms`,
      )
    } finally {
      await agent.restore()
    }
  },
)

test(
  'an agent that exits on the stop request leaves no child of its process group running',
  { timeout: 15_000 },
  async () => {
    // Arrange
    // The agent starts a child in its own process group that ignores the stop request; the agent itself exits on it.
    const agent = await installAgent(
      "require('node:child_process').spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); require('node:fs').writeFileSync('child.pid', String(process.pid)); setInterval(() => {}, 1000);\"], { stdio: 'ignore' }); setInterval(() => {}, 1000);",
    )
    const controller = new AbortController()
    let childPid: number | undefined
    try {
      const run = runCursorWikiUpdate(
        agent.projectRoot,
        '/codebook Update LLM Wiki for this opened repository.',
        controller.signal,
        10_000,
      ).catch((error: unknown) => error)
      childPid = await readProcessId(agent.projectRoot, 'child.pid', run)

      // Act
      controller.abort()
      const failure: unknown = await run
      // A hard stop is delivered at once but not within the same turn.
      const deadline = Date.now() + 2_000
      while (!isProcessGone(childPid) && Date.now() < deadline)
        await new Promise((resolveWait) => setTimeout(resolveWait, 20))

      // Assert
      assert.equal(thrownMessage(failure), 'The Wiki update was cancelled.')
      assert.equal(isProcessGone(childPid), true)
    } finally {
      // A failing run must not leave the child behind.
      if (childPid !== undefined && !isProcessGone(childPid))
        process.kill(childPid, 'SIGKILL')
      await agent.restore()
    }
  },
)
