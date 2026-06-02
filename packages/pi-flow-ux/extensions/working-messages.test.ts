import { test } from "node:test";
import assert from "node:assert/strict";
import { WORKING_MESSAGES, pickRandomWorkingMessage } from "./working-messages.ts";

test("WORKING_MESSAGES is a non-empty array with non-empty string entries", () => {
  assert(Array.isArray(WORKING_MESSAGES), "WORKING_MESSAGES must be an array");
  assert(WORKING_MESSAGES.length > 0, "WORKING_MESSAGES must not be empty");
  for (const msg of WORKING_MESSAGES) {
    assert(typeof msg === "string", "Each entry must be a string");
    assert(msg.length > 0, "Each entry must be non-empty");
  }
});

test("pickRandomWorkingMessage returns a value from WORKING_MESSAGES", () => {
  for (let i = 0; i < 20; i++) {
    const msg = pickRandomWorkingMessage();
    assert(WORKING_MESSAGES.includes(msg), `pickRandomWorkingMessage should return a message from WORKING_MESSAGES; got: ${msg}`);
  }
});
