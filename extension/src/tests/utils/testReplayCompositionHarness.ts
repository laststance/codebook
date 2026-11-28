import type { workspaceHarness } from '../studyWorkspaceHarness'

export type Harness = Awaited<ReturnType<typeof workspaceHarness>>
