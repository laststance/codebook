import { z } from 'zod';

// Only an isolated runner writes this private launch contract; it never enters the public MCP surface.
export const configSchema = z.strictObject({ directory: z.string().min(1), target: z.string().min(1), node: z.string().min(1), revision: z.string().min(1), sourceFingerprint: z.string().min(1), host: z.strictObject({ id: z.enum(['vscode', 'cursor']), productVersion: z.string(), apiVersion: z.string(), commit: z.string(), browserBackend: z.literal('managed'), chrome: z.strictObject({ binary: z.string(), version: z.string() }) }) });
export const commandSchema = z.strictObject({ sequence: z.number().int().nonnegative(), action: z.enum(['inspect', 'prepare', 'prepare-decoy', 'inspect-decoy', 'click', 'continue', 'manual-resume', 'cdp-resume', 'source-drift', 'stop', 'finish']), key: z.string().max(128).optional(), pause: z.strictObject({ sessionId: z.string(), threadId: z.number().int(), generation: z.number().int().positive() }).optional() });
