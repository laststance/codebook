import type { Protocol } from 'devtools-protocol'

/** The longest `req.url` the read accepts: a longer target is treated as unreadable, so a hostile request cannot fill the journal or the saved text. */
const MAX_REQUEST_URL_CHARS = 2048

/** The class name Node gives a request object of an API route's handler. */
const REQUEST_CLASS_NAME = 'IncomingMessage'

/** The request a Pages API route handler is answering, as the paused frame's `req` holds it. */
export type PagesApiRequest = { method: string; url: string }

/**
 * Reads the request a Pages API route handler is answering from the handler frame's local scope, without evaluating anything.
 *
 * Why it exists: one default export serves every method, so the handler's name says nothing about the method (E-1, Cycle 0088). The paused frame's local scope holds the request as an `IncomingMessage`, and its own data properties `method` and `url` name the request exactly, whatever the parameter is called. Called by {@link ConfiguredBrowserRun} at a hit of an API-route stop.
 * It takes values the debugger already answered (`Runtime.getProperties`, own properties): exactly one `IncomingMessage` among the locals is the request, and a property that is an accessor is never invoked. Destructured parameters, several requests (a proxied call) and accessors all read as unreadable, and the caller then attributes the pause by the operation window.
 * @param localProperties - The own properties of the handler frame's local scope object.
 * @param readOwnProperties - Gives the own properties of one object by its remote object id; may reject or answer `undefined` when the object cannot be read.
 * @returns
 * - `{ method, url }` when exactly one local is an `IncomingMessage` whose `method` and `url` are own string data properties (the url at most 2048 characters)
 * - `undefined` for zero or several requests, an accessor, a non-string value or a failed read
 * @example
 * await readPagesApiRequest(
 *   [{ name: 'req', value: { type: 'object', className: 'IncomingMessage', objectId: '7' }, configurable: true, enumerable: true }],
 *   async () => [
 *     { name: 'method', value: { type: 'string', value: 'GET' }, configurable: true, enumerable: true },
 *     { name: 'url', value: { type: 'string', value: '/api/data?clear=1' }, configurable: true, enumerable: true },
 *   ],
 * ) // => { method: 'GET', url: '/api/data?clear=1' }
 */
export async function readPagesApiRequest(
  localProperties: readonly Protocol.Runtime.PropertyDescriptor[],
  readOwnProperties: (
    objectId: string,
  ) => Promise<readonly Protocol.Runtime.PropertyDescriptor[] | undefined>,
): Promise<PagesApiRequest | undefined> {
  const requests = localProperties.filter(
    (property) => property.value?.className === REQUEST_CLASS_NAME,
  )
  const objectId = requests[0]?.value?.objectId
  // Exactly one request object: none (a destructured parameter) or several cannot be told apart safely.
  if (requests.length !== 1 || objectId === undefined) return undefined
  let own: readonly Protocol.Runtime.PropertyDescriptor[] | undefined
  try {
    own = await readOwnProperties(objectId)
  } catch {
    return undefined
  }
  const method = stringDataProperty(own, 'method')
  const url = stringDataProperty(own, 'url')
  if (
    method === undefined ||
    url === undefined ||
    method === '' ||
    url.length > MAX_REQUEST_URL_CHARS
  )
    return undefined
  return { method: method.toUpperCase(), url }
}

/**
 * Reads a string-valued own data property by name; an accessor (a getter or setter, which the read never invokes) and any other value read as absent.
 * @param properties - The own properties of one object.
 * @param name - The property name.
 * @returns The string value, or `undefined`.
 * @example stringDataProperty([{ name: 'url', value: { type: 'string', value: '/a' }, configurable: true, enumerable: true }], 'url') // => '/a'
 */
function stringDataProperty(
  properties: readonly Protocol.Runtime.PropertyDescriptor[] | undefined,
  name: string,
): string | undefined {
  const property = properties?.find((candidate) => candidate.name === name)
  if (!property || property.get || property.set) return undefined
  const value = property.value
  return value?.type === 'string' && typeof value.value === 'string'
    ? value.value
    : undefined
}
