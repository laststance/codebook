import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeCommandSchema } from './nativeSchemas';
import { NATIVE_COMMAND_POLL_MS, PRIVATE_FILE_MODE } from './constants';

/** Runs inside the actual development host; only lifecycle commands are bridged, all study controls remain external MCP calls. @example --extensionTestsPath extension/dist/nativeBootstrap.js */
export async function run(): Promise<void> {
  const directory = process.env.CODEBOOK_NATIVE_SUITE;
  if (!directory) throw new Error('Missing native suite directory');
  const initialBreakpoints = vscode.debug.breakpoints.map(breakpoint => breakpoint.id).sort();
  const activeSessions = new Set<string>();
  const started = vscode.debug.onDidStartDebugSession(session => activeSessions.add(session.id));
  const terminated = vscode.debug.onDidTerminateDebugSession(session => activeSessions.delete(session.id));
  let sequence = 0;
  const observations = () => ({ trusted: vscode.workspace.isTrusted, apiVersion: vscode.version, appName: vscode.env.appName,
    node: process.versions.node, electron: process.versions.electron, debugger: vscode.extensions.getExtension('ms-vscode.js-debug')?.packageJSON.version,
    activeSessions: [...activeSessions], breakpointsRestored: JSON.stringify(vscode.debug.breakpoints.map(breakpoint => breakpoint.id).sort()) === JSON.stringify(initialBreakpoints) });
  const publish = async (descriptorPath?: string, error?: unknown) => {
    await writeFile(join(directory, `bootstrap-${sequence}.json`), JSON.stringify({ sequence, descriptorPath, error: error ? String(error) : undefined, observations: observations() }, null, 2), { mode: PRIVATE_FILE_MODE });
  };
  try {
    await vscode.extensions.getExtension('laststance.codebook')?.activate();
    const paths = await Promise.all([vscode.commands.executeCommand<string>('codebook.startAgentServer'), vscode.commands.executeCommand<string>('codebook.startAgentServer')]);
    assert.equal(paths[0], paths[1]); assert.equal(typeof paths[0], 'string'); await publish(paths[0]);
    // A private harness file controls server lifecycle, never action/continue/evaluation.
    while (true) {
      let command;
      try { command = nativeCommandSchema.parse(JSON.parse(await readFile(join(directory, 'native-command.json'), 'utf8'))); } catch { await delay(NATIVE_COMMAND_POLL_MS); continue; }
      if (command.sequence <= sequence) { await delay(NATIVE_COMMAND_POLL_MS); continue; }
      sequence = command.sequence;
      try {
        await vscode.commands.executeCommand('codebook.stopAgentServer');
        if (command.action === 'restart') await publish(await vscode.commands.executeCommand<string>('codebook.startAgentServer'));
        else { await publish(); if (command.action === 'finish') return; }
      } catch (error) { await publish(undefined, error); }
    }
  } catch (error) { await publish(undefined, error); throw error; }
  finally { await vscode.commands.executeCommand('codebook.stopAgentServer'); started.dispose(); terminated.dispose(); }
}
