import { VITE_SUPPORTED_MAJOR } from '../constants'

/** The Yarn Plug-n-Play refusal sentence, shared by the start and `codebook_status`. */
export const VITE_PNP_MESSAGE =
  'Yarn Plug-n-Play without node_modules is not supported: vite cannot be resolved from the package root. Use node_modules (nodeLinker: node-modules).'

/** The sentence for a workspace that has no resolvable `vite` package and no Next. */
export const VITE_NOT_INSTALLED_MESSAGE =
  'Install the workspace dependencies, including vite, before using vite-dev (the vite package does not resolve from the package root).'

/** The sentence for a workspace that has Next and no `vite` package. */
export const VITE_ADAPTER_MISROUTE_MESSAGE =
  'vite-dev was chosen, but this workspace has Next and no vite package: use adapter "next-dev-webpack".'

/** The sentence `codebook_status` gives for a Next-only workspace: at status time nobody chose `vite-dev`, so it says what is available instead of what was chosen. */
export const VITE_NOT_AVAILABLE_FOR_NEXT_MESSAGE =
  'This workspace has Next and no vite package, so vite-dev is not available here; use next-dev-webpack.'

/** The sentence for an `engines.node` check that needs the configured Node executable and has none. */
export const VITE_NODE_NOT_CONFIGURED_MESSAGE =
  'The Vite engines.node check needs the configured Node executable (codebook.nodeExecutable).'

/**
 * The sentence for an `engines.node` check whose configured Node executable is set but cannot run, so it is never mistaken for one that is not set.
 * @param cause - What running the executable reported.
 * @returns The sentence, naming the cause and the setting to fix.
 * @example
 * viteNodeUnrunnableMessage('spawn /opt/node ENOENT') // => 'The configured Node executable (codebook.nodeExecutable) could not be run for the Vite engines.node check: spawn /opt/node ENOENT. Point the setting at a Node that runs.'
 */
export function viteNodeUnrunnableMessage(cause: string): string {
  return `The configured Node executable (codebook.nodeExecutable) could not be run for the Vite engines.node check: ${cause}. Point the setting at a Node that runs.`
}

/**
 * The sentence for a Vite whose major is not supported.
 * @param version - The found Vite version.
 * @returns The refusal sentence, naming the found version and the supported major.
 * @example
 * viteMajorMessage('7.1.0') // => 'Vite 7.1.0 is installed; Codebook supports Vite 8 only.'
 */
export function viteMajorMessage(version: string): string {
  return `Vite ${version} is installed; Codebook supports Vite ${VITE_SUPPORTED_MAJOR} only.`
}

/**
 * The sentence for a Vite whose `engines.node` excludes the run's Node.
 * @param version - The found Vite version.
 * @param range - Vite's `engines.node` range.
 * @param nodeVersion - The run's Node version.
 * @returns The refusal sentence with the fix.
 * @example
 * viteEnginesMessage('8.3.5', '^20.19.0 || >=22.12.0', 'v18.0.0') // => 'Vite 8.3.5 requires Node ^20.19.0 || >=22.12.0, but Codebook runs Node v18.0.0 …'
 */
export function viteEnginesMessage(
  version: string,
  range: string,
  nodeVersion: string,
): string {
  return `Vite ${version} requires Node ${range}, but Codebook runs Node ${nodeVersion} (the Node Executable setting; a .nvmrc or .node-version is not honored). Set codebook.nodeExecutable to a Node in that range.`
}

/**
 * The sentence for a Vite whose `engines.node` range uses syntax Codebook does not read, so it cannot tell whether the run's Node is inside it.
 * @param version - The found Vite version.
 * @param range - Vite's `engines.node` text, named as unknown.
 * @param nodeVersion - The run's Node version.
 * @returns The refusal sentence naming the range.
 * @example
 * viteEnginesUnknownMessage('8.3.5', '>=18 <=bad', 'v24.22.1') // => 'Vite 8.3.5 declares the Node range ">=18 <=bad", which Codebook does not know how to read …'
 */
export function viteEnginesUnknownMessage(
  version: string,
  range: string,
  nodeVersion: string,
): string {
  return `Vite ${version} declares the Node range ${JSON.stringify(range)}, which Codebook does not know how to read, so it cannot confirm that Node ${nodeVersion} (the Node Executable setting) is inside it. Reinstall Vite ${VITE_SUPPORTED_MAJOR} so its package.json carries a standard engines.node range.`
}

/**
 * The sentence for a run whose Node version text cannot be read as a version, so it cannot be placed in Vite's `engines.node` range.
 * @param version - The found Vite version.
 * @param range - Vite's `engines.node` range.
 * @param nodeVersion - The text the configured Node reported.
 * @returns The refusal sentence naming the reported text.
 * @example
 * viteNodeVersionUnknownMessage('8.3.5', '>=20', 'node-latest') // => 'Vite 8.3.5 requires Node >=20, but the configured Node reported "node-latest" …'
 */
export function viteNodeVersionUnknownMessage(
  version: string,
  range: string,
  nodeVersion: string,
): string {
  return `Vite ${version} requires Node ${range}, but the configured Node (the Node Executable setting) reported ${JSON.stringify(nodeVersion)}, which Codebook cannot read as a version, so it cannot confirm that Node is inside that range. Set codebook.nodeExecutable to a Node executable that prints a version such as v24.22.1.`
}

/** The sentence for a missing `dev` script. */
export const VITE_NO_DEV_SCRIPT_MESSAGE =
  'package.json has no dev script. Codebook starts Vite as the dev script does and accepts a script such as "vite" or "vite dev".'

/** The sentence for a `predev` script. */
export const VITE_PREDEV_MESSAGE =
  "package.json has a predev script: Codebook starts Vite directly and would skip it, so its start would differ from the project's own."

/**
 * The sentence for a `package.json` that cannot be read as the workspace's manifest, never quoting its contents.
 * @param reason - Why it could not be read, such as `is not valid JSON`.
 * @returns The refusal sentence naming `package.json`.
 * @example
 * viteManifestUnreadableMessage('is not valid JSON') // => 'package.json could not be read: it is not valid JSON. Fix it so Codebook can read the dev script.'
 */
export function viteManifestUnreadableMessage(reason: string): string {
  return `package.json could not be read: it ${reason}. Fix it so Codebook can read the dev script.`
}

/**
 * The sentence for a `dev` script outside the grammar, naming every refused element.
 * @param refused - The refused elements `parseViteDevScript` listed (grammar words only, never values).
 * @returns The refusal sentence with the accepted forms.
 * @example
 * viteScriptMessage(['the operator &&']) // => 'The dev script is outside what Codebook starts: the operator &&. Accepted: …'
 */
export function viteScriptMessage(refused: readonly string[]): string {
  return `The dev script is outside what Codebook starts: ${refused.join('; ')}. Accepted: [NAME=value ...] vite [dev|serve] [--host] [--open] [--port N] [--mode M] [--config F] (--config a file inside the package root).`
}
