import type { PairedRun } from 'codebook-cycle-0004/dist/run';
import type { ParticipantSnapshot } from 'codebook-cycle-0004/dist/inspectParticipant';
import type { SealedSource } from 'codebook-cycle-0001/dist/inspect';
import type { Evidence } from 'codebook-cycle-0001/dist/evidence';
import type { HostConfiguration } from 'codebook-cycle-0001/dist/hostBrowser';
import type { ProfileId, StudyItemId } from 'codebook-cycle-0004/dist/constants';

export type RuntimeView = ReturnType<PairedRun['view']>;
export type Participant = ParticipantSnapshot['participant'];
/** Keeps MCP independent of VS Code imports while reusing the proven coordinator's concrete data contracts. @example const runtime: StudyRuntime = environment.createRuntime(directory) */
export interface StudyRuntime {
  readonly id: PairedRun['id'];
  readonly evidence: Pick<Evidence, 'save' | 'flush' | 'record' | 'failure' | 'directory'>;
  prepare: PairedRun['prepare'];
  view: PairedRun['view'];
  action: PairedRun['acceptAction'];
  continue: PairedRun['continue'];
  stop: PairedRun['cleanup'];
  fail: PairedRun['fail'];
  source(item: Participant | StudyItemId): SealedSource | undefined;
  reveal(snapshot: ParticipantSnapshot): Promise<void>;
}
export interface StudyEnvironment {
  readonly workspace: string;
  readonly host: HostConfiguration;
  readonly build: { revision: string; dirty: boolean; sourceHash: string };
  prerequisites(): Promise<{ ready: boolean; missing: string[] }>;
  createRuntime(directory: string, profile?: ProfileId): Promise<StudyRuntime>;
}
