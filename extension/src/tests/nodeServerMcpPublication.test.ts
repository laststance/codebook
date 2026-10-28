import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { StudyError } from '../errors'
import { nodeServerHelp } from '../nodeServerHelp'
import { readResource } from '../resources'
import { sha256 } from '../runtimeSupport/utils/sha256'
import {
  explainNodeHistorySchema,
  type ExplainNodeHistoryInput,
} from '../schemas'

import { createHarness } from './helpers'
import { HANDLER_SOURCE_TEXT } from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { startHistoryServerRun } from './utils/startHistoryServerRun'

before(async () => {
  await realProcessStart(process.pid)
})

const SOURCE_HASH = sha256(HANDLER_SOURCE_TEXT)

/** One step of a node history's learning material. */
type Step = ExplainNodeHistoryInput['content']['steps'][number]

/** A stopped server run with a sealed history of two stops and a response, and the study id the agent cites. */
async function sealedRun(context: Parameters<typeof startHistoryServerRun>[1]) {
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startHistoryServerRun(harness, context)
  const { service, record, run } = started
  await run.sendRequest('k1')
  run.pauseAt(0)
  run.pauseAt(1)
  run.respond()
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const studyId = `${service.instanceId}_${record.id}`
  const entries = (await started.repository.serverHistories.read(studyId))
    .entries
  const sequenceOf = (type: string, nth = 0): number =>
    entries.filter((entry) => entry.type === type)[nth]!.sequence
  const content = (steps: Step[]): ExplainNodeHistoryInput['content'] => ({
    question: 'How is the health route answered?',
    title: 'Health route',
    summary: 'One request, two stops, a response.',
    participants: [{ id: 'server', label: 'Server' }],
    steps,
  })
  const step = (id: string, reference: Step['reference']): Step => ({
    id,
    from: 'server',
    to: 'server',
    label: id,
    explanation: id,
    evidence: 'observed' as const,
    reference,
  })
  return { ...started, studyId, entries, sequenceOf, content, step }
}

// protects=a sealed server run's resource names its history, its verdicts and what is missing, offers save-node-learning until the chat's material covers it, and agrees with the history resource; fails_when=a verdict is missing, the action stays after coverage is complete, or the two resources disagree; no_claim=the library row
test('the sealed server run resource and the history resource agree on coverage and offer save-node-learning until it is complete', async (context) => {
  // Arrange
  const sealed = await sealedRun(context)
  const { service, record, studyId } = sealed
  const before = service.state(record)

  // Act
  await service.explainNodeHistory({
    studyId,
    expectedRevision: 0,
    content: sealed.content([
      sealed.step('request', {
        type: 'request',
        sequence: sealed.sequenceOf('request'),
      }),
      sealed.step('s1', {
        type: 'stop',
        sequence: sealed.sequenceOf('stop', 0),
        sourceHash: SOURCE_HASH,
      }),
      sealed.step('s2', {
        type: 'stop',
        sequence: sealed.sequenceOf('stop', 1),
        sourceHash: SOURCE_HASH,
      }),
      sealed.step('response', {
        type: 'response',
        sequence: sealed.sequenceOf('response'),
      }),
    ]),
  })
  const after = service.state(record)
  const historyResource = await readResource(
    service,
    `codebook://node-history/${studyId}`,
  )
  const page = JSON.parse(
    'text' in historyResource ? historyResource.text : '{}',
  ) as { content: string }
  const history = JSON.parse(page.content) as { learningCoverage?: string }

  // Assert
  assert.equal(before.nodeServer?.history, 'sealed')
  assert.equal(
    before.nodeServer?.historyUri,
    `codebook://node-history/${studyId}`,
  )
  assert.equal(before.nodeServer?.learningCoverage, 'none')
  assert.deepEqual(before.nodeServer?.captureMissing, [])
  assert.ok(before.nextActions.includes('save-node-learning'))
  assert.equal(after.nodeServer?.learningCoverage, 'complete')
  assert.equal(after.nextActions.includes('save-node-learning'), false)
  assert.equal(history.learningCoverage, after.nodeServer?.learningCoverage)
})

