import { splitNameIntoWords } from './splitNameIntoWords'

/** Final words that make a name secret: `accessToken`, `db_passwd`, `set-cookie`, `dbPass`, `jwt`; `apikey`, `privatekey`, `secretkey` and `accesskey` are the one-word spellings. */
const SECRET_FINAL_WORDS: ReadonlySet<string> = new Set([
  'password',
  'passwords',
  'passwd',
  'passphrase',
  'passphrases',
  'pwd',
  'pass',
  'jwt',
  'sid',
  'secret',
  'secrets',
  'token',
  'tokens',
  'authorization',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'session',
  'sessions',
  'apikey',
  'privatekey',
  'secretkey',
  'accesskey',
])

/** Words that, before a final `key` or `keys`, make a name secret: `apiKey`, `private_key`, `AWS_SECRET_ACCESS_KEY`, `signingKey`; `publicKey`, `primaryKey`, `sortKey` and `cacheKey` stay visible. */
const SECRET_KEY_QUALIFIERS: ReadonlySet<string> = new Set([
  'api',
  'private',
  'secret',
  'access',
  'signing',
  'encryption',
  'master',
  'client',
  'auth',
  'session',
])

/**
 * Tells whether a variable, property or header name holds a secret by its words, so the redaction contract masks its value and its whole subtree.
 * Why: `tokenCount`, `sortKey` and `publicKey` must stay readable while `accessToken`, `AWS_SECRET_ACCESS_KEY` and `sessionId` must not; called by {@link isSecretPath} and the snapshot capture ({@link captureReplayDebugSnapshot}).
 * @param name - One name, in camelCase, snake_case, kebab-case or dotted form.
 * @returns `true` when the final word is a secret word, the name ends in a key named for a secret use (`api key`, `secret access key`, `signing key`), or in `session id`.
 * @example
 * isSecretName('accessToken') // => true
 * isSecretName('tokenCount') // => false
 */
export function isSecretName(name: string): boolean {
  const words = splitNameIntoWords(name)
  const finalWord = words.at(-1)
  if (finalWord === undefined) return false
  if (SECRET_FINAL_WORDS.has(finalWord)) return true
  const qualifier = words.at(-2)
  if (qualifier === undefined) return false
  // A key named for its secret use (`apiKey`, `secretAccessKey`), and a session's id, hold credentials.
  if (finalWord === 'key' || finalWord === 'keys')
    return SECRET_KEY_QUALIFIERS.has(qualifier)
  return finalWord === 'id' && qualifier === 'session'
}
