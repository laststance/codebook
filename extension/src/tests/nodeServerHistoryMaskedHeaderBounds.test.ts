import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { before, test } from 'node:test'

import { REDACTION_MASK } from '../constants'
import { nodeServerConfigSchema } from '../nodeServerConfigSchemas'
import type { NodeServerHistoryRecorder } from '../nodeServerHistoryRecorder'
import {
  nodeServerHistoryHeaderSchema,
  type NodeServerHistoryHeader,
} from '../nodeServerHistorySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { maskSavedServerHeader } from '../utils/maskSavedServerHeader'
import { startNodeServerHistory } from '../utils/startNodeServerHistory'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

/** The longest request path a declaration and a history header both accept, in characters. */
const PATH_LIMIT = 2_048

/** The largest request body a declaration and a history header both accept, in UTF-8 bytes. */
const BODY_LIMIT_BYTES = 16_384

/** A request path of exactly {@link PATH_LIMIT} characters that ends in a callback `code` of one character, which masking lengthens by seven. */
const NEAR_LIMIT_CALLBACK_PATH = `/cb?pad=${'a'.repeat(2_033)}&code=x`

/**
 * A JSON body of exactly {@link BODY_LIMIT_BYTES} bytes whose `password` property is empty, so masking it to the redaction mask lengthens the body by eight bytes.
 * @example NEAR_LIMIT_JSON_BODY.length // => 16_384
 */
const NEAR_LIMIT_JSON_BODY = `{"password":"","pad":"${'a'.repeat(16_384 - 24)}"}`

/** The one request entry a history needs for its seal to keep the folder (an empty history is removed when it is sealed). */
const ONE_REQUEST = {
  elapsedMs: 1,
  attempt: 1,
  method: 'GET',
  path: '/x',
  bodyBytes: 0,
} as const

/**
 * Records one request and seals the run's history the way Stop does, so the store keeps the folder the test then reads.
 * @param recorder - The recorder {@link startNodeServerHistory} returned.
 * @example await sealWithOneRequest(begun.recorder)
 */
async function sealWithOneRequest(
  recorder: NodeServerHistoryRecorder,
): Promise<void> {
  await recorder.writer.appendRequest(ONE_REQUEST)
  await recorder.seal({ elapsedMs: 5, reason: 'stopped' }, 10_000)
}

/**
 * Starts the history of a node-server run that declares the given request, the way the service starts it, and returns the recorder with the repository and the study id.
 * @param context - The test whose end removes the learning directory.
 * @param request - The declared request.
 * @returns The outcome of the start, the repository and the history's study id.
 * @example const { begun, repository, studyId } = await startHistoryDeclaring(context, { method: 'GET', path: '/x' })
 */
async function startHistoryDeclaring(
  context: Parameters<typeof openServerRepository>[0],
  request: Record<string, unknown>,
) {
  const { repository, learningDirectory } = await openServerRepository(context)
  const declared = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY).configuration
  const configuration = nodeServerConfigSchema.parse({ ...declared, request })
  const descriptor = createConfiguredStudy().descriptor
  assert.ok(descriptor)
  const instanceId = randomUUID()
  const runId = randomUUID()
  const begun = await startNodeServerHistory({
    repository,
    workspace: learningDirectory,
    instanceId,
    runId,
    createdAtMs: Date.parse('2026-11-03T00:00:00.000Z'),
    prepared: {
      configuration,
      configurationHash: sha256(JSON.stringify(configuration)),
      descriptor,
    },
    hideRoots: (text) => text,
    describeCause: (error) =>
      error instanceof Error ? error.message : String(error),
  })
  return { begun, repository, studyId: `${instanceId}_${runId}` }
}

// protects=a Node server run that declares a request path at the 2,048-character limit still records and saves its history when the callback code in it is masked, with the stored path cut to the limit and no value of the code left; fails_when=the header stores the lengthened masked path, the header schema refuses it, and the run goes on with no history; no_claim=which part of the cut mask stays (a bare opening bracket) or the path actually sent, which is unchanged
test('a request path at the length limit with a callback code starts a history that seals with the code masked and the path cut to the limit', async (context) => {
  // Arrange
  assert.equal(NEAR_LIMIT_CALLBACK_PATH.length, PATH_LIMIT)

  // Act
  const { begun, repository, studyId } = await startHistoryDeclaring(context, {
    method: 'GET',
    path: NEAR_LIMIT_CALLBACK_PATH,
  })

  // Assert
  assert.equal(
    'unavailable' in begun ? begun.unavailable : undefined,
    undefined,
  )
  assert.ok('recorder' in begun)
  await sealWithOneRequest(begun.recorder)
  assert.equal(begun.recorder.status, 'sealed')
  const { header } = await repository.serverHistories.read(studyId)
  assert.equal(header.configuration.request.path.length, PATH_LIMIT)
  assert.equal(header.declaredRequest.path.length, PATH_LIMIT)
  assert.equal(header.declaredRequest.path, header.configuration.request.path)
  assert.equal(header.declaredRequest.path.includes('code=x'), false)
  assert.equal(header.declaredRequest.path.endsWith('&code=['), true)
})

