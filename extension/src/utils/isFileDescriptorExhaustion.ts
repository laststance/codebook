/**
 * Says whether a file-system error means the process or the system ran out of file descriptors, a condition a later attempt overcomes; called by the Devin bridge when a descriptor file cannot be opened.
 * @param error - What the open threw.
 * @returns `true` for EMFILE (this process's limit) and ENFILE (the system's limit); `false` for anything else.
 * @example
 * isFileDescriptorExhaustion(Object.assign(new Error('x'), { code: 'EMFILE' })) // => true
 * isFileDescriptorExhaustion(new Error('x'))                                    // => false
 */
export function isFileDescriptorExhaustion(error: unknown): boolean {
  // Not `instanceof Error`: an error from another realm fails that check.
  if (typeof error !== 'object' || error === null || !('code' in error))
    return false
  return error.code === 'EMFILE' || error.code === 'ENFILE'
}