// protects=a history that is unavailable, whose seal failed or whose append failed is reported on the run resource with its stable code, what is kept and what to do, while the live run is untouched; fails_when=a code is missing or a history problem fails the run; no_claim=the status item
test('history problems read as historyIssue with their code and never fail the live run', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const unavailable = await startHistoryServerRun(harness, context, {
    repositoryOptions: { limit: 1, savedStudies: async () => 1 },
  })
  const appendHarness = await createHarness()
  context.after(() => appendHarness.close())
  const failing = await startHistoryServerRun(appendHarness, context)
  await failing.run.sendRequest('k1')
  failing.record.nodeServer?.history?.writer.markFailed(
    new Error('ENOSPC: no space left'),
  )
  const sealHarness = await createHarness()
  context.after(() => sealHarness.close())
  const unsealed = await startHistoryServerRun(sealHarness, context)
  await unsealed.run.sendRequest('k1')
  const writer = unsealed.record.nodeServer?.history?.writer
  assert.ok(writer)
  writer.seal = () => Promise.reject(new Error('EROFS: read-only'))

  // Act
  await unsealed.service.stop({
    instanceId: unsealed.service.instanceId,
    runId: unsealed.record.id,
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const issues = [unavailable, failing, unsealed].map(
    ({ service, record }) => service.state(record).nodeServer,
  )

  // Assert
  assert.deepEqual(
    issues.map((block) => [block?.history, block?.historyIssue?.code]),
    [
      ['unavailable', 'HISTORY_UNAVAILABLE'],
      ['recording', 'HISTORY_APPEND_FAILED'],
      ['failed', 'HISTORY_SEAL_FAILED'],
    ],
  )
  assert.equal(unavailable.run.view().state, 'ready')
  assert.equal(failing.run.view().state, 'request-in-flight')
  assert.match(issues[1]?.historyIssue?.preserved ?? '', /live run goes on/)
})

// protects=a citation that fits no entry of a server history is refused as INVALID_REFERENCE naming the history and the recovery, and a stale revision names the current revision with the material's recovery; fails_when=the recovery is the idempotency-key sentence or the history or revision is not named; no_claim=the nearest-sequence wording (store tests)
test('a bad citation and a stale revision are refused with the recovery that fits them', async (context) => {
  // Arrange
  const sealed = await sealedRun(context)
  const { service, studyId } = sealed

  // Act
  const badCitation = await service
    .explainNodeHistory({
      studyId,
      expectedRevision: 0,
      content: sealed.content([
        sealed.step('response', {
          type: 'response',
          sequence: sealed.sequenceOf('request'),
        }),
      ]),
    })
    .catch((error: unknown) => error)
  const stale = await service
    .explainNodeHistory({
      studyId,
      expectedRevision: 3,
      content: sealed.content([
        sealed.step('request', {
          type: 'request',
          sequence: sealed.sequenceOf('request'),
        }),
      ]),
    })
    .catch((error: unknown) => error)

  // Assert
  assert.ok(badCitation instanceof StudyError)
  assert.equal(badCitation.code, 'INVALID_REFERENCE')
  assert.match(
    badCitation.message,
    new RegExp(`codebook://node-history/${studyId}`),
  )
  assert.match(
    badCitation.describe().recovery,
    /Re-read the events .* retry once/,
  )
  assert.ok(stale instanceof StudyError)
  assert.equal(stale.code, 'IDEMPOTENCY_CONFLICT')
  assert.match(stale.message, /is at revision 0; you sent expectedRevision 3/)
  assert.match(stale.describe().recovery, /retry with expectedRevision 0/)
})

// protects=the worked example of the canonical help validates against the tool's input schema once its placeholders are filled, and the help states the 16-hit budget and every code; fails_when=the example drifts from the schema or a code is missing from the help; no_claim=an agent following it
test('the node-server save help example parses as the tool input and names the budget and every code', async () => {
  // Arrange
  const { save } = nodeServerHelp()
  const filled = JSON.parse(
    JSON.stringify(save.example.arguments)
      .replace(
        '<nodeServer.historyUri without codebook://node-history/>',
        `${'a'.repeat(8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa_${'b'.repeat(8)}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
      )
      .replace('<sourceHash of that stop entry>', SOURCE_HASH),
  ) as unknown

  // Act
  const parsed = explainNodeHistorySchema.safeParse(filled)

  // Assert
  assert.equal(parsed.success, true)
  assert.match(save.stopBudget, /At most 16 stop hits/)
  assert.deepEqual(save.codes.map((entry) => entry.code).sort(), [
    'SERVER_HISTORY_APPEND_FAILED',
    'SERVER_HISTORY_CAPTURE_BUDGET_EXHAUSTED',
    'SERVER_HISTORY_NO_RESPONSE_EXITED',
    'SERVER_HISTORY_NO_RESPONSE_REQUEST_FAILED',
    'SERVER_HISTORY_NO_RESPONSE_RUN_FAILED',
    'SERVER_HISTORY_NO_RESPONSE_STOPPED',
    'SERVER_HISTORY_OUTPUT_TRUNCATED',
    'SERVER_HISTORY_SIZE_LIMIT',
    'SERVER_HISTORY_SNAPSHOT_MISSING',
    'SERVER_HISTORY_SOURCE_UNAVAILABLE',
    'SERVER_HISTORY_STOP_NOT_REACHED',
    'SERVER_HISTORY_VALUE_UNAVAILABLE',
  ])
})

// protects=a secret planted in server output, the response location and a failure message reaches no MCP answer (the run resource and the history events); fails_when=any answer carries the canary; no_claim=a secret of a shape the contract does not detect
test('a redaction canary planted in output and the response location appears in no run or history answer', async (context) => {
  // Arrange
  const sealed = await (async () => {
    const harness = await createHarness()
    context.after(() => harness.close())
    const started = await startHistoryServerRun(harness, context)
    const { service, record, run } = started
    await run.sendRequest('k1')
    run.print('Authorization: Bearer canarycanary123456\n')
    run.pauseAt(0)
    run.respond({ location: '/next?x=Bearer canarycanary123456' })
    await service.stop({ instanceId: service.instanceId, runId: record.id })
    return started
  })()
  const studyId = `${sealed.service.instanceId}_${sealed.record.id}`

  // Act
  const answers = [
    JSON.stringify(sealed.service.state(sealed.record)),
    ...(await Promise.all(
      ['', '/events'].map(async (suffix) => {
        const resource = await readResource(
          sealed.service,
          `codebook://node-history/${studyId}${suffix}`,
        )
        return 'text' in resource ? resource.text : ''
      }),
    )),
  ].join('\n')

  // Assert
  assert.doesNotMatch(answers, /canarycanary123456/)
  assert.match(answers, /Bearer \[masked\]/)
})
