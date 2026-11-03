import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import type { DebugProtocol } from '@vscode/debugprotocol'
import type { Protocol } from 'devtools-protocol'
import type * as vscode from 'vscode'

import { ChromeExtensionHistoryRecorder } from '../chromeExtensionHistoryRecorder'
import type { ExtensionHistoryPause } from '../chromeExtensionHistorySink'
import { inspectConfiguredValues } from '../utils/inspectConfiguredValues'
import { inspectNodeTestVariables } from '../utils/inspectNodeTestVariables'
import { maskSavedFacts } from '../utils/maskSavedFacts'
import { sourceImportBindings } from '../utils/sourceImportBindings'

import {
  capturedStop,
  EXTENSION_WORKSPACE_KEY,
  extensionHistoryHeader,
  openExtensionStore,
} from './utils/chromeExtensionHistoryFixture'

// Made-up opaque values that only the shape of their string marks as credentials, never a name.
const COOKIE_VALUE = ['FACT', 'COOKIE', 'VALUE', 'opaque', '5d7e20b4'].join('-')
const AUTH_CODE = ['FACT', 'OAUTH', 'CODE', '71c9a3e8'].join('-')
const BASIC_CREDENTIAL = ['Zm9v', 'YmFy', 'b3BhcXVl'].join('')

// protects=a declared string value of a web or server-render stop is saved masked when it is a Cookie header, an Authorization value or a URL with a secret query value; fails_when=a captured string fact keeps a session cookie, a Basic credential or a callback code, or a plain string (a theme pair, a page pair, prose that starts with Token, a URL without a secret query) is masked; no_claim=a secret-named path (redactionContract tests) or a value of the env files (the known-value mask)
test('a declared page string with a Cookie, Authorization or secret URL query shape is captured masked while plain strings stay readable', async () => {
  // Arrange
  const environment = {
    cookieHeader: `sid=${COOKIE_VALUE}; theme=dark`,
    basicHeader: `Basic ${BASIC_CREDENTIAL}`,
    callbackUrl: `https://shop.example/cb?code=${AUTH_CODE}&page=2`,
    themePair: 'theme=dark',
    pagePair: 'page=2',
    note: 'Token expired',
    listUrl: 'https://shop.example/items?page=2',
  }
  const evaluate = async (
    parameters: Protocol.Debugger.EvaluateOnCallFrameRequest,
  ): Promise<Protocol.Debugger.EvaluateOnCallFrameResponse> => {
    const value = runInNewContext(parameters.expression, environment)
    return { result: { type: typeof value, value } }
  }

  // Act
  const captured = await inspectConfiguredValues(
    evaluate,
    'exact-frame',
    Object.keys(environment).map((path) => ({
      path,
      mode: 'value' as const,
      required: false,
    })),
    () => {},
  )

  // Assert
  assert.deepEqual(captured.values, {
    'value:cookieHeader': '[masked]',
    'value:basicHeader': '[masked]',
    'value:callbackUrl': 'https://shop.example/cb?code=[masked]&page=2',
    'value:themePair': 'theme=dark',
    'value:pagePair': 'page=2',
    'value:note': 'Token expired',
    'value:listUrl': 'https://shop.example/items?page=2',
  })
})

