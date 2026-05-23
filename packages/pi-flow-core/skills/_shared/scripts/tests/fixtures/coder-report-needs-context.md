STATUS: NEEDS_CONTEXT

## Completed
Read through the spec but need clarification before implementing.

## Tests
None yet.

## Files Changed

## Self-Review Findings
None.

## Concerns / Needs / Blocker
- Which file contains the list of valid status tokens? The spec references a set but I cannot find where it is defined in the codebase.
- Is `report_unreadable` emitted to stdout or stderr? The spec says stderr for other protocol errors but is silent on this one.
