import type { BuildClock, BuildSpawner } from './buildProcessTypes'

/** The external Node as {@link resolveExternalNode} returns it, or none when it could not be resolved. */
export type WxtBuildNode = { executable: string; version: string } | undefined

/** What {@link buildWxtExtension} needs to build one WXT project. */
export type WxtBuildInput = {
  /** The Git repository root (the tracked-file check runs from it). */
  repositoryRoot: string
  /** The real path of `extensionRoot`, inside the repository. */
  projectRoot: string
  /** The run's private folder; the build goes to `wxt-build/` inside it. */
  privateFolder: string
  node: WxtBuildNode
  signal: AbortSignal
  clock?: BuildClock
  spawner?: BuildSpawner
}

/** The outcome of a build step that was not refused. */
export type WxtBuildResult =
  | {
      kind: 'built'
      /** The folder to load as an unpacked extension (`<outDir>/chrome-mv3-dev`). */
      loadRoot: string
      wxtVersion: string
      durationMs: number
    }
  /** The caller's signal ended the build and the tracked files are verified unchanged; the caller maps this to its stop error. */
  | { kind: 'cancelled' }
