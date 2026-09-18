import { z } from 'zod';
import { continueSchema } from './schemas';

// External validation consumes only documented fields; extra version-compatible fields remain available in transcripts.
export const receiptSchema = z.object({ instanceId: z.uuid(), runId: z.uuid(), runUri: z.string(), deadlineAt: z.string() });
const participantSchema = z.object({ snapshotUri: z.string().optional(), sourceUri: z.string().optional(), resumable: z.boolean(), continueArguments: continueSchema.optional() });
export const stateSchema = z.object({ instanceId: z.uuid(), runId: z.uuid(), runtimeRunId: z.uuid().optional(), state: z.string(), runtimeState: z.string().optional(), cleaned: z.boolean(), nextActions: z.array(z.string()),
  participants: z.object({ server: participantSchema, browser: participantSchema }), observed: z.object({ cartCount: z.number(), completedClicks: z.number() }).optional(), finalOutcome: z.string(), terminalReason: z.string().optional(),
  captures: z.array(z.object({ phase: z.string(), status: z.string(), uri: z.string().optional() })), explanations: z.array(z.string()), activeSessionIds: z.array(z.string()), eventsUri: z.string(), runUri: z.string() });
export const snapshotSchema = z.object({ id: z.string(), participant: z.enum(['server', 'browser']), values: z.object({ productId: z.string(), price: z.number(), cartCount: z.number(), admittedCount: z.number(), operationId: z.string(), cartId: z.string() }),
  frame: z.object({ line: z.number(), source: z.object({ path: z.string() }) }), source: z.object({ typescriptHash: z.string(), javascriptHash: z.string(), sourceMapHash: z.string() }), sourceUri: z.string() });
export const statusSchema = z.object({ instanceId: z.uuid(), apiVersion: z.string(), workspace: z.string(), host: z.object({ id: z.string(), productVersion: z.string(), apiVersion: z.string() }), prerequisites: z.object({ ready: z.boolean(), missing: z.array(z.string()) }), build: z.object({ revision: z.string(), dirty: z.boolean(), sourceHash: z.string() }) });
export const eventsSchema = z.object({ events: z.array(z.object({ type: z.string(), sequence: z.number(), detail: z.unknown() })), nextUri: z.string().optional() });
export const bootstrapSchema = z.object({ sequence: z.number(), descriptorPath: z.string().optional(), error: z.string().optional(), observations: z.record(z.string(), z.unknown()).optional() });
export const nativeCommandSchema = z.object({ sequence: z.number(), action: z.enum(['restart', 'stop', 'finish']) });
