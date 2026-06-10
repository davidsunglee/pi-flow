import json
import subprocess
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parent.parent / "extract-plan-tasks.py"
FIXTURES = Path(__file__).parent / "fixtures"


def run_script(*args):
    result = subprocess.run(
        [sys.executable, str(SCRIPT)] + list(args),
        capture_output=True,
        text=True,
    )
    return result


class TestCleanPlan(unittest.TestCase):
    def setUp(self):
        self.result = run_script("--plan", str(FIXTURES / "plan-clean.md"))
        self.data = json.loads(self.result.stdout)

    def test_exits_zero(self):
        self.assertEqual(self.result.returncode, 0)

    def test_task_count(self):
        self.assertEqual(len(self.data["tasks"]), 2)

    def test_task1_number(self):
        self.assertEqual(self.data["tasks"][0]["number"], 1)

    def test_task1_title(self):
        self.assertEqual(self.data["tasks"][0]["title"], "Parse plan headings")

    def test_task1_task_spec_starts_with_heading(self):
        spec = self.data["tasks"][0]["task_spec"]
        self.assertTrue(spec.startswith("### Task 1:"), f"task_spec does not start with '### Task 1:': {spec[:80]!r}")

    def test_task1_task_spec_does_not_contain_next_heading(self):
        spec = self.data["tasks"][0]["task_spec"]
        lines = spec.splitlines()
        for line in lines[1:]:
            self.assertFalse(
                line.startswith("### Task ") or line.startswith("## "),
                f"task_spec contains boundary heading: {line!r}",
            )

    def test_task2_task_spec_starts_with_heading(self):
        spec = self.data["tasks"][1]["task_spec"]
        self.assertTrue(spec.startswith("### Task 2:"), f"task_spec does not start with '### Task 2:': {spec[:80]!r}")

    def test_task2_task_spec_does_not_contain_next_heading(self):
        spec = self.data["tasks"][1]["task_spec"]
        lines = spec.splitlines()
        for line in lines[1:]:
            self.assertFalse(
                line.startswith("### Task ") or line.startswith("## "),
                f"task_spec contains boundary heading: {line!r}",
            )

    def test_task1_files_create(self):
        create = self.data["tasks"][0]["files"]["create"]
        self.assertIsInstance(create, list)
        self.assertIn("scripts/extract-plan-tasks.py", create)

    def test_task1_criteria_have_text_and_verify(self):
        for criterion in self.data["tasks"][0]["criteria"]:
            self.assertTrue(criterion["text"], "criterion text is empty")
            self.assertTrue(criterion["verify"], "criterion verify is empty")

    def test_task1_model_tier(self):
        self.assertEqual(self.data["tasks"][0]["model_tier"], "efficient")

    def test_task1_dependencies_empty(self):
        self.assertEqual(self.data["tasks"][0]["dependencies"], [])

    def test_task2_dependencies(self):
        self.assertEqual(self.data["tasks"][1]["dependencies"], [1])

    def test_test_command_extracted(self):
        cmd = self.data.get("test_command")
        self.assertIsNotNone(cmd)
        self.assertTrue(len(cmd.strip()) > 0, "test_command is blank")


class TestTaskNumberFilter(unittest.TestCase):
    def test_filter_returns_single_task(self):
        result = run_script("--plan", str(FIXTURES / "plan-clean.md"), "--task-number", "2")
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(len(data["tasks"]), 1)
        self.assertEqual(data["tasks"][0]["number"], 2)


class TestMissingVerify(unittest.TestCase):
    def test_exits_nonzero(self):
        result = run_script("--plan", str(FIXTURES / "plan-missing-verify.md"))
        self.assertNotEqual(result.returncode, 0)

    def test_stderr_has_missing_verify_recipe_error(self):
        result = run_script("--plan", str(FIXTURES / "plan-missing-verify.md"))
        errors = json.loads(result.stderr)["errors"]
        kinds = [e["kind"] for e in errors]
        self.assertIn("missing_verify_recipe", kinds)

    def test_error_references_task1(self):
        result = run_script("--plan", str(FIXTURES / "plan-missing-verify.md"))
        errors = json.loads(result.stderr)["errors"]
        mv_errors = [e for e in errors if e["kind"] == "missing_verify_recipe"]
        task_nums = [e.get("task_number") for e in mv_errors]
        self.assertIn(1, task_nums)

    def test_error_references_criterion_text(self):
        result = run_script("--plan", str(FIXTURES / "plan-missing-verify.md"))
        errors = json.loads(result.stderr)["errors"]
        mv_errors = [e for e in errors if e["kind"] == "missing_verify_recipe"]
        self.assertTrue(any(e.get("criterion") for e in mv_errors), "No criterion text in error")


class TestDuplicateTask(unittest.TestCase):
    def test_exits_nonzero(self):
        result = run_script("--plan", str(FIXTURES / "plan-duplicate-task.md"))
        self.assertNotEqual(result.returncode, 0)

    def test_stderr_has_duplicate_task_number_error(self):
        result = run_script("--plan", str(FIXTURES / "plan-duplicate-task.md"))
        errors = json.loads(result.stderr)["errors"]
        kinds = [e["kind"] for e in errors]
        self.assertIn("duplicate_task_number", kinds)

    def test_error_references_duplicated_number(self):
        result = run_script("--plan", str(FIXTURES / "plan-duplicate-task.md"))
        errors = json.loads(result.stderr)["errors"]
        dup_errors = [e for e in errors if e["kind"] == "duplicate_task_number"]
        task_nums = [e.get("task_number") for e in dup_errors]
        self.assertIn(1, task_nums)


class TestMissingFiles(unittest.TestCase):
    def test_exits_nonzero(self):
        result = run_script("--plan", str(FIXTURES / "plan-missing-files.md"))
        self.assertNotEqual(result.returncode, 0)

    def test_stderr_has_missing_files_block_error(self):
        result = run_script("--plan", str(FIXTURES / "plan-missing-files.md"))
        errors = json.loads(result.stderr)["errors"]
        kinds = [e["kind"] for e in errors]
        self.assertIn("missing_files_block", kinds)

    def test_error_references_task1(self):
        result = run_script("--plan", str(FIXTURES / "plan-missing-files.md"))
        errors = json.loads(result.stderr)["errors"]
        mf_errors = [e for e in errors if e["kind"] == "missing_files_block"]
        task_nums = [e.get("task_number") for e in mf_errors]
        self.assertIn(1, task_nums)


class TestMissingModel(unittest.TestCase):
    def test_exits_nonzero(self):
        result = run_script("--plan", str(FIXTURES / "plan-missing-model.md"))
        self.assertNotEqual(result.returncode, 0)

    def test_stderr_has_missing_model_tier_error(self):
        result = run_script("--plan", str(FIXTURES / "plan-missing-model.md"))
        errors = json.loads(result.stderr)["errors"]
        kinds = [e["kind"] for e in errors]
        self.assertIn("missing_model_tier", kinds)

    def test_error_references_task1(self):
        result = run_script("--plan", str(FIXTURES / "plan-missing-model.md"))
        errors = json.loads(result.stderr)["errors"]
        mm_errors = [e for e in errors if e["kind"] == "missing_model_tier"]
        task_nums = [e.get("task_number") for e in mm_errors]
        self.assertIn(1, task_nums)


