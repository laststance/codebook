import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DebugProtocol } from '@vscode/debugprotocol';
import { FOCUS_ATTEMPT_LIMIT } from 'codebook-cycle-0001/dist/constants';
import { awaitResponse } from 'codebook-cycle-0001/dist/utils/awaitResponse';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { PRIVATE_FILE_MODE } from '../constants';

/** Creates an independently owned paused Node target for {@link run}'s native isolation check; primary cleanup must leave it usable. @example const decoy = createNativeDecoy(directory, node); await decoy.prepare() */
export function createNativeDecoy(directory: string, node: string) {
  const name = `unrelated repository QA ${directory}`, program = join(directory, 'decoy.cjs');
  const sessions = new Map<string, vscode.DebugSession>();
  let selected: vscode.DebugSession | undefined, threadId: number | undefined, preparation: Promise<void> | undefined;
  let stoppedCount = 0, continuedCount = 0, closing = false;
  let launching: Promise<boolean> | undefined;
  const failures: string[] = [];
  const owns = (session: vscode.DebugSession) => session.configuration.name === name || session.parentSession?.configuration.name === name;
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory('*', {
    createDebugAdapterTracker(session) {
      if (!owns(session)) return;
      sessions.set(session.id, session);
      return { onDidSendMessage(message) {
        if (message.type !== 'event') return;
        if (message.event === 'stopped' && Number.isInteger(message.body?.threadId)) { selected = session; threadId = message.body.threadId; stoppedCount++; }
        if (message.event === 'continued') { threadId = undefined; continuedCount++; }
      } };
    },
  });
  const termination = vscode.debug.onDidTerminateDebugSession(session => { sessions.delete(session.id); if (session.id === selected?.id) threadId = undefined; });
  // A timed-out launch can still acquire a session; retain its tracker and close it when it actually starts.
  const startup = vscode.debug.onDidStartDebugSession(session => {
    if (closing && owns(session)) void Promise.resolve(vscode.debug.stopDebugging(session)).catch(error => failures.push(String(error)));
  });
  return {
    view() { const focused = vscode.debug.activeDebugSession; return { sessionId: selected?.id, threadId, stoppedCount, continuedCount, activeSessionIds: [...sessions.keys()], focused: Boolean(focused && owns(focused)), focusedSessionId: focused?.id, failures }; },
    async prepare() {
      assert.equal(closing, false);
      preparation ??= (async () => {
        await writeFile(program, 'setInterval(() => {}, 1000);\n', { mode: PRIVATE_FILE_MODE });
        assert.equal(closing, false);
        launching = Promise.resolve(vscode.debug.startDebugging(undefined, { name, type: 'pwa-node', request: 'launch', runtimeExecutable: node, program, cwd: directory, stopOnEntry: true, console: 'internalConsole', internalConsoleOptions: 'neverOpen' }, { suppressSaveBeforeStart: true }));
        assert.equal(await awaitResponse(launching, 'unrelated QA launch'), true);
        assert.equal(closing, false);
        await waitUntil(() => selected && threadId !== undefined, 'unrelated real debugger pause');
        // Shared consoles focus the parent; accept only this decoy's owner while inspecting the exact stopped child.
        for (let attempt = 0; attempt < FOCUS_ATTEMPT_LIMIT; attempt++) {
          const focused = vscode.debug.activeDebugSession;
          if (focused && owns(focused)) break;
          await awaitResponse(vscode.commands.executeCommand('workbench.action.debug.nextConsole'), 'unrelated QA focus');
          assert.equal(closing, false);
          await waitUntil(() => vscode.debug.activeDebugSession?.id !== focused?.id, 'unrelated debugger focus');
        }
        const focused = vscode.debug.activeDebugSession;
        assert.ok(focused && owns(focused));
      })();
      await awaitResponse(preparation, 'unrelated QA preparation');
    },
    async inspect() {
      assert.ok(selected && threadId !== undefined); assert.equal(continuedCount, 0);
      const stack: DebugProtocol.StackTraceResponse['body'] = await awaitResponse(selected.customRequest('stackTrace', { threadId, startFrame: 0, levels: 1 }), 'unrelated paused stack');
      assert.equal(stack.stackFrames[0]?.source?.path, program);
      return { sessionId: selected.id, threadId, frame: stack.stackFrames[0] };
    },
    async close() {
      closing = true;
      // Stop known roots before draining the raw launch; keep late-session adoption if acquisition times out.
      for (const session of sessions.values()) if (!session.parentSession) await awaitResponse(vscode.debug.stopDebugging(session), 'unrelated QA cleanup');
      await awaitResponse(preparation?.catch(() => undefined) ?? Promise.resolve(), 'unrelated QA preparation settlement');
      if (launching) await awaitResponse(launching.catch(() => undefined), 'unrelated QA launch settlement');
      await waitUntil(() => sessions.size === 0, 'unrelated QA sessions exit');
      assert.equal(failures.length, 0);
      tracker.dispose(); termination.dispose(); startup.dispose();
    },
  };
}
