## Goal

Test that fenced code blocks with heading-like content inside do not create spurious tasks.

## Architecture summary

Simple plan with one real task containing a fenced block with fake task headings.

## Tech stack

Python 3, unittest, markdown

## File Structure

- scripts/test-fenced.py

### Task 1: Real task with fenced fake content

**Files:**
- Create: scripts/test-fenced.py

**Steps:**
- [ ] **Step 1:** Create a test file

Here is a fenced block with fake task content inside:

```markdown
## Completion contract

This is just documentation about the contract.

### Task 999: Not a real task

This is fake content inside the fence and should not be parsed as a real task.

More fake content.
```

Here is real content after the fence:

- [ ] **Step 2:** Verify post-fence content is included

**Acceptance criteria:**
- The parser only extracts one real task (Task 1) when Task 999 is inside a fence.
  Verify: run the parser and confirm the output contains exactly one task with `number: 1`.
- Content after the fence is included in the task.
  Verify: assert the `task_spec` for Task 1 contains `**Step 2:**`.

**Model recommendation:** cheap

## Dependencies

## Risk Assessment

Low risk, this is purely a regression test fixture.

## Test Command

```bash
python3 -m unittest agent.skills.execute_plan.scripts.tests.test_extract_plan_tasks -v
```
