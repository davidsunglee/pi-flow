{
  "id": "cfcb8ede",
  "title": "Extract pi-config workflow package into pi-flow",
  "tags": [
    "pi-package",
    "extraction",
    "agents",
    "extensions",
    "skills"
  ],
  "status": "open",
  "created_at": "2026-05-18T00:00:00.000Z"
}

## Goal

Extract the distributable workflow code from `../pi-config` into this `pi-flow` repository so it can be installed as a Pi package.

The package should include the workflow **skills**, local **extensions**, and local **subagent definitions** needed to run the artifact-driven flow outside the personal `pi-config` checkout.

## Source material

From `../pi-config`, extract or adapt:

- `agent/skills/` — workflow skills and shared helper scripts.
- `agent/extensions/` — local TypeScript extensions intended for distribution.
- `agent/agents/` — subagent definition Markdown files used by the workflow.
- Relevant docs from `README.md` that explain setup, model tiers, required companion packages, and workflow usage.
- Optional: `agent/themes/nord.json` if it should ship with the workflow package.

Do **not** blindly copy personal state or workflow artifacts such as `docs/todos/`, `docs/specs/`, `docs/plans/`, `docs/reviews/`, sessions, auth files, node_modules, or generated caches.

## Desired package shape

Create a clean package repository, for example:

```text
pi-flow/
  package.json
  README.md
  extensions/
  skills/
  agents/
  themes/          # optional
  test/            # optional migrated tests
```

`package.json` should declare a Pi package manifest:

```json
{
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions/*.ts", "!./extensions/*.test.ts"],
    "skills": ["./skills"],
    "themes": ["./themes"]
  }
}
```

Adjust this manifest to match the actual files that should be distributed.

## Agent-definition packaging issue

Pi core package manifests support `extensions`, `skills`, `prompts`, and `themes`, but not `agents` as a first-class package resource. The extracted workflow still needs the `agent/agents/*.md` definitions because the skills dispatch `planner`, `coder`, `verifier`, `test-runner`, `code-reviewer`, `plan-refiner`, etc.

Design and implement one of these approaches:

1. Add or use companion support in `pi-interactive-subagent` so package-bundled `agents/` are discoverable from `pi-flow`.
2. Provide a small bootstrap/setup extension or command that installs/symlinks the bundled agents into `~/.pi/agent/agents` or project `.pi/agents`.
3. Document a manual copy/symlink step clearly if automation is intentionally deferred.

The chosen approach must make a fresh install of `pi-flow` realistically usable without relying on the old `pi-config` checkout.

## Portability work

Audit and fix references that assume the old repo layout:

- Paths like `agent/skills/...` should work from the installed package or be rewritten to package-relative/skill-relative paths where appropriate.
- Skills that invoke helper scripts must resolve them correctly after packaging.
- Workflow docs should no longer assume `../pi-config` is present.
- Runtime requirements such as `model-tiers.json`, `pi-interactive-subagent`, `pi-web-access`, and `pi-processes` should be documented or bundled/declared appropriately.
- Extension imports should use the current Pi package names (`@earendil-works/...`) unless compatibility with the older `@mariozechner/...` names is intentionally retained.
- Tests and dev dependencies should stay dev-only; runtime dependencies required by extensions must be in `dependencies` or `peerDependencies` as Pi package docs require.

## Acceptance criteria

- `pi-flow` has a valid `package.json` with `keywords: ["pi-package"]` and a `pi` manifest for distributable resources.
- Skills from `../pi-config/agent/skills` are present and loadable from `pi-flow`.
- Intended extensions from `../pi-config/agent/extensions` are present and loadable, excluding test files from the runtime manifest.
- Subagent definitions from `../pi-config/agent/agents` are included and there is a documented or automated path for `pi-interactive-subagent` to discover them.
- Personal configuration/state from `pi-config` is not copied into the package.
- A local install test works, e.g. `pi -e ../pi-flow` or `pi install ./pi-flow`, and Pi reports the expected skills/extensions.
- README explains installation, required companion packages, agent setup, model-tier setup, and basic workflow entry points.
- Existing helper-script and extension tests are either migrated or replaced with an equivalent verification plan.

## Notes

This extraction should prefer a maintainable package boundary over preserving the exact `pi-config` directory layout. If agent discovery requires changes in `pi-interactive-subagent`, capture that as a separate linked task or implement it before declaring `pi-flow` installable.
