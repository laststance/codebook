/** Devin's request 0 of a handshake, as the Devin bridge tests send it. */
export const DEVIN_INITIALIZE_REQUEST = {
  jsonrpc: '2.0',
  id: 0,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'devin-bridge-test', version: '1.0' },
  },
}
