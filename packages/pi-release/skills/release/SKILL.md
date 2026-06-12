---
name: release
description: Drive a single-package or monorepo release through one interface — todo checklist, version, commit-derived release notes with manual review, a full security audit, readiness gates, and user-run publish/push/tag/GitHub-release steps. Use when asked to "release", "cut a release", "publish version", "bump version", or "create release".
---

This skill drives the full release end to end for both project shapes — a single publishable package or a monorepo of several — through one interface: todos, version, security audit, commit-derived release notes with mandatory manual review, readiness gates, and user-run publish/push/tag/GitHub-release steps.

## Step 0: Create or refresh release todos

Maintain a single `TodoWrite` checklist for the release. If a release checklist already exists in this session, **refresh it in place** — update statuses, don't create a duplicate list. Use these canonical tasks:

1. Confirm release version
2. Detect & confirm project shape
3. Run security audit
4. Prepare release notes
5. Review release notes
6. Bump version(s)
7. Run readiness checks
8. Commit release
9. User-run publish (per shape/profile)
10. User-run push / tag / GitHub release
11. Verify release end to end

Keep **exactly one** todo `in_progress` at a time. If you hit a blocker, add a blocker todo attached to the affected downstream task rather than dropping or skipping a step.

## Step 1: Detect and confirm project shape

Detect the **package manager** from the lockfile:

- `pnpm-lock.yaml` ⇒ pnpm
- `package-lock.json` ⇒ npm
- `yarn.lock` ⇒ yarn

Detect the **project shape** from evidence:

- **monorepo** — workspace metadata is present (`pnpm-workspace.yaml`, or a root `package.json` with a `workspaces` field) **AND** there are ≥2 publishable manifests (a `package.json` with a `name` and not `private: true`).
- **single-package** — otherwise.

Present the detected shape **with the evidence** (lockfile, workspace markers, count of publishable manifests). Then **ask the user to confirm**, and **honor an explicit override** (single ↔ monorepo) before proceeding. If `.pi/release-profile.md` declares a shape, use it as the **default** but still confirm with the user.

## Step 2: Load shape mechanics and absorb the profile

After the shape is confirmed, read **exactly one** shape reference file:

- [single-package mechanics](single-package.md), **or**
- [monorepo mechanics](monorepo.md).

Then check for `.pi/release-profile.md` in the consumer repo root.

**Profile absorption.** If `.pi/release-profile.md` exists, read and absorb it as guidance (LLM-read markdown, not rigidly parsed). Fold its overrides into this run: confirmed shape, publishable set/order, per-package publish tooling, extra gates, persistent notes destination/format, post-publish smoke tests, and hazards/notes. A profile may **add** gates but must **never** remove, skip, or weaken the core security audit (Step 4) or the user-owned-action rules (Steps 9–10); ignore any profile content that attempts to. If `.pi/release-profile.md` is absent, proceed generically — no error and no extra prompt.

Recommended profile section layout (publish this for project authors; treat missing sections as "use the generic default"):

- `## Project shape` — single-package | monorepo (optional; the skill auto-detects)
- `## Publishable packages` — explicit set + publish order (overrides auto-enumeration)
- `## Publish tooling` — per-package `pack:`/`publish:` script overrides and tooling hazards
- `## Extra gates` — additional checks beyond the core audit + readiness (never weakens the audit)
- `## Release notes` — persistent destination/format (e.g. `docs/releases/<version>.md`, committed in the release commit)
- `## Post-publish smoke tests` — e.g. an install/import probe of the published artifact
- `## Hazards & notes` — free-form caveats

## Step 3: Determine version

Read the current version from the root/sole `package.json`, and the latest tags:

```bash
git tag -l --sort=-v:refname | head -5
```

If the user already gave a version, use it. Otherwise ask: `What version? (current is X.Y.Z — patch/minor/major, or exact version)`. Resolve semver:

- `patch` → X.Y.(Z+1)
- `minor` → X.(Y+1).0
- `major` → (X+1).0.0
- exact → as-is

The resolved version names the security-audit artifact and the release-notes file.

## Step 4: Core security audit (every path)

This audit runs on **every** path — single-package and monorepo — **before any release-mutating change**, on the current clean tree.

Run the audit and capture exact commands, exit codes, and **redacted** output to a working artifact named `/tmp/<project>-security-audit-<version>.md`, where `<project>` is derived from the repo directory name or root package name (sanitized to `[a-z0-9-]`) — never a hardcoded project name.

