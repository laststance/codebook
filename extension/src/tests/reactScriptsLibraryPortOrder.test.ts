import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:net'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { REACT_SCRIPTS_DEV_ADAPTER } from '../reactScriptsDevAdapter'
import { assertDevelopmentPortFree } from '../utils/assertDevelopmentPortFree'
import { assertReactScriptsLibraryPortFree } from '../utils/assertReactScriptsLibraryPortFree'

import {
  createReactScriptsRepository,
  reactScriptsStartRequest,
} from './utils/reactScriptsFixture'

/** Listens on the repository's declared port on 127.0.0.1 until the test ends. */
async function occupyPort(context: TestContext, port: number): Promise<void> {
  const server: Server = createServer()
  await new Promise<void>((resolve) =>
    server.listen(port, '127.0.0.1', resolve),
  )
  context.after(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  )
}

// protects=a busy declared port refuses a react-scripts library run before the confirmation and the build, with nothing written; fails_when=the port is only checked by the launcher after the build, or the early refusal does not say sideEffects none
test('a busy declared port refuses a react-scripts library run before the build with sideEffects none', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context, { mode: 'ok' })
  await occupyPort(context, repository.port)
  const controller = new AbortController()
  const { request } = await reactScriptsStartRequest(
    repository,
    controller.signal,
  )

  // Act
  const refusal = await assertReactScriptsLibraryPortFree(
    request.reactScriptsPackage!,
    (declared, refuse) =>
      assertDevelopmentPortFree(declared, {
        signal: controller.signal,
        refuse,
      }),
  ).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'REACT_SCRIPTS_PORT_UNAVAILABLE')
  assert.equal(refusal.details?.sideEffects, 'none')
  assert.equal(refusal.details?.source, 'pre-start-check')
  assert.equal(refusal.details?.port, repository.port)
})

// protects=a free declared port lets the library run go on to its confirmation and build; fails_when=the early check refuses a port nothing listens on
test('a free declared port lets a react-scripts library run go on to the build', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context, { mode: 'ok' })
  const controller = new AbortController()
  const { request } = await reactScriptsStartRequest(
    repository,
    controller.signal,
  )

  // Act
  const outcome = await assertReactScriptsLibraryPortFree(
    request.reactScriptsPackage!,
    (declared, refuse) =>
      assertDevelopmentPortFree(declared, {
        signal: controller.signal,
        refuse,
      }),
  ).then(
    () => 'free',
    () => 'refused',
  )

  // Assert
  assert.equal(outcome, 'free')
})

// protects=a port taken after the build refuses a library run as partial, because the build wrote its ignored output; fails_when=the launcher's check after the build still says sideEffects none
test('a port taken after the library build refuses with sideEffects partial', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context, { mode: 'ok' })
  await occupyPort(context, repository.port)
  const controller = new AbortController()
  const { request } = await reactScriptsStartRequest(
    repository,
    controller.signal,
  )

  // Act
  const refusal = await REACT_SCRIPTS_DEV_ADAPTER.start({
    ...request,
    reactScriptsLibrary: { preloadPath: 'unused-preload.cjs' },
    assertPortFree: (declared, refuse) =>
      assertDevelopmentPortFree(declared, {
        signal: controller.signal,
        ...(refuse ? { refuse } : {}),
      }),
  }).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'REACT_SCRIPTS_PORT_UNAVAILABLE')
  assert.equal(refusal.details?.sideEffects, 'partial')
})

// protects=a run without library keeps the unchanged none refusal from the launcher check; fails_when=the partial override leaks into runs without library
test('a busy port refuses a react-scripts run without library with sideEffects none', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context, { mode: 'ok' })
  await occupyPort(context, repository.port)
  const controller = new AbortController()
  const { request } = await reactScriptsStartRequest(
    repository,
    controller.signal,
  )

  // Act
  const refusal = await REACT_SCRIPTS_DEV_ADAPTER.start({
    ...request,
    assertPortFree: (declared, refuse) =>
      assertDevelopmentPortFree(declared, {
        signal: controller.signal,
        ...(refuse ? { refuse } : {}),
      }),
  }).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.details?.sideEffects, 'none')
})
