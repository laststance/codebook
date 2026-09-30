import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sha256 } from '../runtimeSupport/utils/sha256'
import type { PlaybackBundle } from '../playbackController'
import type {
  CitationSourceStates,
  LiveStudy,
  SourceBaselines,
} from '../studyModel'
import { projectStudy } from '../studyModel'
import { captureStudy } from '../utils/captureStudy'
import { buildRecordingContext } from '../utils/buildRecordingContext'
import { decodeLearnerProgress } from '../utils/decodeLearnerProgress'
import { describeStudy } from '../utils/describeStudy'
import { projectPlaybackStudy } from '../utils/projectPlaybackStudy'
import { selectStudy } from '../utils/selectStudy'
import { capturedAppHtml } from '../utils/capturedAppHtml'
import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { configuredServiceHarness } from './utils/configuredServiceHarness'

const baseline = {
  text: 'fixture is unrelated',
  hash: sha256('fixture is unrelated'),
  line: 1,
  path: '/fixture/unused.mts',
}
const baselines: SourceBaselines = { server: baseline, browser: baseline }

/** Supplies current citation statuses and explicit historical decisions for pure configured reader regressions. @example configuredProjectionInput().selection.itemId // 'repository/interface/theme' */
function configuredProjectionInput(understood = false) {
  const study = createConfiguredStudy()
  const citationSources: CitationSourceStates = study.descriptor!.sources.map(
    (source) => ({
      path: source.path,
      hash: source.hash,
      currentHash: source.hash,
      status: 'current',
    }),
  )
  const progress = decodeLearnerProgress(
    {
      version: 3,
      workspaceKey: study.workspaceKey,
      decisions: understood
        ? [
            {
              id: '55555555-5555-4555-8555-555555555555',
              item: 'repository/interface/theme',
              sourceHash: study.configuration.source.hash,
              context: study.descriptor!.citationContext,
              understood: true,
              at: '2026-09-20T00:00:01.000Z',
            },
          ]
        : [],
    },
    study.workspaceKey,
  )
  return {
    study,
    selection: selectStudy(study),
    baselines,
    citationSources,
    progress,
  }
}

test('a configured title containing quotes and markup stays literal in the captured application image description', () => {
  // Arrange
  const input = configuredProjectionInput()
  input.study.descriptor!.nodeTitle = '\"><h1>Injected title</h1><img alt="'
  // Act
  const html = capturedAppHtml({
    type: 'study',
    revision: 1,
    model: projectStudy(input),
    busy: false,
    saving: false,
    loading: false,
    errors: [],
    canClick: false,
    canRun: false,
    profiles: [],
    moments: [],
    studies: [],
  })
  // Assert
  assert.equal(html.includes('<h1>Injected title</h1>'), false)
  assert.ok(
    html.includes(
      'alt="Application pixels captured at the selected &quot;&gt;&lt;h1&gt;Injected title&lt;/h1&gt;&lt;img alt=&quot; pause"',
    ),
  )
})

test('a configured study displays one declared browser item and actual false/null facts without inventing checkout progress', () => {
  // Arrange / Act
  const model = projectStudy(configuredProjectionInput())
  // Assert
  assert.deepEqual(
    model.progressByItem.map((item) => [item.id, item.title, item.participant]),
    [['repository/interface/theme', 'Theme', 'browser']],
  )
  assert.ok(model.observation?.actionId === 'repository-click')
  assert.equal(model.observation?.values['value:enabled'], false)
  assert.equal(model.observation?.values['value:selection'], null)
  assert.equal(model.observation?.actionId, 'repository-click')
  assert.equal(model.scenarioProgress?.unverifiedLinkCount, 0)
  assert.equal(model.understoodCount, 0)
  assert.equal(model.selectedUnderstanding.understood, false)
  assert.equal(model.continueArguments, undefined)
})

test('changing a configured operation title never renames its captured article or offline learning item', () => {
  // Arrange
  const input = configuredProjectionInput()
  input.study.configuration.action.title = 'Inspect the next theme'
  input.study.configurationHash = sha256(
    JSON.stringify(input.study.configuration),
  )
  // Act
  const descriptor = describeStudy(input.study),
    saved = buildRecordingContext(input.study, [], 1),
    recorded = describeStudy(saved.study)
  // Assert
  assert.equal(descriptor.title, 'Interface')
  assert.equal(descriptor.items[0]!.title, 'Theme')
  assert.equal(descriptor.actions[0]!.title, 'Inspect the next theme')
  assert.equal(recorded.title, 'Interface')
  assert.equal(recorded.items[0]!.title, 'Theme')
  assert.equal(recorded.actions[0]!.title, 'Inspect the next theme')
})

