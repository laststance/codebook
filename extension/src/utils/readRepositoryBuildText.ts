import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

import { unchangedSource } from './unchangedSource'

/** Acquires bounded unchanged build bytes inside the selected workspace for module discovery, rejecting linked ancestors and replacements. @example await readRepositoryBuildText(root, '.next/dev/static/chunk.js', limit, signal) */
export async function readRepositoryBuildText(
  root: string,
  path: string,
  limit: number,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted()
  const canonicalRoot = await realpath(root),
    fullPath = resolve(root, path),
    relativePath = relative(resolve(root), fullPath)
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`)
  )
    throw new Error('Build path escapes the selected workspace')
  const canonicalPath = join(canonicalRoot, relativePath)
  const inspect = async () => {
    let current = canonicalRoot
    // Every ancestor is checked so a regular final file cannot hide a linked build directory.
    for (const component of relativePath.split(sep)) {
      signal?.throwIfAborted()
      current = join(current, component)
      if ((await lstat(current)).isSymbolicLink())
        throw new Error('Linked build paths are unsupported')
    }
    if (
      (await realpath(root)) !== canonicalRoot ||
      (await realpath(canonicalPath)) !== canonicalPath
    )
      throw new Error('Build containment changed')
    const identity = await lstat(canonicalPath, { bigint: true })
    if (!identity.isFile()) throw new Error('Build path is not a regular file')
    return identity
  }
  const before = await inspect(),
    handle = await open(
      canonicalPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !unchangedSource(before, opened))
      throw new Error('Build file changed before acquisition')
    if (opened.size > BigInt(limit))
      throw new Error('Build text exceeds byte limit')
    const bytes = Buffer.alloc(Number(opened.size) + 1)
    let offset = 0
    // Fill legal short reads, with one extra byte detecting growth without unbounded allocation.
    while (offset < bytes.length) {
      signal?.throwIfAborted()
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      )
      if (!result.bytesRead) break
      offset += result.bytesRead
    }
    const after = await handle.stat({ bigint: true })
    if (
      offset !== Number(opened.size) ||
      !unchangedSource(opened, after) ||
      !unchangedSource(after, await inspect())
    )
      throw new Error('Build file changed during acquisition')
    const text = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes.subarray(0, offset))
    if (
      text.includes('\0') ||
      !Buffer.from(text).equals(bytes.subarray(0, offset))
    )
      throw new Error('Build is not lossless UTF-8 text')
    signal?.throwIfAborted()
    return text
  } finally {
    await handle.close()
  }
}
