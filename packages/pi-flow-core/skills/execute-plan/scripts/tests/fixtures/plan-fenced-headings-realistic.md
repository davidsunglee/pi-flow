## Goal

Test fence-aware parsing with realistic markdown content inside code blocks.

## Architecture summary

A plan with a task that documents markdown structure in a fenced code block, with the model recommendation appearing after the fence closure.

## Tech stack

Python 3, unittest, markdown

## File Structure

- scripts/doc-example.py

### Task 1: Document markdown structure

**Files:**
- Create: scripts/doc-example.py

**Steps:**
- [ ] **Step 1:** Implement the markdown structure documentation

Here is an example of the markdown structure we need to parse:

```markdown
## Main Section

This is the content of the main section.

### Subsection

Content here.

### Another Subsection

More content.

## Second Section

And so on.
```

The above block demonstrates how our parser handles nested markdown.

**Acceptance criteria:**
- The task is parsed correctly despite the fenced markdown block.
  Verify: run the parser and confirm Task 1 is extracted completely.
- Content after the fence is still parsed.
  Verify: assert the `task_spec` contains `The above block demonstrates` and the model recommendation line.

**Model recommendation:** standard

## Dependencies

None.

## Risk Assessment

Low, this is a regression test fixture showing real-world markdown inside code fences.

## Test Command

```bash
python3 -m unittest agent.skills.execute_plan.scripts.tests.test_extract_plan_tasks -v
```
