import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parent.parent / "compute-verifier-file-set.py"


def run_script(*args, stdin_input=""):
    """Run the script with args and optional stdin, return (returncode, stdout, stderr)."""
    result = subprocess.run(
        [sys.executable, str(SCRIPT)] + list(args),
        capture_output=True,
        text=True,
        input=stdin_input,
    )
    return result.returncode, result.stdout, result.stderr


def create_temp_file(content):
    """Create a temporary file and return its path."""
    f = tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json')
    f.write(content)
    f.close()
    return f.name


class TestSingleTaskWaveDisjointSets(unittest.TestCase):
    """Step 10: single-task wave with disjoint sets → union of all three."""

    def test_single_task_union_of_all_three(self):
        task_file = create_temp_file('["src/a.ts"]')
        worker_file = create_temp_file('["src/b.ts"]')
        diff_file = create_temp_file('["src/c.ts"]')
        observed_status_file = create_temp_file('')

        returncode, stdout, stderr = run_script(
            '--task-files', task_file,
            '--worker-files', worker_file,
            '--observed-status', observed_status_file,
            '--observed-diff-paths', diff_file,
            '--wave-shape', 'single-task'
        )

        self.assertEqual(returncode, 0, f"stderr: {stderr}")
        data = json.loads(stdout)

        # Single-task should be union of all three
        self.assertEqual(set(data['verifier_visible_files']), {'src/a.ts', 'src/b.ts', 'src/c.ts'})


class TestParallelMultiTaskWaveExcludesUnrelatedObservedPaths(unittest.TestCase):
    """Step 11: parallel-multi-task with observed path NOT under task-files or in worker-files → excluded."""

    def test_parallel_multi_task_excludes_unrelated_observed_path(self):
        task_file = create_temp_file('["src/task/"]')
        worker_file = create_temp_file('[]')
        diff_file = create_temp_file('[]')
        observed_status_file = create_temp_file(' M src/other/unrelated.ts')

        returncode, stdout, stderr = run_script(
            '--task-files', task_file,
            '--worker-files', worker_file,
            '--observed-status', observed_status_file,
            '--observed-diff-paths', diff_file,
            '--wave-shape', 'parallel-multi-task'
        )

        self.assertEqual(returncode, 0, f"stderr: {stderr}")
        data = json.loads(stdout)

        # Should only include task_files, not the unrelated observed path
        self.assertEqual(data['verifier_visible_files'], ['src/task/'])


class TestParallelMultiTaskWaveIncludesDescendantObservedPaths(unittest.TestCase):
    """Step 12: parallel-multi-task with observed path under task-files directory → included."""

    def test_parallel_multi_task_includes_descendant_observed_path(self):
        task_file = create_temp_file('["src/a/"]')
        worker_file = create_temp_file('[]')
        diff_file = create_temp_file('[]')
        observed_status_file = create_temp_file(' M src/a/b.ts')

        returncode, stdout, stderr = run_script(
            '--task-files', task_file,
            '--worker-files', worker_file,
            '--observed-status', observed_status_file,
            '--observed-diff-paths', diff_file,
            '--wave-shape', 'parallel-multi-task'
        )

        self.assertEqual(returncode, 0, f"stderr: {stderr}")
        data = json.loads(stdout)

        # Should include both task_files and observed path that's a descendant
        self.assertIn('src/a/', data['verifier_visible_files'])
        self.assertIn('src/a/b.ts', data['verifier_visible_files'])


class TestEmptyInputs(unittest.TestCase):
    """Step 13: empty inputs → empty verifier_visible_files, exit 0."""

    def test_empty_inputs(self):
        task_file = create_temp_file('[]')
        worker_file = create_temp_file('[]')
        diff_file = create_temp_file('[]')
        observed_status_file = create_temp_file('')

        returncode, stdout, stderr = run_script(
            '--task-files', task_file,
            '--worker-files', worker_file,
            '--observed-status', observed_status_file,
            '--observed-diff-paths', diff_file,
            '--wave-shape', 'single-task'
        )

        self.assertEqual(returncode, 0, f"stderr: {stderr}")
        data = json.loads(stdout)
        self.assertEqual(data['verifier_visible_files'], [])


class TestMalformedJSON(unittest.TestCase):
    """Step 14: malformed JSON → exit 1, stderr JSON failure == 'input_json_invalid' with field."""

    def test_malformed_task_files_json(self):
        task_file = create_temp_file('not valid json')
        worker_file = create_temp_file('[]')
        diff_file = create_temp_file('[]')

        returncode, stdout, stderr = run_script(
            '--task-files', task_file,
            '--worker-files', worker_file,
            '--observed-status', '-',
            '--observed-diff-paths', diff_file,
            '--wave-shape', 'single-task',
            stdin_input=''
        )

        self.assertNotEqual(returncode, 0)
        error = json.loads(stderr)
        self.assertEqual(error['failure'], 'input_json_invalid')
        self.assertEqual(error['field'], 'task_files')

    def test_malformed_worker_files_json(self):
        task_file = create_temp_file('[]')
        worker_file = create_temp_file('not valid json')
        diff_file = create_temp_file('[]')

        returncode, stdout, stderr = run_script(
            '--task-files', task_file,
            '--worker-files', worker_file,
            '--observed-status', '-',
            '--observed-diff-paths', diff_file,
            '--wave-shape', 'single-task',
            stdin_input=''
        )

        self.assertNotEqual(returncode, 0)
        error = json.loads(stderr)
        self.assertEqual(error['failure'], 'input_json_invalid')
        self.assertEqual(error['field'], 'worker_files')


