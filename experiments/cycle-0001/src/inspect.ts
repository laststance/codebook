import { readFile } from 'node:fs/promises';
import { SourceMap, type SourceMapPayload } from 'node:module';
import { resolve } from 'node:path';
import type * as vscode from 'vscode';
import type { DebugProtocol } from '@vscode/debugprotocol';
import type { Protocol } from 'devtools-protocol';
import type { Cdp } from './cdp';
import type { Evidence } from './evidence';
import { EXPECTED_VALUES } from './constants';
import type { PauseIdentity } from './pauseGate';
import { sha256 } from './utils/sha256';
import { awaitResponse } from './utils/awaitResponse';

export interface SealedSource {
  sourcePath: string;
  source: string;
  javascript: string;
  sourceMap: string;
  breakpointLine: number;
}
export interface Snapshot {
  id: string;
  pause: PauseIdentity;
  frame: DebugProtocol.StackFrame;
  values: typeof EXPECTED_VALUES;
  evaluations: DebugProtocol.EvaluateResponse['body'][];
  source: {
    scriptId: string;
    scriptLocation: Protocol.Debugger.Location;
    mapping: ReturnType<SourceMap['findEntry']>;
    typescriptHash: string;
    javascriptHash: string;
    sourceMapHash: string;
  };
}

/** Validates real DAP values against the paused executable and source map before a run commits a snapshot. @example await inspectPause(session, cdp, pause, pausedEvent, source, assertCurrent) */
export async function inspectPause(
  session: vscode.DebugSession,
  cdp: Cdp,
  pause: PauseIdentity,
  paused: Protocol.Debugger.PausedEvent,
  source: SealedSource,
  assertCurrent: () => void,
  signal: AbortSignal,
  evidence: Evidence,
): Promise<{ snapshot: Snapshot; executedJavascript: string }> {
  assertCurrent();
  const stack: DebugProtocol.StackTraceResponse['body'] = await awaitResponse(session.customRequest('stackTrace', { threadId: pause.threadId, startFrame: 0, levels: 10 }), 'stopped stack', signal);
  assertCurrent();
  const frame = stack.stackFrames[0];
  if (!frame?.source?.path || resolve(frame.source.path) !== resolve(source.sourcePath) || frame.line !== source.breakpointLine) throw new Error('Paused source location does not match the bound TypeScript line');

  const evaluations: DebugProtocol.EvaluateResponse['body'][] = [];
  // Expressions are fixed by the fixture, never supplied by an HTTP client.
  for (const expression of ['selectedProduct.id', 'selectedProduct.price', 'state.items.length']) {
    assertCurrent();
    const evaluation: DebugProtocol.EvaluateResponse['body'] = await awaitResponse(session.customRequest('evaluate', { expression, frameId: frame.id, context: 'watch' }), 'stopped value', signal);
    assertCurrent();
    evaluations.push(evaluation);
  }
  const values = {
    productId: evaluations[0]!.result.replace(/^['"]|['"]$/g, ''),
    price: Number(evaluations[1]!.result),
    cartCount: Number(evaluations[2]!.result),
  };
  if (JSON.stringify(values) !== JSON.stringify(EXPECTED_VALUES)) throw new Error(`Unexpected stopped values: ${JSON.stringify(values)}`);

  const javascriptFrame = paused.callFrames[0];
  if (!javascriptFrame) throw new Error('CDP supplied no paused call frame');
  assertCurrent();
  const executed = await cdp.request('Debugger.getScriptSource', { scriptId: javascriptFrame.location.scriptId });
  assertCurrent();
  await evidence.save('executed.js', executed.scriptSource);
  assertCurrent();
  evidence.record('source.executed', { actualHash: sha256(executed.scriptSource), expectedHash: sha256(source.javascript), scriptId: javascriptFrame.location.scriptId });
  if (sha256(executed.scriptSource) !== sha256(source.javascript)) throw new Error('Executed JavaScript does not match the sealed build');

  const localSource = await readFile(source.sourcePath, 'utf8');
  assertCurrent();
  evidence.record('source.local', { actualHash: sha256(localSource), expectedHash: sha256(source.source) });
  if (sha256(localSource) !== sha256(source.source)) throw new Error('Local TypeScript changed after the build was sealed');
  const payload: SourceMapPayload = JSON.parse(source.sourceMap);
  if (payload.sources.length !== 1 || payload.sources[0] !== '../fixture/cart.ts' || payload.sourcesContent?.[0] !== source.source) throw new Error('Source map does not contain the sealed TypeScript');
  const mapping = new SourceMap(payload).findEntry(javascriptFrame.location.lineNumber, javascriptFrame.location.columnNumber ?? 0);
  if (!('originalLine' in mapping) || mapping.originalLine + 1 !== frame.line) throw new Error('Executed JavaScript does not map to the DAP TypeScript stop');
  assertCurrent();
  return {
    snapshot: {
      id: `${pause.sessionId}:${pause.generation}`,
      pause: { ...pause }, frame, values, evaluations,
      source: {
        scriptId: javascriptFrame.location.scriptId,
        scriptLocation: javascriptFrame.location,
        mapping,
        typescriptHash: sha256(source.source),
        javascriptHash: sha256(executed.scriptSource),
        sourceMapHash: sha256(source.sourceMap),
      },
    },
    executedJavascript: executed.scriptSource,
  };
}
