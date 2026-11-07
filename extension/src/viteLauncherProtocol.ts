import type { ViteFacts } from './utils/assessViteSettings'
import type { LibraryBlockers } from './viteLibraryRedirect'

/** What the extension passes the launcher on its command line (one JSON argument). */
export type ViteLauncherOptions = {
  /** The absolute path of the app's own Vite ESM entry. */
  viteEntry: string
  /** The package root; the launcher's working directory too. */
  root: string
  /** `--mode` of the dev script. */
  mode: string | undefined
  /** `--config` / `-c` of the dev script. */
  configFile: string | undefined
  /** `--port` of the dev script, when given. */
  port: number | undefined
  /** The checked-out library to serve from its packed copy (the library route); absent for every other run. */
  library?: ViteLauncherLibraryOptions
}

/** What the launcher needs to redirect the Example's imports of one library to its packed copy; every path is absolute. */
export type ViteLauncherLibraryOptions = {
  /** The library's package name. */
  packageName: string
  /** The real path of the unpacked package folder; it may be empty when the server is created. */
  packedRoot: string
  /** A real file inside the private folder, the importer the redirect resolves the library from. */
  anchorFile: string
  /** The real path of the library's package folder. */
  libraryRoot: string
  /** The packed `package.json` `peerDependencies` names. */
  peers: string[]
  /** The packed `package.json` `imports` field, when it has one. */
  imports?: Record<string, unknown>
  /** The run's private folder: it holds the Vite cache (`vite-cache`) and is allowed to the dev server. */
  privateFolder: string
}

/** The phase a launcher failure happened in, named in the refusal. */
export type ViteLauncherPhase = 'import' | 'config' | 'listen'

/** What the launcher tells the extension. */
export type ViteLauncherReport =
  | {
      type: 'vite-env'
      /** Values of the env files, sent right after Vite is imported and before any project code runs, so the extension masks them in every output it publishes even when the launcher dies before its facts. */
      envValues: string[]
    }
  | {
      type: 'vite-facts'
      facts: ViteFacts
      /** Values of the env files Vite loaded (at least the masked minimum length), for masking by value only; never published. */
      envValues: string[]
      /** What would defeat the redirect, read from the same resolved config; present only for a library run. */
      libraryBlockers?: LibraryBlockers
    }
  | {
      type: 'vite-failed'
      phase: ViteLauncherPhase
      errorName: string
      /** The first line of the error message, still unmasked: the extension masks it; the sentence that says why the line is withheld. */
      firstLine: string
      configFile?: string
      /** Values of the env files, read best-effort, for masking the first line by value. */
      envValues: string[]
    }
  | { type: 'vite-listening'; port: number }
  /** The dependency optimizer of Vite's client environment has nothing left to process (or there is none). */
  | { type: 'vite-optimizer-idle' }
  /** The answer to one {@link ViteLibraryModulesCommand}. */
  | ViteLibraryModulesReport

/** Why a walk of Vite's client module graph ended early: too many modules, too much transformed code, or its time limit. */
export type ViteLibraryWalkBound = 'modules' | 'bytes' | 'deadline'

/** Asks the launcher which modules of one library folder Vite's client graph reaches from the entry modules. */
export type ViteLibraryModulesCommand = {
  type: 'vite-library-modules'
  /** Echoed in the answer, so an answer is never taken for another request's. */
  requestId: number
  /** The entry module URLs, as the served `index.html` lists them in its module scripts (e.g. `/src/main.tsx`). */
  entries: string[]
  /** The real (symlink-resolved) absolute path of the library's folder. */
  libraryFolder: string
}

/** What the launcher answers to a {@link ViteLibraryModulesCommand}. */
export type ViteLibraryModulesReport = {
  type: 'vite-library-modules-result'
  /** The `requestId` of the command this answers. */
  requestId: number
  /** The served URLs (e.g. `/@fs/…/build/modern/query.js`) of every reached module whose real file path lies inside the library folder, in walk order, without duplicates. */
  modules: string[]
  /** Whether one of Vite's optimized dependencies has its source inside the library folder (the page may then reach the library pre-bundled). */
  optimizedLibrary: boolean
  /** The bound that ended the walk before it finished; absent when the walk finished. */
  bound?: ViteLibraryWalkBound
}

/** What the extension tells the launcher after the facts. */
export type ViteLauncherCommand =
  | { type: 'vite-listen' }
  | { type: 'vite-refuse' }
  /** Sent after listening: the launcher answers `vite-optimizer-idle` once Vite's dependency optimizer is idle. */
  | { type: 'vite-await-optimizer' }
  /** Sent after listening: the launcher answers `vite-library-modules-result`. */
  | ViteLibraryModulesCommand
