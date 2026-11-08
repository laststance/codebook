/**
 * Builds the Chrome switch that pins a declared host to the address Codebook checked.
 *
 * Why it exists: the saved-profile browser and the throwaway probe must reach the validated address and no other, so both get the same rule. Called by the gate for the run's browser, the setup browser and the probe.
 * @param hostname - The canonical host name of the declared origin.
 * @param address - The validated address; an IPv6 address is bracketed.
 * @returns `--host-resolver-rules=MAP <hostname> <address>`.
 * @example
 * hostResolverRuleOf('app.example.test', '127.0.0.1') // => '--host-resolver-rules=MAP app.example.test 127.0.0.1'
 * hostResolverRuleOf('app.example.test', '::1') // => '--host-resolver-rules=MAP app.example.test [::1]'
 */
export function hostResolverRuleOf(hostname: string, address: string): string {
  void hostname
  void address
  throw new Error('not implemented')
}
