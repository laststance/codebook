// Test-only stand-in for a repository's tsx loader, which `--import` runs before the entry; it never ships (package.test.mjs checks the VSIX).
// Real tsx is covered only by the native check. This one only leaves a mark the test reads over the inspector, so it proves the loader ran before the entry.
// The tests copy its compiled file into the fixture repository as `node_modules/tsx/dist/loader.js`, so it imports nothing.
Reflect.set(globalThis, 'standInLoaderRan', true)