class TestInvalidModel(unittest.TestCase):
    def test_exits_nonzero(self):
        result = run_script("--plan", str(FIXTURES / "plan-invalid-model.md"))
        self.assertNotEqual(result.returncode, 0)

    def test_stderr_has_missing_model_tier_error(self):
        result = run_script("--plan", str(FIXTURES / "plan-invalid-model.md"))
        errors = json.loads(result.stderr)["errors"]
        kinds = [e["kind"] for e in errors]
        self.assertIn("missing_model_tier", kinds)

    def test_error_detail_mentions_offending_token(self):
        result = run_script("--plan", str(FIXTURES / "plan-invalid-model.md"))
        errors = json.loads(result.stderr)["errors"]
        mm_errors = [e for e in errors if e["kind"] == "missing_model_tier"]
        self.assertTrue(
            any("premium" in (e.get("detail") or "") for e in mm_errors),
            "detail does not mention the offending token 'premium'",
        )


class TestFrontierModelTier(unittest.TestCase):
    def test_frontier_value_parses_and_is_accepted(self):
        task_section = _make_task(1, "Frontier task", model="frontier")
        plan = _make_plan(task_section=task_section)
        result, data, errors = _parse_plan_str(plan)
        self.assertEqual(result.returncode, 0, f"frontier model tier should be accepted: {errors}")
        self.assertEqual(data["tasks"][0]["model_tier"], "frontier")
        kinds = [e.get("kind") for e in errors]
        self.assertNotIn("missing_model_tier", kinds)


class TestOutOfOrder(unittest.TestCase):
    def test_exits_nonzero(self):
        result = run_script("--plan", str(FIXTURES / "plan-out-of-order.md"))
        self.assertNotEqual(result.returncode, 0)

    def test_stderr_has_out_of_order_task_number_error(self):
        result = run_script("--plan", str(FIXTURES / "plan-out-of-order.md"))
        errors = json.loads(result.stderr)["errors"]
        kinds = [e["kind"] for e in errors]
        self.assertIn("out_of_order_task_number", kinds)


class TestHelp(unittest.TestCase):
    def test_help_exits_zero(self):
        result = run_script("--help")
        self.assertEqual(result.returncode, 0)

    def test_help_mentions_expected_terms(self):
        result = run_script("--help")
        output = result.stdout
        self.assertIn("tasks", output)
        self.assertIn("criteria", output)
        self.assertIn("dependencies", output)
        self.assertTrue(
            "missing_verify_recipe" in output or "duplicate_task_number" in output,
            "help does not mention error kinds",
        )

    def test_help_mentions_new_error_kinds(self):
        result = run_script("--help")
        output = result.stdout
        self.assertIn("missing_required_section", output)
        self.assertIn("dependency_unknown_target", output)
        self.assertIn("dependency_cycle", output)


class TestCleanPlanWaves(unittest.TestCase):
    """Verify clean plan emits waves array."""

    def setUp(self):
        self.result = run_script("--plan", str(FIXTURES / "plan-clean.md"))
        self.data = json.loads(self.result.stdout)

    def test_waves_key_present(self):
        self.assertIn("waves", self.data)

    def test_waves_is_list(self):
        self.assertIsInstance(self.data["waves"], list)

    def test_waves_have_required_fields(self):
        for entry in self.data["waves"]:
            self.assertIn("wave", entry)
            self.assertIn("subwave", entry)
            self.assertIn("tasks", entry)


class TestRequiredSectionMissing(unittest.TestCase):

    def _assert_missing_section(self, fixture_name, expected_section):
        result = run_script("--plan", str(FIXTURES / fixture_name))
        self.assertNotEqual(result.returncode, 0, f"{fixture_name} should exit non-zero")
        errors = json.loads(result.stderr)["errors"]
        sections = [e["section"] for e in errors if e.get("kind") == "missing_required_section"]
        self.assertIn(
            expected_section, sections,
            f"Expected section '{expected_section}' in errors, got: {sections}",
        )

    def test_missing_arch_summary_section(self):
        self._assert_missing_section("plan-missing-section-arch-summary.md", "architecture_summary")

    def test_missing_arch_summary_only_one_error(self):
        result = run_script("--plan", str(FIXTURES / "plan-missing-section-arch-summary.md"))
        errors = json.loads(result.stderr)["errors"]
        section_errors = [e for e in errors if e.get("kind") == "missing_required_section"]
        self.assertEqual(len(section_errors), 1, f"Expected 1 section error, got {section_errors}")
        self.assertEqual(section_errors[0]["section"], "architecture_summary")

    def test_missing_tech_stack_section(self):
        self._assert_missing_section("plan-missing-section-tech-stack.md", "tech_stack")

    def test_missing_tech_stack_only_one_error(self):
        result = run_script("--plan", str(FIXTURES / "plan-missing-section-tech-stack.md"))
        errors = json.loads(result.stderr)["errors"]
        section_errors = [e for e in errors if e.get("kind") == "missing_required_section"]
        self.assertEqual(len(section_errors), 1, f"Expected 1 section error, got {section_errors}")
        self.assertEqual(section_errors[0]["section"], "tech_stack")

    def test_missing_all_three_headers(self):
        result = run_script("--plan", str(FIXTURES / "plan-missing-section-header.md"))
        self.assertNotEqual(result.returncode, 0)
        errors = json.loads(result.stderr)["errors"]
        sections = [e["section"] for e in errors if e.get("kind") == "missing_required_section"]
        self.assertIn("goal", sections)
        self.assertIn("architecture_summary", sections)
        self.assertIn("tech_stack", sections)

    def test_missing_file_structure(self):
        self._assert_missing_section("plan-missing-section-files.md", "file_structure")

    def test_missing_numbered_tasks(self):
        self._assert_missing_section("plan-missing-section-tasks.md", "numbered_tasks")

    def test_missing_dependencies(self):
        self._assert_missing_section("plan-missing-section-deps.md", "dependencies")

    def test_missing_risk_assessment(self):
        self._assert_missing_section("plan-missing-section-risk.md", "risk_assessment")


class TestDependencyValidation(unittest.TestCase):

    def test_unknown_dep_exits_nonzero(self):
        result = run_script("--plan", str(FIXTURES / "plan-unknown-dep.md"))
        self.assertNotEqual(result.returncode, 0)

    def test_unknown_dep_error_kind(self):
        result = run_script("--plan", str(FIXTURES / "plan-unknown-dep.md"))
        errors = json.loads(result.stderr)["errors"]
        kinds = [e["kind"] for e in errors]
        self.assertIn("dependency_unknown_target", kinds)

    def test_unknown_dep_has_task_number_and_unknown_dep(self):
        result = run_script("--plan", str(FIXTURES / "plan-unknown-dep.md"))
        errors = json.loads(result.stderr)["errors"]
        unknown_errors = [e for e in errors if e.get("kind") == "dependency_unknown_target"]
        self.assertTrue(any(e.get("task_number") == 2 for e in unknown_errors))
        self.assertTrue(any(e.get("unknown_dep") == 99 for e in unknown_errors))

    def test_cycle_exits_nonzero(self):
        result = run_script("--plan", str(FIXTURES / "plan-dep-cycle.md"))
        self.assertNotEqual(result.returncode, 0)

    def test_cycle_error_kind(self):
        result = run_script("--plan", str(FIXTURES / "plan-dep-cycle.md"))
        errors = json.loads(result.stderr)["errors"]
        kinds = [e["kind"] for e in errors]
        self.assertIn("dependency_cycle", kinds)

    def test_cycle_names_participating_tasks(self):
        result = run_script("--plan", str(FIXTURES / "plan-dep-cycle.md"))
        errors = json.loads(result.stderr)["errors"]
        cycle_errors = [e for e in errors if e.get("kind") == "dependency_cycle"]
        self.assertTrue(len(cycle_errors) > 0)
        cycle = cycle_errors[0]["cycle"]
        self.assertIn(1, cycle)
        self.assertIn(2, cycle)


