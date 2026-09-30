import { extname } from 'node:path'
import {
  REPOSITORY_EXCLUDED_DIRECTORIES,
  REPOSITORY_SOURCE_EXTENSIONS,
} from '../constants'
import { repositoryPathSchema } from '../repositorySchemas'

const excludedDirectories: ReadonlySet<string> = new Set(
  REPOSITORY_EXCLUDED_DIRECTORIES,
)
const sourceExtensions: ReadonlySet<string> = new Set(
  REPOSITORY_SOURCE_EXTENSIONS,
)

/** Classifies tracked names before repository source reads; discovery exposes exclusion counts without exposing excluded filenames. @example sourceExclusion('.env') // 'hidden-path' */
export function sourceExclusion(path: string): string | undefined {
  if (!repositoryPathSchema.safeParse(path).success) return 'invalid-path'
  const parts = path.split('/'),
    name = parts.at(-1)!.toLowerCase()
  if (parts.some((part) => part.startsWith('.'))) return 'hidden-path'
  if (
    parts
      .slice(0, -1)
      .some((part) => excludedDirectories.has(part.toLowerCase()))
  )
    return 'generated-or-dependency'
  if (
    parts.some((part) =>
      /(?:^|[-_.])(credential|credentials|secret|secrets|private[-_]?key)(?:[-_.]|$)/i.test(
        part,
      ),
    ) ||
    /^(?:id_rsa|id_ed25519)(?:\.|$)/.test(name)
  )
    return 'sensitive-name'
  if (
    /(?:^|[.-])lock(?:\.|$)/.test(name) ||
    name === 'package-lock.json' ||
    name === 'npm-shrinkwrap.json'
  )
    return 'lockfile'
  if (!sourceExtensions.has(extname(name))) return 'unsupported-extension'
  return undefined
}
