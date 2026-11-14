import assert from 'node:assert/strict'
import { test } from 'node:test'

import type * as vscode from 'vscode'

import {
  CHROME_EXTENSION_SESSION_NAME_PREFIX,
  NODE_SERVER_SESSION_NAME_PREFIX,
} from '../constants'
import { isCodebookRunDebugSession } from '../utils/isCodebookRunDebugSession'

type DebugSession = vscode.DebugSession

/** A debug session carrying a configuration name and an optional parent; the rest is inert. */
function session(name: string, parentSession?: DebugSession): DebugSession {
  return {
    id: name,
    type: 'node',
    name,
    workspaceFolder: undefined,
    configuration: { name, type: 'node', request: 'attach' },
    parentSession,
    customRequest: async () => undefined,
    getDebugProtocolBreakpoint: async () => undefined,
  }
}

// Value: protects=a run's own debug session and a child js-debug opens under it (named after the child's target, not the run) are both taken for the run's stop, so the next extension run's view comes forward over the stop file; fails_when=only the root name is checked, or a run kind's name is missing from the prefix, so a library test run's child session stops noting its stop file and the next view is refused with "Application ownership changed"; why_new=the studyWorkspaceChromeExtensionView tests give the session a Codebook-named root only, never a child chain or the other run kinds' names; seam=none; no_claim=what js-debug names real children (the chain stands in for them)
test('a debug session of a Codebook run, or a child of one, is a run session for every run kind', () => {
  // Arrange
  const runRoots = [
    'codebook node test run-9',
    'codebook repository run-9',
    'codebook server run-9',
    `${NODE_SERVER_SESSION_NAME_PREFIX}run-9`,
    `${CHROME_EXTENSION_SESSION_NAME_PREFIX}run-9`,
  ]
  // Act
  const roots = runRoots.map((name) => isCodebookRunDebugSession(session(name)))
  const grandchild = isCodebookRunDebugSession(
    session(
      'pwa-node child',
      session('worker', session('codebook node test run-9')),
    ),
  )
  // Assert
  assert.deepEqual(roots, [true, true, true, true, true])
  assert.equal(grandchild, true)
})

// Value: protects=the learner's own debugger (F5 on their launch configuration, with or without children) is never taken for a Codebook run, so the next run does not move the learner's file; fails_when=the matcher accepts any session, or a name that only contains or capitalizes the prefix; why_new=the learner-session test in studyWorkspaceChromeExtensionView covers one flat session, not a child chain or look-alike names; seam=none; no_claim=how the editor starts a learner session
test("the learner's own debug sessions, flat or with children, are no Codebook run", () => {
  // Arrange
  const learnerSessions = [
    session('Launch Program'),
    session('my codebook run'),
    session('Codebook notes'),
    session('codebook'),
    session('child', session('Launch Program')),
  ]
  // Act
  const results = learnerSessions.map((candidate) =>
    isCodebookRunDebugSession(candidate),
  )
  // Assert
  assert.deepEqual(results, [false, false, false, false, false])
})
