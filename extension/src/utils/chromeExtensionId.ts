import { createHash } from 'node:crypto'

/** The number of hex digits of the SHA-256 digest an extension id keeps (16 bytes). */
const ID_HEX_DIGITS = 32
/** The code of the letter `a`, the image of the hex digit 0. */
const LETTER_A_CODE = 97
const HEX_RADIX = 16

/**
 * Maps the first 32 hex digits of a digest to Chrome's extension id alphabet: 0-f become a-p.
 * Called by {@link chromeExtensionIdFromPath} and {@link chromeExtensionIdFromKey}.
 * @param digestInput - The bytes Chrome hashes.
 * @returns The 32-letter id.
 * @example idFromBytes(Buffer.from('x')) // => a 32-letter string of a-p
 */
function idFromBytes(digestInput: Buffer): string {
  const hexDigits = createHash('sha256')
    .update(digestInput)
    .digest('hex')
    .slice(0, ID_HEX_DIGITS)
  return Array.from(hexDigits, (digit) =>
    String.fromCharCode(LETTER_A_CODE + Number.parseInt(digit, HEX_RADIX)),
  ).join('')
}

/**
 * Computes the id Chrome gives an unpacked extension without a manifest `key`: the SHA-256 of the UTF-8 absolute path, first 32 hex digits mapped 0-f to a-p.
 * Needed before launch so the run can check `Extensions.loadUnpacked`'s answer and build `chrome-extension://<id>/` urls; called by {@link resolveChromeExtensionRun}.
 * Supports macOS and Linux paths only: Windows path rules (drive letters, case, UTF-16) are out of scope (ER7). The string is hashed exactly as given with no Unicode normalization, so the caller must pass the same realpath it passes to `loadUnpacked` (SR28).
 * @param canonicalPath - The extension root's realpath.
 * @returns The 32-letter id.
 * @example
 * chromeExtensionIdFromPath('/Users/lume/qa/c61/bookmark-xp-explorer') // => 'kgdakicbeoenmomkdpkiobphgcknpomd'
 */
export function chromeExtensionIdFromPath(canonicalPath: string): string {
  return idFromBytes(Buffer.from(canonicalPath, 'utf8'))
}

/**
 * Computes the id Chrome gives an extension whose manifest declares a `key`: the SHA-256 of the DER public key, mapped like the path rule.
 * Called by {@link resolveChromeExtensionRun} when the manifest carries a validated key.
 * @param base64PublicKey - The manifest's `key` (base64 of the DER SubjectPublicKeyInfo).
 * @returns The 32-letter id.
 * @example chromeExtensionIdFromKey('MFkwEwYH…') // => 'lkbpbcmlmcgphmfmhjejoinopdjlmpac'
 */
export function chromeExtensionIdFromKey(base64PublicKey: string): string {
  return idFromBytes(Buffer.from(base64PublicKey, 'base64'))
}
