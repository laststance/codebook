import { z } from 'zod';
import { REPOSITORY_PATH_LIMIT_CHARS } from './constants';

export const repositoryHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const repositoryPathSchema = z.string().min(1).max(REPOSITORY_PATH_LIMIT_CHARS)
  .refine(path => !path.startsWith('/') && !/[\\\x00-\x1f\x7f]/.test(path) && path.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'Use a relative slash-separated path without traversal or control characters.');
export const bookAnchorSchema = z.strictObject({ path: repositoryPathSchema, hash: repositoryHashSchema, startLine: z.number().int().positive(), endLine: z.number().int().positive() })
  .refine(anchor => anchor.endLine >= anchor.startLine, 'Anchor endLine must not precede startLine.');
export type BookAnchor = z.infer<typeof bookAnchorSchema>;