class TestInvalidWaveShape(unittest.TestCase):
    """Step 15: invalid wave-shape → exit non-zero with failure == 'wave_shape_invalid'."""

    def test_invalid_wave_shape(self):
        task_file = create_temp_file('[]')
        worker_file = create_temp_file('[]')
        diff_file = create_temp_file('[]')

        returncode, stdout, stderr = run_script(
            '--task-files', task_file,
            '--worker-files', worker_file,
            '--observed-status', '-',
            '--observed-diff-paths', diff_file,
            '--wave-shape', 'bogus',
            stdin_input=''
        )

        self.assertNotEqual(returncode, 0)
        error = json.loads(stderr)
        self.assertEqual(error['failure'], 'wave_shape_invalid')
        self.assertEqual(error['value'], 'bogus')


class TestDuplicatePathInAllThreeSources(unittest.TestCase):
    """Step 16: same path in all three sources → exactly one occurrence."""

    def test_duplicate_in_all_sources(self):
        task_file = create_temp_file('["src/common.ts"]')
        worker_file = create_temp_file('["src/common.ts"]')
        diff_file = create_temp_file('["src/common.ts"]')
        observed_status_file = create_temp_file(' M src/common.ts')

        returncode, stdout, stderr = run_script(
            '--task-files', task_file,
            '--worker-files', worker_file,
            '--observed-status', observed_status_file,
            '--observed-diff-paths', diff_file,
            '--wave-shape', 'single-task'
        )

        self.assertEqual(returncode, 0, f"stderr: {stderr}")
        data = json.loads(stdout)

        # Should have exactly one occurrence
        self.assertEqual(data['verifier_visible_files'].count('src/common.ts'), 1)


class TestObservedPathsOrdering(unittest.TestCase):
    """Step 17: observed_paths uses first-occurrence dedup in input order, not sorting."""

    def test_observed_paths_ordering(self):
        task_file = create_temp_file('[]')
        worker_file = create_temp_file('[]')
        diff_file = create_temp_file('["c.ts", "a.ts"]')
        observed_status_file = create_temp_file(' M b.ts\n M a.ts')

        returncode, stdout, stderr = run_script(
            '--task-files', task_file,
            '--worker-files', worker_file,
            '--observed-status', observed_status_file,
            '--observed-diff-paths', diff_file,
            '--wave-shape', 'single-task'
        )

        self.assertEqual(returncode, 0, f"stderr: {stderr}")
        data = json.loads(stdout)

        # Should be: porcelain order first (b.ts, a.ts), then diff order (c.ts, a.ts but a.ts is duplicate)
        self.assertEqual(data['observed_paths'], ['b.ts', 'a.ts', 'c.ts'])


class TestObservedStatusFromStdin(unittest.TestCase):
    """Test that observed-status can read from stdin when value is '-'."""

    def test_observed_status_from_stdin(self):
        task_file = create_temp_file('["src/a.ts"]')
        worker_file = create_temp_file('[]')
        diff_file = create_temp_file('[]')

        returncode, stdout, stderr = run_script(
            '--task-files', task_file,
            '--worker-files', worker_file,
            '--observed-status', '-',
            '--observed-diff-paths', diff_file,
            '--wave-shape', 'single-task',
            stdin_input=' M src/b.ts\n M src/c.ts'
        )

        self.assertEqual(returncode, 0, f"stderr: {stderr}")
        data = json.loads(stdout)

        self.assertIn('src/b.ts', data['observed_paths'])
        self.assertIn('src/c.ts', data['observed_paths'])


class TestObservedStatusUnreadable(unittest.TestCase):
    """Missing observed-status file should return structured JSON, not a traceback."""

    def test_missing_observed_status_file(self):
        task_file = create_temp_file('["src/a.ts"]')
        worker_file = create_temp_file('[]')
        diff_file = create_temp_file('[]')

        returncode, stdout, stderr = run_script(
            '--task-files', task_file,
            '--worker-files', worker_file,
            '--observed-status', '/no/such/status.txt',
            '--observed-diff-paths', diff_file,
            '--wave-shape', 'single-task'
        )

        self.assertNotEqual(returncode, 0)
        error = json.loads(stderr)
        self.assertEqual(error['failure'], 'observed_status_unreadable')


class TestHelpContainsProtocolErrors(unittest.TestCase):
    """Step 9: --help epilog lists protocol-error labels."""

    def test_help_contains_protocol_errors(self):
        returncode, stdout, stderr = run_script('--help')

        self.assertEqual(returncode, 0)
        self.assertIn('input_json_invalid', stdout)
        self.assertIn('wave_shape_invalid', stdout)
        self.assertIn('observed_status_unreadable', stdout)


if __name__ == "__main__":
    unittest.main()
