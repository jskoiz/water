# Water Dispatch Board

This is the coordinator-owned source of truth for implementation dispatches. A task marked `ready` is queued for a future worker; it is not active until the coordinator records a worker thread, branch, worktree, and base commit.

`FND-001`, `RAFT-001`, and `QA-001` are integrated. `OCE-001` was blocked before mutation by its worktree policy, and replacement lane `OCE-002` is active in a workspace-owned isolated worktree.

Every implementation dispatch uses `gpt-5.6-luna` at `max` reasoning effort and contains exactly one lane plus the exclusive write scope recorded below.

## State model

`queued` -> `ready` -> `active` -> `review` -> `integrated`

Use `blocked` whenever a dependency or acceptance decision prevents dispatch. Only the Sol Max coordinator changes task state or the merge record.

## Queue

| Task | Lane | State | Depends on | Worker | Branch / worktree | Exclusive worker write scope |
| --- | --- | --- | --- | --- | --- | --- |
| `FND-001` | `foundation` | `integrated` | None | `/root/foundation_fnd001` | `c1/foundation-bootstrap` / `/private/tmp/water-fnd001` / base `e207233` | `package.json`; `package-lock.json`; `index.html`; `vite.config.*`; `tsconfig*.json`; `src/main.*`; `src/runtime/**` |
| `OCE-001` | `ocean-rendering` | `blocked` | Workspace policy rejected writes before mutation | `/root/ocean_oce001` | `c1/ocean-rendering` / `/private/tmp/water-oce001` / base `ccfc531` | No changes; superseded by `OCE-002` |
| `OCE-002` | `ocean-rendering` | `active` | `OCE-001` clean blocker; foundation/runtime reviewed | `/root/ocean_oce002` | `c1/ocean-rendering-2` / `/Users/jk/Desktop/water/.worktrees/oce002` / base `4860d54` | `src/features/ocean/**`; `src/features/environment/**`; `public/ocean/**`; `tests/ocean/**` |
| `RAFT-001` | `raft-systems` | `integrated` | `FND-001` integrated and runtime contracts reviewed at `ccfc531` | `/root/raft_raft001` | `c1/raft-systems` / `/private/tmp/water-raft001` / base `ccfc531` | `src/features/raft/**`; `public/raft/**`; `tests/raft/**` |
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

## Shared and coordinator-owned paths

The coordinator owns `AGENTS.md`, `ORCHESTRATOR.md`, `DISPATCH.md`, `.orchestration.json`, `README.md`, integration composition after `FND-001`, and shared manifest/configuration edits after `FND-001`. A worker that needs one of these paths must stop and request a separately recorded scope change.

## Dispatch sequence

1. Dispatch `FND-001` alone from a verified `main` commit.
2. Review its diff, run its focused checks and the repository build, then merge it into local `main` only if verified.
3. Rebase the board's scopes on the integrated foundation. Dispatch `OCE-001`, `RAFT-001`, and `QA-001` in parallel from the same verified `main` commit when worker capacity permits.
4. Review and validate each feature independently before merging. Serialize any coordinator-owned composition changes.
5. Re-run `QA-001` after both feature lanes and coordinator-owned composition are integrated. Treat its browser evidence, and any separately agreed visual/performance criteria, as the merge-readiness gate for the first complete slice.

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
| `OCE-002` | `4860d54` | _Active_ | _Pending handoff_ | _Pending handoff_ | _Not merged_ | Replacement workspace-owned lane; owns `ocean.surface.v1` and ocean/environment assets. |
| `RAFT-001` | `ccfc531` | `d995cc3` | Full scope/diff and lifecycle review passed; asset hashes match | Worker and coordinator: typecheck/build; diff checks | `c6e6d52` | Live integration with `ocean.surface.v1` and browser proof remain. |
| `QA-001` | `ccfc531` | `ea7d849` | Full scope/diff review passed; seven Water markers defaulted | Worker and coordinator: syntax/import checks; no-server preflight correctly failed | `e200361` | Successful HTTP path and final In-app Browser run remain coordinator gates. |
