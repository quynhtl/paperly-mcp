import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToText, shortCreators } from "../server/text.mjs";
import { checkArguments } from "../server/mcp.mjs";

test("HTML keeps its words and line breaks, and loses its tags", () => {
  assert.equal(htmlToText("<p>a &amp; b</p><p>c&nbsp;d &#8212; &#x2014;</p>"), "a & b\nc d — —");
  assert.equal(htmlToText("<script>alert(1)</script><b>bold</b><br>next"), "bold\nnext");
  assert.equal(htmlToText(null), "");
});

test("a numeric reference that is no character reads as U+FFFD, as in a browser", () => {
  assert.equal(htmlToText("<p>&#x1D465; &#119909;</p>"), "𝑥 𝑥");
  assert.equal(htmlToText("<p>a &#x110000; b &#99999999999999999999; c</p>"), "a \ufffd b \ufffd c");
  // Half a surrogate pair would leave a string that is not well-formed
  assert.equal(htmlToText("&#xD835;&#56421;"), "\ufffd\ufffd");
  // Only digits make a number
  assert.equal(htmlToText("&#12ab; &#x;"), "&#12ab; &#x;");
});

test("creators shorten the way a reference list would", () => {
  const people = (...names) => names.map((lastName) => ({ creatorType: "author", lastName }));
  assert.equal(shortCreators(people("Smith")), "Smith");
  assert.equal(shortCreators(people("Smith", "Jones")), "Smith and Jones");
  assert.equal(shortCreators(people("Smith", "Jones", "Lee")), "Smith, Jones and Lee");
  assert.equal(shortCreators(people("A", "B", "C", "D")), "A et al.");
  assert.equal(shortCreators([{ creatorType: "editor", name: "WHO" }]), "WHO");
  assert.equal(shortCreators([]), "");
});

test("argument checks cover the schema features the tools use", () => {
  const schema = {
    type: "object",
    properties: {
      key: { type: "string", pattern: "^[A-Z0-9]{8}$" },
      mode: { type: "string", enum: ["a", "b"] },
      limit: { type: "integer", minimum: 1, maximum: 5 },
      keys: { type: "array", items: { type: "string", pattern: "^[A-Z]+$" }, minItems: 1, maxItems: 2 },
    },
    required: ["key"],
    additionalProperties: false,
  };
  assert.equal(checkArguments(schema, { key: "ABCD1234" }), null);
  assert.match(checkArguments(schema, {}), /required/);
  assert.match(checkArguments(schema, { key: "abc" }), /format/);
  assert.match(checkArguments(schema, { key: "ABCD1234", mode: "c" }), /one of/);
  assert.match(checkArguments(schema, { key: "ABCD1234", limit: 9 }), /at most 5/);
  assert.match(checkArguments(schema, { key: "ABCD1234", limit: 1.5 }), /whole number/);
  assert.match(checkArguments(schema, { key: "ABCD1234", keys: [] }), /at least 1/);
  assert.match(checkArguments(schema, { key: "ABCD1234", keys: ["ok", "NO"] }), /keys\[0\]/);
  assert.match(checkArguments(schema, { key: "ABCD1234", other: 1 }), /not an argument/);
  assert.match(checkArguments(schema, "nope"), /object/);
});
