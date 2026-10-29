/**
 * Builds the `chrome-extension://<id>/<path>` url of a file under the extension root.
 * Called by {@link discoverStaticLoads} as the base every reference in that file is resolved against.
 * @param relativePath - Path relative to the root, forward slashes.
 * @param extensionId - The run's extension id.
 * @returns The file's extension url.
 * @example extensionFileUrl('popup/popup.js', 'abc…').href // => 'chrome-extension://abc…/popup/popup.js'
 */
export function extensionFileUrl(
  relativePath: string,
  extensionId: string,
): URL {
  const encoded = relativePath.split('/').map(encodeURIComponent).join('/')
  return new URL(`chrome-extension://${extensionId}/${encoded}`)
}
