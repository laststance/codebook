import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type { WikiFreshness } from '../utils/inspectDeepWikiFreshness'
import type { WikiUpdateStatus } from '../utils/wikiUpdateRun'

import {
  openWikiUpdateWindow,
  type CancellableProgress,
} from './utils/wikiUpdateWindow'

const CURRENT: WikiFreshness = {
  status: 'current',
  changedPaths: [],
  addedPaths: [],
}

/** Opens a window on a project with a hand-written published Wiki and records what the learner sees of an update. */
async function openWikiWindow(
  options: Omit<
    Parameters<typeof openWikiUpdateWindow>[0],
    'projectRoot' | 'outputSetting'
  > & { outputSetting?: string } = {},
) {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'codebook-wiki-flow-'))
  const projectRoot = await realpath(projectDirectory)
  const outputSetting = options.outputSetting ?? '.codebook/wiki'
  const outputDirectory = join(projectRoot, outputSetting)
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(join(outputDirectory, 'index.html'), '<title>Wiki</title>')
  const manifestPath = join(outputDirectory, 'codebook-wiki.json')
  /** Writes the published manifest the way an agent's publish would change it. */
  const publish = (
    sourceHash: string,
    excludedPaths: string[] = [],
  ): Promise<void> =>
    writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        repositoryRoot: projectRoot,
        generated: { revision: 'a1b2c3d4e5f6a7b8' },
        pages: [],
        assets: [],
        excludedPaths,
        includedSources: [{ path: 'src/a.ts', sha256: sourceHash }],
      }),
    )
  await publish('a'.repeat(64))
  const window = await openWikiUpdateWindow({
    ...options,
    projectRoot,
    outputSetting,
  })
  return {
    ...window,
    projectRoot,
    outputDirectory,
    manifestPath,
    publish,
    async close(): Promise<void> {
      await window.close()
      await rm(projectDirectory, { recursive: true, force: true })
    },
  }
}

/** Waits until the update state leaves `running`, polling the way the reader page does. */
async function waitForEnd(
  status: () => WikiUpdateStatus,
  limitMs = 6_000,
): Promise<WikiUpdateStatus> {
  const deadline = Date.now() + limitMs
  while (status().state === 'running' && Date.now() < deadline)
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  return status()
}

test('a VS Code Wiki update shows running, then the new identity once the editor agent publishes', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  try {
    // Act
    await wiki.clickUpdate()
    const whileWaiting = wiki.status()
    wiki.setFreshness(CURRENT)
    await wiki.publish('b'.repeat(64))
    const ended = await waitForEnd(wiki.status)

    // Assert
    assert.equal(whileWaiting.state, 'running')
    assert.equal(ended.state, 'succeeded')
    assert.match(
      ended.state === 'succeeded' ? ended.identity : '',
      /^a1b2c3d4e5f6\+[0-9a-f]{8}$/,
    )
    assert.deepEqual(
      wiki.chatRequests.map((request) => request.name),
      ['workbench.action.chat.open'],
    )
  } finally {
    await wiki.close()
  }
})

test('cancelling a VS Code Wiki update ends it as cancelled and leaves the published site byte-identical', async () => {
  // Arrange
  const progress: CancellableProgress[] = []
  const wiki = await openWikiWindow({ cancellable: progress })
  const manifestBefore = await readFile(wiki.manifestPath)
  const indexBefore = await readFile(join(wiki.outputDirectory, 'index.html'))
  try {
    await wiki.clickUpdate()

    // Act
    progress[0]!.cancel()
    const ended = await waitForEnd(wiki.status)

    // Assert
    assert.equal(ended.state, 'cancelled')
    assert.deepEqual(await readFile(wiki.manifestPath), manifestBefore)
    assert.deepEqual(
      await readFile(join(wiki.outputDirectory, 'index.html')),
      indexBefore,
    )
  } finally {
    await wiki.close()
  }
})

