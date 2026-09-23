declare module 'vscode' {
  export const cursor: {
    mcp?: {
      registerServer: (config: { name: string; server: { url: string; headers?: Record<string, string> } }) => void;
      unregisterServer: (serverName: string) => void;
    };
  } | undefined;
}
