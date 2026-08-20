# Water Project Agent Contract

This repository is coordinated by the Sol Max orchestrator. All implementation work belongs in this repository; do not continue work in the previous Driftbound checkout.

## Orchestration

- The coordinator uses `gpt-5.6-sol` at `max` reasoning effort.
- Worker threads use `gpt-5.6-luna` at `max` reasoning effort unless the coordinator explicitly assigns a different lane.
- Every worker owns a disjoint lane and works on a branch or isolated worktree. Do not make unrelated edits or commit directly to `main`.
- Before merging, the coordinator reviews the worker diff, runs the relevant checks, and records the merge/validation result.
- Keep commits small and single-purpose. Use descriptive commit messages and preserve a clean working tree at handoff.

## Safety and verification

- Read this file and `ORCHESTRATOR.md` before changing files.
- Inspect `pwd`, repository root, branch, status, and current diff before editing.
- Do not overwrite another worker's files. If lanes overlap, stop and report the overlap to the coordinator.
- Do not claim a merge, build, visual acceptance, or runtime result without evidence from this checkout.
