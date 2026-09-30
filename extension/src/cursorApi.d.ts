declare module 'vscode' {
  export const cursor:
    | {
        mcp?: {
          registerServer: (config: {
            name: string
            server:
              | { url: string; headers?: Record<string, string> }
              | { command: string; args: string[]; env: Record<string, string> }
          }) => void
          unregisterServer: (serverName: string) => void
        }
      }
    | undefined
}
