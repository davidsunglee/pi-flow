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
- [ ] **Step 2:** Parse task headings

**Acceptance criteria:**
- The script exits 0 on a clean plan.
  Verify: Run the script on a clean plan and check exit code is zero.
- The script outputs valid JSON.
  Verify: Parse stdout as JSON and confirm no exception is raised.

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

## Risk Assessment

Low risk. The script only reads files and emits JSON.

## Test Command

```bash
python3 -m unittest discover -s agent/skills/execute-plan/scripts/tests -p "test_extract_plan_tasks.py" -v
```