test('source-only article understanding remains the same complete citation decision in configured history', () => {
  // Arrange
  const input = configuredProjectionInput(true),
    before = JSON.stringify(input.progress)
  // Act
  const model = projectStudy(input)
  // Assert
  assert.equal(model.selectedUnderstanding.understood, true)
  assert.equal(model.understoodCount, 1)
  assert.equal(model.reviewCount, 0)
  assert.equal(model.selectedUnderstanding.context?.anchors.length, 2)
  assert.equal(
    model.selectedUnderstanding.context?.hash,
    input.study.descriptor!.citationContext.hash,
  )
  assert.equal(JSON.stringify(input.progress), before)
})

test('a changed secondary citation requests review while the primary captured source and historical checkbox remain intact', () => {
  // Arrange
  const input = configuredProjectionInput(true),
    before = JSON.stringify(input.progress)
  input.citationSources[1] = {
    ...input.citationSources[1]!,
    status: 'changed',
    currentHash: sha256('secondary changed'),
  }
  // Act
  const model = projectStudy(input)
  // Assert
  assert.equal(model.currentSourceAvailable, true)
  assert.equal(model.sourceChanged, true)
  assert.equal(model.understoodCount, 0)
  assert.equal(model.reviewCount, 1)
  assert.equal(model.source.text, 'const nextTheme = "dark";\n')
  assert.equal(model.selectedUnderstanding.understood, true)
  assert.equal(JSON.stringify(input.progress), before)
})

test('missing current citations do not erase captured article understanding or qualify current-source progress', () => {
  // Arrange
  const input = configuredProjectionInput(true)
  input.citationSources[1] = {
    ...input.citationSources[1]!,
    currentHash: undefined,
    status: 'unavailable',
    reason: 'File removed.',
  }
  // Act
  const model = projectStudy(input)
  // Assert
  assert.equal(model.currentSourceAvailable, false)
  assert.equal(model.progressByItem[0]!.known, false)
  assert.equal(model.understoodCount, 0)
  assert.equal(model.selectedUnderstanding.known, true)
  assert.equal(model.selectedUnderstanding.understood, true)
  assert.ok(model.observation?.actionId === 'repository-click')
  assert.equal(model.observation?.values['value:nextTheme'], 'dark')
})

test('failed configured preparation remains its declared article with unavailable source and no invented runtime evidence', () => {
  // Arrange
  const input = configuredProjectionInput()
  input.study.descriptor = undefined
  input.study.observations = []
  input.study.captures = []
  input.study.operation = undefined
  input.study.finalOutcome = 'not-demonstrated'
  // Act
  const model = projectStudy(input)
  // Assert
  assert.equal(model.selectedItem.id, 'repository/interface/theme')
  assert.equal(model.selectedItem.title, 'Repository article')
  assert.equal(
    model.source.text,
    '// Configured source is unavailable. Open the article or retry preparation.\n',
  )
  assert.equal(model.observation, undefined)
  assert.equal(model.selectedUnderstanding.known, false)
  assert.equal(model.continueArguments, undefined)
})

test('selecting another configured article never retains the previous article merely because both use the same profile', () => {
  // Arrange
  const first = configuredProjectionInput(),
    other = createConfiguredStudy()
  other.configuration.book.nodeId = 'appearance'
  other.descriptor!.itemId = 'repository/interface/appearance'
  // Act
  const selected = selectStudy(other, first.selection)
  // Assert
  assert.equal(selected.itemId, 'repository/interface/appearance')
  assert.equal(selected.follow, false)
  assert.throws(
    () => projectStudy({ ...first, study: other }),
    /another configured article/,
  )
})

