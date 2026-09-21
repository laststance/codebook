import { access, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { DEMO_ASSET_PATHS } from '../constants';

/** Checks bundled demo prerequisites independently from repository support for environment discovery and acquisition. @example await checkDemoFiles(templateRoot) // [] when built */
export async function checkDemoFiles(templateRoot: string): Promise<string[]> {
  try {
    await Promise.all(DEMO_ASSET_PATHS.map(async file => {
      const path = join(templateRoot, file);
      // A directory or escaping symlink is not an installed fixture, even when access succeeds.
      if (!(await lstat(path)).isFile()) throw new Error(`Expected bundled file: ${file}`);
      await access(path, constants.R_OK);
    }));
    return [];
  } catch { return ['Bundled demo files are missing or unreadable. Reinstall Codebook.']; }
}
