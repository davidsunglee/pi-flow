import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resolveIdeasConfig,
  substituteIdea,
  shortcutToKeyId,
  BUILTIN_IDEAS_CONFIG,
} from "./config.ts";

function makeTmpDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-config-test-"));
  return dir;
}

function removeTmpDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function writeJson(filePath: string, data: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data), "utf8");
}

test("resolveIdeasConfig with no files returns built-in defaults", () => {
  const tmp = makeTmpDir();
  try {
    const cfg = resolveIdeasConfig({ homeDir: tmp, cwd: tmp });
    assert.equal(cfg.command, "ideas");
    assert.equal(cfg.actions.length, 0);
    assert.ok(!cfg.refinePrompt.includes("## Context"), "refinePrompt should not contain ## Context");
    assert.ok(!cfg.toolDescription.includes("## Context"), "toolDescription should not contain ## Context");
    assert.ok(!cfg.promptSnippet.includes("5-section"), "promptSnippet should not contain 5-section");
    assert.ok(!cfg.promptSnippet.includes("## Context"), "promptSnippet should not contain ## Context");
  } finally {
    removeTmpDir(tmp);
  }
});

test("resolveIdeasConfig with packaged default file applies command and actions", () => {
  const tmp = makeTmpDir();
  try {
    const defaultConfigPath = path.join(tmp, "default-ideas.json");
    writeJson(defaultConfigPath, {
      command: "flow:ideas",
      actions: [
        { name: "fastlane", prompt: "Fastlane prompt" },
        { name: "scout", prompt: "Scout prompt" },
        { name: "spec", prompt: "Spec prompt" },
        { name: "plan", prompt: "Plan prompt" },
      ],
    });
    const cfg = resolveIdeasConfig({ defaultConfigPath, homeDir: tmp, cwd: tmp });
    assert.equal(cfg.command, "flow:ideas");
    assert.deepEqual(
      cfg.actions.map((a) => a.name),
      ["fastlane", "scout", "spec", "plan"],
    );
  } finally {
    removeTmpDir(tmp);
  }
});

test("resolveIdeasConfig scalar command: project wins over global wins over packaged", () => {
  const tmp = makeTmpDir();
  try {
    const defaultConfigPath = path.join(tmp, "default-ideas.json");
    writeJson(defaultConfigPath, { command: "packaged:ideas" });

    const homeDir = path.join(tmp, "home");
    writeJson(path.join(homeDir, ".pi", "ideas.json"), { command: "global:ideas" });

    const cwd = path.join(tmp, "project");
    writeJson(path.join(cwd, ".pi", "ideas.json"), { command: "project:ideas" });

    const cfg = resolveIdeasConfig({ defaultConfigPath, homeDir, cwd });
    assert.equal(cfg.command, "project:ideas");
  } finally {
    removeTmpDir(tmp);
  }
});

test("resolveIdeasConfig action merge: global adds a,b; project removes a, updates b, adds c", () => {
  const tmp = makeTmpDir();
  try {
    const homeDir = path.join(tmp, "home");
    writeJson(path.join(homeDir, ".pi", "ideas.json"), {
      actions: [
        { name: "a", prompt: "A prompt" },
        { name: "b", prompt: "B prompt" },
      ],
    });

    const cwd = path.join(tmp, "project");
    writeJson(path.join(cwd, ".pi", "ideas.json"), {
      actions: [
        { name: "-a" },
        { name: "b", prompt: "X" },
        { name: "c", prompt: "Y" },
      ],
    });

    const cfg = resolveIdeasConfig({ homeDir, cwd });
    assert.deepEqual(
      cfg.actions.map((a) => a.name),
      ["b", "c"],
    );
    const b = cfg.actions.find((a) => a.name === "b");
    assert.equal(b?.prompt, "X", "b.prompt should be replaced by project value");
  } finally {
    removeTmpDir(tmp);
  }
});

test("resolveIdeasConfig project negation removes action from packaged config", () => {
  const tmp = makeTmpDir();
  try {
    const defaultConfigPath = path.join(tmp, "default-ideas.json");
    writeJson(defaultConfigPath, {
      actions: [
        { name: "fastlane", prompt: "Fastlane prompt" },
        { name: "scout", prompt: "Scout prompt" },
      ],
    });

    const cwd = path.join(tmp, "project");
    writeJson(path.join(cwd, ".pi", "ideas.json"), {
      actions: [{ name: "-fastlane" }],
    });

    const cfg = resolveIdeasConfig({ defaultConfigPath, homeDir: tmp, cwd });
    assert.deepEqual(
      cfg.actions.map((a) => a.name),
      ["scout"],
    );
  } finally {
    removeTmpDir(tmp);
  }
});

test("resolveIdeasConfig ignores malformed JSON in any layer", () => {
  const tmp = makeTmpDir();
  try {
    const defaultConfigPath = path.join(tmp, "default-ideas.json");
    writeFileSync(defaultConfigPath, "{ not valid json", "utf8");

    const homeDir = path.join(tmp, "home");
    mkdirSync(path.join(homeDir, ".pi"), { recursive: true });
    writeFileSync(path.join(homeDir, ".pi", "ideas.json"), "also bad", "utf8");

    const cwd = path.join(tmp, "project");
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(path.join(cwd, ".pi", "ideas.json"), "{ bad }", "utf8");

    const cfg = resolveIdeasConfig({ defaultConfigPath, homeDir, cwd });
    assert.equal(cfg.command, BUILTIN_IDEAS_CONFIG.command);
    assert.equal(cfg.actions.length, 0);
  } finally {
    removeTmpDir(tmp);
  }
});

test("substituteIdea replaces single ${idea} occurrence with IDEA-<hex>", () => {
  assert.equal(substituteIdea("/x ${idea} y", "8530d048"), "/x IDEA-8530d048 y");
});

test("substituteIdea replaces all ${idea} occurrences", () => {
  assert.equal(
    substituteIdea("${idea} and ${idea}", "8530d048"),
    "IDEA-8530d048 and IDEA-8530d048",
  );
});

test("shortcutToKeyId lowercases and trims whitespace", () => {
  assert.equal(shortcutToKeyId(" Ctrl+Shift+F "), "ctrl+shift+f");
});
