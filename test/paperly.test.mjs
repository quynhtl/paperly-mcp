import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolError } from "../server/mcp.mjs";
import { Paperly } from "../server/paperly.mjs";
import { wellFormed } from "./helpers.mjs";

test("an error from Paperly is shortened without cutting a character in half", async () => {
  // The 𝑥 takes units 199 and 200 of the body
  const body = `${"e".repeat(199)}${String.fromCodePoint(0x1d465)} and more`;
  const paperly = new Paperly({ fetch: async () => new Response(body, { status: 500 }) });
  await assert.rejects(paperly.get("items"), (e) => {
    assert.ok(e instanceof ToolError);
    assert.equal(e.message, `Paperly answered 500: ${"e".repeat(199)}`);
    assert.ok(wellFormed(e.message));
    return true;
  });
});
