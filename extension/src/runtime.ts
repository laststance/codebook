import type { PairedRun } from 'codebook-cycle-0004/dist/run';
import type { ParticipantSnapshot } from 'codebook-cycle-0004/dist/inspectParticipant';
import type { SealedSource } from 'codebook-cycle-0001/dist/inspect';
import type { Evidence } from 'codebook-cycle-0001/dist/evidence';
import type { HostConfiguration } from 'codebook-cycle-0001/dist/hostBrowser';
import type { ProfileId, ActionId } from 'codebook-cycle-0004/dist/constants';
import type { ConfiguredDefinition, ConfiguredObservation, ConfiguredStudy } from './configuredStudySchemas';
import { REPOSITORY_BROWSER_ACTION, REPOSITORY_BROWSER_PROFILE } from './constants';

export type DemoRuntimeView = ReturnType<PairedRun['view']>;
export type ConfiguredRuntimeSnapshot = Omit<ConfiguredObservation, 'snapshotUri' | 'interpretations'>;
export type RuntimeSnapshot = ParticipantSnapshot | ConfiguredRuntimeSnapshot;
export type RuntimeAction = ActionId | typeof REPOSITORY_BROWSER_ACTION;
export type RuntimeDefinition = ProfileId | ConfiguredDefinition;
export type RuntimeControl = Readonly<{ signal: AbortSignal; deadlineAt: number; preparationDeadlineAt: number }>;
export type RuntimeSource = Pick<SealedSource, 'source' | 'javascript' | 'sourceMap'>;
export type ConfiguredRuntimeView = Pick<DemoRuntimeView, 'runId' | 'status' | 'cleaned' | 'resourcesReleased' | 'runtimeOutcome' | 'captureOutcome' | 'finalOutcome' | 'captures' | 'failures' | 'events' | 'artifactDirectory' | 'activeSessionIds'> & {
  profile: typeof REPOSITORY_BROWSER_PROFILE;
  definition: ConfiguredDefinition;
  manifest?: { hash: string; configurationHash: string; itemId: ConfiguredObservation['itemId']; sourceHash: string; javascriptHash: string; mapHash: string };
  participants: { browser: Omit<DemoRuntimeView['participants']['browser'], 'snapshot'> & { snapshot: ConfiguredRuntimeSnapshot | undefined } };
  snapshots: ConfiguredRuntimeSnapshot[];
  operation: ConfiguredStudy['operation'];
  nextAction: typeof REPOSITORY_BROWSER_ACTION | undefined;
  observed: { afterVerified: true } | undefined;
  links: never[];
};
export type RuntimeView = DemoRuntimeView | ConfiguredRuntimeView;
export type Participant = ParticipantSnapshot['participant'];
/** Shares lifecycle/control while preserving schema-derived demo/configured evidence variants for the service. @example const runtime = await environment.createRuntime(directory, definition) */
export interface StudyRuntime {
  readonly id: PairedRun['id'];
  readonly evidence: Pick<Evidence, 'save' | 'flush' | 'record' | 'failure' | 'directory' | 'elapsedMs'>;
  prepare: PairedRun['prepare'];
  view(): RuntimeView;
  action(key: string, action: RuntimeAction): { id: string };
  continue: PairedRun['continue'];
  stop: PairedRun['cleanup'];
  fail: PairedRun['fail'];
  source(item: string): RuntimeSource | undefined;
  reveal(snapshot: RuntimeSnapshot): Promise<void>;
}
export interface StudyEnvironment {
  readonly workspace: string;
  readonly host: HostConfiguration;
  readonly build: { revision: string; dirty: boolean; sourceHash: string };
  assertWorkspace?(): void;
  prerequisites(): Promise<{ ready: boolean; missing: string[] }>;
  createRuntime(directory: string, definition?: RuntimeDefinition, control?: RuntimeControl): Promise<StudyRuntime>;
}