test('a Wiki that already matches the source says so and opens no chat request', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  wiki.setFreshness(CURRENT)
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    assert.equal(wiki.status().state, 'already-current')
    assert.deepEqual(wiki.chatRequests, [])
    assert.deepEqual(wiki.notices, [
      'This project’s LLM Wiki already matches the current source; nothing to update.',
    ])
  } finally {
    await wiki.close()
  }
})

test('a chat that cannot open ends the update as failed with its reason instead of staying running', async () => {
  // Arrange
  const wiki = await openWikiWindow({ chatFails: true })
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'failed')
    assert.equal(
      status.state === 'failed' ? status.reason : '',
      'Chat is unavailable',
    )
    assert.equal(wiki.errors.length, 1)
  } finally {
    await wiki.close()
  }
})

test('a learner file the update candidate would overwrite ends the run as a conflict naming that file', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  await mkdir(join(wiki.outputDirectory, 'pages'), { recursive: true })
  await writeFile(join(wiki.outputDirectory, 'pages', 'overview.html'), 'mine')
  const stage = `${wiki.outputDirectory}.stage-1`
  await mkdir(stage)
  await writeFile(
    join(stage, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      pages: [{ path: 'pages/overview.html' }],
      assets: [],
    }),
  )
  // The candidate counts only when it was prepared after the click; its folder is dated ahead of it.
  const future = new Date(Date.now() + 60_000)
  await utimes(stage, future, future)
  try {
    // Act
    await wiki.clickUpdate()
    const ended = await waitForEnd(wiki.status)

    // Assert
    assert.equal(ended.state, 'conflict')
    assert.deepEqual(ended.state === 'conflict' ? ended.paths : [], [
      'pages/overview.html',
    ])
    assert.equal(
      await readFile(
        join(wiki.outputDirectory, 'pages', 'overview.html'),
        'utf8',
      ),
      'mine',
    )
  } finally {
    await wiki.close()
  }
})

test('a configured Wiki output folder is the one the update state names', async () => {
  // Arrange
  const wiki = await openWikiWindow({ outputSetting: 'docs/my-wiki' })
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'running')
    assert.equal(
      status.state === 'running' ? status.outputDirectory : '',
      join(wiki.projectRoot, 'docs/my-wiki'),
    )
  } finally {
    await wiki.close()
  }
})

test('a Cursor Wiki update that fails ends as failed with the agent message and keeps the site', async () => {
  // Arrange
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async () => {
      throw new Error('Cursor Agent exited with code 1.')
    },
  })
  const manifestBefore = await readFile(wiki.manifestPath)
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'failed')
    assert.equal(
      status.state === 'failed' ? status.reason : '',
      'Cursor Agent exited with code 1.',
    )
    assert.deepEqual(await readFile(wiki.manifestPath), manifestBefore)
  } finally {
    await wiki.close()
  }
})

test('a Cursor Wiki update the learner cancels ends as cancelled, not failed', async () => {
  // Arrange
  const progress: CancellableProgress[] = []
  const wiki = await openWikiWindow({
    cursor: true,
    cancellable: progress,
    cursorAgent: async () => {
      progress[0]!.cancel()
      throw new Error('The Wiki update was cancelled.')
    },
  })
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    assert.equal(wiki.status().state, 'cancelled')
  } finally {
    await wiki.close()
  }
})

test('a Cursor Wiki update that publishes ends as succeeded with the new identity', async () => {
  // Arrange
  let publishNew: (() => Promise<void>) | undefined
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async () => {
      await publishNew!()
      return 'Updated'
    },
  })
  publishNew = async (): Promise<void> => {
    wiki.setFreshness(CURRENT)
    await wiki.publish('c'.repeat(64))
  }
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'succeeded')
    assert.match(
      status.state === 'succeeded' ? status.identity : '',
      /^a1b2c3d4e5f6\+[0-9a-f]{8}$/,
    )
  } finally {
    await wiki.close()
  }
})

test('a VS Code update that publishes the same sources and revision again still ends as succeeded', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  try {
    await wiki.clickUpdate()

    // Act: the agent resolves the stale state by excluding a new file; sources and revision stay as they were.
    wiki.setFreshness(CURRENT)
    await wiki.publish('a'.repeat(64), ['scratch'])
    const ended = await waitForEnd(wiki.status)

    // Assert
    assert.equal(ended.state, 'succeeded')
    assert.equal(
      ended.state === 'succeeded' ? ended.identity : '',
      'a1b2c3d4e5f6+296fae53',
    )
  } finally {
    await wiki.close()
  }
})

