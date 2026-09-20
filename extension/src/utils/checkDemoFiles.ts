import { access } from 'node:fs/promises';
import { join } from 'node:path';

/** Checks bundled demo prerequisites independently from repository support for environment discovery and acquisition. @example await checkDemoFiles(templateRoot) // [] when built */
export async function checkDemoFiles(templateRoot: string): Promise<string[]> {
  try { await Promise.all(['server', 'client', 'constants'].flatMap(name => [`fixture/${name}.mts`, `build/${name}.mjs`, `build/${name}.mjs.map`]).map(file => access(join(templateRoot, file)))); return []; }
  catch { return ['Build the extension and paired-cart-demo packages with pnpm build.']; }
}
