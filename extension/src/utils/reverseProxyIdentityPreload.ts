/**
 * Builds the CommonJS text of the identity preload the development server runs with `--require`.
 *
 * Why it exists: the proof must be answered by Codebook's code inside the server Codebook started, without running any route code of the app. The preload replaces `http.Server.prototype.emit` so a `request` whose URL starts with {@link REVERSE_PROXY_PROOF_PATH_PREFIX} is answered with `HMAC-SHA256(secret, challenge)`, the secret read from {@link REVERSE_PROXY_PROOF_SECRET_ENV}; without the variable it is inert. The text holds no secret. Called by `ReverseProxyGate.preparePreload()`.
 * @returns The source of the preload file.
 * @example
 * buildReverseProxyIdentityPreloadSource().includes('__codebook_proof__') // => true
 */
export function buildReverseProxyIdentityPreloadSource(): string {
  throw new Error('not implemented')
}

/**
 * Computes the answer the preload gives to a challenge, for the prover to compare with.
 * @param secret - The run's identity secret (hex).
 * @param challenge - The 32-hex-character challenge of one proof.
 * @returns `HMAC-SHA256(secret, challenge)` as 64 lowercase hex characters.
 * @example
 * expectedProofOf(secret, '00112233445566778899aabbccddeeff') // => '9f2c…' (64 hex characters)
 */
export function expectedProofOf(secret: string, challenge: string): string {
  void secret
  void challenge
  throw new Error('not implemented')
}