class TestInlineGoalExtraction(unittest.TestCase):

    def test_inline_goal_label_populates_goal_field(self):
        import tempfile

        plan_path = FIXTURES / "plan-clean.md"
        text = plan_path.read_text()
        inline = text.replace("## Goal\n\nExtract tasks from plan files for automated processing.", "**Goal**: Extract tasks from plan files for automated processing.")
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(inline)
            temp_plan = f.name
        try:
            result = run_script("--plan", temp_plan)
            self.assertEqual(result.returncode, 0, result.stderr)
            data = json.loads(result.stdout)
            self.assertEqual(data["goal"], "Extract tasks from plan files for automated processing.")
        finally:
            Path(temp_plan).unlink(missing_ok=True)

    def test_inline_goal_label_colon_inside_bold_populates_goal_field(self):
        """Reviewers commonly emit `**Goal:**` with the colon inside the bold marker.

        The parser must accept this form just like `**Goal**:`.
        """
        import tempfile

        plan_path = FIXTURES / "plan-clean.md"
        text = plan_path.read_text()
        inline = text.replace(
            "## Goal\n\nExtract tasks from plan files for automated processing.",
            "**Goal:** Extract tasks from plan files for automated processing.",
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(inline)
            temp_plan = f.name
        try:
            result = run_script("--plan", temp_plan)
            self.assertEqual(result.returncode, 0, result.stderr)
            data = json.loads(result.stdout)
            self.assertEqual(data["goal"], "Extract tasks from plan files for automated processing.")
        finally:
            Path(temp_plan).unlink(missing_ok=True)


class TestInlineBoldSectionLabelsTolerance(unittest.TestCase):
    """Regression: required-section detection must accept colon-inside-bold and
    colon-outside-bold forms for the three inline-label top sections.
    """

    def _plan_with_inline_top_sections(self, goal_label, arch_label, tech_label):
        return (
            f"{goal_label} Extract tasks from plan files for automated processing.\n\n"
            f"{arch_label} Single-script Python tool that parses markdown and emits JSON.\n\n"
            f"{tech_label} Python 3, argparse, json.\n\n"
            "## File Structure\n"
            "- scripts/extract-plan-tasks.py\n\n"
            "### Task 1: Parse plan headings\n\n"
            "**Files:**\n- Create: scripts/extract-plan-tasks.py\n\n"
            "**Steps:**\n- [ ] **Step 1:** Read the plan file\n\n"
            "**Acceptance criteria:**\n"
            "- The script exits zero.\n  Verify: run it.\n\n"
            "**Model tier:** efficient\n\n"
            "## Dependencies\n\n"
            "## Risk Assessment\nLow risk.\n\n"
            "## Test Command\n```bash\necho hi\n```\n"
        )

    def _run_inline_plan(self, content):
        import tempfile
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False, encoding="utf-8") as f:
            f.write(content)
            temp_plan = f.name
        try:
            result = run_script("--plan", temp_plan)
            data = json.loads(result.stdout) if result.returncode == 0 else None
            errors = json.loads(result.stderr)["errors"] if result.returncode != 0 else []
            return result, data, errors
        finally:
            Path(temp_plan).unlink(missing_ok=True)

    def test_colon_outside_bold_accepted(self):
        content = self._plan_with_inline_top_sections(
            "**Goal**:", "**Architecture summary**:", "**Tech stack**:"
        )
        result, data, errors = self._run_inline_plan(content)
        self.assertEqual(result.returncode, 0, f"colon-outside-bold should pass: {errors}")
        self.assertEqual(data["goal"], "Extract tasks from plan files for automated processing.")

    def test_colon_inside_bold_accepted(self):
        content = self._plan_with_inline_top_sections(
            "**Goal:**", "**Architecture summary:**", "**Tech stack:**"
        )
        result, data, errors = self._run_inline_plan(content)
        self.assertEqual(result.returncode, 0, f"colon-inside-bold should pass: {errors}")
        self.assertEqual(data["goal"], "Extract tasks from plan files for automated processing.")

    def test_mixed_colon_forms_accepted(self):
        content = self._plan_with_inline_top_sections(
            "**Goal:**", "**Architecture summary**:", "**Tech stack:**"
        )
        result, data, errors = self._run_inline_plan(content)
        self.assertEqual(result.returncode, 0, f"mixed colon forms should pass: {errors}")
        self.assertEqual(data["goal"], "Extract tasks from plan files for automated processing.")

    def test_inline_label_with_empty_body_still_fails(self):
        """Strict missing-content errors must remain — an empty body should error."""
        content = self._plan_with_inline_top_sections(
            "**Goal:**", "**Architecture summary:**", "**Tech stack:**"
        ).replace(
            "**Goal:** Extract tasks from plan files for automated processing.\n",
            "**Goal:**\n",
        )
        result, data, errors = self._run_inline_plan(content)
        self.assertNotEqual(result.returncode, 0, "empty inline goal body should fail")
        sections = [e.get("section") for e in errors if e.get("kind") == "missing_required_section"]
        self.assertIn("goal", sections, f"expected 'goal' missing-section error, got: {errors}")


class TestWaveGrouping(unittest.TestCase):

    def test_linear_deps_wave_assignment(self):
        result = run_script("--plan", str(FIXTURES / "plan-clean-with-deps.md"))
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        waves = data["waves"]
        wave1 = [w for w in waves if w["wave"] == 1 and w["subwave"] == 1]
        wave2 = [w for w in waves if w["wave"] == 2 and w["subwave"] == 1]
        self.assertTrue(len(wave1) == 1, f"Expected wave 1 subwave 1, got {waves}")
        self.assertEqual(sorted(wave1[0]["tasks"]), [1, 2])
        self.assertTrue(len(wave2) == 1, f"Expected wave 2 subwave 1, got {waves}")
        self.assertEqual(wave2[0]["tasks"], [3])

    def test_parallel_only_all_in_wave1(self):
        result = run_script("--plan", str(FIXTURES / "plan-parallel-only.md"))
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        waves = data["waves"]
        self.assertEqual(len(waves), 1, f"Expected 1 wave entry, got {waves}")
        self.assertEqual(waves[0]["wave"], 1)
        self.assertEqual(waves[0]["subwave"], 1)
        self.assertEqual(sorted(waves[0]["tasks"]), [1, 2, 3])

    def test_large_wave_splits_at_cap(self):
        result = run_script("--plan", str(FIXTURES / "plan-large-wave.md"))
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        waves = data["waves"]
        for entry in waves:
            self.assertLessEqual(
                len(entry["tasks"]), 8,
                f"Subwave has {len(entry['tasks'])} tasks, exceeds cap of 8",
            )

    def test_large_wave_subwave_split(self):
        result = run_script("--plan", str(FIXTURES / "plan-large-wave.md"))
        data = json.loads(result.stdout)
        waves = data["waves"]
        self.assertEqual(len(waves), 2, f"Expected 2 subwaves for 10 tasks with cap 8, got {waves}")
        self.assertEqual(waves[0]["subwave"], 1)
        self.assertEqual(waves[1]["subwave"], 2)
        self.assertEqual(len(waves[0]["tasks"]), 8)
        self.assertEqual(len(waves[1]["tasks"]), 2)


