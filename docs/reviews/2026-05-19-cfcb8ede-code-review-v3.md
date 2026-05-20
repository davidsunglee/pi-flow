**Reviewer:** anthropic/claude-sonnet-4-6 via claude

### Outcome

**Verdict:** Approved

**Reasoning:** The remediation directly and completely addresses the previous finding: both tests now use `spawnSync('pi', ['--version'])` for detection, exercise `pi -e <PKG_DIR> --help` through the documented extension-loader entry point, check for a nonzero exit and a "Failed to load extension" diagnostic, and retain the deterministic manifest/glob assertions for all 15 skill names.

### Strengths

- Detection logic correctly uses `spawnSync('pi', ['--version'])` and guards against the `.error` property (ENOENT), avoiding the unreliable `which pi` approach.
- Both probe test names (`'pi CLI discovery probe'`, `'pi CLI aggregate discovery probe'`) match the plan's naming contract exactly.
- The `--help` flag causes Pi to exercise extension loading without invoking any LLM, making the probes safe to run in CI.
- The "Failed to load extension" regex check (`/Failed to load extension/i`) catches load failures even when the process exits 0, providing defense in depth.
- The structured skip message (JSON with `skipped` and `reason` keys) gives CI consumers machine-readable context when Pi is absent.
- Unused imports were correctly cleaned up: `realpathSync` and `pathToFileURL` removed from the core test; `pathToFileURL` removed from the aggregate test.
- The `findPiLibIndex()` helpers (brittle Homebrew-path-traversal logic) are fully excised from both files.
- Secondary manifest/glob assertions for all 15 skills remain in place as deterministic proxies, so test failures are informative even on machines without Pi.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

_None._

#### Minor (Nice to Have)

_None._

### Recommendations

- The `realpathSync` import in `aggregate-forwarding.test.mjs` is still needed (lines 79 and 137) and was correctly retained — no action required.
- The `expandGlob` implementations differ slightly between the two files (core skips only `.`-prefixed entries; aggregate also skips `_`-prefixed entries). This is a pre-existing divergence unrelated to the remediation and not introduced by these changes; it can be harmonised in a follow-up if desired.
