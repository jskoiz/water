# Water Dispatch Board

This is the coordinator-owned source of truth for implementation dispatches. A task marked `ready` is queued for a future worker; it is not active until the coordinator records a worker thread, branch, worktree, and base commit.

Foundation, first-pass features, QA, fog repair, first visual-polish lanes, and the second screenshot's narrow horizon-scale and camera-framing corrections are integrated. The three research-backed physical-water lanes from clean baseline `d90be9d` are integrated. Native-frame comparison then opened two disjoint optical/atmospheric repair lanes from the integrated build.

Every implementation dispatch uses `gpt-5.6-luna` at `max` reasoning effort and contains exactly one lane plus the exclusive write scope recorded below.

## State model

`queued` -> `ready` -> `active` -> `review` -> `integrated`

Use `blocked` whenever a dependency or acceptance decision prevents dispatch. Only the Sol Max coordinator changes task state or the merge record.

## Queue

| Task | Lane | State | Depends on | Worker | Branch / worktree | Exclusive worker write scope |
| --- | --- | --- | --- | --- | --- | --- |
| `FND-001` | `foundation` | `integrated` | None | `/root/foundation_fnd001` | `c1/foundation-bootstrap` / `/private/tmp/water-fnd001` / base `e207233` | `package.json`; `package-lock.json`; `index.html`; `vite.config.*`; `tsconfig*.json`; `src/main.*`; `src/runtime/**` |
| `OCE-001` | `ocean-rendering` | `blocked` | Workspace policy rejected writes before mutation | `/root/ocean_oce001` | `c1/ocean-rendering` / `/private/tmp/water-oce001` / base `ccfc531` | No changes; superseded by `OCE-002` |
| `OCE-002` | `ocean-rendering` | `integrated` | `OCE-001` clean blocker; foundation/runtime reviewed | `/root/ocean_oce002` | `c1/ocean-rendering-2` / `/Users/jk/Desktop/water/.worktrees/oce002` / base `4860d54` | `src/features/ocean/**`; `src/features/environment/**`; `public/ocean/**`; `tests/ocean/**` |
| `OCE-003` | `ocean-rendering` | `integrated` | Integrated browser fatal after `OCE-002` composition | `/root/ocean_oce003` | `c1/ocean-fog-fix` / `/Users/jk/Desktop/water/.worktrees/oce003` / base `cf21135` | `src/features/ocean/ocean.ts`; `tests/ocean/**` |
| `OCE-004` | `ocean-rendering` | `integrated` | Repaired runtime screenshot comparison at `055184c` | `/root/ocean_oce004` | `c1/ocean-visual-polish` / `/Users/jk/Desktop/water/.worktrees/oce004` / base `055184c` | `src/features/ocean/**`; `src/features/environment/**` |
| `OCE-005` | `ocean-rendering` | `integrated` | Second screenshot showed foreground-sized destination | `/root/ocean_oce005` | `c1/horizon-scale-fix` / `/Users/jk/Desktop/water/.worktrees/oce005` / base `3e7bfb7` | `src/features/environment/atmosphere.ts` |
| `OCE-006` | `ocean-rendering` | `integrated` | Accepted baseline `d90be9d`; physical-water research complete | `/root/ocean_oce006` | `c1/ocean-physical-water` / `/Users/jk/Desktop/water/.worktrees/oce006` / base `d90be9d` | `src/features/ocean/waves.ts`; `src/features/ocean/ocean.ts`; optional `tests/ocean/**` |
| `OCE-007` | `ocean-rendering` | `active` | Integrated `OCE-006` frame showed broad chalky foam/reflection | `/root/ocean_oce006` | `c1/ocean-optical-tuning` / `/Users/jk/Desktop/water/.worktrees/oce007` / base `90ee59d` | `src/features/ocean/ocean.ts` |
| `ENV-001` | `ocean-rendering` | `integrated` | Accepted baseline `d90be9d`; atmosphere research complete | `/root/environment_env001` | `c1/environment-physical-light` / `/Users/jk/Desktop/water/.worktrees/env001` / base `d90be9d` | `src/features/environment/atmosphere.ts` |
| `ENV-002` | `ocean-rendering` | `active` | Integrated `ENV-001` frame showed a sparse, flat cloud field | `/root/environment_env001` | `c1/environment-visual-tuning` / `/Users/jk/Desktop/water/.worktrees/env002` / base `79cec93` | `src/features/environment/atmosphere.ts` |
| `RAFT-001` | `raft-systems` | `integrated` | `FND-001` integrated and runtime contracts reviewed at `ccfc531` | `/root/raft_raft001` | `c1/raft-systems` / `/private/tmp/water-raft001` / base `ccfc531` | `src/features/raft/**`; `public/raft/**`; `tests/raft/**` |
| `RAFT-002` | `raft-systems` | `integrated` | Repaired runtime screenshot comparison at `055184c` | `/root/raft_raft002` | `c1/raft-visual-polish` / `/Users/jk/Desktop/water/.worktrees/raft002` / base `055184c` | `src/features/raft/**` |
| `RAFT-003` | `raft-systems` | `integrated` | Second screenshot clipped deck/hull below viewport | `/root/raft_raft003` | `c1/raft-framing-fix` / `/Users/jk/Desktop/water/.worktrees/raft003` / base `3e7bfb7` | `src/features/raft/raft.ts` |
| `RAFT-004` | `raft-systems` | `integrated` | Accepted baseline `d90be9d`; marine-response research complete | `/root/raft_raft004` | `c1/raft-physical-response` / `/Users/jk/Desktop/water/.worktrees/raft004` / base `d90be9d` | `src/features/raft/raft.ts` |
| `RAFT-005` | `raft-systems` | `active` | Integrated `RAFT-004` frame showed geometric wake wedges | `/root/raft_raft004` | `c1/raft-wake-optical-tuning` / `/Users/jk/Desktop/water/.worktrees/raft005` / base `a48a091` | `src/features/raft/raft.ts` |
| `QA-001` | `world-qa` | `integrated` | `FND-001` integrated; dev URL `http://127.0.0.1:5173`; Codex In-app Browser runner | `/root/qa_qa001` | `c1/world-qa-smoke` / `/private/tmp/water-qa001` / base `ccfc531` | `qa/**` |

