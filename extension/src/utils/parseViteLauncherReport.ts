import { z } from 'zod'

import { VITE_LAUNCHER_MESSAGES } from '../constants'
import type { ViteLauncherReport } from '../viteLauncherProtocol'

const factsSchema = z.object({
  viteVersion: z.string(),
  root: z.string(),
  base: z.string(),
  cacheDir: z.string(),
  // 0 is legal in Vite (a random port); the settings policy refuses it
  port: z.number().int().min(0).max(65_535),
  https: z.boolean(),
  origin: z.string().optional(),
  hmrOwnListener: z.boolean(),
  middlewareMode: z.boolean(),
  appType: z.string(),
  configFile: z.string().optional(),
})

const reportSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(VITE_LAUNCHER_MESSAGES.env),
    envValues: z.array(z.string()),
  }),
  z.object({
    type: z.literal(VITE_LAUNCHER_MESSAGES.facts),
    facts: factsSchema,
    envValues: z.array(z.string()),
  }),
  z.object({
    type: z.literal(VITE_LAUNCHER_MESSAGES.failed),
    phase: z.enum(['import', 'config', 'listen']),
    errorName: z.string(),
    firstLine: z.string(),
    configFile: z.string().optional(),
    envValues: z.array(z.string()),
  }),
  z.object({
    type: z.literal(VITE_LAUNCHER_MESSAGES.listening),
    port: z.number().int(),
  }),
])

/**
 * Validates one message the launcher sent over IPC, for {@link launchViteDevelopmentServer}.
 * @param message - The value received from the channel.
 * @returns The typed report.
 * @throws When the message has no known shape; the launcher is then treated as failed.
 * @example
 * parseViteLauncherReport({ type: 'vite-listening', port: 3010 }) // => { type: 'vite-listening', port: 3010 }
 */
export function parseViteLauncherReport(message: unknown): ViteLauncherReport {
  return reportSchema.parse(message)
}
