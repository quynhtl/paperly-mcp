import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolError } from "../server/mcp.mjs";
import { Paperly } from "../server/paperly.mjs";
import { startFakePaperly } from "./fake-paperly.mjs";
import { wellFormed } from "./helpers.mjs";

test("a Paperly that takes a request and never answers is given up on", async () => {
  const fake = await startFakePaperly({ enabled: true, delay: 60_000 });
  try {
    const paperly = new Paperly({ apiURL: fake.url, timeout: 300 });
    const started = Date.now();
    await assert.rejects(paperly.get("items/top"), (e) => {
      assert.ok(e instanceof ToolError);
      assert.match(e.message, /^Paperly is not responding: .* within 0\.3 seconds/);
      return true;
    });
    assert.ok(Date.now() - started < 5000);
  } finally {
    await fake.close();
  }
});

test("an answer that is slow to arrive is given up on too", async () => {
  // Headers at once, then a body that never ends
  const paperly = new Paperly({
    timeout: 300,
    fetch: async (url, { signal }) => {
      const body = new ReadableStream({
        start(controller) {
          signal.addEventListener("abort", () => controller.error(signal.reason));
        },
      });
      return new Response(body, { status: 200 });
    },
  });
  await assert.rejects(paperly.get("items"), /^Error: Paperly is not responding/);
});

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