Paths not listed in a worker's row are out of scope. Dependency or shared-file changes are returned to the coordinator for a separate dispatch; workers do not widen their own scope.

## Acceptance gates

### FND-001 — application foundation

- Establish a minimal TypeScript, Vite, and Three.js application that can install, start, and build from a clean checkout.
- Define the shared runtime boundaries feature lanes will consume, including scene lifecycle, frame updates, input, configuration, and loading/error behavior.
- Provide a non-product diagnostic shell only; do not implement the ocean, atmosphere, raft, buoyancy, or gameplay.
- Keep all implementation under `src/runtime/**` except the serialized application entrypoint; do not create feature modules or edit orchestration documents.
- Document the local commands and add focused checks inside the assigned scope.
- Handoff includes changed paths, one focused commit, checks run, remaining risks, and requested shared-file follow-ups.

### OCE-001 — ocean and atmosphere

- Implement only against the reviewed foundation contracts; do not edit the contracts or application composition directly.
- Keep ocean, wave, foam, reflection, sky, fog, and lighting work within the assigned feature and asset paths.
- Export a feature boundary the coordinator can compose without moving ownership into shared files.
- Include lane-level checks and the standard worker handoff evidence.

### RAFT-001 — playable raft

- Implement only against the reviewed foundation contracts; do not edit the contracts or application composition directly.
- Keep raft model, buoyancy, controls, camera, wake, and raft interaction work within the assigned feature and asset paths.
- Export a feature boundary the coordinator can compose without moving ownership into shared files.
- Include lane-level checks and the standard worker handoff evidence.

### QA-001 — browser smoke baseline

- Add `qa/README.md` plus a runner-specific `qa/browser-smoke.*` suite without changing package scripts, lockfiles, entrypoints, shared contracts, or product source.
- Cover boot at the agreed dev URL, a nonzero visible render surface, no uncaught page or console errors, basic input, and resize behavior.
- Defer performance assertions until the coordinator records the device, browser, measurement method, and budgets. A measurement without those decisions is diagnostic only.
- Re-run the suite after the ocean and raft lanes are integrated. Report defects back to the owning lane; fixes require a new scoped dispatch.
- Handoff includes changed paths, one focused commit, checks run, evidence locations, and remaining risks.

### OCE-006 — physical ocean surface and shading

- Replace vertical-only sine motion with a stable, wind-driven Gerstner-style spectrum using deep-water dispersion, bounded steepness, analytic tangents/normals, and a CPU sampler that remains aligned with rendered displacement.
- Derive foam from crest compression, slope, or curvature rather than raw height alone; keep the required breakup asset and the exact `ocean.surface.v1` service boundary.
- Add distance-filtered micro-normal detail, water-IOR Fresnel-Schlick, reflected-sky/transmitted-water separation, restrained sun glitter, trough absorption, and Three.js tone-mapping/color-space integration.
- Preserve lifecycle, fog, loading, disposal, mobile support, and a bounded tessellation/shader cost.

