import { join } from 'node:path';

/** Locates extension-owned demo bytes when environment discovery or {@link StudyWorkspace} reads current source. @example getDemoRoot('/extensions/codebook') // '/extensions/codebook/dist/demo' */
export function getDemoRoot(extensionPath: string): string { return join(extensionPath, 'dist', 'demo'); }
