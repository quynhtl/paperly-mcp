import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BOOK_HIGHLIGHTS, BOOK_PARAGRAPHS, MATH_X, startFakePaperly } from "./fake-paperly.mjs";
import { startServer } from "./client.mjs";
import { wellFormed } from "./helpers.mjs";

const manifest = JSON.parse(readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8"));

describe("the protocol", () => {
  let fake, server;
  before(async () => {
    fake = await startFakePaperly();
    server = startServer({ PAPERLY_API_URL: fake.url });
  });
  after(async () => {
    await server.close();
    await fake.close();
  });

  test("initialize agrees on a protocol version and says what the server is", async () => {
    const { result } = await server.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    assert.equal(result.protocolVersion, "2025-06-18");
    assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
    assert.equal(result.serverInfo.name, "paperly");
    assert.equal(result.serverInfo.version, manifest.version);
    assert.match(result.instructions, /search_library/);
    // A style download installs a style; it is said, not hidden
    assert.match(result.instructions, /zotero\.org\/styles/);
    server.notify("notifications/initialized");
  });

  test("a version the server does not know gets its newest", async () => {
    const { result } = await server.request("initialize", { protocolVersion: "1999-01-01", capabilities: {} });
    assert.equal(result.protocolVersion, "2025-11-25");
  });

  test("every tool is listed, described, and read-only", async () => {
    const { result } = await server.request("tools/list", {});
    const names = result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "format_bibliography",
      "get_annotations",
      "get_collection_items",
      "get_fulltext",
      "get_item",
      "get_notes",
      "list_collections",
      "search_library",
    ]);
    for (const tool of result.tools) {
      assert.ok(tool.title && tool.description, tool.name);
      assert.equal(tool.inputSchema.type, "object", tool.name);
      assert.equal(tool.annotations.readOnlyHint, true, tool.name);
      assert.equal(tool.annotations.title, tool.title, tool.name);
      // Only a citation style Paperly doesn't have yet reaches past this computer
      const fetchesStyles = tool.name === "get_item" || tool.name === "format_bibliography";
      assert.equal(tool.annotations.openWorldHint, fetchesStyles, tool.name);
      assert.equal(/zotero\.org\/styles/.test(tool.description), fetchesStyles, tool.name);
    }
  });

  test("ping, unknown methods and unknown tools", async () => {
    assert.deepEqual((await server.request("ping")).result, {});
    assert.equal((await server.request("resources/list")).error.code, -32601);
    assert.equal((await server.request("tools/call", { name: "delete_everything", arguments: {} })).error.code, -32602);
  });

  test("a line that is not JSON gets a parse error, and the server carries on", async () => {
    const response = await server.raw("{ not json");
    assert.equal(response.error.code, -32700);
    assert.deepEqual((await server.request("ping")).result, {});
  });

  test("arguments are checked before anything reaches Paperly", async () => {
    const before = fake.requests.length;
    const missing = await server.call("get_item", {});
    assert.equal(missing.isError, true);
    assert.match(missing.text, /"key" is required/);
    const badKey = await server.call("get_item", { key: "../../etc" });
    assert.equal(badKey.isError, true);
    const extra = await server.call("search_library", { query: "x", delete: true });
    assert.match(extra.text, /not an argument/);
    assert.equal(fake.requests.length, before);
  });

  test("a citation style is a style's id, never an address Paperly would fetch it from", async () => {
    const before = fake.requests.length;
    for (const style of ["https://evil.example/x.csl?d=notes", "//evil.example/apa", "apa/../x", "APA", "apa.csl"]) {
      const item = await server.call("get_item", { key: "ATTN0001", style });
      assert.equal(item.isError, true, style);
      assert.match(item.text, /"style" is not in the expected format/);
      const bibliography = await server.call("format_bibliography", { keys: ["ATTN0001"], style });
      assert.equal(bibliography.isError, true, style);
    }
    for (const locale of ["../x", "en_US", "https://evil.example"]) {
      const bibliography = await server.call("format_bibliography", { keys: ["ATTN0001"], locale });
      assert.match(bibliography.text, /"locale" is not in the expected format/, locale);
    }
    assert.equal(fake.requests.length, before);
    const fine = await server.call("format_bibliography", { keys: ["ATTN0001"], style: "chicago-author-date", locale: "vi-VN" });
    assert.equal(fine.isError, false);
    assert.equal(fake.requests.at(-1).searchParams.get("style"), "chicago-author-date");
    assert.equal(fake.requests.at(-1).searchParams.get("locale"), "vi-VN");
  });
});

