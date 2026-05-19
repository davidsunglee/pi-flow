## Goal

Test that a required section inside a fence does not satisfy section validation.

## Tech stack

Python 3, unittest, markdown

## File Structure

- scripts/test-fence-section.py

### Task 1: Document architecture with fenced section

**Files:**
- Create: scripts/test-fence-section.py

**Steps:**
- [ ] **Step 1:** Create a file that documents the architecture

Here is an example of architecture documentation:

```markdown
## Architecture summary

This is inside a code fence and should NOT satisfy the real required section validation.

The architecture has these components:
- Parser
- Validator
- Emitter
```

This task demonstrates that fenced headings should not count toward required section validation.

**Acceptance criteria:**
- The parser correctly rejects this plan because Architecture summary is inside a fence and doesn't count.
  Verify: The parser should emit a `missing_required_section` error for `architecture_summary`.

**Model recommendation:** cheap

## Dependencies

## Risk Assessment

Low risk for testing purposes.

## Test Command

```bash
python3 -m unittest agent.skills.execute_plan.scripts.tests.test_extract_plan_tasks -v
```