class TestMaxParallelHardCapOverride(unittest.TestCase):

    def test_override_cap_4(self):
        result = run_script(
            "--plan", str(FIXTURES / "plan-large-wave.md"),
            "--max-parallel-hard-cap", "4",
        )
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        waves = data["waves"]
        for entry in waves:
            self.assertLessEqual(
                len(entry["tasks"]), 4,
                f"Subwave has {len(entry['tasks'])} tasks, exceeds cap of 4",
            )

    def test_override_cap_4_at_least_three_subwaves(self):
        result = run_script(
            "--plan", str(FIXTURES / "plan-large-wave.md"),
            "--max-parallel-hard-cap", "4",
        )
        data = json.loads(result.stdout)
        waves = data["waves"]
        self.assertGreaterEqual(len(waves), 3, f"Expected at least 3 subwaves with cap 4, got {waves}")


class TestFencedHeadingsMinimal(unittest.TestCase):
    """Verify that fenced headings do not create spurious tasks."""

    def setUp(self):
        self.result = run_script("--plan", str(FIXTURES / "plan-fenced-headings-minimal.md"))
        if self.result.returncode == 0:
            self.data = json.loads(self.result.stdout)
        else:
            self.data = None

    def test_exits_zero(self):
        self.assertEqual(self.result.returncode, 0, f"Parser failed: {self.result.stderr}")

    def test_only_one_real_task(self):
        self.assertIsNotNone(self.data)
        self.assertEqual(len(self.data["tasks"]), 1, f"Expected 1 task, got {len(self.data['tasks'])}")

    def test_no_fake_task_999(self):
        self.assertIsNotNone(self.data)
        task_numbers = [t["number"] for t in self.data["tasks"]]
        self.assertNotIn(999, task_numbers, "Task 999 from inside fence should not be parsed")

    def test_task_1_extracted(self):
        self.assertIsNotNone(self.data)
        self.assertEqual(self.data["tasks"][0]["number"], 1)
        self.assertEqual(self.data["tasks"][0]["title"], "Real task with fenced fake content")

    def test_post_fence_content_included(self):
        self.assertIsNotNone(self.data)
        task_spec = self.data["tasks"][0]["task_spec"]
        self.assertIn("**Step 2:**", task_spec,
                      "Post-fence content should be included in task_spec")


class TestFencedHeadingsRealistic(unittest.TestCase):
    """Verify that fenced markdown content doesn't break parsing and model tier is preserved."""

    def setUp(self):
        self.result = run_script("--plan", str(FIXTURES / "plan-fenced-headings-realistic.md"))
        if self.result.returncode == 0:
            self.data = json.loads(self.result.stdout)
        else:
            self.data = None

    def test_exits_zero(self):
        self.assertEqual(self.result.returncode, 0, f"Parser failed: {self.result.stderr}")

    def test_single_task(self):
        self.assertIsNotNone(self.data)
        self.assertEqual(len(self.data["tasks"]), 1)

    def test_model_tier_after_fence(self):
        self.assertIsNotNone(self.data)
        task = self.data["tasks"][0]
        self.assertEqual(task["model_tier"], "standard",
                         "Model tier after fence should be preserved")

    def test_task_spec_contains_post_fence_text(self):
        self.assertIsNotNone(self.data)
        task_spec = self.data["tasks"][0]["task_spec"]
        self.assertIn("The above block demonstrates", task_spec,
                      "Text after fence should be in task_spec")

    def test_task_spec_contains_literal_model_tier_line(self):
        self.assertIsNotNone(self.data)
        task_spec = self.data["tasks"][0]["task_spec"]
        self.assertIn("**Model tier:** standard", task_spec,
                      "Literal model tier line should be in task_spec")


class TestFencedFakeRequiredSection(unittest.TestCase):
    """Verify that fenced section headings do not satisfy required-section validation."""

    def test_fenced_section_does_not_satisfy_requirement(self):
        """A required section inside a fence should not count toward validation."""
        result = run_script("--plan", str(FIXTURES / "plan-fenced-fake-section.md"))
        self.assertNotEqual(result.returncode, 0,
                           "Parser should fail when required section is only in a fence")

    def test_error_reports_missing_architecture_summary(self):
        """The error should specifically report architecture_summary as missing."""
        result = run_script("--plan", str(FIXTURES / "plan-fenced-fake-section.md"))
        errors = json.loads(result.stderr)["errors"]
        sections = [e["section"] for e in errors if e.get("kind") == "missing_required_section"]
        self.assertIn("architecture_summary", sections,
                     f"Expected 'architecture_summary' error, got: {sections}")

    def test_only_one_missing_section_error(self):
        """Should report exactly one missing section error for architecture_summary."""
        result = run_script("--plan", str(FIXTURES / "plan-fenced-fake-section.md"))
        errors = json.loads(result.stderr)["errors"]
        section_errors = [e for e in errors if e.get("kind") == "missing_required_section"]
        self.assertEqual(len(section_errors), 1,
                        f"Expected 1 section error, got {len(section_errors)}: {section_errors}")