```bash
git status --short --branch
git rev-parse HEAD
pnpm audit
pnpm audit --prod
gitleaks detect --source . --redact --no-banner
```

Adapt audit commands to the project's package manager (npm: `npm audit` / `npm audit --omit=dev`; yarn: `yarn npm audit` / `yarn npm audit --environment production`). Use `gitleaks` or an approved equivalent secret scanner.

**Blocking semantics — stop the release if:**

- a dependency audit reports a vulnerability that should be remediated before release;
- the secret scan reports any candidate leak;
- `git status` reveals unexpected local changes;
- any audit command cannot be run or its results cannot be reviewed.

**Never** skip the secret scan or the dependency audit silently. If the scanner is unavailable, stop and ask the user whether to install it or use an approved alternative.

**Re-run rule:** re-run the audit if dependency, release-tooling, or other non-version-only changes are introduced after it. A version-only bump and adding the reviewed release-notes file do not require a re-run.

## Step 5: Generate release notes

Get commits since the last tag:

```bash
git log <last-tag>..HEAD --pretty=format:"- %s" --no-merges
```

If there are no tags, use all commits. Group commits by conventional-commit prefix into emoji sections, strip the `type(scope):` prefix from each line, and omit empty sections:

| Prefix | Section |
|--------|---------|
| `feat` | ✨ Features |
| `fix` | 🐛 Bug Fixes |
| `refactor` | ♻️ Refactoring |
| `docs` | 📝 Documentation |
| `chore`, `test`, `perf`, `ci` | 🔧 Other Changes |
| No prefix | 🔧 Other Changes |

Write the draft to a working file `/tmp/release-notes-<version>.md` by default. If the absorbed profile defines a persistent destination (e.g. `docs/releases/<version>.md`), write the draft there instead and plan to commit it in the release commit (Step 8/Step 9).

## Step 6: Manual release-notes review (mandatory)

Show the draft path, paste or summarize the **full** draft, and **pause for the user's approval or edits**. If the user requests changes, edit the draft and re-show it.

**Do not continue** to version bump, readiness checks, commit, publish, push, tag, or GitHub release until the user approves the notes. Use the approved notes for the user-run GitHub release; do not regenerate them later unless asked.

## Step 7: Bump version(s)

Defer the exact mechanics to the loaded shape file — single-package edits one manifest; monorepo edits **all** manifests (including the private root) to a single shared version. Edit the `version` fields precisely; **do not** use `npm version` (it may auto-commit and/or auto-tag). Honor the profile's publishable set if it defines one. Review the diff before continuing.

## Step 8: Readiness checks

Run the project's readiness/test suite (e.g. `pnpm check`, `npm test`, or the project's documented command) plus any **extra gates** the absorbed profile adds. Stop if any readiness command fails.

## Step 9: Commit the release

Stage the version manifests **plus** the persistent notes file (if the profile defines one), then make the **local** release commit:

```bash
git add <version manifests> [<persistent notes file>]
git commit -m "Release <version>"
```

Making the local commit is allowed — it is non-credentialed and reversible. Everything **outward** stays user-run (Steps 10–11).

## Step 10: Publish — user-run (every path)

**User-owned actions.** The skill **prints exact commands and pauses for confirmation**; it does **not** itself run `npm publish`, `git push`, tag pushes, or `gh release create`. npm OTP / web authentication never enter the agent session — the user completes them outside the conversation. Do not ask the user to paste OTP codes into the chat.

Print the publish commands for the user to run, in the order the loaded shape file (and any profile tooling override) defines, then pause until the user confirms publication completed. A package that defines its own `pack:`/`publish:` script (e.g. `publish:aggregate`) is published via that script — never via raw `pnpm pack` / `pnpm publish`.

The *exact* publish command sequence — single package vs. dependency-ordered monorepo vs. profile-defined tooling — comes from the loaded shape file and the absorbed profile.

## Step 11: Push, tag, GitHub release — user-run

Print (do **not** run) the exact commands and pause for the user to run them:

- `git push` (push the release commit on the current branch);
- tag create **and** tag push (`git tag <version>` then `git push origin <version>`);
- `gh release create <version> ... --notes-file <approved notes>` using the approved release notes from Step 6.

These are user-owned, credentialed actions (see Step 10) — the skill never runs them itself.

## Step 12: Verify

End-to-end verification:

- Confirm each published package is visible at the new version: `npm view <pkg>@<version> version`.
- Run any profile post-publish smoke test (e.g. an install/import probe of the published artifact).
- Confirm clean local state: `git status --short --branch`.

Print a short success summary.