// protects=a Node server run that declares a JSON body at the 16,384-byte limit with a secret-named property still records its history, with the stored body cut to the limit and the property masked; fails_when=the header stores the body lengthened by the mask, the configuration schema refuses it, and the run goes on with no history; no_claim=the body actually sent, or that the cut body is still valid JSON
test('a JSON request body at the size limit with a secret-named property starts a history that seals with the body cut to the limit', async (context) => {
  // Arrange
  assert.equal(Buffer.byteLength(NEAR_LIMIT_JSON_BODY), BODY_LIMIT_BYTES)

  // Act
  const { begun, repository, studyId } = await startHistoryDeclaring(context, {
    method: 'POST',
    path: '/api/login',
    contentType: 'application/json',
    body: NEAR_LIMIT_JSON_BODY,
  })

  // Assert
  assert.equal(
    'unavailable' in begun ? begun.unavailable : undefined,
    undefined,
  )
  assert.ok('recorder' in begun)
  await sealWithOneRequest(begun.recorder)
  assert.equal(begun.recorder.status, 'sealed')
  const { header } = await repository.serverHistories.read(studyId)
  const storedBody = header.configuration.request.body ?? ''
  assert.equal(Buffer.byteLength(storedBody), BODY_LIMIT_BYTES)
  assert.equal(storedBody.startsWith(`{"password":"${REDACTION_MASK}"`), true)
})

// protects=a request body whose mask makes the cut fall inside a multi-byte character is cut before that character, so the stored body is valid text within the byte limit; fails_when=the cut splits the character and the body holds a replacement character, or the cut is skipped and the body passes the limit; no_claim=bodies that fit after masking, which are stored as masked
test('a request body that masking lengthens is cut before the multi-byte character the byte limit falls inside', async (context) => {
  // Arrange
  // The mask adds eight bytes, so the 16,384th byte of the masked body is the second byte of the é.
  const body = `{"password":"","pad":"${'a'.repeat(16_353)}é${'a'.repeat(5)}"}`
  assert.equal(Buffer.byteLength(body), BODY_LIMIT_BYTES)

  // Act
  const { begun, repository, studyId } = await startHistoryDeclaring(context, {
    method: 'POST',
    path: '/api/login',
    contentType: 'application/json',
    body,
  })

  // Assert
  assert.equal(
    'unavailable' in begun ? begun.unavailable : undefined,
    undefined,
  )
  assert.ok('recorder' in begun)
  await sealWithOneRequest(begun.recorder)
  const { header } = await repository.serverHistories.read(studyId)
  const storedBody = header.configuration.request.body ?? ''
  assert.equal(Buffer.byteLength(storedBody), 16_383)
  assert.equal(storedBody.includes('\uFFFD'), false)
  assert.equal(storedBody.endsWith('a'), true)
})

// protects=a saved header whose declared path is at the 2,048-character limit with a callback code is served masked and still within the header schema, in the configuration and in the declared request; fails_when=serving masks the saved path again without the cut, so the served header is 2,055 characters and the schema refuses it; no_claim=the entries of the history, which have their own mask
test('a saved header whose request path is at the length limit is served with the callback code masked and the path within the schema', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const fixture = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const saved = {
    ...fixture,
    configuration: {
      ...fixture.configuration,
      request: {
        ...fixture.configuration.request,
        path: NEAR_LIMIT_CALLBACK_PATH,
      },
    },
    declaredRequest: {
      ...fixture.declaredRequest,
      path: NEAR_LIMIT_CALLBACK_PATH,
    },
  }
  const writer = await repository.serverHistories.start(saved)
  await writer.appendRequest(ONE_REQUEST)
  await writer.seal({ elapsedMs: 5, reason: 'stopped' })
  const { header } = await repository.serverHistories.read(saved.studyId)

  // Act
  const served: NodeServerHistoryHeader = maskSavedServerHeader(header)

  // Assert
  assert.equal(header.declaredRequest.path, NEAR_LIMIT_CALLBACK_PATH)
  assert.equal(served.configuration.request.path.length, PATH_LIMIT)
  assert.equal(served.declaredRequest.path.length, PATH_LIMIT)
  assert.equal(served.declaredRequest.path.includes('code=x'), false)
  assert.equal(served.configuration.request.path.includes('code=x'), false)
  assert.equal(nodeServerHistoryHeaderSchema.safeParse(served).success, true)
})

// protects=a header the builder already masked and cut is served again within the schema and unchanged in length, so serving a new history never lengthens its path; fails_when=the cut leaves a bare opening bracket that serving masks again into a full mask and the served path passes the limit; no_claim=the path's content beyond its length
test('a header stored with its path already cut is served again at the same length', async (context) => {
  // Arrange
  const { begun, repository, studyId } = await startHistoryDeclaring(context, {
    method: 'GET',
    path: NEAR_LIMIT_CALLBACK_PATH,
  })
  assert.ok('recorder' in begun)
  await sealWithOneRequest(begun.recorder)
  const { header } = await repository.serverHistories.read(studyId)

  // Act
  const served = maskSavedServerHeader(header)

  // Assert
  assert.equal(served.declaredRequest.path.length, PATH_LIMIT)
  assert.equal(served.declaredRequest.path, header.declaredRequest.path)
  assert.equal(nodeServerHistoryHeaderSchema.safeParse(served).success, true)
})
