import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'

import { REPOSITORY_SETUP_TIMEOUT_MS, VITE_PAGE_QUIET_MS } from '../constants'
import { StudyError } from '../errors'
import { sha256 } from '../runtimeSupport/utils/sha256'
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

test('a reload before the inputs that changes the served stop module seals it again and the run reaches its pause', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    adapter: 'vite-dev',
  })
  const preparing = harness.run.prepare()
  await waitUntil(() => harness.navigations.length === 1, 'first navigation')
  // Act
  harness.serveChangedModule('const nextTheme = "dark";\n// ?v=57ee5d84')
  harness.reloadPage()
  harness.announceSealedModule('second')
  await preparing
  // Assert
  assert.equal(harness.run.view().status, 'ready')
  assert.deepEqual([...harness.run.view().failures], [])
  assert.equal(
    harness.run
      .view()
      .events.filter((event) => event.type === 'source.resealed').length,
    1,
  )
})

test('a reload that lands while the entry page is still loading seals the stops again before the inputs', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    adapter: 'vite-dev',
    reloadDuringEntryLoad: true,
  })
  // Act
  await harness.run.prepare()
  // Assert
  assert.equal(harness.run.view().status, 'ready')
  assert.deepEqual([...harness.run.view().failures], [])
  assert.equal(
    harness.run
      .view()
      .events.filter((event) => event.type === 'source.resealed').length,
    1,
  )
})

test('the inputs wait for a dependency optimizer that stays busy longer than the quiet window and then reloads the page', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    adapter: 'vite-dev',
  })
  const releaseOptimizer = harness.holdOptimizer()
  const preparing = harness.run.prepare()
  await waitUntil(() => harness.navigations.length === 1, 'first navigation')
  await waitUntil(
    () => harness.settledQuestionCount() === 1,
    'the optimizer question',
  )
  // Act
  await sleep(VITE_PAGE_QUIET_MS + 200)
  const statusWhileBusy = harness.run.view().status
  harness.reloadPage()
  harness.announceSealedModule('second')
  releaseOptimizer()
  await preparing
  // Assert
  assert.notEqual(statusWhileBusy, 'ready')
  assert.equal(harness.run.view().status, 'ready')
  assert.deepEqual([...harness.run.view().failures], [])
})

test('a page that reloads more than the limit before the inputs ends the preparation with VITE_PAGE_UNSTABLE and sends nothing', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    adapter: 'vite-dev',
  })
  const preparing = harness.run.prepare()
  await waitUntil(() => harness.navigations.length === 1, 'first navigation')
  // Act
  for (let reload = 0; reload < 5; reload += 1) harness.reloadPage()
  harness.announceSealedModule('second')
  const error: unknown = await preparing.then(
    () => undefined,
    (cause: unknown) => cause,
  )
  // Assert
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'VITE_PAGE_UNSTABLE')
  assert.match(error.message, /reloaded 5 times .* nothing was sent/)
  assert.equal(harness.mouse.length, 0)
})

test('the executed bytes at the pause differing from the sealed bytes end the run without an explanation', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    adapter: 'vite-dev',
  })
  await harness.run.prepare()
  harness.replaceExecutedModule('rebuilt()')
  // Act
  harness.run.action('one', 'repository-click')
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the refusal at the pause',
  )
  // Assert
  assert.equal(harness.run.view().snapshots.length, 0)
  assert.equal(harness.run.view().finalOutcome, 'not-demonstrated')
})

test('the setup budget expiring while the stops are sealed fails with the coded deadline naming that step', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    adapter: 'vite-dev',
    sealHangs: true,
  })
  const preparing = harness.run.prepare().catch(() => undefined)
  await waitUntil(() => harness.sealReadCount() === 1, 'the seal read')
  // Act
  harness.advance(REPOSITORY_SETUP_TIMEOUT_MS)
  await preparing
  // Assert
  const failure = viteFailureOf(harness.run.view().failures[0] ?? '')
  assert.equal(failure?.code, 'VITE_SETUP_DEADLINE')
  assert.match(
    failure?.message ?? '',
    /exceeded while sealing the declared stops/,
  )
})

