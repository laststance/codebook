import assert from 'node:assert/strict'
import { test } from 'node:test'

import { configuredStudySchema as studyArchiveSchema } from '../configuredStudySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'

import { createConfiguredStudy } from './utils/createConfiguredStudy'

const workspaceKey = '0'.repeat(64)

test('configured offline history retains exact source, complete citations and actual false or null values without runtime authority', () => {
  // Arrange
  const archive = createConfiguredStudy(),
    before = JSON.stringify(archive)
  // Act
  const decoded = decodeConfiguredStudy(JSON.parse(before), workspaceKey)
  // Assert
  assert.equal(decoded.profile, 'repository-browser')
  assert.equal(decoded.descriptor?.itemId, 'repository/interface/theme')
  assert.equal(decoded.descriptor?.citationContext.anchors.length, 2)
  assert.equal(
    decoded.observations[0]?.source.text,
    'const nextTheme = "dark";\n',
  )
  assert.deepEqual(decoded.observations[0]?.values, {
    'value:nextTheme': 'dark',
    'type:setTheme': 'function',
    'value:enabled': false,
    'value:selection': null,
  })
  assert.deepEqual(decoded.observations[0]?.unavailableValues, [
    { path: 'value:renderLocal', reason: 'Optimized out at this frame.' },
  ])
  assert.equal('continueArguments' in decoded, false)
  assert.equal(JSON.stringify(archive), before)
})

test('preparation failure can retain configured intent without fabricating an article binding or observed pause', () => {
  // Arrange
  const archive = createConfiguredStudy()
  archive.descriptor = undefined
  archive.operation = undefined
  archive.observations = []
  archive.captures = []
  archive.finalOutcome = 'not-demonstrated'
  archive.reason = 'Selected book is unavailable.'
  // Act
  const decoded = decodeConfiguredStudy(archive, workspaceKey)
  // Assert
  assert.equal(decoded.configuration.book.nodeId, 'theme')
  assert.equal(decoded.descriptor, undefined)
  assert.deepEqual(decoded.observations, [])
  assert.equal(decoded.finalOutcome, 'not-demonstrated')
})

test('configured data cannot be passed off as version 2 or attach fake server observations and causal links', () => {
  // Arrange
  const archive = createConfiguredStudy()
  // Act / Assert
  assert.equal(
    studyArchiveSchema.safeParse({ ...archive, version: 2 }).success,
    false,
  )
  assert.throws(() =>
    decodeConfiguredStudy({ ...archive, version: 2 }, workspaceKey),
  )
  assert.throws(() =>
    decodeConfiguredStudy(
      { ...archive, links: [{ id: 'server-request', status: 'observed' }] },
      workspaceKey,
    ),
  )
  assert.throws(() =>
    decodeConfiguredStudy(
      {
        ...archive,
        observations: [{ ...archive.observations[0], participant: 'server' }],
      },
      workspaceKey,
    ),
  )
  assert.throws(() =>
    decodeConfiguredStudy(
      {
        ...archive,
        observations: [...archive.observations, ...archive.observations],
      },
      workspaceKey,
    ),
  )
})

test('changed intent, foreign workspace and rebound learning identity reject retained configured history', () => {
  // Arrange
  const archive = createConfiguredStudy()
  // Act / Assert
  assert.throws(
    () => decodeConfiguredStudy(archive, 'f'.repeat(64)),
    /different workspace/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        { ...archive, id: `${archive.runId}_${archive.instanceId}` },
        workspaceKey,
      ),
    /different workspace or run/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        {
          ...archive,
          configuration: {
            ...archive.configuration,
            action: { ...archive.configuration.action, title: 'Changed title' },
          },
        },
        workspaceKey,
      ),
    /intent changed/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        {
          ...archive,
          descriptor: {
            ...archive.descriptor,
            itemId: 'repository/interface/other',
          },
        },
        workspaceKey,
      ),
    /learning item changed/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        { ...archive, descriptor: undefined },
        workspaceKey,
      ),
    /no bound descriptor/,
  )
})

