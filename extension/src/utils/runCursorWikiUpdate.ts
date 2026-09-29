import { spawn } from 'node:child_process';
import type * as vscode from 'vscode';
import {
  WIKI_CURSOR_PROMPT_LIMIT_BYTES,
  WIKI_CURSOR_TERMINATION_GRACE_MS,
  WIKI_CURSOR_UPDATE_OUTPUT_LIMIT_BYTES,
  WIKI_CURSOR_UPDATE_TIMEOUT_MS,
} from '../constants';
import { resolveCursorAgentExecutable } from './resolveCursorAgentExecutable';
import { terminateCursorAgentProcess } from './requestCursorWikiText';

type CursorCliResult = { type?: unknown; subtype?: unknown; is_error?: unknown; result?: unknown };

/** Accepts only a completed Cursor Agent update response before the caller validates the published Wiki. @param output - CLI JSON envelope. @example parseCursorWikiUpdateResult('{"type":"result","subtype":"success","is_error":false,"result":"Updated"}') // => 'Updated' */
export function parseCursorWikiUpdateResult(output: string): string {
  let envelope: CursorCliResult;
  try { envelope = JSON.parse(output.trim()); }
  catch { throw new Error('Cursor Agent returned an unreadable Wiki update result. Inspect the existing Wiki before retrying.'); }
  if (!envelope || envelope.type !== 'result' || envelope.subtype !== 'success' || envelope.is_error !== false || typeof envelope.result !== 'string')
    throw new Error('Cursor Agent did not complete the Wiki update. The last published Wiki remains available; inspect its status before retrying.');
  return envelope.result;
}

/** Starts the shared Codebook skill in the opened Cursor project when its browser update button is used. @param projectRoot - Canonical opened repository. @param prompt - Project-bound update request sent over stdin. @param cancellationToken - User cancellation from the editor progress UI. @example await runCursorWikiUpdate('/repo', '/codebook Update LLM Wiki...', token) */
export async function runCursorWikiUpdate(projectRoot: string, prompt: string, cancellationToken?: Pick<vscode.CancellationToken, 'isCancellationRequested' | 'onCancellationRequested'>): Promise<string> {
  if (Buffer.byteLength(prompt, 'utf8') > WIKI_CURSOR_PROMPT_LIMIT_BYTES) throw new Error('The Wiki update request is too large.');
  if (cancellationToken?.isCancellationRequested) throw new Error('The Wiki update was cancelled.');
  const executable = await resolveCursorAgentExecutable();
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, [
      '--print', '--trust', '--sandbox', 'enabled', '--auto-review',
      '--output-format', 'json', '--workspace', projectRoot,
    ], { cwd: projectRoot, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let failure: Error | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const stop = (error: Error): void => {
      if (failure) return;
      failure = error;
      terminateCursorAgentProcess(child);
      killTimer = setTimeout(() => {
        if (child.pid && process.platform !== 'win32') {
          try { process.kill(-child.pid, 'SIGKILL'); return; } catch { /* The process may have exited already. */ }
        }
        child.kill('SIGKILL');
      }, WIKI_CURSOR_TERMINATION_GRACE_MS);
    };
    const timeout = setTimeout(() => stop(new Error('Cursor Agent timed out updating the Wiki. Inspect the last published Wiki and retry.')), WIKI_CURSOR_UPDATE_TIMEOUT_MS);
    const cancellation = cancellationToken?.onCancellationRequested(() => stop(new Error('The Wiki update was cancelled. Inspect the last published Wiki before retrying.')));
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > WIKI_CURSOR_UPDATE_OUTPUT_LIMIT_BYTES) { stop(new Error('Cursor Agent exceeded the Wiki update response limit. Inspect the published Wiki before retrying.')); return; }
      chunks.push(chunk);
    });
    child.stderr.on('data', () => { /* CLI diagnostics may contain private source paths or content. */ });
    child.stdin.on('error', () => { /* The exit status reports a closed child. */ });
    child.on('error', error => {
      failure = 'code' in error && error.code === 'ENOENT'
        ? new Error('Cursor Agent CLI is not installed. Install and sign in, then retry the Wiki update.')
        : new Error('Cursor Agent could not start the Wiki update. Check its installation and retry.');
    });
    child.on('close', code => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      cancellation?.dispose();
      if (failure) { reject(failure); return; }
      if (code !== 0) { reject(new Error('Cursor Agent did not finish the Wiki update. Inspect the last published Wiki and its publication journal before retrying.')); return; }
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin.end(prompt);
  });
  return parseCursorWikiUpdateResult(output);
}
