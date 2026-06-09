import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveIdeasConfig } from "@aphotic/pi-ideas/extensions/config.ts";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGED_IDEAS_JSON = resolve(PKG_DIR, "ideas.json");

// Resolve the packaged refinePrompt the same way the running extension does
// (registerIdea(pi, { defaultConfigPath: ".../ideas.json" })), but isolate the
// global/project layers to an empty sandbox so we assert on the packaged text.
function resolvePackagedRefinePrompt(): string {
  const sandbox = mkdtempSync(join(tmpdir(), "pi-flow-refine-prompt-"));
  try {
    const cfg = resolveIdeasConfig({
      defaultConfigPath: PACKAGED_IDEAS_JSON,
      homeDir: sandbox,
      cwd: sandbox,
    });
    return cfg.refinePrompt;
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

test("packaged refinePrompt retains the canonical five-section order and ${idea} placeholder", () => {
  const prompt = resolvePackagedRefinePrompt();

  assert.ok(prompt.includes("${idea}"), "refinePrompt must keep the ${idea} placeholder");

  const headers = [
    "## Context",
    "## Goal",
    "## Scope",
    "## Acceptance Sketch",
    "## Open Questions",
  ];
  let cursor = -1;
  for (const header of headers) {
    const idx = prompt.indexOf(header, cursor + 1);
    assert.ok(idx > cursor, `expected ${header} after the previous section header`);
    cursor = idx;
  }
});

test("packaged refinePrompt directs the model to read and inspect the existing idea's ## Open Questions before rewriting", () => {
  const prompt = resolvePackagedRefinePrompt();

  assert.match(
    prompt,
    /read the existing idea/i,
    "refinePrompt must tell the model to read the existing idea",
  );
  assert.match(
    prompt,
    /(current|existing)[^\n]*## Open Questions/i,
    "refinePrompt must tell the model to inspect the existing idea's ## Open Questions",
  );
  assert.match(
    prompt,
    /clarification target/i,
    "refinePrompt must frame existing open questions as clarification targets to raise with the user",
  );
});

test("packaged refinePrompt separates conversation-time clarifying questions from the final ## Open Questions section", () => {
  const prompt = resolvePackagedRefinePrompt();

  assert.match(
    prompt,
    /distinguish/i,
    "refinePrompt must explicitly distinguish conversation questions from the written section",
  );
  assert.match(
    prompt,
    /clarifying questions[^.]*during[^.]*conversation/i,
    "refinePrompt must describe clarifying questions asked during the refinement conversation",
  );
  assert.match(
    prompt,
    /final[^\n]*## Open Questions/i,
    "refinePrompt must distinguish the final ## Open Questions section written into the artifact",
  );
});

test("packaged refinePrompt makes None. the default outcome when material questions are answered", () => {
  const prompt = resolvePackagedRefinePrompt();

  assert.match(
    prompt,
    /`None\.`/,
    "refinePrompt must instruct writing the final ## Open Questions as `None.` when all material questions are answered",
  );
  assert.match(
    prompt,
    /(deferred|unresolved|cannot answer)/i,
    "refinePrompt must reserve the final section for genuinely deferred/unresolved items",
  );
});

test("packaged refinePrompt preserves existing recommendation and no-premature-rewrite behaviors", () => {
  const prompt = resolvePackagedRefinePrompt();

  assert.match(
    prompt,
    /recommendation/i,
    "refinePrompt must keep offering a recommendation per question",
  );
  assert.match(
    prompt,
    /do not rewrite the idea body before the user answers/i,
    "refinePrompt must keep the do-not-rewrite-before-answer guidance",
  );
  assert.match(
    prompt,
    /`idea` tool's `update` action/,
    "refinePrompt must still write via the idea tool's update action",
  );
});
