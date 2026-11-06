import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { gunzipSync } from 'node:zlib'

import {
  LIBRARY_UNPACK_ENTRY_LIMIT_COUNT,
  LIBRARY_UNPACK_LIMIT_BYTES,
} from '../constants'

/** The size of one tar block; headers and padded contents are multiples of it. */
const TAR_BLOCK_BYTES = 512

/** One entry of a tar archive, after pax and GNU long-name headers were applied to it. */
type TarEntry = {
  name: string
  typeFlag: string
  executableBits: number
  content: Buffer
}

/** Reads a NUL-terminated text field of a tar header. */
function readField(header: Buffer, start: number, length: number): string {
  const field = header.subarray(start, start + length)
  const end = field.indexOf(0)
  return field.subarray(0, end === -1 ? length : end).toString('utf8')
}

/** Reads an octal number field of a tar header; 0 for an empty field, `NaN` for a malformed one. */
function readOctal(header: Buffer, start: number, length: number): number {
  const text = readField(header, start, length).trim()
  return text === '' ? 0 : Number.parseInt(text, 8)
}

/** Parses pax extended header records (`<length> <key>=<value>\n`) into a map. */
function parsePaxRecords(content: Buffer): Map<string, string> {
  const records = new Map<string, string>()
  let offset = 0
  while (offset < content.length) {
    const space = content.indexOf(0x20, offset)
    if (space === -1) break
    const length = Number.parseInt(content.toString('utf8', offset, space), 10)
    if (!Number.isInteger(length) || length <= 0) break
    const record = content.toString('utf8', space + 1, offset + length - 1)
    const equals = record.indexOf('=')
    if (equals !== -1)
      records.set(record.slice(0, equals), record.slice(equals + 1))
    offset += length
  }
  return records
}

/**
 * Turns a tar entry name into a path inside the unpack folder, dropping the first path segment (`package/` in an npm tarball).
 * @returns The destination, or `undefined` for a name that names only the dropped segment.
 * @throws When the name leaves the folder (absolute, `..`).
 */
function destinationOf(folder: string, entryName: string): string | undefined {
  const segments = entryName.split('/').filter((part) => part !== '')
  if (segments.length < 2) return undefined
  const destination = resolve(folder, ...segments.slice(1))
  const fromFolder = relative(folder, destination)
  if (
    fromFolder === '' ||
    isAbsolute(fromFolder) ||
    fromFolder === '..' ||
    fromFolder.startsWith(`..${sep}`)
  )
    throw new Error(`The tarball entry "${entryName}" leaves the folder.`)
  return destination
}

/** Reads the header at an offset; `undefined` at the archive's end marker. */
function readHeader(archive: Buffer, offset: number) {
  const header = archive.subarray(offset, offset + TAR_BLOCK_BYTES)
  // An empty block ends the archive.
  if (header.every((byte) => byte === 0)) return undefined
  const size = readOctal(header, 124, 12)
  if (!Number.isInteger(size) || size < 0)
    throw new Error('The tarball holds a malformed header.')
  const content = archive.subarray(
    offset + TAR_BLOCK_BYTES,
    offset + TAR_BLOCK_BYTES + size,
  )
  if (content.length !== size)
    throw new Error('The tarball ends inside an entry.')
  const prefix = readField(header, 345, 155)
  const headerName = readField(header, 0, 100)
  return {
    size,
    content,
    typeFlag: String.fromCharCode(header[156] ?? 0x30),
    name: prefix === '' ? headerName : `${prefix}/${headerName}`,
    executableBits: readOctal(header, 100, 8) & 0o111,
  }
}

/** Walks the entries of an archive, applying pax `path` records and GNU long names to the entry that follows. */
function* readTarEntries(archive: Buffer): Generator<TarEntry> {
  let offset = 0
  let pendingName: string | undefined
  let entryCount = 0
  while (offset + TAR_BLOCK_BYTES <= archive.length) {
    const header = readHeader(archive, offset)
    if (header === undefined) return
    offset +=
      TAR_BLOCK_BYTES +
      Math.ceil(header.size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES
    entryCount++
    if (entryCount > LIBRARY_UNPACK_ENTRY_LIMIT_COUNT)
      throw new Error('The tarball holds too many entries.')
    if (header.typeFlag === 'x')
      pendingName = parsePaxRecords(header.content).get('path') ?? pendingName
    else if (header.typeFlag === 'L')
      pendingName = header.content.toString('utf8').replace(/\0+$/, '')
    // A global pax header holds defaults no entry here depends on.
    else if (header.typeFlag !== 'g') {
      yield {
        name: pendingName ?? header.name,
        typeFlag: header.typeFlag,
        executableBits: header.executableBits,
        content: header.content,
      }
      pendingName = undefined
    }
  }
}

/**
 * Unpacks an npm tarball (`.tgz`) into a folder with Node's own gzip and a small tar reader, no shell and no program from `PATH`.
 *
 * Why it exists: the library route unpacks the package its manager packed into `<private folder>/node_modules/<name>`; npm tarballs hold regular files only, so anything else (a link, a device) is refused, as is an entry that would leave the folder.
 * Called by {@link prepareLibraryPackage}.
 * @param tarballPath - The `.tgz` file.
 * @param folder - The existing or new folder the package contents go to; the first path segment of each entry (`package/`) is dropped.
 * @returns The number of files written.
 * @throws When the archive is not gzip or tar, holds an entry that is not a file or directory, leaves the folder, or passes the entry or size limit.
 * @example
 * await extractPackageTarball('/tmp/run/toolkit-2.14.0.tgz', '/tmp/run/node_modules/@reduxjs/toolkit') // => 53
 */
export async function extractPackageTarball(
  tarballPath: string,
  folder: string,
): Promise<number> {
  const archive = gunzipSync(await readFile(tarballPath))
  await mkdir(folder, { recursive: true })
  let totalBytes = 0
  let fileCount = 0
  for (const entry of readTarEntries(archive)) {
    if (entry.typeFlag === '5') {
      const directory = destinationOf(folder, entry.name.replace(/\/$/, ''))
      if (directory !== undefined) await mkdir(directory, { recursive: true })
      continue
    }
    if (entry.typeFlag !== '0' && entry.typeFlag !== '\0')
      throw new Error(
        `The tarball entry "${entry.name}" is neither a file nor a folder.`,
      )
    totalBytes += entry.content.length
    if (totalBytes > LIBRARY_UNPACK_LIMIT_BYTES)
      throw new Error('The tarball unpacks to too many bytes.')
    const destination = destinationOf(folder, entry.name)
    if (destination === undefined) continue
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, entry.content, {
      mode: entry.executableBits === 0 ? 0o644 : 0o755,
    })
    fileCount++
  }
  return fileCount
}
