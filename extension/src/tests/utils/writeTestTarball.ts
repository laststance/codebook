import { writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

/** Writes one octal field of a tar header, NUL-terminated and zero-padded to the field width. */
function octal(value: number, width: number): Buffer {
  return Buffer.from(`${value.toString(8).padStart(width - 1, '0')}\0`)
}

/** Builds the 512-byte ustar header of a regular file. */
function header(name: string, size: number): Buffer {
  const block = Buffer.alloc(512)
  block.write(name, 0, 100, 'utf8')
  octal(0o644, 8).copy(block, 100)
  octal(0, 8).copy(block, 108)
  octal(0, 8).copy(block, 116)
  octal(size, 12).copy(block, 124)
  octal(0, 12).copy(block, 136)
  block.fill(0x20, 148, 156)
  block.write('0', 156)
  block.write('ustar\0', 257)
  block.write('00', 263)
  let checksum = 0
  for (const byte of block) checksum += byte
  block.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148)
  return block
}

/**
 * Writes an npm-style tarball for a test: every file under the `package/` segment, as `npm pack` and `pnpm pack` do.
 * @param files - Package-relative path to file text (`package.json`, `dist/index.mjs`).
 * @param tarballPath - Where the `.tgz` goes.
 * @example
 * writeTestTarball({ 'package.json': '{"name":"lib","version":"2.0.0"}' }, '/tmp/run/lib-2.0.0.tgz')
 */
export function writeTestTarball(
  files: Readonly<Record<string, string>>,
  tarballPath: string,
): void {
  const blocks: Buffer[] = []
  for (const [path, text] of Object.entries(files)) {
    const content = Buffer.from(text)
    blocks.push(header(`package/${path}`, content.length), content)
    blocks.push(Buffer.alloc((512 - (content.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  writeFileSync(tarballPath, gzipSync(Buffer.concat(blocks)))
}
