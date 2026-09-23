declare module 'vscode' {
  export namespace cursor {
    export namespace mcp {
      export interface RemoteServerConfig {
        name: string;
        server: { url: string; headers?: Record<string, string> };
      }
      export const registerServer: (config: RemoteServerConfig) => void;
      export const unregisterServer: (serverName: string) => void;
    }
  }
}