### OCE-007 — integrated ocean optical repair

- Retain the verified Gerstner geometry, physical water IOR, service contract, and lifecycle from `OCE-006`.
- Restrict foam to irregular compressed crests, deepen trough absorption, reduce chalky reflected saturation, and shape a restrained broken sun-glitter path.
- Compare the native `1586x992` result directly with the accepted concept and the rejected `water-realism-interim.png` frame; the sea must not read as ice or a continuous snowfield.

### ENV-001 — physical atmosphere and scene lighting

- Upgrade the sky with efficient Rayleigh/Mie phase approximations, horizon optical depth, aerial perspective, a physically scaled sun disc, and layered clouds with light/self-shadow cues.
- Rebalance directional and hemispheric light, PBR environment materials, and shadow-ready islands/lighthouse without changing the public environment interface or destination framing.
- Keep the shader compatible with Three.js tone mapping/color management and avoid new dependencies or assets.

### ENV-002 — integrated atmosphere visual repair

- Retain the verified Rayleigh/Mie/extinction basis, physical sun core, public interface, destination positions, tone mapping, color conversion, and shadow setup from `ENV-001`.
- Replace the sparse/banded appearance with layered maritime cloud bodies, lit edges, self-shadowed volume, deeper upper-sky blue, and a warm aerial-perspective horizon.
- Compare the native `1586x992` result directly with the accepted concept and the rejected `water-lighting-interim.png` frame; keep the ocean and raft out of crushed shadow.

### RAFT-004 — damped marine motion

- Use a stable second-order heave/roll/pitch response with restoring forces, hydrodynamic damping, bounded integration, and improved symmetric surface-contact sampling.
- Preserve `ocean.surface.v1`, controls, HUD, camera, assets, disposal, and responsive framing.
- Make wake and spray react to speed and vertical impact, and make raft materials/meshes ready for coordinator-enabled shadows.

### RAFT-005 — integrated wake optical repair

- Retain the verified second-order raft motion, nine-point contact sampling, controls, framing, service boundary, and lifecycle from `RAFT-004`.
- Replace broad translucent wake wedges and rectangular impact shapes with narrow, broken, dissipating turbulent trails whose color and opacity remain restrained under ACES.
- Preserve mobile stability and include Three.js tone-mapping/color-space output integration for any custom scene-color shader.

## Dependency and lockfile policy

- Foundation uses npm and commits exactly one `package-lock.json`; no alternate lockfile is allowed.
- Direct dependencies are saved at exact versions rather than floating ranges. The activated foundation set is Vite `8.2.1`, TypeScript `7.0.2`, Three.js `0.185.1`, and `@types/three` `0.185.4` when separate declarations are required.
- The coordinator verified Node `v22.21.0` with npm `10.9.4` at activation. Vite `8.2.1` declares Node `^20.19.0 || >=22.12.0`.
- Package manifest, lockfile, entrypoint, and build/runtime configuration remain serialized through `FND-001`. Later workers return dependency or script-wiring requests to the coordinator.

## Standby evidence

| Lane | Thread | Observed base | Result |
| --- | --- | --- | --- |
| `foundation` | `01a01c90-b504-7d13-97bc-5aa00daa623a` | `2e8a97d` | Clean orchestration-only baseline; no files changed and no commit created. Recommended first lane is the Vite, TypeScript, Three.js bootstrap recorded above. |
| `world-qa` | `01a01c90-b8ec-77d0-90e1-3457ea5ca0f7` | `2e8a97d` | Clean orchestration-only baseline; no app or test target, no files changed, and no commit created. Browser-smoke scope recorded above. |

Both standby bases predate this board. Before activation, the coordinator must create or refresh each isolated worktree from the then-current verified `main` and record the new base commit.

## Active visual reference

The accepted desktop gameplay concept is `/Users/jk/.codex/visualizations/2026/08/20/01a01c90-8bec-75d2-93f7-b299a7f64d01/water-gameplay-concept.png`. Lane-ready texture sources are stored beside it as `ocean-foam-breakup.png`, `raft-wood-albedo.png`, and `raft-sail-albedo.png`. Workers may copy only their lane's assigned assets into their exclusive `public/**` scope.