test('changed secondary citations and source bytes cannot retain the original understanding context', () => {
  // Arrange
  const archive = createConfiguredStudy(),
    descriptor = archive.descriptor!
  // Act / Assert
  assert.throws(
    () =>
      decodeConfiguredStudy(
        {
          ...archive,
          descriptor: { ...descriptor, anchors: [descriptor.anchors[0]] },
        },
        workspaceKey,
      ),
    /complete citation context changed/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        {
          ...archive,
          descriptor: {
            ...descriptor,
            sources: descriptor.sources.map((source) =>
              source.path === 'src/mode.ts'
                ? { ...source, text: 'changed' }
                : source,
            ),
          },
        },
        workspaceKey,
      ),
    /source bytes changed/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        {
          ...archive,
          descriptor: {
            ...descriptor,
            sources: [descriptor.sources[0], descriptor.sources[0]],
          },
        },
        workspaceKey,
      ),
    /duplicate source paths/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        {
          ...archive,
          descriptor: { ...descriptor, sources: [descriptor.sources[0]] },
        },
        workspaceKey,
      ),
    /no exact retained source/,
  )
})

test('captured pause identity and selected source coordinates cannot be rebound after saving', () => {
  // Arrange
  const archive = createConfiguredStudy(),
    observation = archive.observations[0]!
  // Act / Assert
  assert.throws(
    () =>
      decodeConfiguredStudy(
        {
          ...archive,
          observations: [
            { ...observation, pause: { ...observation.pause, generation: 2 } },
          ],
        },
        workspaceKey,
      ),
    /observation identity changed/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        {
          ...archive,
          observations: [
            { ...observation, source: { ...observation.source, column: 2 } },
          ],
        },
        workspaceKey,
      ),
    /source differs/,
  )
  const invalid = createConfiguredStudy()
  invalid.configuration.source.column = 100
  invalid.configurationHash = sha256(JSON.stringify(invalid.configuration))
  assert.throws(
    () => decodeConfiguredStudy(invalid, workspaceKey),
    /position differs/,
  )
  const otherAnchor = createConfiguredStudy()
  otherAnchor.configuration.book.anchorIndex = 1
  otherAnchor.configurationHash = sha256(
    JSON.stringify(otherAnchor.configuration),
  )
  assert.throws(
    () => decodeConfiguredStudy(otherAnchor, workspaceKey),
    /position differs/,
  )
})

test('a saved stop at another column of its declared line is rejected when it has no native debugger state to confirm the column', () => {
  // Arrange: this browser archive has no saved debugger snapshot.
  const archive = createConfiguredStudy(),
    observation = archive.observations[0]!
  // Act / Assert
  assert.equal(observation.debugger, undefined)
  assert.throws(
    () =>
      decodeConfiguredStudy(
        {
          ...archive,
          observations: [
            { ...observation, source: { ...observation.source, column: 7 } },
          ],
        },
        workspaceKey,
      ),
    {
      message:
        'Configured observation source differs from its sealed definition.',
    },
  )
})

// Cycle 0045 (AD-2, class B): pins that the rule "a saved observation's column lies at most one past its line's end" needs no allowance for older studies: a run could always commit a stop one past its line's end, and such a study still opens. Green today; its control lowers the bound by one.
test('a study saved by 0.2.27 whose stop sits one past its line’s end still opens', () => {
  // Arrange: line 1 of the cited source holds 25 characters; the stop was declared and committed at column 26, and its observation carries no binding receipt, as in every study saved by 0.2.27 and older.
  const archive = createConfiguredStudy()
  archive.configuration.source.column = 26
  archive.configurationHash = sha256(JSON.stringify(archive.configuration))
  archive.observations[0]!.source.column = 26
  // Act
  const decoded = decodeConfiguredStudy(archive, workspaceKey)
  // Assert
  assert.equal(archive.observations[0]!.source.binding, undefined)
  assert.equal(decoded.observations[0]?.source.line, 1)
  assert.equal(decoded.observations[0]?.source.column, 26)
})

