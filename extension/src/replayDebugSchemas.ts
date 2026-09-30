import { z } from 'zod'
import {
  REPLAY_DEBUG_MAX_DEPTH,
  REPLAY_DEBUG_MAX_FRAMES,
  REPLAY_DEBUG_MAX_SCOPES,
  REPLAY_DEBUG_MAX_VARIABLES,
  REPLAY_DEBUG_TEXT_LIMIT_CHARS,
} from './constants'
import { sourceSchema } from './legacyStudySchemas'

const text = z.string().max(REPLAY_DEBUG_TEXT_LIMIT_CHARS)
const reference = z
  .number()
  .int()
  .nonnegative()
  .max(REPLAY_DEBUG_MAX_VARIABLES - 1)
const children = z.array(reference).max(REPLAY_DEBUG_MAX_VARIABLES)
export const replayDebugSnapshotSchema = z
  .strictObject({
    version: z.literal(1),
    frames: z
      .array(
        z.strictObject({
          name: text,
          line: z.number().int().positive(),
          column: z.number().int().positive(),
          source: sourceSchema.extend({ name: text }).optional(),
          sourceUnavailable: text.optional(),
          scopes: z
            .array(
              z.strictObject({
                name: text,
                variables: children,
                unavailable: text.optional(),
              }),
            )
            .max(REPLAY_DEBUG_MAX_SCOPES),
          unavailable: text.optional(),
        }),
      )
      .max(REPLAY_DEBUG_MAX_FRAMES),
    variables: z
      .array(
        z.strictObject({
          name: text,
          value: text,
          type: text.optional(),
          children,
          unavailable: text.optional(),
        }),
      )
      .max(REPLAY_DEBUG_MAX_VARIABLES),
    limitations: z.array(text).max(REPLAY_DEBUG_MAX_VARIABLES),
  })
  .superRefine((snapshot, context) => {
    const parents = new Set<number>(),
      depths = new Map<number, number>()
    const claim = (index: number, depth: number) => {
      if (parents.has(index) || depth > REPLAY_DEBUG_MAX_DEPTH)
        context.addIssue({
          code: 'custom',
          message: 'Historical variable tree is duplicated or too deep.',
        })
      parents.add(index)
      depths.set(index, depth)
    }
    for (const frame of snapshot.frames)
      for (const scope of frame.scopes)
        for (const index of scope.variables) claim(index, 1)
    // Capture writes parents before children; reject cycles, aliases to ancestors and dangling archive handles.
    snapshot.variables.forEach((variable, index) => {
      if (
        variable.children.some(
          (child) => child <= index || child >= snapshot.variables.length,
        )
      )
        context.addIssue({
          code: 'custom',
          message: 'Invalid historical variable child.',
        })
      for (const child of variable.children)
        claim(child, (depths.get(index) ?? 1) + 1)
    })
    for (const frame of snapshot.frames)
      for (const scope of frame.scopes) {
        if (scope.variables.some((index) => index >= snapshot.variables.length))
          context.addIssue({
            code: 'custom',
            message: 'Invalid historical scope variable.',
          })
      }
  })
export type ReplayDebugSnapshot = z.infer<typeof replayDebugSnapshotSchema>
