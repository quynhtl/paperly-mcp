import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer, ToolError } from "../server/mcp.mjs";
import { Paperly } from "../server/paperly.mjs";
import { addTools } from "../server/tools.mjs";
import { LIBRARY, startFakePaperly } from "./fake-paperly.mjs";
import { wellFormed } from "./helpers.mjs";

test("a Paperly that takes a request and never answers is given up on", async () => {
  const fake = await startFakePaperly({ enabled: true, delay: 60_000 });
  try {
    const paperly = new Paperly({ apiURL: fake.url, timeout: 300 });
    const started = Date.now();
    await assert.rejects(paperly.get("items/top"), (e) => {
      assert.ok(e instanceof ToolError);
      assert.match(e.message, /^Paperly took the request but did not answer within 0\.3 seconds\. It may only be busy/);
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
  // AbortSignal.timeout's timer does not keep Node running, and with no
  // socket open nothing else here does: Node 18 and 20 would end the test
  // before the timeout fired
  const alive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(paperly.get("items"), /^Error: Paperly took the request but did not answer/);
  } finally {
    clearInterval(alive);
  }
});

test("a request that names a citation style waits out Paperly's download of it", async () => {
  // Paperly allows itself 30 seconds for each of two downloads
  assert.equal(new Paperly().timeout, 60_000);
  assert.equal(new Paperly().styleTimeout, 90_000);
  const fake = await startFakePaperly({ enabled: true, delay: 600 });
  try {
    const paperly = new Paperly({ apiURL: fake.url, timeout: 300, styleTimeout: 3000 });
    const item = await paperly.item("ATTN0001", { style: "harvard-anglia-ruskin-university" });
    assert.match(item.bib, /harvard-anglia-ruskin-university/);
    const bibliography = await paperly.bibliography(["ATTN0001"], { style: "nature" });
    assert.match(bibliography, /Vaswani/);
    await assert.rejects(paperly.collections(), /within 0\.3 seconds/);
  } finally {
    await fake.close();
  }
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

test("a search traces only so many files to their items, and says how many it left", async () => {
  const fake = await startFakePaperly();
  try {
    const paperly = new Paperly({ apiURL: fake.url, fileLimit: 1 });
    // Both PDFs are titled "Full Text PDF", and neither paper matches on its own
    const { items, untraced } = await paperly.search({ query: "full text pdf", mode: "everything" });
    assert.equal(items.length, 1);
    assert.equal(untraced, 1);
    assert.equal(fake.hashed.length, 1);

    const server = new McpServer({ name: "test", log: () => {} });
    addTools(server, paperly);
    const { content } = await server.call({ name: "search_library", arguments: { query: "full text pdf", mode: "everything" } });
    assert.match(
      content[0].text,
      /^1 item\(s\) match “full text pdf”:\n\[[A-Z0-9]{8}\] .*\n\n\(The words are also in the text or highlights of 1 more file\(s\), not traced/,
    );
  } finally {
    await fake.close();
  }
});

test("a filter that also finds every paper's PDF has Paperly read none of them", async () => {
  // 200 papers with the words in their titles, each with a stored PDF, and one PDF on its own
  const item = (key, data) => ({ key, meta: {}, data: { key, tags: [], ...data } });
  const added = [];
  for (let i = 0; i < 200; i++) {
    const n = String(i).padStart(6, "0");
    added.push(
      item(`QP${n}`, { itemType: "journalArticle", title: `Quantum paper ${i}`, date: "2021" }),
      item(`QF${n}`, { itemType: "attachment", parentItem: `QP${n}`, title: "Full Text PDF", linkMode: "imported_url" }),
    );
  }
  added.push(item("QS000001", { itemType: "attachment", title: "Quantum notes", linkMode: "imported_file" }));
  const length = LIBRARY.items.length;
  LIBRARY.items.push(...added);
  const fake = await startFakePaperly();
  try {
    const paperly = new Paperly({ apiURL: fake.url });
    const { items } = await paperly.search({ query: "quantum", mode: "everything", limit: 5, itemType: "attachment" });
    assert.deepEqual(items.map((item) => item.key), ["QS000001"]);
    // The PDF the answer lists, and none of the 200 that belong to the papers
    assert.deepEqual(fake.hashed, ["QS000001"]);
    // However many children the filter finds, they are dropped in one list of keys
    assert.ok(fake.requests.length <= 6, fake.requests.join("\n"));
  } finally {
    LIBRARY.items.splice(length);
    await fake.close();
  }
});
