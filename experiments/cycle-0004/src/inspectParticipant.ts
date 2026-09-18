import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type * as vscode from 'vscode';
import type { DebugProtocol } from '@vscode/debugprotocol';
import type { Protocol } from 'devtools-protocol';
import type { Cdp } from 'codebook-cycle-0001/dist/cdp';
import type { Evidence } from 'codebook-cycle-0001/dist/evidence';
import type { SealedSource } from 'codebook-cycle-0001/dist/inspect';
import type { PauseIdentity } from 'codebook-cycle-0001/dist/pauseGate';
import { verifySource } from 'codebook-cycle-0001/dist/verifySource';
import { awaitResponse } from 'codebook-cycle-0001/dist/utils/awaitResponse';
import { STACK_FRAME_LIMIT, type ParticipantName } from './constants';
import type { CartResponse } from './networkEvidence';

export interface ParticipantSnapshot {
  id: string;
  participant: ParticipantName;
  pause: PauseIdentity;
  frame: DebugProtocol.StackFrame;
  values: CartResponse;
  evaluations: { expression: string; value: DebugProtocol.EvaluateResponse['body'] }[];
  source: ReturnType<typeof verifySource>;
}

/** Captures one owned participant's actual values and executed source, called after its DAP/CDP stop pair is available. @example await inspectParticipant('server', session, cdp, pause, paused, seal, assertCurrent, signal, evidence) */
export async function inspectParticipant(name: ParticipantName, session: vscode.DebugSession, cdp: Cdp, pause: PauseIdentity, paused: Protocol.Debugger.PausedEvent, seal: SealedSource, assertCurrent: () => void, signal: AbortSignal, evidence: Evidence): Promise<ParticipantSnapshot> {
  assertCurrent();
  const stack: DebugProtocol.StackTraceResponse['body'] = await awaitResponse(session.customRequest('stackTrace', { threadId: pause.threadId, startFrame: 0, levels: STACK_FRAME_LIMIT }), 'participant stack', signal);
  assertCurrent();
  const frame = stack.stackFrames[0];
  if (!frame?.source?.path || resolve(frame.source.path) !== resolve(seal.sourcePath) || frame.line !== seal.breakpointLine) throw new Error('Participant paused outside its bound TypeScript line');
  const evaluations: ParticipantSnapshot['evaluations'] = [];
  const evaluate = async (expression: string, kind: 'string' | 'number') => {
    assertCurrent();
    const value: DebugProtocol.EvaluateResponse['body'] = await awaitResponse(session.customRequest('evaluate', { expression, frameId: frame.id, context: 'watch' }), 'participant value', signal);
    assertCurrent();
    evaluations.push({ expression, value });
    if (kind === 'string') {
      if (value.type !== 'string' || !['"', "'"].includes(value.result[0] ?? '') || value.result.at(-1) !== value.result[0]) throw new Error('Expected a quoted primitive string');
      return value.result.slice(1, -1);
    }
    const numeric = Number(value.result);
    if (value.type !== 'number' || !Number.isFinite(numeric)) throw new Error('Expected a finite primitive number');
    return numeric;
  };
  const prefix = name === 'server' ? 'tuple' : 'result';
  const operationId = await evaluate(`${prefix}.operationId`, 'string');
  const cartId = await evaluate(`${prefix}.cartId`, 'string');
  const productId = await evaluate(`${prefix}.productId`, 'string');
  const price = await evaluate(`${prefix}.price`, 'number');
  const cartCount = await evaluate(name === 'server' ? 'state.items.length' : 'result.cartCount', 'number');
  const admittedCount = await evaluate(name === 'server' ? 'admittedCount' : 'result.admittedCount', 'number');
  if (typeof operationId !== 'string' || typeof cartId !== 'string' || typeof productId !== 'string' || typeof price !== 'number' || typeof cartCount !== 'number' || typeof admittedCount !== 'number') throw new Error('Unexpected primitive value type');
  const location = paused.callFrames[0]?.location;
  if (!location) throw new Error('Missing participant CDP call frame');
  const executed = await cdp.request('Debugger.getScriptSource', { scriptId: location.scriptId });
  assertCurrent();
  await evidence.save(`${name}-executed.mjs`, executed.scriptSource);
  assertCurrent();
  const local = await readFile(seal.sourcePath, 'utf8');
  assertCurrent();
  const source = verifySource(seal, executed.scriptSource, local, location, frame.line, `../fixture/${name === 'server' ? 'server' : 'client'}.mts`);
  return { id: `${pause.sessionId}:${pause.generation}`, participant: name, pause: { ...pause }, frame, values: { operationId, cartId, productId, price, cartCount, admittedCount }, evaluations, source };
}