test('a publish that no longer matches the source says the site was replaced and how many files changed', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  try {
    await wiki.clickUpdate()

    // Act
    wiki.setFreshness({
      status: 'changed',
      changedPaths: ['src/a.ts', 'src/b.ts'],
      addedPaths: [],
    })
    await wiki.publish('b'.repeat(64))
    const ended = await waitForEnd(wiki.status)

    // Assert
    assert.equal(ended.state, 'failed')
    assert.equal(ended.state === 'failed' ? ended.site : '', 'replaced')
    assert.equal(
      ended.state === 'failed' ? ended.reason : '',
      'The editor agent published a new Wiki, but 2 source files changed while it worked (first: src/a.ts). Press Update LLM Wiki again.',
    )
  } finally {
    await wiki.close()
  }
})

test('a publish Codebook cannot check against the source passes the reason on and says a retry will not help', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  try {
    await wiki.clickUpdate()

    // Act
    wiki.setFreshness({
      status: 'unknown',
      changedPaths: [],
      addedPaths: [],
      reason:
        'Added source files could not be checked against the generated revision.',
    })
    await wiki.publish('b'.repeat(64))
    const ended = await waitForEnd(wiki.status)

    // Assert
    assert.equal(ended.state, 'failed')
    assert.equal(ended.state === 'failed' ? ended.site : '', 'replaced')
    assert.equal(
      ended.state === 'failed' ? ended.reason : '',
      'The editor agent published a new Wiki, but Codebook cannot check it against the source: Added source files could not be checked against the generated revision. Updating again will not change this; ask the editor chat to republish with the full commit hash in generated.revision.',
    )
  } finally {
    await wiki.close()
  }
})

test('a Cursor update that runs past its bound ends as timed out, the state VS Code reports for the same event', async () => {
  // Arrange
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async () => {
      const timedOut = new Error('Cursor Agent timed out updating the Wiki.')
      timedOut.name = 'WikiUpdateTimedOut'
      throw timedOut
    },
  })
  try {
    // Act
    await wiki.clickUpdate().catch(() => {})

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'timed-out')
    assert.equal(status.state === 'timed-out' ? status.site : '', 'kept')
    assert.equal(status.state === 'timed-out' ? status.timeoutMs : 0, 900_000)
  } finally {
    await wiki.close()
  }
})

test('a Cursor agent that publishes and then fails is shown as a failure that replaced the site, not one that kept it', async () => {
  // Arrange
  let publishNew: (() => Promise<void>) | undefined
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async () => {
      await publishNew?.()
      throw new Error('Cursor Agent stopped with exit code 1 before finishing.')
    },
  })
  publishNew = (): Promise<void> => wiki.publish('c'.repeat(64))
  try {
    // Act
    await wiki.clickUpdate().catch(() => {})

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'failed')
    assert.equal(status.state === 'failed' ? status.site : '', 'replaced')
    assert.equal(
      status.state === 'failed' ? status.reason : '',
      'Cursor Agent stopped with exit code 1 before finishing.',
    )
  } finally {
    await wiki.close()
  }
})

test('a Cursor agent that ends its turn without publishing is a failure that kept the site', async () => {
  // Arrange
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async () => 'I could not update the Wiki.',
  })
  const manifestBefore = await readFile(wiki.manifestPath)
  try {
    // Act
    await wiki.clickUpdate().catch(() => {})

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'failed')
    assert.equal(status.state === 'failed' ? status.site : '', 'kept')
    assert.equal(
      status.state === 'failed' ? status.reason : '',
      'Cursor Agent finished without publishing a new Wiki. Run "/codebook Update LLM Wiki" in the editor chat to see its own message.',
    )
    assert.deepEqual(await readFile(wiki.manifestPath), manifestBefore)
  } finally {
    await wiki.close()
  }
})
