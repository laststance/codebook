import { posix, win32 } from 'node:path'

import type { DebugStackFrameOfAnswer } from './stackTraceResponseOf'

/** The parts of a text document's URI that tell which debug source it shows, as `vscode.Uri` has them. */
export interface DocumentUriParts {
  scheme: string
  path: string
  query: string
  fsPath: string
}

/** A path that the editor parses as a URI of its own (`hnr` of VS Code 1.140.0 workbench line 694 col 12520); a drive letter is no scheme. */
const URI_LIKE_PATH = /^[a-zA-Z][a-zA-Z0-9+\-.]+:/

/**
 * Says whether a text document is the one the editor opens for a debug adapter's source, by the editor's own mapping of a source to a URI; asked by {@link StopKeyboardHandOver} when a text editor becomes active while a stop waits for its hand-over.
 * The editor opens a source the adapter serves by reference as a `debug:` document of the session (`lvt`, VS Code 1.140.0 workbench line 694 col 16858; Cursor 3.23.12 line 17298 col 67367) and a source with an absolute path as that file. A file the editor saw first in another case keeps that case on a file system that ignores case (`asCanonicalUri`), so a file is compared without case on Windows and macOS. A path the editor parses as a URI of its own and a relative path are not compared: the stop's frame is waited for then.
 * @param uri - The document's URI.
 * @param source - The source of the frame the editor focuses for the stop.
 * @param sessionId - The debug session of the stop, which names a `debug:` document.
 * @param platform - The operating system, which decides whether a file's case counts.
 * @returns
 * - `true` when the document is that source's `debug:` document or that file
 * - `false` otherwise, also for a source whose mapping is not compared
 * @example
 * isEditorOfDebugSource({ scheme: 'file', path: '/app/actions.ts', query: '', fsPath: '/app/actions.ts' }, { path: '/app/actions.ts' }, 'learner-node', 'linux') // => true
 * isEditorOfDebugSource({ scheme: 'debug', path: '<node_internals>/timers', query: 'session=learner-node&ref=9', fsPath: '<node_internals>/timers' }, { path: '<node_internals>/timers', sourceReference: 9 }, 'learner-node', 'linux') // => true
 */
export function isEditorOfDebugSource(
  uri: DocumentUriParts,
  source: NonNullable<DebugStackFrameOfAnswer['source']>,
  sessionId: string,
  platform: NodeJS.Platform,
): boolean {
  const sourcePath = source.path || source.name || ''
  // A source the adapter serves by reference opens as a `debug:` document of the session.
  if (source.sourceReference !== undefined && source.sourceReference > 0)
    return (
      uri.scheme === 'debug' &&
      uri.path === sourcePath.replace(/^\/+/g, '/') &&
      uri.query === `session=${sessionId}&ref=${source.sourceReference}`
    )
  const isFilePath = (platform === 'win32' ? win32 : posix).isAbsolute(
    sourcePath,
  )
  // Only a source with an absolute path that the editor does not parse as a URI opens as that file.
  if (URI_LIKE_PATH.test(sourcePath) || !isFilePath || uri.scheme !== 'file')
    return false
  return isSameFilePath(uri.fsPath, sourcePath, platform)
}

/**
 * Says whether two paths name the same file as the operating system reads them; the file comparison of {@link isEditorOfDebugSource}.
 * @param documentPath - The document's file system path.
 * @param sourcePath - The path the adapter gave the source.
 * @param platform - The operating system.
 * @returns `true` for the same path, without case on Windows and macOS (Windows also accepts either slash); `false` otherwise.
 * @example isSameFilePath('c:\\app\\actions.ts', 'C:/app/actions.ts', 'win32') // => true
 */
function isSameFilePath(
  documentPath: string,
  sourcePath: string,
  platform: NodeJS.Platform,
): boolean {
  if (platform === 'win32')
    return (
      win32.normalize(documentPath).toLowerCase() ===
      win32.normalize(sourcePath).toLowerCase()
    )
  if (platform === 'darwin')
    return documentPath.toLowerCase() === sourcePath.toLowerCase()
  return documentPath === sourcePath
}
