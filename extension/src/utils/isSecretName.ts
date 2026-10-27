import { splitNameIntoWords } from './splitNameIntoWords'

/** Final words that make a name secret: `accessToken`, `db_passwd`, `set-cookie`; `apikey` and `privatekey` are the one-word spellings. */
const SECRET_FINAL_WORDS: ReadonlySet<string> = new Set([
  'password',
  'passwords',
  'passwd',
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
])

/** Words that, before a final `key`, make a name secret: `apiKey`, `private_key`. */
const SECRET_KEY_QUALIFIERS: ReadonlySet<string> = new Set(['api', 'private'])

/**
 * Tells whether a variable, property or header name holds a secret by its words, so the redaction contract masks its value and its whole subtree.
 * Why: `tokenCount` and `sortKey` must stay readable while `accessToken` must not; called by {@link isSecretPath} and the snapshot capture ({@link captureReplayDebugSnapshot}).
 * @param name - One name, in camelCase, snake_case, kebab-case or dotted form.
 * @returns `true` when the final word is a secret word or the final two words are `api key` / `private key`.
 * @example
 * isSecretName('accessToken') // => true
 * isSecretName('tokenCount') // => false
 */
export function isSecretName(name: string): boolean {
  const words = splitNameIntoWords(name)
  const finalWord = words.at(-1)
  if (finalWord === undefined) return false
  if (SECRET_FINAL_WORDS.has(finalWord)) return true
  // `api key` and `private key` as two words (`apiKey`, `api_key`).
  const qualifier = words.at(-2)
  return (
    finalWord === 'key' &&
    qualifier !== undefined &&
    SECRET_KEY_QUALIFIERS.has(qualifier)
  )
}
