import { z } from 'zod'

import type { ExtensionSeedBookmark } from './chromeExtensionContracts'
import {
  EXTENSION_ACKNOWLEDGED_PERMISSION_LIMIT,
  EXTENSION_ACKNOWLEDGED_PERMISSION_LIMIT_CHARS,
  EXTENSION_CLICK_LIMIT,
  EXTENSION_CLICK_TITLE_LIMIT_CHARS,
  EXTENSION_SEED_TITLE_LIMIT_CHARS,
  EXTENSION_SEED_URL_LIMIT_CHARS,
  EXTENSION_STOP_LIMIT,
  REPOSITORY_PATH_LIMIT_CHARS,
  REPOSITORY_STORAGE_KEY_LIMIT_CHARS,
} from './constants'
import {
  repositoryBookSelectionSchema,
  repositoryInputsSchema,
  selectorSchema,
} from './repositoryConfigSchemas'
import { addExtensionSeedIssues } from './utils/addExtensionSeedIssues'

/** A repository-relative or extension-relative path; confinement is checked against the real file system by {@link resolveChromeExtensionRun}, so `..` and absolute paths get its worded refusal rather than a pattern error. */
const extensionPathSchema = z
  .string()
  .min(1)
  .max(REPOSITORY_PATH_LIMIT_CHARS)
  .regex(/^[^\x00-\x1f\x7f]+$/)

const seedNodeSchema: z.ZodType<ExtensionSeedBookmark> = z.lazy(() =>
  z.strictObject({
    title: z.string().max(EXTENSION_SEED_TITLE_LIMIT_CHARS),
    url: z.string().max(EXTENSION_SEED_URL_LIMIT_CHARS).optional(),
    children: z.array(seedNodeSchema).optional(),
  }),
)

const clickSchema = z.strictObject({
  title: z.string().min(1).max(EXTENSION_CLICK_TITLE_LIMIT_CHARS),
  selector: selectorSchema,
  kind: z.enum(['click', 'dblclick']).default('click'),
  dialog: z.enum(['accept', 'dismiss']).optional(),
  inputs: repositoryInputsSchema.optional(),
})

const stopSchema = z.strictObject({
  path: extensionPathSchema,
  line: z.number().int().positive(),
  context: z.enum(['page', 'service-worker']),
})

const seedSchema = z
  .strictObject({
    bookmarks: z.array(seedNodeSchema).optional(),
    storage: z.record(z.string(), z.json()).optional(),
  })
  .superRefine(addExtensionSeedIssues)

const surfaceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('popup') }),
  z.strictObject({
    kind: z.literal('page'),
    path: extensionPathSchema.refine(
      (path) => path.endsWith('.html'),
      'expected an .html file under the extension root',
    ),
  }),
])

const observeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), selector: selectorSchema }),
  z.strictObject({
    kind: z.literal('storage'),
    key: z.string().min(1).max(REPOSITORY_STORAGE_KEY_LIMIT_CHARS),
  }),
  z.strictObject({ kind: z.literal('popup') }),
])

/**
 * Bounds one chrome-extension run before anything launches: the shared book object, the extension folder, the surface (popup or one extension page), 1 to 3 declared clicks, an optional seed, 1 to 4 stops in the page or the service worker, and what to observe.
 * Unknown keys are refused, so an `inspections` key fails (SR11). Path confinement and file checks are made later by {@link resolveChromeExtensionRun}.
 * Parsed by {@link parseChromeExtensionConfiguration}; its issues are worded by {@link describeChromeExtensionConfigurationIssues}.
 * @example
 * chromeExtensionConfigSchema.parse({ version: 1, adapter: 'chrome-mv3-unpacked', book, extensionRoot: 'ext', surface: { kind: 'popup' }, clicks: [{ title: 'Add', selector: '#add' }], stops: [{ path: 'popup.js', line: 3, context: 'page' }], observe: { kind: 'popup' } })
 */
export const chromeExtensionConfigSchema = z.strictObject({
  version: z.literal(1),
  adapter: z.literal('chrome-mv3-unpacked'),
  book: repositoryBookSelectionSchema,
  extensionRoot: extensionPathSchema,
  surface: surfaceSchema,
  clicks: z.array(clickSchema).min(1).max(EXTENSION_CLICK_LIMIT),
  seed: seedSchema.default({}),
  stops: z.array(stopSchema).min(1).max(EXTENSION_STOP_LIMIT),
  observe: observeSchema,
  acknowledgedPermissions: z
    .array(z.string().min(1).max(EXTENSION_ACKNOWLEDGED_PERMISSION_LIMIT_CHARS))
    .max(EXTENSION_ACKNOWLEDGED_PERMISSION_LIMIT)
    .optional(),
})

export type ChromeExtensionConfiguration = z.infer<
  typeof chromeExtensionConfigSchema
>
