import * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configSchema } from './config';
import { RepositoryRun } from './run';

let active: RepositoryRun | undefined;

/** Registers trackers before this private experiment's bootstrap can launch an owned debugger. @example VS Code calls activate(context) */
export async function activate(context: vscode.ExtensionContext): Promise<RepositoryRun | undefined> {
  const directory = process.env.CODEBOOK_REAL_REPOSITORY_SESSION;
  if (!directory) return;
  const config = configSchema.parse(JSON.parse(await readFile(join(directory, 'config.json'), 'utf8')));
  const run = active = new RepositoryRun(config);
  context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('*', {
    createDebugAdapterTracker(session) {
      if (!run.owns(session)) return;
      run.addSession(session);
      return { onWillReceiveMessage: message => { if (message.type === 'request') run.onRequest(session, message); },
        onDidSendMessage: message => { if (message.type === 'event') run.onEvent(session, message); }, onError: error => run.fail(error.message) };
    },
  }), vscode.debug.onDidTerminateDebugSession(session => { if (run.owns(session)) run.terminated(session); }));
  return run;
}

/** Drains owned resources when this isolated extension host closes. @example VS Code calls deactivate() */
export async function deactivate(): Promise<void> { await active?.cleanup(); }