describe("the tools", () => {
  let fake, server;
  before(async () => {
    fake = await startFakePaperly();
    server = startServer({ PAPERLY_API_URL: fake.url });
    await server.request("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  });
  after(async () => {
    await server.close();
    await fake.close();
  });

  test("search_library lists matches with their keys", async () => {
    const { text, isError } = await server.call("search_library", { query: "attention" });
    assert.equal(isError, false);
    assert.match(text, /^1 item\(s\) match/);
    assert.match(text, /\[ATTN0001\] Attention Is All You Need — Vaswani et al\., 2017/);
    assert.match(text, /doi:10\.48550/);
    assert.equal(fake.requests.at(-1).searchParams.get("qmode"), "titleCreatorYear");

    const none = await server.call("search_library", { query: "quantum", mode: "everything" });
    assert.match(none.text, /Nothing in the library matches/);
    assert.equal(fake.requests.at(-1).searchParams.get("qmode"), "everything");
  });

  test("search_library finds the item whose PDF, note or highlight has the words", async () => {
    const search = async (args) => (await server.call("search_library", { mode: "everything", ...args })).text;
    // Only in the PDF's full text
    assert.match(await search({ query: "sinusoids" }), /^1 item\(s\) match “sinusoids”:\n\[ATTN0001\] Attention Is All You Need/);
    // Only in a child note
    assert.match(await search({ query: "madeleine" }), /^1 item\(s\) match “madeleine”:\n\[LONG0001\] Swann's Way/);
    // Only in an annotation, whose file is the paper's child...
    assert.match(await search({ query: "multi-head" }), /^1 item\(s\) match “multi-head”:\n\[ATTN0001\]/);
    assert.ok(fake.requests.some((url) => url.searchParams.get("itemKey") === "PDF00001"));
    // ... or stands alone
    assert.match(await search({ query: "gradient descent" }), /^1 item\(s\) match “gradient descent”:\n\[SOLO0001\] Scanned chapter/);
    // A paper is listed once, however many of its parts match
    assert.match(await search({ query: "words" }), /^1 item\(s\) match “words”:\n\[LONG0001\]/);
    assert.match(await search({ query: "attention" }), /^1 item\(s\) match/);
  });

  test("search_library has Paperly read no file it does not need to", async () => {
    // Paperly reads a stored file whole for its MD5 hash whenever it describes one
    const hashedBy = async (query) => {
      const before = fake.hashed.length;
      const requests = fake.requests.length;
      const { isError } = await server.call("search_library", { query, mode: "everything" });
      assert.equal(isError, false);
      // The matches themselves only ever come back as keys
      for (const url of fake.requests.slice(requests).filter((u) => u.searchParams.has("q"))) {
        assert.equal(url.searchParams.get("format"), "keys", url.search);
      }
      return fake.hashed.slice(before);
    };
    // The paper matches by its title, so its PDF, though its text matches too, is not described
    assert.deepEqual(await hashedBy("attention"), []);
    // Only the PDF's text matches: that file, to learn whose it is
    assert.deepEqual(await hashedBy("sinusoids"), ["PDF00001"]);
    // 300 highlights in one book: their file, once
    assert.deepEqual(await hashedBy("words"), ["EPUB0001"]);
    // A note names its item itself
    assert.deepEqual(await hashedBy("madeleine"), []);
  });

  test("search_library filters and orders what everything finds by the items themselves", async () => {
    const search = async (args) => (await server.call("search_library", { mode: "everything", ...args })).text;
    // Both PDFs are titled "Full Text PDF": newest paper first
    const both = await search({ query: "full text pdf" });
    assert.match(both, /^2 item\(s\) match .*\n\[MATH0001\] .*\n\[ATTN0001\] /);
    // Paperly describes the items of the answer and nothing else
    assert.equal(fake.requests.at(-1).pathname, "/api/users/0/items/top");
    assert.equal(fake.requests.at(-1).searchParams.get("sort"), "date");
    assert.equal(fake.requests.at(-1).searchParams.get("itemKey"), "MATH0001,ATTN0001");
    assert.match(await search({ query: "full text pdf", limit: 1 }), /^1 item\(s\) match .*\n\[MATH0001\] /);
    assert.equal(fake.requests.at(-1).searchParams.get("itemKey"), "MATH0001");

    // A filter also finds the files, notes and highlights of the items it
    // narrows: the filtered list only ever comes back as keys, so Paperly
    // reads none of those files, and none of them is listed
    const filtered = async (args) => {
      const requests = fake.requests.length;
      const hashed = fake.hashed.length;
      const text = await search(args);
      for (const url of fake.requests.slice(requests).filter((u) => u.searchParams.get("sort") === "date")) {
        const filter = url.searchParams.has("itemType") || url.searchParams.has("tag");
        assert.equal(url.searchParams.get("format"), filter ? "keys" : null, url.search);
      }
      return { text, hashed: fake.hashed.slice(hashed) };
    };
    // Both papers have a stored PDF, and only those PDFs have the words: Paperly
    // reads them once, to learn whose they are, and no more
    const files = await filtered({ query: "full text pdf", limit: 1, itemType: "attachment" });
    assert.match(files.text, /Nothing in the library matches/);
    assert.deepEqual(files.hashed, ["PDF00001", "PDF00002"]);
    // A file that stands alone is an item: it alone is read, for its line in the answer
    const solo = await filtered({ query: "an", itemType: "attachment" });
    assert.match(solo.text, /^1 item\(s\) match “an”:\n\[SOLO0001\] Scanned chapter/);
    assert.deepEqual(solo.hashed, ["SOLO0001"]);
    assert.match(await search({ query: "full text pdf", itemType: "book" }), /Nothing in the library matches/);
    assert.match(await search({ query: "transformer", tag: "transformers" }), /\n\[ATTN0001\] /);
    // The tag is on the paper's highlight, not on the paper, which is what the filter is for
    assert.match(await search({ query: "transformer", tag: "core" }), /Nothing in the library matches/);
  });

  test("get_item gives fields, the reference, attachments and notes", async () => {
    const { text } = await server.call("get_item", { key: "ATTN0001", style: "ieee" });
    assert.match(text, /^# Attention Is All You Need/);
    assert.match(text, /Creators: Ashish Vaswani \(author\); Noam Shazeer/);
    assert.match(text, /DOI: 10\.48550/);
    assert.match(text, /Reference: Attention Is All You Need\. \(ieee\)/);
    assert.match(text, /Abstract:\nThe dominant/);
    assert.match(text, /- \[PDF00001\] Full Text PDF \(application\/pdf\)/);
    assert.match(text, /Notes: 1/);
  });

  test("get_item says when a key is unknown", async () => {
    const { text, isError } = await server.call("get_item", { key: "NOPE0000" });
    assert.equal(isError, true);
    assert.match(text, /No item in the library has the key NOPE0000/);
  });

  test("get_fulltext reads the PDF in slices", async () => {
    const first = await server.call("get_fulltext", { key: "ATTN0001", length: 1000 });
    assert.match(first.text, /Full text of Full Text PDF \[PDF00001\], characters 0–1000 of \d+; 15 of 15 pages indexed/);
    assert.match(first.text, /offset 1000\.\)$/);
    const last = await server.call("get_fulltext", { key: "PDF00001", offset: 100000, length: 60000 });
    assert.doesNotMatch(last.text, /There is more/);
    const past = await server.call("get_fulltext", { key: "ATTN0001", offset: 10_000_000 });
    assert.equal(past.isError, true);
    const none = await server.call("get_fulltext", { key: "BOOK0001" });
    assert.match(none.text, /has no full text/);
  });

  test("get_fulltext never cuts a character in half", async () => {
    // The 𝑥 takes units 999 and 1000, so a 1000-unit slice stops before it
    const first = await server.call("get_fulltext", { key: "MATH0001", length: 1000 });
    assert.match(first.text, /characters 0–999 of 2501/);
    assert.match(first.text, /offset 999\.\)$/);
    assert.ok(wellFormed(first.text));
    const next = await server.call("get_fulltext", { key: "MATH0001", offset: 999, length: 1000 });
    assert.match(next.text, /characters 999–1999 of 2501/);
    assert.ok(next.text.includes(`\n\n${MATH_X}yyy`));
    // An offset inside the pair starts with the whole character
    const inside = await server.call("get_fulltext", { key: "MATH0001", offset: 1000, length: 1000 });
    assert.match(inside.text, /characters 999–1999 of 2501/);
    assert.ok(wellFormed(inside.text));
  });

  test("get_annotations lists highlights in reading order", async () => {
    const { text } = await server.call("get_annotations", { key: "ATTN0001" });
    const lines = text.split("\n");
    assert.equal(lines[0], "## Full Text PDF [PDF00001]");
    assert.equal(lines[1], "- p. 1, highlight (green): “The Transformer” [tags: core]");
    assert.equal(lines[2], "- p. 4, highlight (yellow): “multi-head attention” — comment: key idea");
    assert.equal(lines.length, 3);
    // Not from the file's children, which never include annotations
    const asked = fake.requests.find((url) => url.searchParams.get("itemType") === "annotation");
    assert.equal(asked.pathname, "/api/users/0/items");
    assert.equal(asked.searchParams.get("itemKey"), "ATTN0001");
  });

  test("get_annotations reads a file's own annotations, and says when there are none", async () => {
    const file = await server.call("get_annotations", { key: "PDF00001" });
    assert.match(file.text, /^## Full Text PDF \[PDF00001\]\n- p\. 1/);
    const standalone = await server.call("get_annotations", { key: "SOLO0001" });
    assert.equal(standalone.text, "## Scanned chapter [SOLO0001]\n- p. 12, underline (blue): “gradient descent”");
    const none = await server.call("get_annotations", { key: "MATH0001" });
    assert.equal(none.text, "There are no highlights or comments on Notation for Variables.");
  });

  test("get_annotations comes in pages of whole annotations", async () => {
    const seen = [];
    let offset = 0;
    for (;;) {
      const { text, isError } = await server.call("get_annotations", { key: "LONG0001", offset });
      assert.equal(isError, false);
      assert.ok(text.length < 40500, `${text.length} characters from offset ${offset}`);
      const next = /\n\n\(There is more: call get_annotations with key LONG0001 and offset (\d+)\.\)$/.exec(text);
      const [heading, ...lines] = (next ? text.slice(0, next.index) : text).split("\n");
      // A page that starts inside a file's annotations says so
      assert.equal(heading, offset ? "## EPUB [EPUB0001] (continued)" : "## EPUB [EPUB0001]");
      for (const line of lines) {
        const whole = /^- p\. \d+, highlight \(yellow\): “Highlight (\d+): (?:words ){29}words”$/.exec(line);
        assert.ok(whole, line);
        seen.push(Number(whole[1]));
      }
      if (!next) {
        break;
      }
      offset = Number(next[1]);
      assert.equal(offset, seen.length);
    }
    assert.deepEqual(seen, Array.from({ length: BOOK_HIGHLIGHTS }, (_, i) => i));
    const past = await server.call("get_annotations", { key: "LONG0001", offset: BOOK_HIGHLIGHTS });
    assert.equal(past.isError, true);
    assert.match(past.text, /nothing at offset 300/);
  });

  test("get_notes comes in pages, and cuts a note longer than a page at a line break", async () => {
    const pages = [];
    let offset = 0;
    for (;;) {
      const { text, isError } = await server.call("get_notes", { key: "LONG0001", offset });
      assert.equal(isError, false);
      assert.ok(text.length < 40500, `${text.length} characters from offset ${offset}`);
      const next = /\n\n\(There is more: call get_notes with key LONG0001 and offset (\d+)\.\)$/.exec(text);
      pages.push(next ? text.slice(0, next.index) : text);
      if (!next) {
        break;
      }
      offset = Number(next[1]);
    }
    // The long note on three pages; the next one whole on a page of its own,
    // as it does not fit after the long note's end; and the last after it
    assert.deepEqual(
      pages.map((p) => p.split("\n")[0]),
      ["## Note [NOTE0002]", "## Note [NOTE0002] (continued)", "## Note [NOTE0002] (continued)", "## Note [NOTE0003]"],
    );
    assert.match(pages[3], /\n\n## Note \[NOTE0004\]\nReread the madeleine scene\.$/);
    // Every paragraph of the long note once, and whole
    const lines = pages.join("\n").split("\n").filter((line) => line.startsWith("Paragraph "));
    assert.equal(lines.length, BOOK_PARAGRAPHS);
    lines.forEach((line, i) => assert.match(line, new RegExp(`^Paragraph ${i}: (?:text ){19}text$`)));
  });

  test("get_notes turns HTML notes into text", async () => {
    const { text } = await server.call("get_notes", { key: "ATTN0001" });
    assert.equal(text, "## Note [NOTE0001]\nWhy it matters\nNo recurrence & no convolution.\n• Faster\n• Parallel");
    const none = await server.call("get_notes", { key: "BOOK0001" });
    assert.match(none.text, /Deep Learning has no notes/);
  });

  test("collections are listed nested, and their items one per line", async () => {
    const { text } = await server.call("list_collections", {});
    assert.equal(text, "- Thesis [THES0001] (1 items)\n  - Chapter 2 [CHAP0002] (0 items)");
    // Every collection, however many there are
    assert.equal(fake.requests.at(-1).searchParams.has("limit"), false);
    const items = await server.call("get_collection_items", { key: "THES0001" });
    assert.match(items.text, /^\[ATTN0001\] Attention Is All You Need/);
    const empty = await server.call("get_collection_items", { key: "CHAP0002" });
    assert.equal(empty.text, "The collection is empty.");
    const missing = await server.call("get_collection_items", { key: "NOPE0000" });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /No collection has the key NOPE0000/);
    assert.doesNotMatch(missing.text, /ATTN0001/);
  });

  test("format_bibliography asks Paperly for the style", async () => {
    const { text } = await server.call("format_bibliography", { keys: ["ATTN0001", "BOOK0001"], style: "nature" });
    assert.equal(text, "Vaswani, Attention Is All You Need (nature).\nGoodfellow, Deep Learning (nature).");
    assert.equal(fake.requests.at(-1).searchParams.get("itemKey"), "ATTN0001,BOOK0001");
  });
});

describe("a slow Paperly", () => {
  let fake;
  before(async () => {
    fake = await startFakePaperly({ enabled: true, delay: 500 });
  });
  after(() => fake.close());

  test("holds up no message but the ones waiting on it", { timeout: 10000 }, async () => {
    const server = startServer({ PAPERLY_API_URL: fake.url });
    try {
      const answered = [];
      const item = server.call("get_item", { key: "ATTN0001" }).then((r) => answered.push("get_item") && r);
      const ping = server.request("ping").then((r) => answered.push("ping") && r);
      assert.deepEqual((await ping).result, {});
      assert.match((await item).text, /^# Attention Is All You Need/);
      assert.deepEqual(answered, ["ping", "get_item"]);
    } finally {
      await server.close();
    }
  });

  test("still gets its answers out when the input ends", { timeout: 10000 }, async () => {
    const server = startServer({ PAPERLY_API_URL: fake.url });
    const item = server.call("get_item", { key: "ATTN0001" });
    const closed = server.close();
    assert.match((await item).text, /^# Attention Is All You Need/);
    await closed;
  });
});

describe("when Paperly can't be reached", () => {
  test("a closed Paperly and a switched-off API each say what to do", async () => {
    const fake = await startFakePaperly({ enabled: false });
    const off = startServer({ PAPERLY_API_URL: fake.url });
    const disabled = await off.call("search_library", { query: "x" });
    assert.equal(disabled.isError, true);
    assert.match(disabled.text, /Settings → Advanced/);
    await off.close();
    await fake.close();

    // Nothing listens on the port the fake just gave up
    const closed = startServer({ PAPERLY_API_URL: fake.url });
    const notRunning = await closed.call("search_library", { query: "x" });
    assert.match(notRunning.text, /Make sure Paperly is open/);
    await closed.close();
  });
});
