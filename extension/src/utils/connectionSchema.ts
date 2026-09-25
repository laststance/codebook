import { z } from 'zod';

export const connectionSchema = z.object({ url: z.url(), token: z.string(), instanceId: z.uuid(), workspace: z.string(), apiVersion: z.string() });
