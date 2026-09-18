import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { dirname } from 'node:path';

/** Injects only editor effects into compiled boundary modules while preserving actual Node/SDK code. @example await loadModule<typeof import('../../environment')>(path, {vscode: stub}) */
export async function loadModule<Module>(path: string, dependencies: Record<string, unknown>): Promise<Module> {
  const required = createRequire(path), module = { exports: {} };
  runInNewContext(await readFile(path, 'utf8'), { module, exports: module.exports, __dirname: dirname(path), __filename: path, Buffer, process, console,
    require: (name: string) => Object.hasOwn(dependencies, name) ? dependencies[name] : required(name) }, { filename: path });
  // A dynamically evaluated CommonJS export has no static TypeScript type; callers supply the original module contract.
  return module.exports as Module;
}
