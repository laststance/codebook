import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import { operationsRepositoryConfigSchema } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import { studyFormatOfConfiguration } from '../utils/studyFormatOfConfiguration'

import { createOperationsStudy } from './utils/createOperationsStudy'

type Configuration = ConfiguredStudy['configuration']

/**
 * Builds the format 8 operations study with its first stop, the browser stop, declared at the entry load, plus one feature of an older format.
 * @param version - The format number to write.
 * @param feature - `hold` puts `hold: "explain"` on that stop (format 24); `press` replaces operation 3 by a key press (format 21); `reverseProxy` declares a reverse proxy (format 22).
 * @returns The study with its configuration hash recomputed and its first observation labelled as an entry-load browser pause.
 * @example entryBrowserStudyWith(25, 'hold') // => { version: 25, … }
 */
function entryBrowserStudyWith(
  version: number,
  feature: 'hold' | 'press' | 'reverseProxy',
): ConfiguredStudy {
  const study = createOperationsStudy('complete', {
    press: feature === 'press',
    reverseProxy: feature === 'reverseProxy',
  })
  const base = study.configuration
  if (base.version !== 3) throw new Error('expected a version 3 study')
  // Parsed so that the keys sit in the schema's order, as the start seals them.
  const configuration: Configuration = operationsRepositoryConfigSchema.parse({
    ...base,
    afterOperation: 0,
    ...(feature === 'hold' ? { hold: 'explain' } : {}),
  })
  const [browser, ...later] = study.observations
  const { attribution: _attribution, ...plain } = browser!
  return {
    ...study,
    version,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    // The entry-load pause happens before the first operation was sent.
    observations: [
      {
        ...plain,
        elapsedMs: 1,
        execution: 'browser',
        attribution: 'entry-load',
      },
      ...later,
    ],
  } as ConfiguredStudy
}

/** Decodes a study and answers `accepted` or the refusal sentence. */
function refusalOf(study: ConfiguredStudy): string {
  try {
    decodeConfiguredStudy(study, study.workspaceKey)
    return 'accepted'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

// Value: protects=a configuration that declares a stop hold and a browser stop at the entry load is saved as format 25, and formats 24, 22 and 21 refuse it; fails_when=format 24 keeps the hold study (the precedence branch or the format 24 refusal of the entry stop is gone) or format 25 stops accepting it; no_claim=a live run or the other older formats
test('a study with hold and an entry-load browser stop is saved as format 25 and an older reader refuses it', () => {
  // Arrange
  const study = entryBrowserStudyWith(25, 'hold')
  const olderVersions = [24, 22, 21]
  // Act
  const format = studyFormatOfConfiguration(study.configuration)
  const olderRefusals = olderVersions.map((version) =>
    refusalOf({ ...study, version } as ConfiguredStudy),
  )
  // Assert
  assert.equal(format, 25)
  assert.equal(refusalOf(study), 'accepted')
  assert.deepEqual(
    olderRefusals,
    olderVersions.map(() => 'Configured archive and intent versions disagree.'),
  )
})

// Value: protects=a configuration that declares a press operation and a browser stop at the entry load is saved as format 25, not 21, and formats 21, 24 and 22 refuse it; fails_when=format 21 keeps the press study or format 25 stops accepting it; no_claim=a live run or the other older formats
test('a study with a press and an entry-load browser stop is saved as format 25 and an older reader refuses it', () => {
  // Arrange
  const study = entryBrowserStudyWith(25, 'press')
  const olderVersions = [21, 24, 22]
  // Act
  const format = studyFormatOfConfiguration(study.configuration)
  const olderRefusals = olderVersions.map((version) =>
    refusalOf({ ...study, version } as ConfiguredStudy),
  )
  // Assert
  assert.equal(format, 25)
  assert.equal(refusalOf(study), 'accepted')
  assert.deepEqual(
    olderRefusals,
    olderVersions.map(() => 'Configured archive and intent versions disagree.'),
  )
})

// Value: protects=a configuration that declares a reverse proxy and a browser stop at the entry load is saved as format 25, not 22, and formats 22, 21 and 24 refuse it; fails_when=format 22 keeps the reverse proxy study or format 25 stops accepting it; no_claim=a live run or the other older formats
test('a study with a reverse proxy and an entry-load browser stop is saved as format 25 and an older reader refuses it', () => {
  // Arrange
  const study = entryBrowserStudyWith(25, 'reverseProxy')
  const olderVersions = [22, 21, 24]
  // Act
  const format = studyFormatOfConfiguration(study.configuration)
  const olderRefusals = olderVersions.map((version) =>
    refusalOf({ ...study, version } as ConfiguredStudy),
  )
  // Assert
  assert.equal(format, 25)
  assert.equal(refusalOf(study), 'accepted')
  assert.deepEqual(
    olderRefusals,
    olderVersions.map(() => 'Configured archive and intent versions disagree.'),
  )
})
