import type { ViteFacts } from './utils/assessViteSettings'

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
    }
  | {
      type: 'vite-failed'
      phase: ViteLauncherPhase
      errorName: string
      /** The first line of the error message, still unmasked: the extension masks it. */
      firstLine: string
      configFile?: string
      /** Values of the env files, read best-effort, for masking the first line by value. */
      envValues: string[]
    }
  | { type: 'vite-listening'; port: number }

/** What the extension tells the launcher after the facts. */
export type ViteLauncherCommand =
  { type: 'vite-listen' } | { type: 'vite-refuse' }
