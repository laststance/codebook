import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  repositoryConfigSchema,
  retainedRepositoryConfigSchema,
} from '../repositoryConfigSchemas'
import { readResource } from '../resources'
import { VITE_QUICK_START_CONFIGURATION, viteHelp } from '../viteHelp'
import { VITE_REFUSAL_CODES } from '../viteRefusals'

import { createHarness } from './helpers'

// protects=the Vite quick start's configuration is valid for the public schema, so an agent that copies it and fills the placeholders is not refused for its shape; fails_when=the schema changes a field and the help keeps the old example; no_claim=that the placeholders name real sources
test('the Vite quick start configuration parses with the public repository-browser schema', () => {
  // Arrange
  const configuration = JSON.parse(
    JSON.stringify(VITE_QUICK_START_CONFIGURATION),
  )
  // Act
  const result = retainedRepositoryConfigSchema.safeParse(configuration)
  // Assert
  assert.equal(result.success, true)
  assert.equal(repositoryConfigSchema.parse(configuration).adapter, 'vite-dev')
})

// protects=every refusal code the Vite adapter can answer has its own section in the help, with the recovery text the error carries; fails_when=a code is added to VITE_REFUSAL_CODES without a help anchor; no_claim=the wording of the recovery
test('the repository-browser help has one anchor section for every Vite refusal code', async (context) => {
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
  // Assert: the Vite quick start comes first.
  assert.deepEqual(Object.keys(help).slice(0, 4), [
    'viteQuickStart',
    'viteSupport',
    'viteFirstRun',
    'viteRefusals',
  ])
  const refusals = viteHelp().viteRefusals
  assert.deepEqual(Object.keys(refusals), [...VITE_REFUSAL_CODES])
  for (const code of VITE_REFUSAL_CODES)
    assert.equal(
      refusals[code]?.anchor,
      `codebook://help/repository-browser#${code}`,
    )
  assert.deepEqual(
    Object.keys((help.viteRefusals ?? {}) as Record<string, unknown>),
    [...VITE_REFUSAL_CODES],
  )
})

// protects=the quick start names the call order and where each id is copied from, and the support table states the limits; fails_when=a step of the order, the root-app limit or the Node pin limit is dropped; no_claim=the agent follows it
test('the Vite quick start gives the call order, the copy sources and the limits', () => {
  // Arrange / Act
  const help = viteHelp()
  const order = help.viteQuickStart.callOrder.map((step) => step.split(':')[0])
  const limits = help.viteSupport.unsupported.concat(help.viteSupport.supported)
  // Assert
  assert.deepEqual(order, [
    'codebook_status',
    'codebook_sources, then codebook_source',
    'codebook_publish_book',
    'codebook_start',
    'Poll the run resource it names until the run reads ready (or an error)',
    'codebook_action repository-click',
    'At each pause read inspectionUri and sourceUri, explain the values in the chat, then codebook_continue with the continueArguments of the current run resource.',
  ])
  assert.ok(limits.some((line) => line.includes('Vite major 8')))
  assert.ok(limits.some((line) => line.includes('not honored')))
  assert.ok(limits.some((line) => line.includes('packageRoot')))
  assert.ok(help.viteFirstRun.includes('pre-bundles dependencies'))
  assert.ok(help.viteFirstRun.includes('node_modules/.vite'))
})

// protects=skill 1.0.57 routes a web-app question to the adapter status reports ready, tells the learner a refusal's limit and never edits project files to start a run; fails_when=any of the three rules leaves the skill; no_claim=how a chat follows it
test('the bundled skill routes a browser run to the ready adapter and forbids editing the project to start it', async () => {
  // Arrange
  const skill = await readFile(
    join(__dirname, '..', '..', 'skills', 'codebook', 'SKILL.md'),
    'utf8',
  )
  // Act
  const paragraph =
    skill.split('\n\n').find((part) => part.startsWith('**Browser runs.**')) ??
    ''
  // Assert
  assert.ok(paragraph.includes('`vite-dev`'))
  assert.ok(paragraph.includes('profiles[].prerequisites.adapters'))
  assert.ok(paragraph.includes('tell the learner the limit the refusal names'))
  assert.ok(
    paragraph.includes("Never edit the project's files, config or scripts"),
  )
})
