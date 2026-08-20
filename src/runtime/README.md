# Runtime foundation

The runtime is a small, feature-oriented Three.js shell. The application entrypoint composes it with an empty feature list so later lanes can add ocean and raft features without changing the shared lifecycle.

From the repository root:

```sh
npm install
npm run typecheck
npm run build
npm run dev
```

`RuntimeFeature` accepts either `init` or `mount`, an optional per-frame `update`, an optional `resize`, and `dispose`. Every callback receives the shared scene, camera, renderer, clock, viewport, input snapshot, typed configuration, loading controller, fatal-error seam, and generic service registry. A feature must provide `init` or `mount`; the runtime validates this when starting.

The service registry uses stable `Symbol.for` keys. `provide` returns an owner cleanup function, `remove` invokes the registered disposer, and runtime disposal clears the remaining services after feature disposal. Keep service keys domain-neutral and define them in the feature module that owns the service contract.

`createRuntimeShell(container, { diagnostic: false })` keeps the canvas and loading/error seams while omitting the non-product diagnostic overlay for final composition.
