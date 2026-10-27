import { REDACTION_MASK } from '../constants'

/** Private-key PEM blocks, whole; an unterminated block is masked to the end of the text. Public keys and certificates are not secrets and stay. The label words are bounded so a crafted run of labels cannot backtrack quadratically. */
const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY[A-Z0-9 ]{0,40}-----[\s\S]*?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY[A-Z0-9 ]{0,40}-----|$)/g

/** A URL's userinfo password: `scheme://user:password@host`; the user name stays. */
const URL_USERINFO_PASSWORD =
  /((?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s:/?#@]*):[^\s/?#]*@/gi

/** Three base64url segments, the first two starting `eyJ` (a JSON header and payload). */
const JSON_WEB_TOKEN =
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g

/** `Bearer <token>`; the word stays. A token of fewer than 8 characters is not taken for one. */
const BEARER_TOKEN = /\b(Bearer[ \t]+)[A-Za-z0-9._~+/=-]{8,}/gi

/** Provider keys by prefix: OpenAI-style `sk-`, Stripe `sk_`/`rk_` live and test keys, GitHub `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_` and `github_pat_`, Slack `xox?-`, Google `AIza`, npm `npm_`, AWS access and session keys `AKIA`/`ASIA`. */
const PREFIXED_KEYS = [
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/g,
  /(?<![A-Za-z0-9])[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}/g,
  /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}/g,
  /(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}/g,
  /(?<![A-Za-z0-9])npm_[A-Za-z0-9]{36}/g,
  /(?<![A-Z0-9])A(?:KI|SI)A[0-9A-Z]{16}(?![A-Z0-9])/g,
]

/**
 * Replaces secret-looking values in text with {@link REDACTION_MASK}: URL userinfo passwords, JWTs, Bearer tokens, the provider keys of {@link PREFIXED_KEYS}, and private-key PEM blocks.
 * Why: the redaction contract keeps credentials out of chat, history and logs; called by {@link createOutputRedactor}, {@link redactInspectedValue}, {@link sanitizeCause} and {@link formatCodebookDiagnostic}. It detects these shapes only, never a secret in plain text.
 * @param text - Any captured text.
 * @returns The text with every match replaced; unchanged when nothing matches.
 * @example
 * redactSecretText('smtps://mailer:pw@smtp:465') // => 'smtps://mailer:[masked]@smtp:465'
 * redactSecretText('Authorization: Bearer abcdefgh12345') // => 'Authorization: Bearer [masked]'
 */
export function redactSecretText(text: string): string {
  let redacted = text
    .replace(PRIVATE_KEY_BLOCK, REDACTION_MASK)
    .replace(URL_USERINFO_PASSWORD, `$1:${REDACTION_MASK}@`)
    .replace(JSON_WEB_TOKEN, REDACTION_MASK)
    .replace(BEARER_TOKEN, `$1${REDACTION_MASK}`)
  for (const pattern of PREFIXED_KEYS)
    redacted = redacted.replace(pattern, REDACTION_MASK)
  return redacted
}
