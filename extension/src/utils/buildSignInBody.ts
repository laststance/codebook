import type { NodeServerConfiguration } from '../nodeServerConfigSchemas'

/**
 * Builds the JSON body of the sign-in request: the declared fields plus the learner's secret.
 *
 * Why it exists: the secret is typed into the editor box and never stored in the configuration, so the body is assembled at send time.
 * Called by the node-server run just before it sends the sign-in request.
 *
 * @param signIn - The configuration's `signIn`.
 * @param secret - The value the learner typed for `signIn.secretField`.
 * @returns The JSON text of every `fields` entry and `[signIn.secretField]: secret`.
 * @example
 * buildSignInBody({ path: '/login', fields: { email: 'a@b.test' }, secretField: 'password', secret: 'ask-learner' }, 's3cret')
 * // => '{"email":"a@b.test","password":"s3cret"}'
 */
export function buildSignInBody(
  signIn: NonNullable<NodeServerConfiguration['signIn']>,
  secret: string,
): string {
  return JSON.stringify({ ...signIn.fields, [signIn.secretField]: secret })
}
