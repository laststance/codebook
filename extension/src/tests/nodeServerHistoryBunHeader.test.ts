import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { before, test } from 'node:test'

import { nodeServerHistoryHeaderSchema } from '../nodeServerHistorySchemas'
import { nodeServerHistoryHeaderFormatOf } from '../utils/nodeServerHistoryHeaderFormat'

import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

const SIGN_IN_DECLARATION = {
  path: '/api/auth/sign-in/email',
  fields: { email: 'learner@example.test' },
  secretField: 'password',
  secret: 'ask-learner',
} as const

/**
 * Builds a header input for a run of the given loader, with or without `signIn`.
 * @param loader - The run's loader.
 * @param withSignIn - Whether the run declared `signIn`.
 * @returns A header input the writer stamps.
 * @example headerInput('bun', false)
 */
function headerInput(loader: 'bun' | 'tsx', withSignIn: boolean) {
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  return {
    ...header,
    configuration: {
      ...header.configuration,
      loader,
      ...(withSignIn && { signIn: SIGN_IN_DECLARATION }),
    },
  }
}

// protects=a Bun run's replay header gets a format an older Codebook does not know (listed there as saved by a newer Codebook), while tsx runs keep formats 2 and 3; fails_when=a Bun run is written as 2 or 3, so an older Codebook reads its loader as corrupt; no_claim=how an older Codebook lists the folder
test('a history header is written as format 4 for a Bun run, 5 for Bun with signIn, and keeps 2 and 3 for tsx runs', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(context)
  const inputs = {
    bun: headerInput('bun', false),
    bunSignIn: headerInput('bun', true),
    tsx: headerInput('tsx', false),
    tsxSignIn: headerInput('tsx', true),
  }
  // Act
  const versions: Record<string, unknown> = {}
  for (const [name, input] of Object.entries(inputs)) {
    const writer = await repository.serverHistories.start(input)
    writer.abandon()
    versions[name] = JSON.parse(
      await readFile(
        join(
          learningDirectory,
          'node-servers.v1',
          input.studyId,
          'header.json',
        ),
        'utf8',
      ),
    ).formatVersion
  }
  // Assert
  assert.deepEqual(versions, { bun: 4, bunSignIn: 5, tsx: 2, tsxSignIn: 3 })
})

// protects=the header schema reads every format and ties formats 4 and 5 to loader bun; fails_when=a bun header at format 1, 2 or 3 parses, or a non-bun header at 4 or 5 parses; no_claim=the rest of the header
test('the header schema accepts every format for its own run and refuses a Bun run at an older format', () => {
  // Arrange
  const cases = [
    { loader: 'bun', withSignIn: false, formatVersion: 4, accepted: true },
    { loader: 'bun', withSignIn: true, formatVersion: 5, accepted: true },
    { loader: 'bun', withSignIn: false, formatVersion: 2, accepted: false },
    { loader: 'bun', withSignIn: false, formatVersion: 1, accepted: false },
    { loader: 'bun', withSignIn: true, formatVersion: 3, accepted: false },
    { loader: 'bun', withSignIn: true, formatVersion: 4, accepted: false },
    { loader: 'tsx', withSignIn: false, formatVersion: 4, accepted: false },
    { loader: 'tsx', withSignIn: true, formatVersion: 5, accepted: false },
    { loader: 'tsx', withSignIn: false, formatVersion: 2, accepted: true },
    { loader: 'tsx', withSignIn: false, formatVersion: 1, accepted: true },
    { loader: 'tsx', withSignIn: true, formatVersion: 3, accepted: true },
  ] as const
  // Act
  const results = cases.map(
    ({ loader, withSignIn, formatVersion }) =>
      nodeServerHistoryHeaderSchema.safeParse({
        ...headerInput(loader, withSignIn),
        formatVersion,
      }).success,
  )
  // Assert
  assert.deepEqual(
    results,
    cases.map(({ accepted }) => accepted),
  )
})

// protects=the format a configuration is written with is the one named by its loader and signIn; fails_when=the mapping changes for any of the four kinds of run; no_claim=the stored header
test('the header format of a configuration follows its loader and signIn', () => {
  // Arrange / Act
  const formats = [
    nodeServerHistoryHeaderFormatOf({ loader: 'tsx' }),
    nodeServerHistoryHeaderFormatOf({ loader: 'node', signIn: {} }),
    nodeServerHistoryHeaderFormatOf({ loader: 'bun' }),
    nodeServerHistoryHeaderFormatOf({ loader: 'bun', signIn: {} }),
  ]
  // Assert
  assert.deepEqual(formats, [2, 3, 4, 5])
})
