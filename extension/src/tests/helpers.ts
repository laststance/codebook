import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import type { ConfiguredDefinition } from '../configuredStudySchemas'
import { LearningLibrary } from '../learningLibrary'
import { RepositoryBookStore } from '../repositoryBook'
import { RepositorySourceService } from '../repositorySource'
import type { ConfiguredRuntimeView, StudyEnvironment } from '../runtime'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { StudyService } from '../service'

import { ControlledConfiguredRuntime } from './utils/configuredServiceHarness'
import { createConfiguredStudy } from './utils/createConfiguredStudy'

const executeFile = promisify(execFile)

/** Adds acquisition and cleanup fault controls to the repository runtime double used by transport tests. @example const runtime = new ControlledRuntime(directory, definition) */
export class ControlledRuntime extends ControlledConfiguredRuntime {
  preparationWait?: Promise<void>
  resourcesReleased = false
  readonly captures: ConfiguredRuntimeView['captures'] = {}
  constructor(directory: string, definition?: ConfiguredDefinition) {
    const reference = createConfiguredStudy()
    super(
      directory,
      definition ?? {
        configuration: reference.configuration,
        configurationHash: reference.configurationHash,
        descriptor: reference.descriptor!,
      },
    )
  }
  get snapshot() {
    return this.snapshots[0]
  }
  get seal() {
    return {
      sourcePath: join(this.evidence.directory, 'source.ts'),
      ...this.source(this.definition.descriptor.itemId)!,
    }
  }
  /** Delays readiness only when a cancellation/race regression requests it. @example runtime.preparationWait = barrier */
  override async prepare(): Promise<void> {
    await this.preparationWait
    await super.prepare()
    const bytes = Buffer.from('synthetic-unit-test-pixels')
    for (const phase of ['before', 'paused-browser', 'after']) {
      await this.evidence.save(`${phase}.png`, bytes)
      this.captures[phase] = {
        status: 'captured',
        file: `${phase}.png`,
        renderer: { epoch: 'test', id: 1, hash: sha256(bytes) },
      }
    }
  }
  /** Adds explicitly synthetic phase bytes to tests of immutable recording persistence. @example runtime.view().captures.before?.status // 'captured' */
  override view(): ConfiguredRuntimeView {
    return {
      ...super.view(),
      resourcesReleased: this.resourcesReleased,
      captures: this.captures,
    }
  }
  /** Marks resource release independently of evidence flush so failed persistence remains retryable. @example await runtime.stop() */
  override async stop(): Promise<void> {
    this.resourcesReleased = true
    await super.stop()
  }
}

/** Provides real Git/source/book/storage boundaries with synthetic debugger effects for isolated unit tests. @example const harness = await createHarness() */
export async function createHarness(
  options: {
    now?: () => number
    /** Replaces the wait before a test history seal's one retry. */
    sealRetryDelay?: (milliseconds: number) => Promise<void>
    prerequisites?: StudyEnvironment['prerequisites']
    create?: (
      directory: string,
      definition?: ConfiguredDefinition,
    ) => Promise<ControlledRuntime>
    /** `vscode.env.remoteName` of the window the service runs in; `wsl` models a WSL remote window, which has no Trash. */
    remoteName?: string
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-mcp-test-')),
    reference = createConfiguredStudy()
  const runtimes: ControlledRuntime[] = []
  await executeFile('git', ['init', '--quiet', directory])
  for (const source of reference.descriptor!.sources) {
    const path = join(directory, source.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, source.text)
    await executeFile('git', ['add', '--', source.path], { cwd: directory })
  }
  const books = new RepositoryBookStore(
    new RepositorySourceService(directory, options.now),
    new LearningLibrary(join(directory, '.learning'), reference.workspaceKey),
  )
  await books.publish({
    bookId: 'interface',
    expectedRevision: 0,
    key: 'article',
    document: {
      title: 'Interface',
      summary: 'Source-grounded reading.',
      nodes: [
        {
          id: 'theme',
          title: 'Theme',
          sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
          anchors: reference.descriptor!.anchors,
          observations: [],
        },
      ],
      edges: [],
    },
  })
  const environment: StudyEnvironment = {
    workspace: directory,
    host: {
      id: 'vscode',
      productVersion: 'test',
      apiVersion: 'test',
      commit: 'test',
    },
    remoteName: options.remoteName,
    build: { revision: 'test', dirty: true, sourceHash: 'test' },
    prerequisites:
      options.prerequisites ?? (async () => ({ ready: true, missing: [] })),
    createRuntime: async (root, definition) => {
      const runtime = options.create
        ? await options.create(root, definition)
        : new ControlledRuntime(root, definition)
      runtimes.push(runtime)
      return runtime
    },
  }
  const service = new StudyService(
    environment,
    directory,
    options.now,
    options.sealRetryDelay,
  )
  service.repository = books
  return {
    directory,
    service,
    runtimes,
    configuration: reference.configuration,
    async close(): Promise<void> {
      try {
        await service.shutdown()
        await books.dispose()
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  }
}
