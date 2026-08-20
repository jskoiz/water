# Water Project Orchestrator

## Mission

Build the new water project through independently reviewable, mergeable work lanes. The coordinator is the Sol Max thread; implementation lanes are delegated to Luna Max worker threads.

## Runtime contract

```yaml
orchestrator:
  model: gpt-5.6-sol
  reasoning: max
workers:
  model: gpt-5.6-luna
  reasoning: max
  default_concurrency: 4
```

## Default lanes

| Lane | Ownership | Typical scope |
| --- | --- | --- |
| `foundation` | app shell and project structure | Vite/Three.js bootstrap, shared runtime contracts, input, loading, configuration |
| `ocean-rendering` | ocean and atmosphere | water surface, wave simulation, foam, reflections, sky, fog, lighting |
| `raft-systems` | playable raft | raft model, buoyancy, controls, camera, wake, interaction |
| `world-qa` | integration and quality | performance, browser QA, visual checks, regression tests, merge-readiness |

## Dispatch rules

1. The Sol Max coordinator breaks a request into concrete tasks with one lane and one write scope per task.
2. Luna Max workers receive the acceptance criteria, relevant files, dependencies, and the exact branch/worktree they own.
3. Independent lanes can run in parallel. Shared-file or shared-contract work is serialized by the coordinator.
4. Workers report changed paths, commit hash, checks run, remaining risks, and any follow-up needed.
5. The coordinator reviews each diff, resolves integration conflicts, runs the full project checks, and merges only after the result is verified.

The live queue, exclusive write scopes, dependency gates, and merge evidence are maintained in [DISPATCH.md](./DISPATCH.md). A queued task is not an active dispatch until its worker thread, branch, worktree, and base commit are recorded there.

## Merge policy

- `main` is the integration branch.
- Workers should never force-push or rewrite shared history.
- Prefer one focused commit per worker task.
- Merge only clean, reviewed branches with passing relevant checks.
- Keep generated output, caches, and local screenshots out of commits unless explicitly requested.

## Initial project state

The repository was initialized as an empty project scaffold. The first implementation dispatch should establish the app foundation before parallel feature work depends on it.