class TestFenceBehavior(unittest.TestCase):
    """Test fence-awareness: backticks, tildes, indentation, closing rules, unclosed."""

    def _parse_inline_fixture(self, content):
        """Helper to parse a plan string directly."""
        import tempfile
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(content)
            temp_plan = f.name
        try:
            result = run_script("--plan", temp_plan)
            return result, json.loads(result.stdout) if result.returncode == 0 else None
        finally:
            Path(temp_plan).unlink(missing_ok=True)

    def test_backtick_fence_suppresses_heading(self):
        """Backtick fence with 3+ backticks should suppress heading parsing inside."""
        content = """## Goal
Test backtick fence suppression.

## Architecture summary
Test.

## Tech stack
Python.

## File Structure
- test.py

### Task 1: Test backticks

**Files:**
- Create: test.py

**Steps:**
- [ ] **Step 1:** Do something

```
## Fake Heading Inside
```

More content.

**Acceptance criteria:**
- Test passes.
  Verify: run it.

**Model tier:** efficient

## Dependencies

## Risk Assessment
Low.

## Test Command
```bash
test
```
"""
        result, data = self._parse_inline_fixture(content)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(len(data["tasks"]), 1)

    def test_tilde_fence_suppresses_heading(self):
        """Tilde fence with 3+ tildes should suppress heading parsing inside."""
        content = """## Goal
Test tilde fence suppression.

## Architecture summary
Test.

## Tech stack
Python.

## File Structure
- test.py

### Task 1: Test tildes

**Files:**
- Create: test.py

**Steps:**
- [ ] **Step 1:** Do something

~~~
## Fake Heading Inside
~~~

More content.

**Acceptance criteria:**
- Test passes.
  Verify: run it.

**Model tier:** efficient

## Dependencies

## Risk Assessment
Low.

## Test Command
```bash
test
```
"""
        result, data = self._parse_inline_fixture(content)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(len(data["tasks"]), 1)

    def test_indented_fence_suppresses_heading(self):
        """Indented fence should still suppress heading parsing inside."""
        content = """## Goal
Test indented fence suppression.

## Architecture summary
Test.

## Tech stack
Python.

## File Structure
- test.py

### Task 1: Test indented fences

**Files:**
- Create: test.py

**Steps:**
- [ ] **Step 1:** Do something

   ```
   ## Fake Heading Inside
   ```

More content.

**Acceptance criteria:**
- Test passes.
  Verify: run it.

**Model tier:** efficient

## Dependencies

## Risk Assessment
Low.

## Test Command
```bash
test
```
"""
        result, data = self._parse_inline_fixture(content)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(len(data["tasks"]), 1)

    def test_closing_fence_same_length_as_opener(self):
        """Closing fence with same marker and length as opener should close the fence."""
        content = """## Goal
Test closing fence rules.

## Architecture summary
Test.

## Tech stack
Python.

## File Structure
- test.py

### Task 1: Test closing rules

**Files:**
- Create: test.py

**Steps:**
- [ ] **Step 1:** Do something

```
## Fake Heading Inside
```

More content.

**Acceptance criteria:**
- Test passes.
  Verify: run it.

**Model tier:** efficient

## Dependencies

## Risk Assessment
Low.

## Test Command
```bash
test
```
"""
        result, data = self._parse_inline_fixture(content)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(len(data["tasks"]), 1)

    def test_closing_fence_longer_than_opener(self):
        """Closing fence with more markers than opener should close the fence."""
        content = """## Goal
Test longer closing fence.

## Architecture summary
Test.

## Tech stack
Python.

## File Structure
- test.py

### Task 1: Test longer closing

**Files:**
- Create: test.py

**Steps:**
- [ ] **Step 1:** Do something

```
## Fake Heading Inside
`````

More content.

**Acceptance criteria:**
- Test passes.
  Verify: run it.

**Model tier:** efficient

## Dependencies

## Risk Assessment
Low.

## Test Command
```bash
test
```
"""
        result, data = self._parse_inline_fixture(content)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(len(data["tasks"]), 1)

    def test_mismatched_markers_do_not_close(self):
        """Closing fence with different marker type should not close the fence."""
        content = """## Goal
Test mismatched marker types.

## Architecture summary
Test.

## Tech stack
Python.

## File Structure
- test.py

## Dependencies

## Risk Assessment
Low.

## Test Command
```bash
test
```

### Task 1: Test mismatched markers

**Files:**
- Create: test.py

**Steps:**
- [ ] **Step 1:** Do something

```
## Fake Heading Still Inside Because Tilde Does Not Close Backtick
~~~

And we're still in the fence.

More content here inside the fence.

**Acceptance criteria:**
- Still inside fence.
  Verify: run it.

**Model tier:** efficient
"""
        result, data = self._parse_inline_fixture(content)
        # The fence opens at the ``` and should NOT be closed by the ~~~
        # (different marker type). Since there's no closing ``` the fence
        # remains open to EOF, suppressing the parsing of any structure inside it.
        # Since **Model tier:** is inside the unclosed fence, it won't be
        # parsed, causing the task to fail validation (missing model_tier).
        self.assertNotEqual(result.returncode, 0,
                            "Unclosed fence suppressing model tier should cause validation errors")

    def test_unclosed_fence_suppresses_to_eof(self):
        """Unclosed fence should suppress structure parsing to EOF."""
        content = """## Goal
Test unclosed fence.

## Architecture summary
Test.

## Tech stack
Python.

## File Structure
- test.py

### Task 1: Test unclosed fence

**Files:**
- Create: test.py

**Steps:**
- [ ] **Step 1:** Do something

```
## Fake Heading and Everything Below is Inside This Unclosed Fence

More content here.

**Acceptance criteria:**
- Still inside fence.
  Verify: run it.

**Model tier:** efficient

## Dependencies

## Risk Assessment
Low.

## Test Command
```bash
test
```
"""
        result, data = self._parse_inline_fixture(content)
        # With an unclosed fence suppressing all content to EOF,
        # we should get validation errors for missing sections or model tier
        self.assertNotEqual(result.returncode, 0,
                            "Unclosed fence suppressing content should cause validation errors")


class TestTestCommandFence(unittest.TestCase):
    """Test that ## Test Command accepts any fenced block, not just ```bash."""

    def _plan_with_test_command(self, test_cmd_section):
        return f"""## Goal
Test fence behavior in test command section.

## Architecture summary
Test.

## Tech stack
Python.

## File Structure
- test.py

### Task 1: Simple task

**Files:**
- Create: test.py

**Steps:**
- [ ] **Step 1:** Do something

**Acceptance criteria:**
- Test passes.
  Verify: run it.

**Model tier:** efficient

## Dependencies

## Risk Assessment
Low.

## Test Command
{test_cmd_section}
"""

    def _parse_plan_str(self, content):
        import tempfile
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(content)
            temp_plan = f.name
        try:
            result = run_script("--plan", temp_plan)
            return result, json.loads(result.stdout) if result.returncode == 0 else None
        finally:
            Path(temp_plan).unlink(missing_ok=True)

    def test_test_command_unlabeled_fence(self):
        """Unlabeled backtick fence should be accepted."""
        content = self._plan_with_test_command("```\nnpm test\n```\n")
        result, data = self._parse_plan_str(content)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(data["test_command"], "npm test")

    def test_test_command_tilde_fence(self):
        """Tilde fence should be accepted."""
        content = self._plan_with_test_command("~~~\nnpm test\n~~~\n")
        result, data = self._parse_plan_str(content)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(data["test_command"], "npm test")

    def test_test_command_long_fence(self):
        """Four-backtick opener and closer should be accepted."""
        content = self._plan_with_test_command("````\nnpm test\n````\n")
        result, data = self._parse_plan_str(content)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(data["test_command"], "npm test")

    def test_test_command_indented_fence(self):
        """Opener and closer indented two spaces should be accepted."""
        content = self._plan_with_test_command("  ```\n  npm test\n  ```\n")
        result, data = self._parse_plan_str(content)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(data["test_command"], "npm test")

    def test_test_command_longer_closer(self):
        """Closer with more markers than opener should close the fence."""
        content = self._plan_with_test_command("```\nnpm test\n`````\n")
        result, data = self._parse_plan_str(content)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(data["test_command"], "npm test")

    def test_test_command_closer_with_info_string_does_not_close(self):
        """A line with an info string after markers should NOT close the fence."""
        content = self._plan_with_test_command("```\nnpm test\n```bash\nmore\n")
        result, data = self._parse_plan_str(content)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("npm test", data["test_command"])
        self.assertIn("more", data["test_command"])

    def test_test_command_unclosed_fence(self):
        """Unclosed fence: everything after opener through EOF is captured."""
        content = self._plan_with_test_command("```\nnpm test\n")
        result, data = self._parse_plan_str(content)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("npm test", data["test_command"])


