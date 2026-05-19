## Goal

Extract tasks from plan files for automated processing.

## Architecture summary

Single-script Python tool that parses markdown and emits JSON.

## Tech stack

Python 3, argparse, json

## File Structure

- scripts/extract-plan-tasks.py

## Dependencies

## Risk Assessment

Low risk. The script only reads files and emits JSON.

## Test Command

```bash
python3 -m unittest discover -s agent/skills/execute-plan/scripts/tests -p "test_extract_plan_tasks.py" -v
```
