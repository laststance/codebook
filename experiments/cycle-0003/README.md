# Scoped native browser probe

This disposable extension inspects the Cursor native command facade in an owned empty profile **without** editor-wide remote debugging. It does not demonstrate a debugger event stream, DAP session or product compatibility. Vendor code and existing user profiles remain unchanged.

```sh
cd experiments/cycle-0001
pnpm build
cd ../cycle-0003
node runner.mjs
```

Uses Node 24+, installed Cursor, and the prior experiment's compiled deadline/installation utilities. Records native command responses/errors, a fixture page image, exact executable/vendor/probe source identifiers, and observed owned tab/process cleanup under ignored `artifacts/cycle-0003/`. Debugger enable success alone is not event subscription. `Target.getTargetInfo` is a read-only capability probe; rejection is retained rather than bypassed. `JsDebug.subscribe` probes whether this route implements the previously used js-debug proxy contract.
