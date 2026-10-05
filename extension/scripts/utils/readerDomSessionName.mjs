import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

/** How many hex characters of the SHA-256 of the output folder's path a session name carries: 32 bits, enough to tell the runs of one machine apart. */
const OUTPUT_FOLDER_DIGEST_HEX_LENGTH = 8

/**
 * Names the browser session of one run of a Reader DOM check, so that two runs on one machine keep their own browsers: opening a session closes the browser that has its name, and closing one closes it for every run that uses the name.
 *
 * Called by `study-bootstrap-qa.mjs` and `wiki-reader-dom-qa.mjs` once, before their first `playwright-cli` call; every call of the run passes the name as `-s=<name>`.
 *
 * The name carries the check, its mode and a digest of the output folder's absolute path. Two checkouts have two paths, and so have two runs from one checkout into two folders. Two runs into one folder share the name: they would overwrite each other's report and stills as well, and the later run closes a browser an ended run left open there.
 * The browser CLI uses the name as a file name (`<name>.session`, `<name>.err`) and in the path of its socket, where every character that is no letter, digit or hyphen becomes a hyphen and a path above the system's limit is replaced by a digest. The name therefore holds lower-case letters, digits and hyphens only, and stays short.
 *
 * @param check - The check's own part of the name, in lower-case letters and hyphens: `bootstrap` or `wiki-reader`.
 * @param mode - `verify` or `red`.
 * @param outputFolder - The folder the run writes its report into; a relative path is taken from the current directory.
 * @returns `cb-<check>-<mode>-<digest>`, where the digest is the first 8 hex characters of the SHA-256 of the folder's absolute path.
 * @example
 * readerDomSessionName('bootstrap', 'verify', '/work/codebook/artifacts/reader-dom')        // => 'cb-bootstrap-verify-5ccc52ef'
 * readerDomSessionName('bootstrap', 'verify', '/work/codebook-review/artifacts/reader-dom') // => 'cb-bootstrap-verify-d63eb6d4'
 */
export function readerDomSessionName(check, mode, outputFolder) {
  const folderDigest = createHash('sha256')
    .update(resolve(outputFolder))
    .digest('hex')
    .slice(0, OUTPUT_FOLDER_DIGEST_HEX_LENGTH)
  return `cb-${check}-${mode}-${folderDigest}`
}
