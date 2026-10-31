/**
 * `dev` script forms and whether {@link devScriptRequestsWebpack} reads each as asking Next for webpack, in the order the packaged README lists them.
 * Read by the function's table-driven test, which proves each answer on a real `package.json`, and by the README pin in `nextDocs.test.ts`, which requires the README's webpack-sentence condition to list exactly these forms.
 * `otherScripts` are written beside `scripts.dev`, so a delegation's target holds the flag the function must not follow.
 */
export const DEV_SCRIPT_WEBPACK_FORMS = [
  { devScript: 'next dev --webpack', asksForWebpack: true },
  { devScript: 'next dev --webpack -p 3000', asksForWebpack: true },
  {
    devScript: 'concurrently "next dev --webpack" "tsc -w"',
    asksForWebpack: false,
  },
  { devScript: 'next dev --webpack; echo ready', asksForWebpack: false },
  { devScript: 'next dev --webpack=true', asksForWebpack: false },
  {
    devScript: 'npm run dev:web',
    otherScripts: { 'dev:web': 'next dev --webpack' },
    asksForWebpack: false,
  },
] as const
