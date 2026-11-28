import { resolve } from 'node:path'

export const CURSOR_BRIDGE_MODULE_PATH = JSON.stringify(
  resolve(__dirname, '../../cursorMcpBridge.js'),
)
