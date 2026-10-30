import {
  MILLISECONDS_PER_SECOND,
  REPOSITORY_SETUP_TIMEOUT_MS,
  VITE_STOP_EXTENSIONS,
  VITE_SUPPORTED_MAJOR,
} from './constants'
import { ERROR_RECOVERY } from './errors'
import { VITE_REFUSAL_CODES, viteHelpAnchor } from './viteRefusals'

/**
 * A minimal valid `vite-dev` configuration, generic on purpose: every identity and hash is a placeholder the agent replaces with the value the step named in {@link VITE_QUICK_START_COPY_FROM} returned.
 * The help serves it as `quickStart.configuration`, and a test parses it with the public schema so it cannot drift from the schema.
 */
export const VITE_QUICK_START_CONFIGURATION = {
  version: 1,
  adapter: 'vite-dev',
  book: {
    bookId: 'my-article',
    revision: 1,
    nodeId: 'my-node',
    anchorIndex: 0,
  },
  source: {
    path: 'src/example/handler.ts',
    hash: '0000000000000000000000000000000000000000000000000000000000000000',
    line: 12,
    column: 3,
  },
  action: {
    title: 'Click the button',
    selector: '[data-testid="example-button"]',
    before: [{ kind: 'visible', selector: '[data-testid="example-button"]' }],
    after: [
      {
        kind: 'text',
        selector: '[data-testid="example-result"]',
        equals: 'Done',
      },
    ],
  },
  inspections: [{ path: 'value', mode: 'value', required: true }],
} as const

/** Where each placeholder of {@link VITE_QUICK_START_CONFIGURATION} is copied from. */
const VITE_QUICK_START_COPY_FROM = {
  'book.bookId, book.revision, book.nodeId':
    'the answer of codebook_publish_book (the published article); book.anchorIndex is the index of the cited anchor in that node',
  'source.path, source.hash':
    'the answer of codebook_source for the file the stop is in (the same path and full SHA-256 as the article cites)',
  'source.line, source.column':
    'one-based position in the numberedText of that codebook_source answer',
  'action.selector, action.before, action.after':
    'read from the source or the rendered page; never guess a library default',
  'inspections[].path':
    'a primitive the stop can read at that line, found in the same source',
  instanceId:
    'codebook_status (copy it into every later tool call; recopy it after a restart)',
} as const

/**
 * Builds the Vite part of `codebook://help/repository-browser`: a quick start with the call order, the supported/unsupported table, the first-run and written-files notes, and one anchor per refusal code.
 *
 * Why it exists: an agent that meets a Vite app needs the minimal route and the limits before it reads the long Next-oriented sections. Called by the resource reader for the repository-browser help, whose first keys are these.
 *
 * @returns Keys to spread at the start of the help object: `viteQuickStart`, `viteSupport`, `viteFirstRun` and `viteRefusals`.
 * @example
 * const help = { ...viteHelp(), profile: 'repository-browser' }
 * help.viteRefusals.VITE_SEAL_FAILED.anchor // => 'codebook://help/repository-browser#VITE_SEAL_FAILED'
 */
export function viteHelp() {
  const setupSeconds = REPOSITORY_SETUP_TIMEOUT_MS / MILLISECONDS_PER_SECOND
  return {
    viteQuickStart: {
      summary: `For a Vite ${VITE_SUPPORTED_MAJOR} web app: configure adapter "vite-dev" (instead of "next-dev-webpack") and use the same tools in this order. Use the adapter that codebook_status reports ready under profiles[].prerequisites.adapters.`,
      configuration: VITE_QUICK_START_CONFIGURATION,
      copyFrom: VITE_QUICK_START_COPY_FROM,
      callOrder: [
        'codebook_status: confirm profiles[].prerequisites.adapters["vite-dev"].ready is true; copy instanceId.',
        'codebook_sources, then codebook_source: read the file the stop is in; copy its path, full SHA-256 and the line and column from numberedText.',
        'codebook_publish_book: publish a source-only article whose node cites that file; copy bookId, revision and nodeId.',
        'codebook_start: profile repository-browser, the configuration above with the copied values and a stable key; the answer is a receipt with a run id.',
        'Poll the run resource it names until the run reads ready (or an error): preparation starts Vite, seals the stops and opens the app.',
        'codebook_action repository-click: copy the run id and revision from the run resource (its nextActions), send it once with a stable action key.',
        'At each pause read inspectionUri and sourceUri, explain the values in the chat, then codebook_continue with the continueArguments of the current run resource.',
      ],
    },
    viteSupport: {
      supported: [
        `Vite major ${VITE_SUPPORTED_MAJOR}; its own engines.node range must include the Node that Codebook runs (Codebook: Node Executable). A .nvmrc or .node-version of the project is not honored.`,
        'A root app: the workspace root is the package root (a Vite app in a sub-folder, a packageRoot, is not supported yet).',
        'A dev script of the form [NAME=value ...] vite [dev|serve] [--host] [--open] [--port N] [--mode M] [--config F]; --port, --mode and --config (also written --port=N) are forwarded to Vite as the script would, --host and --open are ignored (Codebook binds 127.0.0.1 and opens no browser of its own). Codebook never runs the dev script itself.',
        `Stops in JavaScript or TypeScript files under the package root (${VITE_STOP_EXTENSIONS.join(', ')}) that the entry page loads.`,
        'Browser stops only.',
      ],
      unsupported: [
        'Another Vite major, or a vite package that does not resolve from the package root (Yarn Plug-n-Play without node_modules).',
        'A dev script with any other command, flag, shell operator (&&, ;, |), variable expansion, quote or redirect; a cross-env, npx or pnpm exec prefix; a predev script.',
        'Config settings Codebook does not own: a server.port of 0, https, origin, an own-listener hmr (port, host or server), middlewareMode or appType "custom", a base other than "/", a root other than the package root, a cacheDir outside the package root. These are found at the start, not by codebook_status, and are refused all at once.',
        'Stops in .vue, .svelte or other non-JS/TS files, in node_modules, or outside the package root.',
        'SSR and a server participant (participant "server" is refused with vite-dev).',
        'A page that reloads after the declared inputs were written: the run ends and the click is not resent.',
      ],
    },
    viteFirstRun: `The first run of a project can be slower than later ones while Vite pre-bundles dependencies; preparation has ${setupSeconds} s in all. A run writes Vite's dependency cache (the resolved cacheDir, node_modules/.vite by default) and a transient vite.config.*.timestamp-*.mjs file that Vite removes (Codebook removes one left by a forced stop). Codebook writes nothing else into the repository.`,
    viteRefusals: Object.fromEntries(
      VITE_REFUSAL_CODES.map((code) => [
        code,
        { anchor: viteHelpAnchor(code), recovery: ERROR_RECOVERY[code] },
      ]),
    ),
  }
}