class TestAmbiguousNestedFence(unittest.TestCase):
    """Verify that ambiguous nested fences emit ambiguous_nested_fence instead of missing_required_section."""

    def _result(self):
        return run_script("--plan", str(FIXTURES / "plan-ambiguous-nested-fence.md"))

    def test_exits_nonzero(self):
        self.assertNotEqual(self._result().returncode, 0)

    def test_emits_ambiguous_nested_fence_error(self):
        errors = json.loads(self._result().stderr)["errors"]
        kinds = [e["kind"] for e in errors]
        self.assertIn("ambiguous_nested_fence", kinds)

    def test_does_not_emit_missing_required_section(self):
        errors = json.loads(self._result().stderr)["errors"]
        kinds = [e["kind"] for e in errors]
        self.assertNotIn("missing_required_section", kinds)

    def test_error_has_required_fields(self):
        errors = json.loads(self._result().stderr)["errors"]
        fence_errors = [e for e in errors if e["kind"] == "ambiguous_nested_fence"]
        self.assertTrue(len(fence_errors) > 0)
        e = fence_errors[0]
        for field in ("line", "marker", "outer_fence_length", "inner_fence_length", "hint"):
            self.assertIn(field, e, f"Missing field: {field}")

    def test_error_hint_contains_remediation(self):
        errors = json.loads(self._result().stderr)["errors"]
        fence_errors = [e for e in errors if e["kind"] == "ambiguous_nested_fence"]
        self.assertTrue(any(e.get("hint") for e in fence_errors), "hint field is empty")


class TestSafeTildeOuterFence(unittest.TestCase):
    """Verify that a plan with ~~~ outer fence containing nested ``` parses successfully."""

    def setUp(self):
        self.result = run_script("--plan", str(FIXTURES / "plan-safe-tilde-outer-fence.md"))
        self.data = json.loads(self.result.stdout) if self.result.returncode == 0 else None

    def test_exits_zero(self):
        self.assertEqual(self.result.returncode, 0, f"Parser failed: {self.result.stderr}")

    def test_has_tasks(self):
        self.assertIsNotNone(self.data)
        self.assertGreater(len(self.data["tasks"]), 0)

    def test_has_waves(self):
        self.assertIsNotNone(self.data)
        self.assertIn("waves", self.data)

    def test_model_tier_parsed(self):
        self.assertIsNotNone(self.data)
        self.assertEqual(self.data["tasks"][0]["model_tier"], "standard")


class TestSafeLongBacktickOuterFence(unittest.TestCase):
    """Verify that a plan with ```` outer fence containing nested ``` parses successfully."""

    def setUp(self):
        self.result = run_script("--plan", str(FIXTURES / "plan-safe-long-backtick-outer-fence.md"))
        self.data = json.loads(self.result.stdout) if self.result.returncode == 0 else None

    def test_exits_zero(self):
        self.assertEqual(self.result.returncode, 0, f"Parser failed: {self.result.stderr}")

    def test_has_tasks(self):
        self.assertIsNotNone(self.data)
        self.assertGreater(len(self.data["tasks"]), 0)

    def test_has_waves(self):
        self.assertIsNotNone(self.data)
        self.assertIn("waves", self.data)

    def test_model_tier_parsed(self):
        self.assertIsNotNone(self.data)
        self.assertEqual(self.data["tasks"][0]["model_tier"], "standard")


def _make_plan(
    goal_section="## Goal\nTest goal.",
    arch_section="## Architecture summary\nTest.",
    tech_section="## Tech stack\nPython.",
    file_structure_section="## File Structure\n- file.py",
    task_section="",
    deps_section="## Dependencies\n",
    risk_section="## Risk Assessment\nLow.",
    test_cmd_section="## Test Command\n```bash\ntest\n```",
):
    """Build a complete plan string from section parts."""
    parts = [
        goal_section,
        "",
        arch_section,
        "",
        tech_section,
        "",
        file_structure_section,
        "",
        task_section,
        "",
        deps_section,
        "",
        risk_section,
        "",
        test_cmd_section,
    ]
    return "\n".join(parts)


def _make_task(number, title, sep=":", model="efficient", extra_files=None, criterion_prefix="", verify_prefix=""):
    """Build a single task block."""
    files_line = extra_files or f"- Create: file{number}.py"
    crit_verify = f"  {verify_prefix}Verify: run it." if not verify_prefix else f"  {verify_prefix}run it."
    return (
        f"### Task {number}{sep} {title}\n\n"
        f"**Files:**\n"
        f"{files_line}\n\n"
        f"**Steps:**\n"
        f"- [ ] **Step 1:** Do something\n\n"
        f"**Acceptance criteria:**\n"
        f"- {criterion_prefix}Some criterion.\n"
        f"{crit_verify}\n\n"
        f"**Model tier:** {model}"
    )


def _parse_plan_str(content):
    import tempfile
    with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False, encoding="utf-8") as f:
        f.write(content)
        temp_plan = f.name
    try:
        result = run_script("--plan", temp_plan)
        data = json.loads(result.stdout) if result.returncode == 0 else None
        errors = json.loads(result.stderr)["errors"] if result.returncode != 0 else []
        return result, data, errors
    finally:
        Path(temp_plan).unlink(missing_ok=True)


class TestSeparatorTolerance(unittest.TestCase):
    def test_all_separators_parse(self):
        for sep in [":", "—", "–", "-"]:
            task_section = (
                _make_task(1, "First task", sep=sep) + "\n\n" +
                _make_task(2, "Second task", sep=sep)
            )
            plan = _make_plan(task_section=task_section, deps_section="## Dependencies\n- Task 2 depends on: Task 1")
            result, data, errors = _parse_plan_str(plan)
            self.assertEqual(result.returncode, 0, f"sep={sep!r} failed: {errors}")
            tasks = data["tasks"]
            self.assertEqual(tasks[0]["number"], 1, f"sep={sep!r}: task 1 number mismatch")
            self.assertEqual(tasks[0]["title"], "First task", f"sep={sep!r}: task 1 title mismatch")
            self.assertEqual(tasks[1]["number"], 2, f"sep={sep!r}: task 2 number mismatch")
            self.assertGreaterEqual(len(data["waves"]), 1, f"sep={sep!r}: no waves")


class TestMalformedTaskHeading(unittest.TestCase):
    def _plan_with_malformed(self, malformed_heading):
        task_section = (
            f"{malformed_heading}\n\n"
            f"**Files:**\n- Create: file.py\n\n"
            f"**Steps:**\n- [ ] **Step 1:** Do something\n\n"
            f"**Acceptance criteria:**\n- Some criterion.\n  Verify: run it.\n\n"
            f"**Model tier:** efficient"
        )
        return _make_plan(task_section=task_section)

    def test_no_separator_heading(self):
        plan = self._plan_with_malformed("### Task 1")
        result, data, errors = _parse_plan_str(plan)
        self.assertNotEqual(result.returncode, 0, "Should fail for malformed heading")
        mh = [e for e in errors if e.get("kind") == "malformed_task_heading"]
        self.assertTrue(len(mh) > 0, f"Expected malformed_task_heading in errors, got: {errors}")
        observed_values = [e.get("observed") for e in mh]
        self.assertIn("### Task 1", observed_values, f"Expected '### Task 1' in observed, got: {observed_values}")
        lines_field = [e.get("line") for e in mh if e.get("observed") == "### Task 1"]
        self.assertTrue(all(isinstance(l, int) and l > 0 for l in lines_field), "line should be positive int")

    def test_title_runs_into_digit(self):
        plan = self._plan_with_malformed("### Task 1Title")
        result, data, errors = _parse_plan_str(plan)
        self.assertNotEqual(result.returncode, 0, "Should fail for malformed heading")
        mh = [e for e in errors if e.get("kind") == "malformed_task_heading"]
        self.assertTrue(len(mh) > 0, f"Expected malformed_task_heading in errors, got: {errors}")
        observed_values = [e.get("observed") for e in mh]
        self.assertIn("### Task 1Title", observed_values)


