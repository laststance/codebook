import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { StudyClient, connectionSchema } from '../dist/client.js';
import { presentationModeSchema } from '../dist/presentationSchemas.js';

// Run against the learner's current private connection; discovery and fresh identity precede this explicit selection.
const connectionPath = process.env.CODEBOOK_CONNECTION;
if (!connectionPath) throw new Error('Set CODEBOOK_CONNECTION to the private connection descriptor path.');
const mode = presentationModeSchema.parse(process.env.CODEBOOK_MODE);
const connection = connectionSchema.parse(JSON.parse(await readFile(connectionPath, 'utf8')));
const stateSchema = z.object({
  instanceId: z.uuid(), uri: z.string(), presentationId: z.uuid(), presentationControlRevision: z.number().int(),
  mode: presentationModeSchema, state: z.enum(['closed', 'open', 'applying']), layoutConfirmed: z.boolean(),
  preference: z.object({ status: z.enum(['default', 'saved', 'saving', 'failed', 'unknown']), reason: z.string().optional() }),
  playbackRevision: z.number().int().optional(), reason: z.string().optional(),
});
const started = performance.now();
const agent = await StudyClient.connect(connection);
let presentationUri;
try {
  const discovery = await agent.discover();
  if (!discovery.tools.tools.some(tool => tool.name === 'codebook_presentation')) throw new Error('This host does not expose presentation control.');
  const status = await agent.tool('codebook_status', {}, z.object({ instanceId: z.uuid(), presentation: z.object({ uri: z.string() }) }));
  if (status.instanceId !== connection.instanceId) throw new Error('Connection instance changed; copy its new descriptor.');
  presentationUri = status.presentation.uri;
  const before = await agent.json(presentationUri, stateSchema);
  const discovered = performance.now();
  const applied = await agent.tool('codebook_presentation', {
    instanceId: status.instanceId, presentationId: before.presentationId,
    expectedRevision: before.presentationControlRevision, mode, action: 'select',
  }, stateSchema);
  // A successful request still reports native confirmation and preference persistence independently.
  console.log(JSON.stringify({
    requestedMode: mode, applied, discoveryMs: discovered - started, selectionMs: performance.now() - discovered,
  }, null, 2));
  if (applied.mode !== mode || !applied.layoutConfirmed) throw new Error('Requested layout is not confirmed; inspect the current panes before restoring.');
} catch (error) {
  // Re-read after a stale identity or lost response; never repeat a mutating request automatically.
  if (presentationUri) {
    const current = await agent.json(presentationUri, stateSchema).catch(() => undefined);
    if (current) console.error(JSON.stringify({ currentPresentation: current }));
  }
  throw error;
} finally {
  await agent.close();
}