test('undeclared, missing, unavailable or invented interpretation facts are rejected instead of becoming observed values', () => {
  // Arrange
  const archive = createConfiguredStudy(),
    observation = archive.observations[0]!
  // Act / Assert
  assert.throws(
    () =>
      decodeConfiguredStudy(
        {
          ...archive,
          observations: [
            {
              ...observation,
              values: { ...observation.values, 'value:other': 'invented' },
            },
          ],
        },
        workspaceKey,
      ),
    /declared inspections/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        {
          ...archive,
          observations: [{ ...observation, unavailableValues: [] }],
        },
        workspaceKey,
      ),
    /declared inspections/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        {
          ...archive,
          observations: [
            {
              ...observation,
              unavailableValues: [
                ...observation.unavailableValues,
                ...observation.unavailableValues,
              ],
            },
          ],
        },
        workspaceKey,
      ),
    /declared inspections/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        {
          ...archive,
          observations: [
            {
              ...observation,
              values: { ...observation.values, 'type:setTheme': 'pretend' },
            },
          ],
        },
        workspaceKey,
      ),
    /captured type string/,
  )
  const missingRequired = createConfiguredStudy()
  delete missingRequired.observations[0]!.values['value:nextTheme']
  missingRequired.observations[0]!.unavailableValues.push({
    path: 'value:nextTheme',
    reason: 'Absent',
  })
  assert.throws(
    () => decodeConfiguredStudy(missingRequired, workspaceKey),
    /required fact/,
  )
  const invented = createConfiguredStudy()
  invented.observations[0]!.interpretations[0]!.facts = [
    { path: 'value:renderLocal', value: 'inferred from source' },
  ]
  assert.throws(
    () => decodeConfiguredStudy(invented, workspaceKey),
    /interpretation facts differ/,
  )
  const duplicated = createConfiguredStudy()
  duplicated.observations[0]!.interpretations[0]!.facts.push({
    path: 'value:nextTheme',
    value: 'dark',
  })
  assert.throws(
    () => decodeConfiguredStudy(duplicated, workspaceKey),
    /interpretation facts differ/,
  )
})

test('configured success requires confirmed input, the exact continued pause and all three retained images', () => {
  // Arrange
  const archive = createConfiguredStudy(),
    operation = archive.operation!
  // Act / Assert
  assert.throws(
    () =>
      decodeConfiguredStudy({ ...archive, operation: undefined }, workspaceKey),
    /no dispatched operation/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        { ...archive, operation: { ...operation, inputAcknowledged: false } },
        workspaceKey,
      ),
    /after verification lacks/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        {
          ...archive,
          operation: {
            ...operation,
            continuedPause: {
              ...operation.continuedPause,
              sessionId: 'foreign',
            },
          },
        },
        workspaceKey,
      ),
    /continuation differs/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        { ...archive, operation: { ...operation, afterVerified: false } },
        workspaceKey,
      ),
    /missing required evidence/,
  )
  assert.throws(
    () => decodeConfiguredStudy({ ...archive, terminal: false }, workspaceKey),
    /missing required evidence/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        { ...archive, captures: archive.captures.slice(0, 2) },
        workspaceKey,
      ),
    /missing required evidence/,
  )
})

test('partial captures remain readable while altered image bytes or duplicate phases cannot certify history', () => {
  // Arrange
  const archive = createConfiguredStudy()
  const partial = {
    ...archive,
    finalOutcome: 'partial',
    captures: [
      ...archive.captures.slice(0, 2),
      {
        phase: 'after',
        status: 'failed',
        reason: 'Renderer did not acknowledge.',
      },
    ],
  }
  // Act / Assert
  assert.equal(
    decodeConfiguredStudy(partial, workspaceKey).finalOutcome,
    'partial',
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        { ...archive, captures: [archive.captures[0], archive.captures[0]] },
        workspaceKey,
      ),
    /duplicate image/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        {
          ...archive,
          captures: [
            {
              phase: 'before',
              status: 'captured',
              base64: Buffer.from('wrong pixels').toString('base64'),
              hash: sha256('light'),
            },
          ],
        },
        workspaceKey,
      ),
    /image changed/,
  )
})

test('saved undefined facts survive JSON replay decoding and cannot be replaced with string or null interpretations', () => {
  // Arrange
  const archive = createConfiguredStudy()
  const observation = archive.observations[0]!
  const serialized = JSON.stringify(archive)
  const withUndefined = JSON.parse(serialized)
  withUndefined.observations[0].values['value:nextTheme'] = {
    type: 'undefined',
  }
  withUndefined.observations[0].interpretations[0].facts[0].value = {
    type: 'undefined',
  }
  // Act
  const decoded = decodeConfiguredStudy(
    JSON.parse(JSON.stringify(withUndefined)),
    workspaceKey,
  )
  // Assert
  assert.deepEqual(decoded.observations[0]?.values['value:nextTheme'], {
    type: 'undefined',
  })
  assert.deepEqual(decoded.observations[0]?.interpretations[0]?.facts, [
    { path: 'value:nextTheme', value: { type: 'undefined' } },
  ])
  for (const changed of [
    'undefined',
    null,
    { type: 'undefined', extra: true },
  ]) {
    withUndefined.observations[0].interpretations[0].facts[0].value = changed
    assert.throws(() => decodeConfiguredStudy(withUndefined, workspaceKey))
  }
  assert.equal(observation.values['value:nextTheme'], 'dark')
})