class TestSectionHeadingCaseTolerance(unittest.TestCase):
    def test_title_case_section_headings(self):
        task_section = _make_task(1, "Parse plan headings") + "\n\n" + _make_task(2, "Emit JSON output")
        plan = _make_plan(
            arch_section="## Architecture Summary\nTest.",
            tech_section="## Tech Stack\nPython.",
            task_section=task_section,
            deps_section="## Dependencies\n- Task 2 depends on: Task 1",
            risk_section="## Risk Assessment\nLow.",
        )
        result, data, errors = _parse_plan_str(plan)
        self.assertEqual(result.returncode, 0, f"Title-case sections failed: {errors}")
        self.assertEqual(len(data["tasks"]), 2)


class TestUnrelaxedSectionHeadingsStayStrict(unittest.TestCase):
    def _base_plan(self):
        task_section = _make_task(1, "Parse plan headings") + "\n\n" + _make_task(2, "Emit JSON output")
        return _make_plan(
            task_section=task_section,
            deps_section="## Dependencies\n- Task 2 depends on: Task 1",
        )

    def test_lowercase_goal_fails(self):
        plan = self._base_plan().replace("## Goal\n", "## goal\n")
        result, data, errors = _parse_plan_str(plan)
        self.assertNotEqual(result.returncode, 0, "lowercase '## goal' should fail")
        sections = [e["section"] for e in errors if e.get("kind") == "missing_required_section"]
        self.assertIn("goal", sections, f"Expected 'goal' in missing sections, got: {sections}")

    def test_lowercase_file_structure_fails(self):
        plan = self._base_plan().replace("## File Structure\n", "## file structure\n")
        result, data, errors = _parse_plan_str(plan)
        self.assertNotEqual(result.returncode, 0, "lowercase '## file structure' should fail")
        sections = [e["section"] for e in errors if e.get("kind") == "missing_required_section"]
        self.assertIn("file_structure", sections, f"Expected 'file_structure' in missing sections, got: {sections}")

    def test_lowercase_dependencies_fails(self):
        plan = self._base_plan().replace("## Dependencies\n", "## dependencies\n")
        result, data, errors = _parse_plan_str(plan)
        self.assertNotEqual(result.returncode, 0, "lowercase '## dependencies' should fail")
        sections = [e["section"] for e in errors if e.get("kind") == "missing_required_section"]
        self.assertIn("dependencies", sections, f"Expected 'dependencies' in missing sections, got: {sections}")


class TestLabelCaseTolerance(unittest.TestCase):
    def _make_plan_with_labels(self, files_label="**Files:**", steps_label="**Steps:**",
                                criteria_label="**Acceptance criteria:**",
                                model_label="**Model tier:**",
                                verify_prefix="Verify:"):
        task_section = (
            "### Task 1: Title case labels\n\n"
            f"{files_label}\n"
            "- Create: file.py\n\n"
            f"{steps_label}\n"
            "- [ ] **Step 1:** Do something\n\n"
            f"{criteria_label}\n"
            "- Some criterion.\n"
            f"  {verify_prefix} run it.\n\n"
            f"{model_label} efficient"
        )
        return _make_plan(task_section=task_section)

    def test_title_case_acceptance_criteria_and_model_tier(self):
        plan = self._make_plan_with_labels(
            criteria_label="**Acceptance Criteria:**",
            model_label="**Model Tier:**",
        )
        result, data, errors = _parse_plan_str(plan)
        self.assertEqual(result.returncode, 0, f"Title-case labels failed: {errors}")
        self.assertTrue(len(data["tasks"][0]["criteria"]) > 0, "criteria should be populated")
        self.assertEqual(data["tasks"][0]["model_tier"], "efficient")

    def test_lowercase_verify(self):
        plan = self._make_plan_with_labels(verify_prefix="verify:")
        result, data, errors = _parse_plan_str(plan)
        self.assertEqual(result.returncode, 0, f"Lowercase 'verify:' failed: {errors}")
        crit = data["tasks"][0]["criteria"]
        self.assertTrue(len(crit) > 0, "criteria should be populated")
        self.assertTrue(all(c["verify"] for c in crit), "verify should be non-empty")


class TestFilePrefixCaseTolerance(unittest.TestCase):
    def _make_plan_with_file_prefixes(self, file_lines):
        task_section = (
            "### Task 1: Mixed case file prefixes\n\n"
            "**Files:**\n" +
            "\n".join(file_lines) + "\n\n"
            "**Steps:**\n"
            "- [ ] **Step 1:** Do something\n\n"
            "**Acceptance criteria:**\n"
            "- Some criterion.\n"
            "  Verify: run it.\n\n"
            "**Model tier:** efficient"
        )
        return _make_plan(task_section=task_section)

    def test_mixed_case_prefixes(self):
        plan = self._make_plan_with_file_prefixes([
            "- create: path/to/a.ts",
            "- MODIFY: path/to/b.ts",
            "- Test: path/to/c.ts",
            "- cReAtE: path/to/d.ts",
        ])
        result, data, errors = _parse_plan_str(plan)
        self.assertEqual(result.returncode, 0, f"Mixed-case prefixes failed: {errors}")
        files = data["tasks"][0]["files"]
        self.assertIn("path/to/a.ts", files["create"])
        self.assertIn("path/to/d.ts", files["create"])
        self.assertIn("path/to/b.ts", files["modify"])
        self.assertIn("path/to/c.ts", files["test"])

    def test_canonical_case_prefixes(self):
        plan = self._make_plan_with_file_prefixes([
            "- Create: path/to/a.ts",
            "- Modify: path/to/b.ts",
            "- Test: path/to/c.ts",
        ])
        result, data, errors = _parse_plan_str(plan)
        self.assertEqual(result.returncode, 0, f"Canonical-case prefixes failed: {errors}")
        files = data["tasks"][0]["files"]
        self.assertIn("path/to/a.ts", files["create"])
        self.assertIn("path/to/b.ts", files["modify"])
        self.assertIn("path/to/c.ts", files["test"])


class TestVagueAliasRejected(unittest.TestCase):
    def test_implementation_section_not_a_task(self):
        plan = _make_plan(
            task_section=(
                "## Implementation\n\n"
                "Some implementation detail here.\n"
            ),
        )
        result, data, errors = _parse_plan_str(plan)
        self.assertNotEqual(result.returncode, 0, "## Implementation should not satisfy numbered_tasks")
        sections = [e["section"] for e in errors if e.get("kind") == "missing_required_section"]
        self.assertIn("numbered_tasks", sections, f"Expected 'numbered_tasks' in missing sections, got: {sections}")


class TestFencedVariantsIgnored(unittest.TestCase):
    def test_fenced_task_heading_ignored(self):
        task_section = (
            "### Task 1: Real task\n\n"
            "**Files:**\n"
            "- Create: file.py\n\n"
            "**Steps:**\n"
            "- [ ] **Step 1:** Do something\n\n"
            "```\n"
            "### Task 99 — Fake fenced task\n"
            "```\n\n"
            "**Acceptance criteria:**\n"
            "- Criterion.\n"
            "  Verify: run it.\n\n"
            "**Model tier:** efficient"
        )
        plan = _make_plan(task_section=task_section)
        result, data, errors = _parse_plan_str(plan)
        self.assertEqual(result.returncode, 0, f"Fenced task heading should be ignored: {errors}")
        task_numbers = [t["number"] for t in data["tasks"]]
        self.assertEqual(task_numbers, [1], f"Should only have task 1, got: {task_numbers}")
        self.assertNotIn(99, task_numbers, "Task 99 from inside fence should not appear")


