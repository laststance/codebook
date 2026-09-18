import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import type { ConnectionDescriptor } from './server';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';

export const connectionSchema = z.object({ url: z.url(), token: z.string(), instanceId: z.uuid(), workspace: z.string(), apiVersion: z.string() });
const outcomeSchema = z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), data: z.unknown() }), z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string(), recovery: z.string() }) })]);

/** Uses only the public MCP protocol for examples and native validation, keeping credentials out of transcripts. @example const agent = await StudyClient.connect(descriptor) */
export class StudyClient {
  readonly transcript: { operation: string; input: unknown; output: unknown; durationMs: number }[] = [];
  private readonly client = new Client({ name: 'codebook-external-agent', version: '1.0' });
  private readonly transport: StreamableHTTPClientTransport;
  private constructor(descriptor: ConnectionDescriptor) {
    this.transport = new StreamableHTTPClientTransport(new URL(descriptor.url), { requestInit: { headers: { Authorization: `Bearer ${descriptor.token}` } } });
  }
  /** Initializes a fresh SDK transport; callers explicitly choose the current descriptor. @example await StudyClient.connect(connectionSchema.parse(json)) */
  static async connect(descriptor: ConnectionDescriptor): Promise<StudyClient> {
    const agent = new StudyClient(descriptor);
    try { await agent.client.connect(agent.transport); return agent; }
    catch (error) { await agent.close(); throw error; }
  }
  /** Records real tool/resource schemas before clients choose supported operations. @example await agent.discover() */
  async discover() {
    const started = performance.now();
    const output = { tools: await this.client.listTools(), resources: await this.client.listResourceTemplates() };
    this.transcript.push({ operation: 'discover', input: {}, output, durationMs: performance.now() - started }); return output;
  }
  /** Validates a structured result after SDK protocol handling; domain failures retain their recovery code. @example await agent.tool('codebook_status', {}, statusSchema) */
  async tool<Schema extends z.ZodType>(name: string, arguments_: Record<string, unknown>, schema: Schema): Promise<z.output<Schema>> {
    const started = performance.now(), result = await this.client.callTool({ name, arguments: arguments_ });
    this.transcript.push({ operation: name, input: arguments_, output: result, durationMs: performance.now() - started });
    const outcome = outcomeSchema.parse(result.structuredContent);
    if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message} ${outcome.error.recovery}`);
    if (result.isError) throw new Error('MCP tool marked a success record as error');
    return schema.parse(outcome.data);
  }
  /** Reads exact resource references without inferring paths; binary transcript entries retain only hashes. @example await agent.read(snapshotUri) */
  async read(uri: string) {
    const started = performance.now(), result = await this.client.readResource({ uri });
    this.transcript.push({ operation: 'read-resource', input: { uri }, output: result.contents.map(content => 'blob' in content && typeof content.blob === 'string' ? { uri: content.uri, mimeType: content.mimeType, bytes: Buffer.from(content.blob, 'base64').length, sha256: sha256(Buffer.from(content.blob, 'base64')) } : content), durationMs: performance.now() - started });
    return result;
  }
  /** Validates text resources against the caller's expected observation shape. @example await agent.json(runUri, runStateSchema) */
  async json<Schema extends z.ZodType>(uri: string, schema: Schema): Promise<z.output<Schema>> {
    const content = (await this.read(uri)).contents[0];
    if (!content || !('text' in content) || typeof content.text !== 'string') throw new Error('Expected a text resource');
    return schema.parse(JSON.parse(content.text));
  }
  /** Simulates abrupt transport loss without terminating its server session or issuing run control. @example await agent.disconnect() */
  async disconnect(): Promise<void> { await this.client.close(); }
  /** Releases the MCP session without stopping application runs; examples call this when finished. @example await agent.close() */
  async close(): Promise<void> { try { await this.transport.terminateSession(); } finally { await this.client.close(); } }
}
