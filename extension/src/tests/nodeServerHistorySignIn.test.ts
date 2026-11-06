import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { before, test, type TestContext } from 'node:test'

import {
  nodeServerHistoryEntrySchema,
  nodeServerHistoryHeaderSchema,
  type NodeServerHistoryEntry,
  type NodeServerHistoryEntryInput,
  type NodeServerHistoryHeader,
} from '../nodeServerHistorySchemas'
import {
  acceptNodeServerEntry,
  newNodeServerJournalProgress,
} from '../utils/nodeServerJournalRules'

import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
  serverStopCapture,
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

/** A header input whose configuration declares `signIn` (written as format 3) or not (format 2). */
function headerInput(withSignIn: boolean) {
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  return withSignIn
    ? {
        ...header,
        configuration: { ...header.configuration, signIn: SIGN_IN_DECLARATION },
      }
    : header
}

/** A full header with the given format version, for the schema's refinement and the rules. */
function stampedHeader(
  withSignIn: boolean,
  formatVersion: 1 | 2 | 3,
): NodeServerHistoryHeader {
  return { ...headerInput(withSignIn), formatVersion }
}

const signedIn: NodeServerHistoryEntryInput = {
  type: 'sign-in',
  elapsedMs: 1,
  path: '/api/auth/sign-in/email',
  status: 200,
  outcome: 'signed-in',
  durationMs: 4,
}
const signInFailed: NodeServerHistoryEntryInput = {
  type: 'sign-in',
  elapsedMs: 1,
  path: '/api/auth/sign-in/email',
  status: 401,
  outcome: 'failed',
  code: 'SIGN_IN_REJECTED',
  durationMs: 4,
}
const request: NodeServerHistoryEntryInput = {
  type: 'request',
  elapsedMs: 5,
  attempt: 1,
  method: 'POST',
  path: '/api/items',
  bodyBytes: 0,
}
const sent: NodeServerHistoryEntryInput = {
  type: 'request-sent',
  elapsedMs: 6,
  attempt: 1,
}
const end: NodeServerHistoryEntryInput = {
  type: 'end',
  elapsedMs: 50,
  reason: 'stopped',
}

/**
 * Offers entries to the shared journal rules one by one, the way every reader does.
 * @param header - The history's header.
 * @param inputs - The entries without their sequence.
 * @returns The number of entries the rules accepted before the first refusal, and the progress then.
 */
function offerEntries(
  header: NodeServerHistoryHeader,
  inputs: NodeServerHistoryEntryInput[],
) {
  const progress = newNodeServerJournalProgress()
  let accepted = 0
  for (const [index, input] of inputs.entries()) {
    const entry: NodeServerHistoryEntry = nodeServerHistoryEntrySchema.parse({
      ...input,
      sequence: index + 1,
    })
    try {
      acceptNodeServerEntry(progress, entry, header)
    } catch {
      break
    }
    accepted++
  }
  return { accepted, progress }
}

// protects=a run that declared signIn is stamped header format 3 and every other run keeps 2; fails_when=a signIn run is written as 2 (an older Codebook then lists a header it cannot read) or a plain run as 3; no_claim=how an older Codebook reads the folder, which the unknown-version test below stands in for
test('a history is written with header format 3 only when its configuration has signIn', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(context)
  const withSignIn = headerInput(true)
  const without = headerInput(false)

  // Act
  const signInWriter = await repository.serverHistories.start(withSignIn)
  signInWriter.abandon()
  const plainWriter = await repository.serverHistories.start(without)
  plainWriter.abandon()
  const versionOf = async (studyId: string) =>
    JSON.parse(
      await readFile(
        join(learningDirectory, 'node-servers.v1', studyId, 'header.json'),
        'utf8',
      ),
    ).formatVersion

  // Assert
  assert.equal(await versionOf(withSignIn.studyId), 3)
  assert.equal(await versionOf(without.studyId), 2)
})

// protects=format 3 and signIn belong together; fails_when=3 without signIn, or 2 or 1 with signIn, parses; no_claim=the rest of the header
test('the header schema refuses format 3 without signIn and formats 1 and 2 with it', () => {
  // Arrange
  const cases = [
    { withSignIn: false, formatVersion: 3, accepted: false },
    { withSignIn: true, formatVersion: 2, accepted: false },
    { withSignIn: true, formatVersion: 1, accepted: false },
    { withSignIn: true, formatVersion: 3, accepted: true },
    { withSignIn: false, formatVersion: 2, accepted: true },
    { withSignIn: false, formatVersion: 1, accepted: true },
  ] as const

  // Act
  const results = cases.map(
    ({ withSignIn, formatVersion }) =>
      nodeServerHistoryHeaderSchema.safeParse(
        stampedHeader(withSignIn, formatVersion),
      ).success,
  )

  // Assert
  assert.deepEqual(results, [false, false, false, true, true, true])
})