test('the setup deadline text says the browser was not opened for every step before the browser launches', () => {
  // Arrange
  const stepsBeforeBrowser = [
    'validating the project',
    'resolving the Vite config',
    'starting Vite',
    'waiting for the server to answer the entry page',
    'sealing the declared stops',
  ]
  // Act
  const tails = stepsBeforeBrowser.map((step) =>
    viteSetupDeadlineText(step, 90_000).replace(
      /^.*pre-bundling can take long; /,
      '',
    ),
  )
  // Assert
  assert.deepEqual(
    tails,
    stepsBeforeBrowser.map(
      () =>
        'the owned server was stopped and the browser was not opened, so start again once (the dependency cache is warm then).',
    ),
  )
})

test('the setup deadline text says the browser being opened was closed for the opening step', () => {
  // Act
  const text = viteSetupDeadlineText('opening the browser', 90_000)
  // Assert
  assert.equal(
    text,
    'VITE_SETUP_DEADLINE: Repository setup deadline (90 s) exceeded while opening the browser. First-run dependency pre-bundling can take long; the owned server was stopped and the browser Codebook was opening was closed and no click was sent, so start again once (the dependency cache is warm then).',
  )
})

test('the setup deadline text says the opened browser was closed for every step after the browser launched', () => {
  // Arrange
  const stepsAfterBrowser = [
    'loading the entry page',
    'waiting for the page to settle',
    'writing the initial inputs and arming the first stop',
  ]
  // Act
  const texts = stepsAfterBrowser.map((step) =>
    viteSetupDeadlineText(step, 90_000),
  )
  // Assert
  assert.deepEqual(texts, [
    'VITE_SETUP_DEADLINE: Repository setup deadline (90 s) exceeded while loading the entry page. First-run dependency pre-bundling can take long; the owned server was stopped and the browser Codebook opened was closed and no click was sent, so start again once (the dependency cache is warm then).',
    'VITE_SETUP_DEADLINE: Repository setup deadline (90 s) exceeded while waiting for the page to settle. First-run dependency pre-bundling can take long; the owned server was stopped and the browser Codebook opened was closed and no click was sent, so start again once (the dependency cache is warm then).',
    'VITE_SETUP_DEADLINE: Repository setup deadline (90 s) exceeded while writing the initial inputs and arming the first stop. First-run dependency pre-bundling can take long; the owned server was stopped and the browser Codebook opened was closed and no click was sent, so start again once (the dependency cache is warm then).',
  ])
})

// Value: protects=a VITE_ value from .env that Vite inlined into the served module never stays in the kept copy of the module, while the seal keeps naming the executed bytes; fails_when=the sealed module text is saved or served unmasked; why_new=the run now masks kept module text with the launcher's env-file values; seam=maskedValues stands in for the launcher's mask; no_claim=the saved study JSON (it holds hashes only, no module text)
test('the kept copy of a sealed Vite module masks an inlined env value and marks the module redacted while the seal hash names the executed bytes', async (context) => {
  // Arrange
  const executedJavascript = 'const apiKey = "plainsecret1";'
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    adapter: 'vite-dev',
    moduleJavascript: executedJavascript,
    maskedValues: ['plainsecret1'],
  })
  // Act
  await harness.run.prepare()
  await harness.run.evidence.flush()
  // Assert
  const keptModule = await readFile(
    join(harness.run.evidence.directory, 'sealed-0-module.js'),
    'utf8',
  )
  assert.equal(keptModule, 'const apiKey = "[masked]";')
  const sealedEvent = harness.run.evidence.events.find(
    (event) => event.type === 'source.sealed',
  )
  assert.equal(
    JSON.stringify(sealedEvent?.detail).includes('"redacted":true'),
    true,
  )
  assert.equal(
    harness.run.view().manifest?.javascriptHash,
    sha256(executedJavascript),
  )
  const served = harness.run.source(harness.definition.descriptor.itemId)
  assert.equal(served?.javascript, 'const apiKey = "[masked]";')
  assert.equal(served?.redacted, true)
})
