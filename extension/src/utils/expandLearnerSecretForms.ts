/** The HTML text escapes a page or server may echo a value with; `&` first so the other entities keep their own ampersand. */
const HTML_ESCAPES: ReadonlyArray<readonly [string, string]> = [
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]

/**
 * Adds to a set of learner secrets the encoded forms a page, URL or server may carry them in.
 *
 * Why it exists: a GET form submit puts the typed value percent-encoded in the page URL and location facts, and a server or page may echo it HTML-escaped; an exact match of the raw value would miss both (ENG-4). Called by {@link maskLearnerSecretText} and {@link maskLearnerSecretData} before they mask.
 * @param secrets - The learner's raw secrets.
 * @param includeJsonEscapes - Also add the JSON-string-escaped form, for text that is serialized JSON.
 * @returns A set of the raw secrets and every form that differs from its raw secret; empty strings are dropped.
 * @example
 * [...expandLearnerSecretForms(new Set(['a b&c']), false)] // => ['a b&c', 'a%20b%26c', 'a+b%26c', 'a b&amp;c']
 */
export function expandLearnerSecretForms(
  secrets: ReadonlySet<string>,
  includeJsonEscapes: boolean,
): Set<string> {
  const forms = new Set<string>()
  for (const secret of secrets) {
    if (secret.length === 0) continue
    forms.add(secret)
    let html = secret
    for (const [raw, escaped] of HTML_ESCAPES)
      html = html.split(raw).join(escaped)
    const candidates = [
      encodeURIComponent(secret),
      new URLSearchParams({ s: secret }).toString().slice(2),
      html,
      ...(includeJsonEscapes ? [JSON.stringify(secret).slice(1, -1)] : []),
    ]
    // A form equal to the raw secret adds nothing.
    for (const form of candidates) if (form !== secret) forms.add(form)
  }
  return forms
}