test('only the exact current configured snapshot enables Continue while another run or manual resume leaves history readable', () => {
  // Arrange
  const input = configuredProjectionInput(),
    observation = input.study.observations[0]!
  const live: Pick<LiveStudy, 'instanceId' | 'runId' | 'participants'> = {
    instanceId: '11111111-1111-4111-8111-111111111111',
    runId: input.study.runId,
    participants: {
      browser: {
        phase: 'paused',
        resumable: true,
        itemId: observation.itemId,
        actionId: 'repository-click',
        snapshotUri: observation.snapshotUri,
        sourceUri: undefined,
        continueArguments: {
          instanceId: '11111111-1111-4111-8111-111111111111',
          runId: input.study.runId,
          participant: 'browser',
          ...observation.pause,
        },
      },
    },
  }
  // Act / Assert
  const matching = projectStudy({
    ...input,
    live,
    liveDescriptor: describeStudy(input.study),
  })
  assert.equal(matching.matching, true)
  assert.equal(matching.continueArguments?.generation, 1)
  assert.equal(matching.currentItemTitle, 'Theme')
  const foreign = projectStudy({
    ...input,
    live: { ...live, runId: 'other-run' },
  })
  assert.equal(foreign.matching, false)
  assert.equal(foreign.continueArguments, undefined)
  assert.ok(foreign.observation?.actionId === 'repository-click')
  assert.equal(foreign.observation?.values['value:nextTheme'], 'dark')
  live.participants.browser.resumable = false
  assert.equal(projectStudy({ ...input, live }).continueArguments, undefined)
})

test('configured replay shows an explicit pre-observation placeholder and never borrows live Continue authority', () => {
  // Arrange
  const input = configuredProjectionInput(true),
    context = buildRecordingContext(input.study, [], 1),
    observed = input.study.observations[0]!
  const bundle: PlaybackBundle = {
    studyId: input.study.id,
    context,
    projection: {
      positionMs: 1000,
      observation: undefined,
      debugger: undefined,
      frame: undefined,
      missing: 'No image.',
      pauseConfirmed: false,
      rendererConfirmed: false,
      laterInterpretations: [],
      contextStatus: 'available',
    },
  }
  // Act
  const before = projectPlaybackStudy(input, bundle)
  const paused = projectPlaybackStudy(input, {
    ...bundle,
    projection: {
      ...bundle.projection,
      positionMs: 2000,
      observation: { ...observed, interpretations: [] },
    },
  })
  // Assert
  assert.equal(before.observation, undefined)
  assert.equal(
    before.source.text,
    '// No source was observed by this recorded position.\n',
  )
  assert.ok(paused.observation?.actionId === 'repository-click')
  assert.equal(paused.observation?.values['value:selection'], null)
  assert.equal(paused.observation?.interpretations.length, 0)
  assert.equal(paused.source.text, 'const nextTheme = "dark";\n')
  assert.equal(paused.selectedUnderstanding.understood, true)
  assert.equal(paused.continueArguments, undefined)
  assert.equal(paused.matching, false)
  assert.equal(paused.selection.follow, false)
})

test('configured live capture seals the accepted article, actual facts and three explicit missing image states for shared history', async (context) => {
  // Arrange
  const harness = await configuredServiceHarness(context)
  const receipt = harness.service.start({
    instanceId: harness.service.instanceId,
    profile: 'repository-browser',
    key: 'capture',
    configuration: harness.configuration,
  })
  const record = harness.service.records.get(receipt.runId)!
  await record.preparation
  harness.service.action({
    instanceId: harness.service.instanceId,
    runId: record.id,
    key: 'click',
    action: 'repository-click',
  })
  // Act
  const archive = await captureStudy(
    harness.service,
    record,
    harness.library.workspaceKey,
  )
  // Assert
  assert.equal(archive?.version, 3)
  assert.ok(archive?.version === 3)
  assert.equal(archive.descriptor?.citationContext.anchors.length, 2)
  assert.equal(archive.observations[0]?.values['value:enabled'], false)
  assert.deepEqual(
    archive.captures.map((capture) => [capture.phase, capture.status]),
    [
      ['before', 'absent'],
      ['paused-browser', 'absent'],
      ['after', 'absent'],
    ],
  )
  assert.equal(archive.operation?.inputDispatched, true)
  assert.deepEqual(archive.links, [])
  assert.equal((await harness.library.readProgress()).decisions.length, 0)
  await harness.library.saveStudy(archive)
  assert.equal(
    (await harness.library.readStudy(archive.id)).profile,
    'repository-browser',
  )
})
