## Goal

Extract tasks from plan files for automated processing.

## Architecture summary

Single-script Python tool that parses markdown and emits JSON.

## Tech stack

Python 3, argparse, json

## File Structure

- scripts/extract-plan-tasks.py

### Task 1: Parse plan headings

**Files:**
- Create: scripts/extract-plan-tasks.py
- Test: scripts/tests/test_extract_plan_tasks.py

**Steps:**
- [ ] **Step 1:** Read the plan file

**Acceptance criteria:**
- The script exits 0 on a clean plan.
  Verify: Run the script and check exit code is zero.

**Model recommendation:** cheap

### Task 2: Emit JSON output

**Files:**
- Modify: scripts/extract-plan-tasks.py

**Steps:**
- [ ] **Step 1:** Add JSON serialization

**Acceptance criteria:**
- The script emits valid JSON with a tasks array.
  Verify: Parse the output as JSON and check that tasks is a list.

**Model recommendation:** standard

## Dependencies

- Task 2 depends on: Task 1

## Test Command

```bash
python3 -m unittest discover -s agent/skills/execute-plan/scripts/tests -p "test_extract_plan_tasks.py" -v
```
