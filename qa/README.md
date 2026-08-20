# Browser smoke QA

This lane is a dependency-free smoke harness for the Water runtime. It is
intentionally limited to `qa/**`: it does not add package scripts, dependencies,
lockfile entries, browser automation packages, or runtime instrumentation.

## Target and artifacts

The coordinator-owned target is:

```text
http://127.0.0.1:5173
```

The harness contains:

- `qa/http-smoke.mjs` — a Node built-in `fetch` preflight for the dev document.
- `qa/browser-smoke.mjs` — a browser-side ES module with no import-time DOM side
  effects. Import it from the local dev server and call
  `collectBrowserEvidence()`; `WATER_HUD_REQUIREMENTS` is the default and
  reviewed variants can pass an explicit `requiredHud` list.

The browser collector returns schema-versioned JSON evidence for the mount and
page identity, visible/nonzero canvas, CSS and backing-store sizes, WebGL
drawing buffer, viewport fit, document/body overflow, the integrated Water HUD
marker/copy contract, extensible HUD requirements, runtime overlays, and
input/resize diagnostics. It does not claim that a screenshot was taken or
that console errors were absent; those are recorded by the coordinator's
In-app Browser run.

## Exact evidence sequence

Run the sequence from this checkout, preserving each JSON result with the
coordinator's task evidence:

1. Start the foundation/integrated app at the exact target URL. The coordinator
   owns the dev-server process and records its checkout, Node/npm versions, and
   target URL.

2. Run the HTTP-only boot preflight:

   ```sh
   node qa/http-smoke.mjs http://127.0.0.1:5173
   ```

   A passing result requires a 2xx HTML response, an `<html>` document, the
   `#app` mount, and a module entry containing `/src/main.ts`. A failed fetch or
   failed check is a preflight blocker; it is not browser/runtime evidence.

3. Before navigation, configure the In-app Browser to capture uncaught page
   errors and console messages at error level. Retain the messages and stack
   details in the run evidence. Do not treat a clean HTTP preflight as proof of
   a clean page or console.

4. Navigate to exactly `http://127.0.0.1:5173`. Verify page identity before
   inspecting visuals: origin, pathname, document title, and the expected
   `#app` mount. The foundation title is `Water Runtime`; an integrated lane
   may record an updated title only when the coordinator has reviewed it.

5. Wait for the page to settle, then perform the blank/overlay checks in the
   actual user-facing viewport. Confirm that the page is not a blank white/black
   surface, the canvas has `data-qa="water-canvas"` and occupies a visible
   nonzero area, no loading/fatal/error overlay obscures the scene, and the HUD
   has the required `data-qa` markers and copy: `water-hud`, `brand` (`WATER`),
   `compass` (`W N E`), `wind` (`WIND <dynamic> KN`), `controls` (`WASD STEER`
   and `DRAG LOOK`), `speed` (`<dynamic> KN`), and `sail` (`SAIL <dynamic>%`).

6. From the page-evaluate surface of the In-app Browser, import and run the
   collector. The exact browser-side expression is:

   ```js
   const { collectBrowserEvidence } = await import('/qa/browser-smoke.mjs?qa=smoke');
   collectBrowserEvidence(); // uses WATER_HUD_REQUIREMENTS by default
   ```

   Save the returned structured evidence. The default result requires the
   integrated Water marker/copy contract. A reviewed variant may pass its own
   `requiredHud` list; `requiredHud: []` makes `checks.requiredHud.ok` `null`
   intentionally and is not a passing claim about product HUD copy.

7. Exercise basic input against the canvas in the same page: focus/click the
   canvas, send one representative keyboard input, and perform a short
   pointer drag (pointer down, move, and up) inside the canvas. Re-run the
   collector and retain `diagnostics.input`, including active-element,
   focusability, pointer-events, and touch-action fields. The runner's event
   log is the evidence that the actions were dispatched; this collector records
   the target readiness and post-action state.

8. Capture a before snapshot, resize the user-facing viewport to a materially
   different width and height, wait for one animation/layout turn, and run the
   collector again. Compare `viewport`, `canvas.css.rect`,
   `diagnostics.resize.currentViewport`, and both overflow flags. Restore the
   original viewport and retain a final collector result. A resize that leaves
   horizontal/vertical overflow or a canvas outside the viewport is a defect
   report for the owning lane.

9. Take screenshots at the reviewed user-facing viewport after boot and after
   resize. Screenshots are visual evidence only; pair them with the structured
   collector result and the In-app Browser page/console error log.

10. Record performance as deferred. No device, browser, measurement method, or
    performance budget is agreed in this lane, so this harness does not invent
    thresholds or report performance acceptance.

## Scope and interpretation

This lane can prove the local HTTP/document boundary and collect browser DOM,
layout, and WebGL-surface facts. It cannot prove hosted deployment state,
pixel quality, or absence of console errors without the coordinator's In-app
Browser run. Defects found after ocean or raft integration should be reported
to the owning lane; fixes require a new scoped dispatch.