test('saved ordered stops keep their own coordinates and reject missing or reordered completed history', () => {
  // Arrange
  const archive = createConfiguredStudy()
  archive.configuration.additionalStops = [
    { line: 1, column: 7, inspections: archive.configuration.inspections },
  ]
  archive.configurationHash = sha256(JSON.stringify(archive.configuration))
  const second = structuredClone(archive.observations[0]!)
  second.pause.generation = 2
  second.id = 'browser-session:2'
  second.snapshotUri = `codebook://${archive.instanceId}/runs/${archive.runId}/snapshots/browser-session%3A2`
  second.elapsedMs = 4000
  second.source.column = 7
  second.interpretations = []
  archive.observations.push(second)
  archive.operation!.continuedPause = second.pause
  const pausedImage = archive.captures.find(
    (image) => image.phase === 'paused-browser',
  )!
  pausedImage.snapshotId = archive.observations[0]!.id
  archive.captures.push({ ...pausedImage, snapshotId: second.id })
  // Act
  const decoded = decodeConfiguredStudy(
    JSON.parse(JSON.stringify(archive)),
    workspaceKey,
  )
  // Assert
  assert.deepEqual(
    decoded.observations.map((value) => value.source.column),
    [1, 7],
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        { ...archive, captures: archive.captures.slice(0, -1) },
        workspaceKey,
      ),
    /missing required evidence/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        {
          ...archive,
          captures: [
            ...archive.captures.slice(0, -1),
            { ...pausedImage, snapshotId: 'foreign:3' },
          ],
        },
        workspaceKey,
      ),
    /another observation/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        { ...archive, observations: archive.observations.toReversed() },
        workspaceKey,
      ),
    /source differs|ordered pause/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        { ...archive, observations: [archive.observations[0]] },
        workspaceKey,
      ),
    /continuation differs|after verification/,
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        {
          ...archive,
          operation: {
            ...archive.operation,
            continuedPause: archive.observations[0]!.pause,
          },
        },
        workspaceKey,
      ),
    /after verification/,
  )
})

test('a later stop with unavailable required facts preserves earlier continued history without qualifying completion', () => {
  // Arrange
  const archive = createConfiguredStudy()
  archive.configuration.additionalStops = [
    {
      line: 1,
      column: 7,
      inspections: [{ path: 'missing', mode: 'value', required: true }],
    },
  ]
  archive.configurationHash = sha256(JSON.stringify(archive.configuration))
  const second = structuredClone(archive.observations[0]!)
  second.pause.generation = 2
  second.id = 'browser-session:2'
  second.snapshotUri = `codebook://${archive.instanceId}/runs/${archive.runId}/snapshots/browser-session%3A2`
  second.elapsedMs = 4000
  second.source.column = 7
  second.interpretations = []
  second.values = {}
  second.unavailableValues = [
    { path: 'value:missing', reason: 'Unavailable at second pause' },
  ]
  archive.observations.push(second)
  archive.operation!.afterVerified = false
  archive.finalOutcome = 'not-demonstrated'
  // Act
  const decoded = decodeConfiguredStudy(archive, workspaceKey)
  // Assert
  assert.equal(decoded.observations.length, 2)
  assert.equal(decoded.operation?.continuedPause?.generation, 1)
  assert.equal(
    decoded.observations[1]?.unavailableValues[0]?.path,
    'value:missing',
  )
  assert.throws(
    () =>
      decodeConfiguredStudy(
        {
          ...archive,
          operation: { ...archive.operation, continuedPause: second.pause },
        },
        workspaceKey,
      ),
    /required fact/,
  )
})

test('additional stop declarations reject out-of-citation coordinates, missing required values and excessive counts', () => {
  // Arrange
  const archive = createConfiguredStudy()
  const valid = {
    line: 1,
    column: 7,
    inspections: [{ path: 'enabled', mode: 'value', required: true }],
  }
  // Act / Assert
  for (const additionalStops of [
    [{ ...valid, line: 2 }],
    [{ ...valid, column: 100 }],
    [
      {
        ...valid,
        inspections: [{ path: 'setTheme', mode: 'type', required: true }],
      },
    ],
    Array.from({ length: 8 }, () => valid),
  ]) {
    const configuration = { ...archive.configuration, additionalStops }
    assert.throws(() =>
      decodeConfiguredStudy(
        {
          ...archive,
          configuration,
          configurationHash: sha256(JSON.stringify(configuration)),
        },
        workspaceKey,
      ),
    )
  }
})
