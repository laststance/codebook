/** Stands in for `vscode.Uri.parse` where a test only passes an address through: its text, also as `toString()`. @example parseFakeUri('http://127.0.0.1:4100/').toString() // => 'http://127.0.0.1:4100/' */
export const parseFakeUri = (
  value: string,
): { value: string; toString(): string } => ({ value, toString: () => value })

/** Stands in for `vscode.env.asExternalUri` in a local window, where the editor forwards no address. @example await keepLocalAddress(uri) // => uri */
export const keepLocalAddress = async <Address>(
  address: Address,
): Promise<Address> => address
