import { NODE_SERVER_REQUEST_BODY_LIMIT_BYTES } from '../constants'

/** One rule a declared request's body breaks: the field it names and the expected value. */
type RequestBodyIssue = { field: 'body' | 'contentType'; message: string }

/** The methods whose declared request carries no body. */
const METHODS_WITHOUT_BODY = ['GET', 'DELETE']

/**
 * Lists what a declared node-server request breaks of the body rules: a body rides only on a method that carries one, always with its content type, within {@link NODE_SERVER_REQUEST_BODY_LIMIT_BYTES} of UTF-8; a content type alone describes nothing.
 * Called by the request schema's refinement in `nodeServerConfigSchemas.ts`, which adds each issue at its field.
 * @param request - The declared method, content type and body.
 * @param contentTypes - The content types a body may declare, named when the body has none.
 * @returns
 * - The issues in the order the request schema reports them (method, content type, size)
 * - An empty list when the body rules hold
 * @example
 * describeNodeServerRequestBodyIssues({ method: 'GET', body: '{}' }, ['application/json'])
 * // => [{ field: 'body', message: 'expected no body for GET.' }, { field: 'contentType', message: "expected the body's content type: application/json." }]
 * describeNodeServerRequestBodyIssues({ method: 'POST', contentType: 'application/json', body: '{}' }, ['application/json']) // => []
 */
export function describeNodeServerRequestBodyIssues(
  request: { method: string; contentType?: string; body?: string },
  contentTypes: readonly string[],
): RequestBodyIssue[] {
  const { body } = request
  // A content type alone describes nothing.
  if (body === undefined)
    return request.contentType === undefined
      ? []
      : [
          {
            field: 'contentType',
            message: 'expected a contentType only beside a body.',
          },
        ]
  const rules: Array<{ broken: boolean; issue: RequestBodyIssue }> = [
    {
      broken: METHODS_WITHOUT_BODY.includes(request.method),
      issue: {
        field: 'body',
        message: `expected no body for ${request.method}.`,
      },
    },
    {
      broken: request.contentType === undefined,
      issue: {
        field: 'contentType',
        message: `expected the body's content type: ${contentTypes.join(', ')}.`,
      },
    },
    {
      broken:
        Buffer.byteLength(body, 'utf8') > NODE_SERVER_REQUEST_BODY_LIMIT_BYTES,
      issue: {
        field: 'body',
        message: `expected at most ${NODE_SERVER_REQUEST_BODY_LIMIT_BYTES} bytes of UTF-8 text.`,
      },
    },
  ]
  return rules.filter((rule) => rule.broken).map((rule) => rule.issue)
}
