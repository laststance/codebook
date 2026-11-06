import { gzipSync } from 'node:zlib'

/** One entry of a hand-built tar archive; every field the reader looks at can be set. */
export type TestTarEntry = {
  /** The name in the header's 100-byte name field (cut to 100 bytes). */
  name: string
  /** The tar type flag; `0` is a regular file. */
  typeFlag?: string
  /** The file text; empty for links and folders. */
  content?: string
  /** The permission bits (default 0o644). */
  mode?: number
  /** The link target of a symlink or hard link entry. */
  linkName?: string
}

/** Writes one octal field, NUL-terminated and zero-padded to the field width. */
function octal(value: number, width: number): Buffer {
  return Buffer.from(`${value.toString(8).padStart(width - 1, '0')}\0`)
}

/** Builds one 512-byte ustar header followed by the padded content blocks. */
function entryBlocks(entry: TestTarEntry): Buffer {
  const content = Buffer.from(entry.content ?? '')
  const block = Buffer.alloc(512)
  block.write(entry.name, 0, 100, 'utf8')
  octal(entry.mode ?? 0o644, 8).copy(block, 100)
  octal(0, 8).copy(block, 108)
  octal(0, 8).copy(block, 116)
  octal(content.length, 12).copy(block, 124)
  octal(0, 12).copy(block, 136)
  block.fill(0x20, 148, 156)
  block.write(entry.typeFlag ?? '0', 156)
  block.write(entry.linkName ?? '', 157, 100, 'utf8')
  block.write('ustar\0', 257)
  block.write('00', 263)
  let checksum = 0
  for (const byte of block) checksum += byte
  block.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148)
  return Buffer.concat([
    block,
    content,
    Buffer.alloc((512 - (content.length % 512)) % 512),
  ])
}

/** A pax extended header record `<length> <key>=<value>\n`, where the length counts itself. */
export function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`
  let length = body.length + 1
  while (String(length).length + body.length !== length)
    length = String(length).length + body.length
  return `${length}${body}`
}

/**
 * Builds the bytes of a tar archive from entries a test writes by hand, so the reader meets headers `npm pack` never writes.
 * @param entries - The entries in order; a pax (`x`) or GNU long name (`L`) entry applies to the entry after it.
 * @returns The uncompressed archive, ending with the two empty blocks.
 * @example
 * buildTestTarArchive([{ name: 'package/a.txt', content: 'a' }]).length // => 2048
 */
export function buildTestTarArchive(entries: readonly TestTarEntry[]): Buffer {
  return Buffer.concat([...entries.map(entryBlocks), Buffer.alloc(1024)])
}

/** Builds the gzip of {@link buildTestTarArchive}, the shape of a `.tgz`. */
export function buildTestTarball(entries: readonly TestTarEntry[]): Buffer {
  return gzipSync(buildTestTarArchive(entries))
}
