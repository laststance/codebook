import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import {
  viteFailureOf,
  viteReloadText,
  viteSetupDeadlineText,
} from '../viteRefusals'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

const NO_STOPS: never[] = []

test('the Vite browser launches with the package root as webRoot and per-script source maps and no webpack path override', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    adapter: 'vite-dev',
  })
  // Act
  await harness.run.prepare()
  // Assert
  const configuration = harness.launchConfigurations[0]!
  assert.equal(configuration.perScriptSourcemaps, 'yes')
  assert.equal(configuration.sourceMaps, true)
  assert.equal(configuration.sourceMapPathOverrides, undefined)
  assert.equal(typeof configuration.webRoot, 'string')
})

test('the Next browser keeps the webpack source-map path override and no per-script setting', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context)
  // Act
  await harness.run.prepare()
  // Assert
  const configuration = harness.launchConfigurations[0]!
  assert.equal(configuration.perScriptSourcemaps, undefined)
  assert.deepEqual(
    { ...configuration.sourceMapPathOverrides },
    {
      'webpack://_N_E/./*': `${configuration.webRoot}/*`,
    },
  )
})

test('a Vite run on its sealed module reaches ready after one page load', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    adapter: 'vite-dev',
  })
  // Act
  await harness.run.prepare()
  // Assert
  assert.equal(harness.run.view().status, 'ready')
  assert.deepEqual([...harness.run.view().failures], [])
  assert.equal(
    harness.run
      .view()
      .events.some((event) => event.type === 'page.generation-started'),
    false,
  )
})

test('a reload before the inputs starts a new page generation and the new parse is bound again', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    adapter: 'vite-dev',
  })
  const preparing = harness.run.prepare()
  await waitUntil(() => harness.navigations.length === 1, 'first navigation')
  // Act
  harness.reloadPage()
  harness.announceSealedModule('second')
  await preparing
  // Assert
  assert.equal(harness.run.view().status, 'ready')
  assert.equal(
    harness.run
      .view()
      .events.filter((event) => event.type === 'page.generation-started')
      .length,
    1,
  )
  assert.deepEqual([...harness.run.view().failures], [])
})

test('two reloads before the inputs are tolerated', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    adapter: 'vite-dev',
  })
  const preparing = harness.run.prepare()
  await waitUntil(() => harness.navigations.length === 1, 'first navigation')
  // Act
  harness.reloadPage()
  harness.reloadPage()
  harness.announceSealedModule('third')
  await preparing
  // Assert
  assert.equal(harness.run.view().status, 'ready')
  assert.equal(
    harness.run
      .view()
      .events.filter((event) => event.type === 'page.generation-started')
      .length,
    2,
  )
})

test('a page load in a subframe is no reload', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    adapter: 'vite-dev',
  })
  await harness.run.prepare()
  // Act
  harness.loadSubframe()
  // Assert
  assert.deepEqual([...harness.run.view().failures], [])
  assert.equal(harness.run.view().status, 'ready')
})

test('a reload after the inputs were written fails the run with the reload code before any click', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    adapter: 'vite-dev',
  })
  await harness.run.prepare()
  // Act
  harness.reloadPage()
  // Assert
  const failure = viteFailureOf(harness.run.view().failures[0] ?? '')
  assert.equal(failure?.code, 'VITE_PAGE_RELOADED')
  assert.match(
    failure?.message ?? '',
    /after the initial inputs were written and before the click, so nothing was clicked/,
  )
})

test('a reload after the click fails the run and says the click result is unknown', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    adapter: 'vite-dev',
  })
  await harness.run.prepare()
  harness.run.action('one', 'repository-click')
  await waitUntil(() => harness.run.view().snapshots[0], 'configured pause')
  // Act
  harness.reloadPage()
  // Assert
  const failure = viteFailureOf(harness.run.view().failures[0] ?? '')
  assert.equal(failure?.code, 'VITE_PAGE_RELOADED')
  assert.match(
    failure?.message ?? '',
    /after the click was sent, so the click's result is unknown/,
  )
})

test('a second script id for the stop module within one page generation fails the run', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    adapter: 'vite-dev',
  })
  await harness.run.prepare()
  // Act
  harness.announceSealedModule('another')
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Selected module changed after sealing',
  )
})

test('a seal failure ends the run with the server released and no browser opened', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    adapter: 'vite-dev',
    sealFailure:
      'Declared stop src/theme.ts:1 cannot be sealed: http://127.0.0.1:4321/src/theme.ts answered status 404',
  })
  // Act
  await assert.rejects(
    harness.run.prepare(),
    /src\/theme\.ts:1 cannot be sealed/,
  )
  await harness.run.stop()
  // Assert
  assert.ok(harness.releases.includes('application'))
  assert.equal(harness.launchConfigurations.length, 0)
  assert.deepEqual(harness.navigations, [])
})

test('the setup deadline failure names the step reached, its limit and its code', () => {
  // Act
  const text = viteSetupDeadlineText('sealing the declared stops', 90_000)
  // Assert
  assert.equal(
    text,
    'VITE_SETUP_DEADLINE: Repository setup deadline (90 s) exceeded while sealing the declared stops. First-run dependency pre-bundling can take long; the owned server was stopped and the browser was not opened, so start again once (the dependency cache is warm then).',
  )
  assert.deepEqual(viteFailureOf(text), {
    code: 'VITE_SETUP_DEADLINE',
    message: text.slice('VITE_SETUP_DEADLINE: '.length),
  })
  assert.equal(viteFailureOf('Repository setup deadline exceeded'), undefined)
  assert.match(viteReloadText(true), /^VITE_PAGE_RELOADED: /)
})

test('a Vite stop in a module the entry page never loads ends the run with the declared-stop-not-hit explanation', async (context) => {
  // Arrange
  const { run, suppressInputPause, advance, mouse } =
    await configuredRuntimeHarness(context, undefined, NO_STOPS, {
      adapter: 'vite-dev',
    })
  await run.prepare()
  suppressInputPause()
  run.action('one', 'repository-click')
  await waitUntil(() => mouse.length === 2, 'pending input')
  // Act
  advance(20000)
  await run.stop()
  // Assert
  assert.equal(
    run.view().failures[0],
    'Repository input reached no verified pause: declared stop src/theme.ts:1 was not hit within 20 s of the accepted action; its line must execute after the input',
  )
})
