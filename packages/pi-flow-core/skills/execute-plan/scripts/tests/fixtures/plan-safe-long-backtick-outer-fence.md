## Goal

Build a task extraction tool.

## Architecture summary

Single-script Python parser that reads plan files.

## Tech stack

Python 3, argparse, json

## File Structure

- scripts/extract-plan-tasks.py

### Task 1: Emit task JSON

**Files:**
- Create: scripts/extract-plan-tasks.py

**Steps:**
- [ ] **Step 1:** Parse the plan and emit JSON

The output format is shown below:

````
Outer example block begins here.

```json
{
  "tasks": [{"number": 1, "title": "Example"}]
}
```

The above is the expected output structure.
````

**Acceptance criteria:**
- The script exits 0 on a clean plan.
  Verify: run the script on a clean plan and check the exit code.

**Model recommendation:** standard

## Dependencies

## Risk Assessment

Low risk.

## Test Command

```bash
python3 -m pytest
```
