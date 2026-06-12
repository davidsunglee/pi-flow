# Releasing Pi-Flow

Pi-Flow releases are driven by the reusable `release` skill in `@aphotic/pi-release`. The skill auto-detects pi-flow's monorepo shape, runs the shared gates and a full security audit, and keeps credentialed actions user-owned.

## Release workflow

See [`packages/pi-release/skills/release/SKILL.md`](../packages/pi-release/skills/release/SKILL.md) for the complete release workflow.

## Pi-Flow specifics

Pi-flow's release configuration is defined in [`.pi/release-profile.md`](.pi/release-profile.md), which covers:

- The publishable packages and their publish order
- The aggregate `publish:aggregate` tooling constraint (pnpm isolated-linker hazard)
- The `pi install` smoke test
- The release notes destination (`docs/releases/<version>.md`)
