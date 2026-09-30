import { createHash } from 'node:crypto'
import { readVsixBytes } from './utils/readVsixBytes.mjs'
import { readVsixEntries } from './utils/readVsixEntries.mjs'
import { verifyPackageContent } from './utils/verifyPackageContent.mjs'

const [path, ...extra] = process.argv.slice(2)
if (!path || extra.length)
  throw new Error('Usage: pnpm package:check /path/to/codebook.vsix')
const bytes = await readVsixBytes(path)
const checked = await verifyPackageContent(await readVsixEntries(bytes))
console.log(
  JSON.stringify(
    {
      ...checked,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    },
    null,
    2,
  ),
)
