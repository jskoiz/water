# Water Dispatch Board

This is the coordinator-owned source of truth for implementation dispatches. A task marked `ready` is queued for a future worker; it is not active until the coordinator records a worker thread, branch, worktree, and base commit.

No implementation worker is active during the orchestration setup turn.

Every implementation dispatch uses `gpt-5.6-luna` at `max` reasoning effort and contains exactly one lane plus the exclusive write scope recorded below.

## State model

`queued` -> `ready` -> `active` -> `review` -> `integrated`

Use `blocked` whenever a dependency or acceptance decision prevents dispatch. Only the Sol Max coordinator changes task state or the merge record.

## Queue

| Task | Lane | State | Depends on | Worker | Branch / worktree | Exclusive worker write scope |
| --- | --- | --- | --- | --- | --- | --- |
| `FND-001` | `foundation` | `ready` | None | Standby: `01a01c90-b504-7d13-97bc-5aa00daa623a` | `c1/foundation-bootstrap` / record exact worktree at dispatch | `package.json`; `package-lock.json`; `index.html`; `vite.config.*`; `tsconfig*.json`; `src/main.*`; `src/runtime/**` |
| `OCE-001` | `ocean-rendering` | `blocked` | `FND-001` integrated and its runtime contracts reviewed | Unassigned | `c1/ocean-rendering` / create after dependency | `src/features/ocean/**`; `src/features/environment/**`; `public/ocean/**`; `tests/ocean/**` |
| `RAFT-001` | `raft-systems` | `blocked` | `FND-001` integrated and its runtime contracts reviewed | Unassigned | `c1/raft-systems` / create after dependency | `src/features/raft/**`; `public/raft/**`; `tests/raft/**` |
| `QA-001` | `world-qa` | `blocked` | `FND-001` integrated; dev URL and browser runner agreed; required shared wiring serialized by coordinator | Standby: `01a01c90-b8ec-77d0-90e1-3457ea5ca0f7` | `c1/world-qa-smoke` / record exact worktree after dependency | `qa/**` |

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
- Direct dependencies are saved at exact versions rather than floating ranges. The first worker prompt must record the exact stable Vite, TypeScript, and Three.js versions selected for compatibility with the verified coordinator runtime.
- The coordinator runtime observed during setup is Node `v22.21.0` with npm `10.9.4`. Re-check it at activation and choose versions then, so the dormant queue does not freeze stale registry versions.
- Package manifest, lockfile, entrypoint, and build/runtime configuration remain serialized through `FND-001`. Later workers return dependency or script-wiring requests to the coordinator.

## Standby evidence

| Lane | Thread | Observed base | Result |
| --- | --- | --- | --- |
| `foundation` | `01a01c90-b504-7d13-97bc-5aa00daa623a` | `2e8a97d` | Clean orchestration-only baseline; no files changed and no commit created. Recommended first lane is the Vite, TypeScript, Three.js bootstrap recorded above. |
| `world-qa` | `01a01c90-b8ec-77d0-90e1-3457ea5ca0f7` | `2e8a97d` | Clean orchestration-only baseline; no app or test target, no files changed, and no commit created. Browser-smoke scope recorded above. |

Both standby bases predate this board. Before activation, the coordinator must create or refresh each isolated worktree from the then-current verified `main` and record the new base commit.

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
| _None dispatched_ | — | — | — | — | — | — |