// protects=a sign-in entry carries a code exactly when it failed, and no body, header or value; fails_when=a failed entry without a code, a signed-in one with a code or an unknown key parses; no_claim=the bounds of the path
test('the sign-in entry schema requires a code when it failed and refuses extra keys', () => {
  // Arrange
  const base = { ...signedIn, sequence: 1 }

  // Act
  const results = [
    nodeServerHistoryEntrySchema.safeParse({ ...base, outcome: 'failed' }),
    nodeServerHistoryEntrySchema.safeParse({ ...base, code: 'X' }),
    nodeServerHistoryEntrySchema.safeParse({ ...base, cookie: 'sid=1' }),
    nodeServerHistoryEntrySchema.safeParse({ ...base, status: null }),
    nodeServerHistoryEntrySchema.safeParse({
      ...base,
      outcome: 'failed',
      code: 'X',
      status: null,
    }),
  ].map((result) => result.success)

  // Assert
  assert.deepEqual(results, [false, false, false, true, true])
})

// protects=the ordering rules of the sign-in entry in a format 3 history; fails_when=a reader accepts a second sign-in, a sign-in after the request, a request after a failed sign-in or without a sign-in, or a sign-in in a format 2 history; no_claim=the writer's disk handling, which the sealed tests below drive
test('the journal rules accept a sign-in only once, first and in a format 3 history', () => {
  // Arrange
  const format3 = stampedHeader(true, 3)
  const format2 = stampedHeader(false, 2)

  // Act
  const counts = {
    signedInThenRequest: offerEntries(format3, [signedIn, request, sent])
      .accepted,
    secondSignIn: offerEntries(format3, [
      signedIn,
      { ...signedIn, elapsedMs: 2 },
    ]).accepted,
    afterRequest: offerEntries(format3, [
      signedIn,
      request,
      { ...signedIn, elapsedMs: 6 },
    ]).accepted,
    requestAfterFailure: offerEntries(format3, [signInFailed, request])
      .accepted,
    requestWithoutSignIn: offerEntries(format3, [request]).accepted,
    inFormat2: offerEntries(format2, [signedIn]).accepted,
    requestInFormat2: offerEntries(format2, [request, sent]).accepted,
  }

  // Assert
  assert.deepEqual(counts, {
    signedInThenRequest: 3,
    secondSignIn: 1,
    afterRequest: 2,
    requestAfterFailure: 1,
    requestWithoutSignIn: 0,
    inFormat2: 0,
    requestInFormat2: 2,
  })
})

// protects=a failed sign-in is the request's terminal entry and a signed-in one is not; fails_when=a failed sign-in leaves hasTerminal false or a signed-in one sets it; no_claim=the seal, covered below
test('a failed sign-in closes the request for good and a signed-in one does not', () => {
  // Arrange
  const format3 = stampedHeader(true, 3)

  // Act
  const failed = offerEntries(format3, [signInFailed, end]).progress
  const ok = offerEntries(format3, [signedIn, end]).progress

  // Assert
  assert.equal(failed.hasTerminal, true)
  assert.equal(ok.hasTerminal, false)
  assert.equal(ok.hasSignIn, true)
})

/** Writes a format 3 history with the given steps, seals it and reads it back. */
async function sealedSignInHistory(
  context: TestContext,
  steps: 'whole' | 'failed' | 'signed-in-only',
) {
  const { repository } = await openServerRepository(context)
  const header = headerInput(true)
  const writer = await repository.serverHistories.start(header)
  await writer.appendSignIn(
    steps === 'failed'
      ? {
          elapsedMs: 1,
          path: '/api/auth/sign-in/email',
          status: 401,
          outcome: 'failed',
          code: 'SIGN_IN_REJECTED',
          durationMs: 4,
        }
      : {
          elapsedMs: 1,
          path: '/api/auth/sign-in/email',
          status: 200,
          outcome: 'signed-in',
          durationMs: 4,
        },
  )
  if (steps === 'whole') {
    await writer.appendRequest({
      elapsedMs: 5,
      attempt: 1,
      method: 'POST',
      path: '/api/items',
      bodyBytes: 0,
    })
    await writer.appendRequestSent({ elapsedMs: 6, attempt: 1 })
    await writer.appendStop(
      serverStopCapture({
        declaredStopIndex: 0,
        hit: 1,
        line: 2,
        elapsedMs: 10,
      }),
    )
    await writer.appendResponse({
      elapsedMs: 20,
      status: 201,
      contentType: 'application/json',
      body: '{}',
      bodyBytes: 2,
      readCut: false,
      location: null,
      requestDurationMs: 14,
    })
  }
  await writer.seal({ elapsedMs: 60, reason: 'stopped' })
  return repository.serverHistories.read(header.studyId)
}