class TestSuffixedTaskId(unittest.TestCase):
    """Allow intentionally inserted task IDs with a single lowercase suffix (e.g. 15a)."""

    def test_suffixed_heading_parses(self):
        task_section = (
            _make_task(1, "First") + "\n\n" +
            _make_task(2, "Second") + "\n\n" +
            _make_task("2a", "Inserted") + "\n\n" +
            _make_task(3, "Third")
        )
        plan = _make_plan(task_section=task_section)
        result, data, errors = _parse_plan_str(plan)
        self.assertEqual(result.returncode, 0, f"Suffixed heading should parse: {errors}")
        numbers = [t["number"] for t in data["tasks"]]
        self.assertIn("2a", numbers, f"Suffixed id missing: {numbers}")
        self.assertIn(2, numbers, f"Base 2 missing: {numbers}")

    def test_suffixed_em_dash_heading_parses(self):
        task_section = (
            _make_task(1, "First") + "\n\n" +
            _make_task(15, "Fifteen") + "\n\n" +
            _make_task("15a", "CLI entry", sep="—") + "\n\n" +
            _make_task(16, "Sixteen")
        )
        # Need bases 1..14 to satisfy contiguity; for this isolated test reuse only 1, 15, 16, 15a.
        # The contiguous check requires 1, 2, 3, ... so this will fail unless we satisfy it.
        # Build the full sequence instead.
        bodies = []
        for n in range(1, 17):
            bodies.append(_make_task(n, f"T{n}"))
        bodies.insert(15, _make_task("15a", "CLI entry", sep="—"))  # after task 15
        task_section = "\n\n".join(bodies)
        plan = _make_plan(task_section=task_section)
        result, data, errors = _parse_plan_str(plan)
        self.assertEqual(result.returncode, 0, f"Should parse: {errors}")
        numbers = [t["number"] for t in data["tasks"]]
        self.assertIn("15a", numbers)

    def test_dependency_references_suffix(self):
        task_section = (
            _make_task(1, "First") + "\n\n" +
            _make_task(2, "Second") + "\n\n" +
            _make_task("2a", "Inserted") + "\n\n" +
            _make_task(3, "Third")
        )
        plan = _make_plan(
            task_section=task_section,
            deps_section="## Dependencies\n- Task 2a depends on: Task 2\n- Task 3 depends on: Task 2a",
        )
        result, data, errors = _parse_plan_str(plan)
        self.assertEqual(result.returncode, 0, f"Should parse: {errors}")
        task_by_id = {t["number"]: t for t in data["tasks"]}
        self.assertIn("2a", task_by_id)
        self.assertEqual(task_by_id["2a"]["dependencies"], [2])
        self.assertEqual(task_by_id[3]["dependencies"], ["2a"])

    def test_wave_placement_with_suffix(self):
        task_section = (
            _make_task(1, "First") + "\n\n" +
            _make_task(2, "Second") + "\n\n" +
            _make_task("2a", "Inserted") + "\n\n" +
            _make_task(3, "Third")
        )
        plan = _make_plan(
            task_section=task_section,
            deps_section="## Dependencies\n- Task 2a depends on: Task 2\n- Task 3 depends on: Task 2a",
        )
        result, data, errors = _parse_plan_str(plan)
        self.assertEqual(result.returncode, 0)
        waves = data["waves"]
        # Wave 1: tasks 1 and 2 (no deps)
        # Wave 2: 2a (depends on 2)
        # Wave 3: 3 (depends on 2a)
        wave_for = {}
        for entry in waves:
            for t in entry["tasks"]:
                wave_for[t] = entry["wave"]
        self.assertEqual(wave_for[1], 1)
        self.assertEqual(wave_for[2], 1)
        self.assertEqual(wave_for["2a"], 2)
        self.assertEqual(wave_for[3], 3)

    def test_ordering_suffix_without_base_fails(self):
        task_section = (
            _make_task(1, "First") + "\n\n" +
            _make_task("2a", "Orphan suffix") + "\n\n" +
            _make_task(3, "Third")
        )
        plan = _make_plan(task_section=task_section)
        result, data, errors = _parse_plan_str(plan)
        self.assertNotEqual(result.returncode, 0, "Suffix without base should fail")
        kinds = [e.get("kind") for e in errors]
        self.assertIn("out_of_order_task_number", kinds, f"Errors: {errors}")

    def test_ordering_suffix_before_base_fails(self):
        """A suffixed task declared before its base (e.g. 1, 2a, 2, 3) is out of order."""
        task_section = (
            _make_task(1, "First") + "\n\n" +
            _make_task("2a", "Inserted early") + "\n\n" +
            _make_task(2, "Second") + "\n\n" +
            _make_task(3, "Third")
        )
        plan = _make_plan(task_section=task_section)
        result, data, errors = _parse_plan_str(plan)
        self.assertNotEqual(result.returncode, 0, "Suffix before base should fail")
        kinds = [e.get("kind") for e in errors]
        self.assertIn("out_of_order_task_number", kinds, f"Errors: {errors}")

    def test_ordering_suffix_after_next_base_fails(self):
        """A suffixed task declared after a later base (e.g. 1, 2, 3, 2a) is out of order."""
        task_section = (
            _make_task(1, "First") + "\n\n" +
            _make_task(2, "Second") + "\n\n" +
            _make_task(3, "Third") + "\n\n" +
            _make_task("2a", "Inserted late")
        )
        plan = _make_plan(task_section=task_section)
        result, data, errors = _parse_plan_str(plan)
        self.assertNotEqual(result.returncode, 0, "Suffix after later base should fail")
        kinds = [e.get("kind") for e in errors]
        self.assertIn("out_of_order_task_number", kinds, f"Errors: {errors}")

    def test_uppercase_suffix_rejected(self):
        task_section = _make_task(1, "First") + "\n\n" + "### Task 1A: bad"
        plan = _make_plan(task_section=task_section)
        result, data, errors = _parse_plan_str(plan)
        self.assertNotEqual(result.returncode, 0, "Uppercase suffix should be malformed")
        kinds = [e.get("kind") for e in errors]
        self.assertIn("malformed_task_heading", kinds, f"Errors: {errors}")

    def test_multi_letter_suffix_rejected(self):
        task_section = _make_task(1, "First") + "\n\n" + "### Task 1ab: bad"
        plan = _make_plan(task_section=task_section)
        result, data, errors = _parse_plan_str(plan)
        self.assertNotEqual(result.returncode, 0, "Multi-letter suffix should be malformed")
        kinds = [e.get("kind") for e in errors]
        self.assertIn("malformed_task_heading", kinds, f"Errors: {errors}")

    def test_filter_by_suffixed_task_number(self):
        task_section = (
            _make_task(1, "First") + "\n\n" +
            _make_task(2, "Second") + "\n\n" +
            _make_task("2a", "Inserted") + "\n\n" +
            _make_task(3, "Third")
        )
        plan = _make_plan(task_section=task_section)
        import tempfile
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False, encoding="utf-8") as f:
            f.write(plan)
            temp_plan = f.name
        try:
            result = run_script("--plan", temp_plan, "--task-number", "2a")
            self.assertEqual(result.returncode, 0, result.stderr)
            data = json.loads(result.stdout)
            self.assertEqual(len(data["tasks"]), 1)
            self.assertEqual(data["tasks"][0]["number"], "2a")
        finally:
            Path(temp_plan).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