// protects=a declared string value of a Node test or Node server stop is saved masked, in the fact and in the kept debugger variable, when it is a Cookie header, an Authorization value or a URL with a secret query value; fails_when=the fact or its variable keeps a session cookie, a Basic credential or a callback code, or a plain string is masked; no_claim=the Node server's own history sink, which stores what this returns
test('a declared Node string with a Cookie, Authorization or secret URL query shape is captured masked while plain strings stay readable', async () => {
  // Arrange
  const previews: Record<string, string> = {
    cookieHeader: `'sid=${COOKIE_VALUE}; theme=dark'`,
    basicHeader: `'Basic ${BASIC_CREDENTIAL}'`,
    callbackUrl: `'https://shop.example/cb?code=${AUTH_CODE}&page=2'`,
    themePair: "'theme=dark'",
    note: "'Token expired'",
  }
  const variables: DebugProtocol.Variable[] = Object.entries(previews).map(
    ([name, value]) => ({ name, value, type: 'string', variablesReference: 0 }),
  )
  const session = {
    customRequest: async () => ({ variables }),
  } as unknown as Pick<vscode.DebugSession, 'customRequest'>

  // Act
  const result = await inspectNodeTestVariables(
    session,
    [{ name: 'Local', variablesReference: 1, expensive: false }],
    Object.keys(previews).map((path) => ({
      path,
      mode: 'value' as const,
      required: true,
    })),
    sourceImportBindings(''),
    AbortSignal.timeout(1_000),
  )

  // Assert
  const expectedDisplays = [
    '[masked]',
    '[masked]',
    "'https://shop.example/cb?code=[masked]&page=2'",
    "'theme=dark'",
    "'Token expired'",
  ]
  assert.deepEqual(
    result.facts.map((fact) => fact.display),
    expectedDisplays,
  )
  assert.deepEqual(
    result.variables.map((variable) => variable.value),
    expectedDisplays,
  )
})

const PAGE_PAUSE: ExtensionHistoryPause = {
  pauseId: 'run:1:page:1',
  generation: 1,
  context: 'page',
  stopIndex: 1,
  targetUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
  workerGeneration: 0,
}

// protects=the facts a Chrome extension capture records, whose one free text is the target URL; fails_when=a secret query value of the target URL is journaled in a capture's facts, or the stop index, context and worker generation are not recorded; no_claim=the pause-open entry's target URL, which identifies the pause and is cited as recorded
test('a Chrome extension capture records its target URL with the secret query value masked', async (context) => {
  // Arrange
  const { store } = await openExtensionStore(context)
  const header = extensionHistoryHeader(EXTENSION_WORKSPACE_KEY)
  const begun = await ChromeExtensionHistoryRecorder.begin({
    start: () => store.start(header),
    describeCause: String,
    summarize: (studyId) => store.summarize(studyId),
  })
  assert.ok('recorder' in begun)
  const { recorder } = begun
  const popupUrl = `chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html?code=${AUTH_CODE}&tab=2`

  // Act
  recorder.pauseOpened(PAGE_PAUSE)
  recorder.captured(PAGE_PAUSE.pauseId, {
    ...capturedStop({ stopIndex: 1, context: 'page' }),
    targetUrl: popupUrl,
  })
  recorder.pauseClosed(PAGE_PAUSE.pauseId, 'continue')
  await recorder.seal({}, 5_000)
  const history = await store.read(header.studyId)

  // Assert
  const capture = history.entries.find((entry) => entry.type === 'capture')
  assert.deepEqual(capture?.type === 'capture' ? capture.facts : undefined, {
    stopIndex: 1,
    context: 'page',
    workerGeneration: 0,
    targetUrl:
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html?code=[masked]&tab=2',
  })
})

// protects=the one helper every saved-fact reader calls; fails_when=a string inside a fact list, record or nested value is served with its Cookie, Authorization or secret URL query value, a number, boolean or null changes, or a key is renamed; no_claim=which readers call it (savedDebugHistoryMasking tests)
test('saved facts keep their names, numbers and plain strings while the credential-shaped strings inside them are masked', () => {
  // Arrange
  const facts = {
    'value:cookieHeader': `'sid=${COOKIE_VALUE}; theme=dark'`,
    'value:count': 3,
    'value:enabled': false,
    'value:selection': null,
    'value:page': "'page=2'",
    nested: [
      { path: 'callbackUrl', mode: 'value', display: `/cb?code=${AUTH_CODE}` },
    ],
  }

  // Act
  const masked = maskSavedFacts(facts)

  // Assert
  assert.deepEqual(masked, {
    'value:cookieHeader': '[masked]',
    'value:count': 3,
    'value:enabled': false,
    'value:selection': null,
    'value:page': "'page=2'",
    nested: [
      { path: 'callbackUrl', mode: 'value', display: '/cb?code=[masked]' },
    ],
  })
})