The visual target is a full-viewport, third-person raft scene with a high marine horizon, deep teal waves, foam wake, layered pale sky, distant islands/lighthouse, weathered wood and canvas, and sparse white navigation HUD. Allowed visible HUD copy is `WATER`, `W`, `N`, `E`, `WIND 12 KN`, `WASD STEER`, `DRAG LOOK`, `6.4 KN`, `SAIL`, and `72%`.

## Previous integrated acceptance

The coordinator tested source commit `ca882e9` from the main checkout at `http://127.0.0.1:5173/` after a clean dev-server restart.

- `npm run typecheck` and `npm run build` passed; the existing Vite large-chunk advisory is non-fatal.
- `node qa/http-smoke.mjs http://127.0.0.1:5173` passed the HTTP, HTML, mount, and module-entry checks.
- The Codex In-app Browser rendered a `1586x992` canvas at the desktop concept frame and a `390x844` canvas after resize, with no document/body overflow in either viewport.
- All seven Water HUD markers and required copy were present. No loading or fatal overlay obscured the scene.
- Canvas click/focus, a representative `W` keypress, and a short pointer drag were dispatched successfully.
- The complete browser log contained only Vite connection diagnostics and no warning or error entry.
- Accepted screenshots: `/Users/jk/.codex/visualizations/2026/08/20/01a01c90-8bec-75d2-93f7-b299a7f64d01/water-final-desktop.jpg` and `/Users/jk/.codex/visualizations/2026/08/20/01a01c90-8bec-75d2-93f7-b299a7f64d01/water-final-mobile.jpg`.
- Performance acceptance remains deferred because no device/browser profile, measurement method, or budget was agreed.

## Physical-water research basis

- Mark Finch, NVIDIA GPU Gems, "Effective Water Simulation from Physical Models": directional/Gerstner waves, bounded steepness, analytic surface orientation, fine normal detail, Fresnel behavior, and distance filtering.
- Jerry Tessendorf, "Simulating Ocean Water": wind-driven spectral relationships, dispersion, choppiness, and ocean-surface rendering.
- Eric Bruneton and Fabrice Neyret, "Precomputed Atmospheric Scattering," plus Preetham, Shirley, and Smits, "A Practical Analytic Model for Daylight": Rayleigh/Mie sky radiance, sun/sky coupling, and aerial perspective.
- Three.js `WebGLRenderer`, color-management, `Water`, and `PMREMGenerator` documentation: sRGB output, tone mapping, shadow-map integration, water reflection inputs, and physically based environment filtering.
- Thor I. Fossen's marine-craft model: restoring forces, added-mass intuition, and positive hydrodynamic damping for stable real-time heave/roll/pitch response.

## Shared and coordinator-owned paths

The coordinator owns `AGENTS.md`, `ORCHESTRATOR.md`, `DISPATCH.md`, `.orchestration.json`, `README.md`, integration composition after `FND-001`, and shared manifest/configuration edits after `FND-001`. A worker that needs one of these paths must stop and request a separately recorded scope change.

## Dispatch sequence

1. Dispatch `FND-001` alone from a verified `main` commit.
2. Review its diff, run its focused checks and the repository build, then merge it into local `main` only if verified.
3. Rebase the board's scopes on the integrated foundation. Dispatch `OCE-001`, `RAFT-001`, and `QA-001` in parallel from the same verified `main` commit when worker capacity permits.
4. Review and validate each feature independently before merging. Serialize any coordinator-owned composition changes.
5. Re-run `QA-001` after both feature lanes and coordinator-owned composition are integrated. Treat its browser evidence, and any separately agreed visual/performance criteria, as the merge-readiness gate for the first complete slice.
6. For the physical-water round, review `OCE-006`, `ENV-001`, and `RAFT-004` independently, merge only passing scoped diffs, then serialize renderer tone-mapping/shadow integration on `main`.
7. Re-run full build, HTTP smoke, desktop/mobile Browser QA, interaction proof, console review, and native-concept screenshot comparison. Dispatch narrow repair lanes for any material defect.
8. Review `OCE-007`, `ENV-002`, and `RAFT-005` independently, merge only passing one-file diffs, and repeat the complete integrated visual gate from a fresh reload.

## Dispatch record template

Before setting a task to `active`, record:

- worker thread ID;
- exact branch and isolated worktree path;
- base `main` commit;
- acceptance criteria and exclusive write scope copied into the worker prompt;
- explicit forbidden shared paths and dependency gates.

At handoff, record:

| Task | Base commit | Worker commit | Diff review | Validation run | Main merge | Risks / follow-up |
| --- | --- | --- | --- | --- | --- | --- |
| `FND-001` | `e207233` | `eae02dd`, `804a3b4` | Scope and full diff reviewed; deprecated Clock warning returned and fixed | `npm ci`; typecheck; build; initial browser canvas boot; Timer source/direct smoke | `ccfc531` | Integrated locally; expected Three.js bundle-size warning remains. |
| `OCE-001` | `ccfc531` | None | Clean base confirmed; no diff to review | Not run; blocked before implementation | _Not merged_ | Superseded after `/private/tmp` write policy rejected both patch attempts. |
| `OCE-002` | `4860d54` | `5af681a` | Full scope/shader/lifecycle review passed; required-asset loading corrected before handoff | Worker and coordinator: typecheck/build; foam asset hash | `9ce8ca4` | Integrated Browser exposed missing Three.js fog uniforms after composition. |
| `OCE-003` | `cf21135` | `f23066c` | Exact seven-line shader diff reviewed | Worker and coordinator: typecheck/build; coordinator browser rerun cleared fatal | `055184c` | Fog retained with cloned complete uniforms; post-repair log segment has no new error. |
| `OCE-004` | `055184c` | `9d91b4e` | Scope/diff and CPU/shader parity reviewed | Worker and coordinator: typecheck/build; worker browser desktop/mobile | `3e7bfb7` | Clouds/waves/glints improved; second screenshot found destination overscaled. |
| `OCE-005` | `3e7bfb7` | `b96faba` | Exact atmosphere-only diff reviewed; destination association and all unrelated environment values preserved | Worker and coordinator: typecheck/build/diff check; worker projection assertions at 1586x992 | `40d9f6f` | Final desktop screenshot accepted the reduced horizon destination. |
| `OCE-006` | `d90be9d` | `048df97` | Exact three-file scope and full CPU/GLSL/shader/lifecycle diff reviewed | Worker and coordinator: typecheck; build; five focused ocean tests; diff check; worker desktop/mobile browser | `90ee59d` | Integrated locally; native frame exposed excessive broad white foam/reflection, assigned to `OCE-007`. |
| `OCE-007` | `90ee59d` | _Active_ | One-file optical repair dispatched from the rejected integrated frame | _Pending handoff_ | _Not merged_ | Foam sparsity, dark-water optical balance, and broken sun glitter only. |
| `ENV-001` | `d90be9d` | `2e903ca` | Exact one-file scope and full sky/light/material/shadow diff reviewed | Worker and coordinator: typecheck; build; diff check; worker desktop/mobile browser | `79cec93` | Integrated locally; native frame exposed an overly sparse/flat cloud field, assigned to `ENV-002`. |
| `ENV-002` | `79cec93` | _Active_ | One-file atmosphere repair dispatched from the rejected integrated frame | _Pending handoff_ | _Not merged_ | Cloud volume, sun/halo readability, and sky-depth balance only. |
| `RAFT-001` | `ccfc531` | `d995cc3` | Full scope/diff and lifecycle review passed; asset hashes match | Worker and coordinator: typecheck/build; diff checks | `c6e6d52` | Live integration with `ocean.surface.v1` and browser proof remain. |
| `RAFT-002` | `055184c` | `5dec595` | Scope/diff and resource lifecycle reviewed | Worker and coordinator: typecheck/build; focused assertions | `0b8f5c8` | Wake/material/HUD improved; second screenshot found camera over-zoomed. |
| `RAFT-003` | `3e7bfb7` | `0fb8141` | Exact raft-only diff reviewed; existing target and drag-look controls preserved | Worker and coordinator: typecheck/build/diff check; worker 1586x992 mast/hull framing assertion | `ca882e9` | Final desktop screenshot accepted the complete raft framing. |
| `RAFT-004` | `d90be9d` | `4738043` | Exact one-file scope and full spring/contact/wake/lifecycle diff reviewed | Worker and coordinator: typecheck; build; diff check; worker numerical bounds and desktop/mobile browser | `ca4b6cb` | Integrated locally; remains a bounded reduced-order marine model rather than a full fluid solver. |
| `RAFT-005` | `a48a091` | _Active_ | One-file wake/material repair dispatched from the rejected integrated frame | _Pending handoff_ | _Not merged_ | Turbulent wake geometry, impact breakup, and scene-color output integration only. |
| `QA-001` | `ccfc531` | `ea7d849` | Full scope/diff review passed; seven Water markers defaulted | Worker and coordinator: syntax/import checks; HTTP smoke; desktop/mobile In-app Browser evidence; input and resize | `e200361` | Final functional and visual smoke passed; performance budgets remain intentionally deferred. |
