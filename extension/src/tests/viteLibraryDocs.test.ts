import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  LIBRARY_BUILD_FAILED_REASONS,
  LIBRARY_PACK_ERROR_STEPS,
  NODE_SCRIPT_LIBRARY_UNSUPPORTED_REASONS,
  VITE_LIBRARY_UNSUPPORTED_REASONS,
} from '../constants'
import { ERROR_RECOVERY } from '../errors'
import {
  liveRepositoryConfigSchema,
  studyConfigurationSchema,
} from '../repositoryConfigSchemas'
import { readResource } from '../resources'
import { VITE_LIBRARY_CONFIGURATION, viteHelp } from '../viteHelp'

import { createHarness } from './helpers'

// protects=the viteLibrary sample is a declaration the live schema accepts and a saved format 16 study retains, with generic names; fails_when=the sample drifts from the schema, drops the nested packageRoot or copies a project's names; no_claim=that a run with it succeeds
test('the viteLibrary help sample parses with the live repository-browser schema and names no project', () => {
  // Arrange
  const { sample } = viteHelp().viteLibrary
  const configuration = JSON.parse(JSON.stringify(sample))
  // Act
  const live = liveRepositoryConfigSchema.parse(configuration)
  const retained = studyConfigurationSchema.safeParse(configuration)
  // Assert
  assert.equal(
    'library' in live && live.library?.packageRoot,
    'packages/widgets',
  )
  assert.equal(retained.success, true)
  assert.equal(sample.packageRoot, 'examples/widgets-vite')
  assert.equal(
    /redux|toolkit/i.test(JSON.stringify(viteHelp().viteLibrary)),
    false,
  )
  assert.deepEqual(sample, VITE_LIBRARY_CONFIGURATION)
})

// protects=the section states the API 1.34 gate, the confirmation, the build and pack, the observation states, one anchor per new reason, every limit and format 16; fails_when=any of those leaves the section; no_claim=the behavior itself, which the integration lane and the native checks cover
test('the viteLibrary help section states the route, its observation states, refusals, limits and study format', () => {
  // Arrange
  const section = viteHelp().viteLibrary
  const text = JSON.stringify(section)
  // Act / Assert
  for (const phrase of [
    'codebook_status reports API 1.34 or later',
    'refuses library under vite-dev as an unknown key',
    'depends on that library by a published version',
    'confirmation comes first',
    "runs the project's own build scripts",
    'Building <name> for the Example',
    'a module of the packed copy was served to the page',
    'publishedCopyLoaded true',
    'never "not loaded"',
    'can resolve to another version than a fresh install',
    'pre-bundled by Vite, so a stop in them is refused',
    'first start re-optimizes',
    'One library per run; browser stops only',
    'study format 16 (.study.v16.json)',
    'Peer dependencies of the library',
  ])
    assert.ok(text.includes(JSON.stringify(phrase).slice(1, -1)), phrase)
})

// protects=each new refusal reason has one anchor under codebook://help/repository-browser, a code and a fix, and the section lists the full reason set of LIBRARY_BUILD_UNSUPPORTED; fails_when=a reason is added to the constants without a help row or a recovery sentence; no_claim=the wording
test('the viteLibrary help has one anchor per new reason and lists every unsupported and failed reason', () => {
  // Arrange
  const { refusals } = viteHelp().viteLibrary
  // Act / Assert
  for (const reason of [
    'library-needs-package-root',
    'library-optimize-include',
    'library-aliased',
  ]) {
    const row: unknown = Reflect.get(refusals, reason)
    assert.ok(typeof row === 'object' && row !== null, reason)
    assert.equal(
      Reflect.get(row, 'anchor'),
      `codebook://help/repository-browser#${reason}`,
    )
    assert.ok(String(Reflect.get(row, 'fix')).length > 0, reason)
  }
  for (const reason of VITE_LIBRARY_UNSUPPORTED_REASONS)
    assert.ok(
      ERROR_RECOVERY.LIBRARY_BUILD_UNSUPPORTED.includes(`${reason}: `),
      reason,
    )
  for (const reason of [
    ...NODE_SCRIPT_LIBRARY_UNSUPPORTED_REASONS,
    ...VITE_LIBRARY_UNSUPPORTED_REASONS,
  ])
    assert.ok(refusals.unsupportedNothingStarted.includes(reason), reason)
  for (const reason of LIBRARY_BUILD_FAILED_REASONS)
    assert.ok(refusals.failedAfterStart.includes(reason), reason)
  for (const step of LIBRARY_PACK_ERROR_STEPS)
    assert.ok(refusals.failedAfterStart.includes(step), step)
})

// protects=the resource a chat reads serves the viteLibrary key; fails_when=the section is built but not served by codebook://help/repository-browser; no_claim=the section's content
test('codebook://help/repository-browser serves the viteLibrary section', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  // Act
  const resource = await readResource(
    harness.service,
    'codebook://help/repository-browser',
  )
  const help: Record<string, unknown> = JSON.parse(
    'text' in resource ? resource.text : '{}',
  )
  // Assert
  assert.equal(
    (help.viteLibrary as { anchor: string }).anchor,
    'codebook://help/repository-browser#viteLibrary',
  )
})
