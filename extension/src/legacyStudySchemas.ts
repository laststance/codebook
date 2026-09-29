import { z } from 'zod';
import { SOURCE_LIMIT_BYTES } from './constants';

// Shared immutable source identities are independent of live runtime configuration.
export const participantSchema = z.enum(['server', 'browser']);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const studyIdSchema = z.string().regex(/^[a-f0-9-]{36}_[a-f0-9-]{36}$/);
export const sourceSchema = z.strictObject({ text: z.string().max(SOURCE_LIMIT_BYTES), hash: hashSchema, line: z.number().int().positive() });