// protects=a signed-in run that reached its stop and its response seals complete with the sign-in kept in the recording; fails_when=the sign-in breaks the order, drops from the entries or makes the seal partial; no_claim=a real server or a real sign-in
test('a sign-in followed by the request, a stop and the response seals complete and keeps the sign-in entry', async (context) => {
  // Arrange / Act
  const opened = await sealedSignInHistory(context, 'whole')

  // Assert
  assert.equal(opened.status, 'complete')
  assert.equal(opened.entries[0]?.type, 'sign-in')
  assert.equal(opened.header.formatVersion, 3)
})

// protects=a failed sign-in plus the end is a whole story with the failure code as its terminal and no request; fails_when=the seal reads it interrupted, drops the folder as empty or loses the code; no_claim=that the replay shows the stops, which were never reached
test('a failed sign-in followed by the end seals as a whole story with its code', async (context) => {
  // Arrange / Act
  const opened = await sealedSignInHistory(context, 'failed')
  const signIn = opened.entries.find((entry) => entry.type === 'sign-in')

  // Assert
  assert.equal(opened.status, 'partial')
  assert.equal(opened.reason?.includes('SIGN_IN_REJECTED'), true)
  assert.equal(signIn?.type === 'sign-in' && signIn.code, 'SIGN_IN_REJECTED')
})

// protects=a signed-in run that ended without any request has no terminal entry, so its seal reads partial; fails_when=it seals complete; no_claim=why the run ended
test('a sign-in followed only by the end seals partial', async (context) => {
  // Arrange / Act
  const opened = await sealedSignInHistory(context, 'signed-in-only')

  // Assert
  assert.equal(opened.status, 'partial')
  assert.equal(opened.entries.length >= 2, true)
})

// protects=the writer refuses a request after a failed sign-in and a sign-in in a format 2 history; fails_when=either entry reaches the journal; no_claim=the message wording
test('the writer refuses a request after a failed sign-in and a sign-in in a format 2 history', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const failedWriter = await repository.serverHistories.start(headerInput(true))
  const plainWriter = await repository.serverHistories.start(headerInput(false))
  await failedWriter.appendSignIn({
    elapsedMs: 1,
    path: '/login',
    status: 401,
    outcome: 'failed',
    code: 'SIGN_IN_REJECTED',
    durationMs: 3,
  })

  // Act
  const requestAfterFailure = failedWriter.appendRequest({
    elapsedMs: 2,
    attempt: 1,
    method: 'GET',
    path: '/x',
    bodyBytes: 0,
  })
  const signInInFormat2 = plainWriter.appendSignIn({
    elapsedMs: 1,
    path: '/login',
    status: 200,
    outcome: 'signed-in',
    durationMs: 3,
  })

  // Assert
  await assert.rejects(requestAfterFailure)
  await assert.rejects(signInInFormat2)
})

// protects=a header of a format version this Codebook does not know is not listed, not counted and never deleted (the rule a Codebook without format 3 follows); fails_when=it is listed, counted or its folder removed; no_claim=what a newer Codebook writes into it
test('a node-server header of an unknown format version is not listed, not counted and stays on disk', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(context)
  const header = { ...headerInput(true), formatVersion: 4 }
  const folder = join(learningDirectory, 'node-servers.v1', header.studyId)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'header.json'), JSON.stringify(header))
  await writeFile(join(folder, 'events.jsonl'), '')

  // Act
  const listed = await repository.serverHistories.list()
  const counted = await repository.serverHistories.countListedHistories(10)

  // Assert
  assert.deepEqual(listed, [])
  assert.equal(counted, 0)
  assert.equal(existsSync(folder), true)
})

// protects=histories saved before sign-in (format 2 and 1 headers) still parse; fails_when=the refinement rejects a plain header; no_claim=their seals, which the existing suites cover
test('format 2 and format 1 headers without signIn still parse', () => {
  // Arrange
  const headers = [stampedHeader(false, 2), stampedHeader(false, 1)]

  // Act
  const parsed = headers.map(
    (header) => nodeServerHistoryHeaderSchema.parse(header).formatVersion,
  )

  // Assert
  assert.deepEqual(parsed, [2, 1])
})
