// A stand-in for Paperly's local API with a small library in it, enough to
// exercise every tool. Answers as the real one does, quirks included: JSON for
// data, HTML for format=bib, 404 for an unknown item or collection, 403 when
// the API is "turned off".
import http from "node:http";

const pdfText = `${Array.from({ length: 2500 }, (_, i) => `Sentence ${i} of the paper about attention.`).join(" ")} Positions are encoded with sinusoids.`;
// A character past U+FFFF (two UTF-16 units) across position 1000
export const MATH_X = String.fromCodePoint(0x1d465);
const mathText = `${"x".repeat(999)}${MATH_X}${"y".repeat(1500)}`;

// A book read closely: more highlights than fit in one answer, and notes, one
// of them longer than an answer on its own
export const BOOK_HIGHLIGHTS = 300;
export const BOOK_PARAGRAPHS = 1000;
const bookHighlights = Array.from({ length: BOOK_HIGHLIGHTS }, (_, i) => {
  const key = `HL${String(i).padStart(6, "0")}`;
  return {
    key,
    meta: {},
    data: {
      key,
      itemType: "annotation",
      parentItem: "EPUB0001",
      annotationType: "highlight",
      annotationText: `Highlight ${i}: ${"words ".repeat(30)}`,
      annotationColor: "#ffd400",
      annotationPageLabel: String(i + 1),
      annotationSortIndex: `${String(i).padStart(5, "0")}|00000000`,
      tags: [],
    },
  };
});
const paragraphs = (label, count) =>
  Array.from({ length: count }, (_, i) => `<p>${label} ${i}: ${"text ".repeat(20)}</p>`).join("");

export const LIBRARY = {
  items: [
    {
      key: "ATTN0001",
      meta: { parsedDate: "2017-06-12", numChildren: 2 },
      data: {
        key: "ATTN0001",
        itemType: "journalArticle",
        title: "Attention Is All You Need",
        creators: [
          { creatorType: "author", firstName: "Ashish", lastName: "Vaswani" },
          { creatorType: "author", firstName: "Noam", lastName: "Shazeer" },
          { creatorType: "author", firstName: "Niki", lastName: "Parmar" },
          { creatorType: "author", firstName: "Jakob", lastName: "Uszkoreit" },
        ],
        date: "2017-06-12",
        publicationTitle: "Advances in Neural Information Processing Systems",
        DOI: "10.48550/arXiv.1706.03762",
        abstractNote: "The dominant sequence transduction models are based on recurrent networks.",
        tags: [{ tag: "transformers" }],
        collections: ["THES0001"],
      },
    },
    {
      key: "PDF00001",
      meta: {},
      data: {
        key: "PDF00001",
        itemType: "attachment",
        parentItem: "ATTN0001",
        title: "Full Text PDF",
        contentType: "application/pdf",
        linkMode: "imported_url",
      },
    },
    {
      key: "NOTE0001",
      meta: {},
      data: {
        key: "NOTE0001",
        itemType: "note",
        parentItem: "ATTN0001",
        note: "<h1>Why it matters</h1><p>No recurrence &amp; no convolution.</p><ul><li>Faster</li><li>Parallel</li></ul>",
      },
    },
    {
      key: "ANNO0002",
      meta: {},
      data: {
        key: "ANNO0002",
        itemType: "annotation",
        parentItem: "PDF00001",
        annotationType: "highlight",
        annotationText: "multi-head attention",
        annotationComment: "key idea",
        annotationColor: "#ffd400",
        annotationPageLabel: "4",
        annotationSortIndex: "00003|000200|00100",
        tags: [],
      },
    },
    {
      key: "ANNO0001",
      meta: {},
      data: {
        key: "ANNO0001",
        itemType: "annotation",
        parentItem: "PDF00001",
        annotationType: "highlight",
        annotationText: "The Transformer",
        annotationColor: "#5fb236",
        annotationPageLabel: "1",
        annotationSortIndex: "00000|000100|00100",
        tags: [{ tag: "core" }],
      },
    },
    {
      key: "MATH0001",
      meta: { parsedDate: "2020", numChildren: 1 },
      data: {
        key: "MATH0001",
        itemType: "journalArticle",
        title: "Notation for Variables",
        creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }],
        date: "2020",
        tags: [],
        collections: [],
      },
    },
    {
      key: "PDF00002",
      meta: {},
      data: {
        key: "PDF00002",
        itemType: "attachment",
        parentItem: "MATH0001",
        title: "Full Text PDF",
        contentType: "application/pdf",
        linkMode: "imported_file",
      },
    },
    {
      key: "SOLO0001",
      meta: { numChildren: 1 },
      data: {
        key: "SOLO0001",
        itemType: "attachment",
        title: "Scanned chapter",
        contentType: "application/pdf",
        linkMode: "imported_file",
        tags: [],
        collections: [],
      },
    },
    {
      key: "ANNO0003",
      meta: {},
      data: {
        key: "ANNO0003",
        itemType: "annotation",
        parentItem: "SOLO0001",
        annotationType: "underline",
        annotationText: "gradient descent",
        annotationColor: "#2ea8e5",
        annotationPageLabel: "12",
        annotationSortIndex: "00011|000300|00200",
        tags: [],
      },
    },
    {
      key: "LONG0001",
      meta: { parsedDate: "1913", numChildren: 4 },
      data: {
        key: "LONG0001",
        itemType: "book",
        title: "Swann's Way",
        creators: [{ creatorType: "author", firstName: "Marcel", lastName: "Proust" }],
        date: "1913",
        tags: [],
        collections: [],
      },
    },
    {
      key: "EPUB0001",
      meta: {},
      data: {
        key: "EPUB0001",
        itemType: "attachment",
        parentItem: "LONG0001",
        title: "EPUB",
        contentType: "application/epub+zip",
        linkMode: "imported_file",
      },
    },
    ...bookHighlights,
    // Made with "Add Note from Annotations": about 115,000 characters
    { key: "NOTE0002", meta: {}, data: { key: "NOTE0002", itemType: "note", parentItem: "LONG0001", note: paragraphs("Paragraph", BOOK_PARAGRAPHS) } },
    // About 25,000 characters: too long to share a page with the end of the first
    { key: "NOTE0003", meta: {}, data: { key: "NOTE0003", itemType: "note", parentItem: "LONG0001", note: paragraphs("Second", 200) } },
    { key: "NOTE0004", meta: {}, data: { key: "NOTE0004", itemType: "note", parentItem: "LONG0001", note: "<p>Reread the madeleine scene.</p>" } },
    {
      key: "BOOK0001",
      meta: { parsedDate: "2016", numChildren: 0 },
      data: {
        key: "BOOK0001",
        itemType: "book",
        title: "Deep Learning",
        creators: [
          { creatorType: "author", firstName: "Ian", lastName: "Goodfellow" },
          { creatorType: "author", firstName: "Yoshua", lastName: "Bengio" },
        ],
        date: "2016",
        publisher: "MIT Press",
        tags: [],
        collections: [],
      },
    },
  ],
  fulltext: {
    PDF00001: { content: pdfText, indexedPages: 15, totalPages: 15 },
    PDF00002: { content: mathText, indexedPages: 1, totalPages: 1 },
  },
  collections: [
    { key: "THES0001", meta: { numItems: 1 }, data: { key: "THES0001", name: "Thesis", parentCollection: false } },
    { key: "CHAP0002", meta: { numItems: 0 }, data: { key: "CHAP0002", name: "Chapter 2", parentCollection: "THES0001" } },
  ],
};

const isTop = (item) => !item.data.parentItem;
const isRegular = (item) => !["attachment", "note", "annotation"].includes(item.data.itemType);

/**
 * A set of items with what a search scope "including children" adds to it:
 * their files and notes, and the annotations on those files, or on the items
 * themselves when they are files (Zotero.Search.prototype.search).
 */
function withChildren(items) {
  const keys = new Set(items.map((i) => i.key));
  const parent = (i) => LIBRARY.items.find((p) => p.key === i.data.parentItem);
  return LIBRARY.items.filter(
    (i) =>
      keys.has(i.key) ||
      keys.has(i.data.parentItem) ||
      (i.data.itemType === "annotation" && keys.has(parent(i)?.data.parentItem)),
  );
}

// What a quick search looks at in one item. "everything" matches each item on
// its own: a note by its text, an annotation by its text and comment, a file
// by the text extracted from it -- and so finds the child, not its parent.
function searchedText(item, mode) {
  const d = item.data;
  const fields = [d.title, d.date, ...(d.creators || []).flatMap((c) => [c.firstName, c.lastName])];
  if (mode === "everything") {
    fields.push(d.publicationTitle, d.abstractNote, d.publisher, d.DOI, ...(d.tags || []).map((t) => t.tag));
    fields.push(d.note?.replace(/<[^>]+>/g, " "), d.annotationText, d.annotationComment, LIBRARY.fulltext[item.key]?.content);
  }
  return fields.filter(Boolean).join(" ").toLowerCase();
}

/** items and items/top, searched the way LocalAPI.Items builds its search. */
function searchItems(top, q) {
  let items = LIBRARY.items.filter((i) => !top || isTop(i));
  if (q.get("itemKey")) {
    const keys = q.get("itemKey").split(",");
    const scope = withChildren(LIBRARY.items.filter((i) => keys.includes(i.key)));
    items = items.filter((i) => scope.includes(i));
  }
  if (q.get("q")) {
    const mode = q.get("qmode") || "titleCreatorYear";
    const words = q.get("q").toLowerCase().split(/\s+/);
    // Each word may match a different field, but all of them the same item
    let matches = LIBRARY.items.filter((i) => words.every((word) => searchedText(i, mode).includes(word)));
    if (mode === "titleCreatorYear") {
      matches = matches.filter(isTop);
    }
    // items/top keeps only the matches that are top-level; items also adds the
    // files and notes of each match, but never the parent of a child that matched
    const children = LIBRARY.items.filter(
      (i) => i.data.itemType !== "annotation" && matches.some((m) => m.key === i.data.parentItem),
    );
    const found = top ? matches : [...matches, ...children];
    items = items.filter((i) => found.includes(i));
  }
  // itemType and tag each narrow the search through a scope that includes
  // children, so a child of an item found so far can come back too
  if (q.get("itemType")) {
    items = withChildren(items).filter((i) => i.data.itemType === q.get("itemType"));
  }
  if (q.get("tag")) {
    items = withChildren(items).filter((i) => (i.data.tags || []).some((t) => t.tag === q.get("tag")));
  }
  return items;
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * A list the way the local API sends one: sorted, then cut to `start` and
 * `limit`. Without a limit it sends everything. (Its default sort,
 * dateModified, is the order here, since nothing in the fake has a date
 * modified.)
 */
function list(res, objects, q) {
  const sort = q.get("sort");
  if (sort === "title" || sort === "date") {
    const direction = (q.get("direction") || (sort === "date" ? "desc" : "asc")) === "desc" ? -1 : 1;
    const field = (o) => o.data[sort] || "";
    objects = [...objects].sort((a, b) => (field(a) < field(b) ? -direction : field(a) > field(b) ? direction : 0));
  }
  const start = Number(q.get("start")) || 0;
  const limit = Number(q.get("limit")) || objects.length - start;
  json(res, 200, objects.slice(start, start + limit));
}

/** Starts the fake on a free port. `options.enabled = false` answers 403, as Paperly does with the API off. */
export function startFakePaperly(options = { enabled: true }) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    requests.push(url);
    if (!options.enabled) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Local API is not enabled");
      return;
    }
    const path = url.pathname.replace(/^\/api\/users\/0\//, "");
    const q = url.searchParams;
    let m;
    if ((path === "items" || path === "items/top") && q.get("format") === "bib") {
      // Only regular items have a reference
      const items = searchItems(path === "items/top", q).filter(isRegular);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<div class="csl-bib-body">${items
          .map((i) => `<div class="csl-entry">${i.data.creators[0].lastName}, ${i.data.title} (${q.get("style")}).</div>`)
          .join("")}</div>`,
      );
      return;
    }
    if (path === "items" || path === "items/top") {
      return list(res, searchItems(path === "items/top", q), q);
    }
    if ((m = /^items\/([A-Z0-9]{8})\/children$/.exec(path))) {
      // Files and notes: an annotation is no child of its file here
      return list(res, LIBRARY.items.filter((i) => i.data.parentItem === m[1] && i.data.itemType !== "annotation"), q);
    }
    if ((m = /^items\/([A-Z0-9]{8})\/fulltext$/.exec(path))) {
      const fulltext = LIBRARY.fulltext[m[1]];
      return fulltext ? json(res, 200, fulltext) : json(res, 404, "Not found");
    }
    if ((m = /^items\/([A-Z0-9]{8})$/.exec(path))) {
      const item = LIBRARY.items.find((i) => i.key === m[1]);
      if (!item) return json(res, 404, "Not found");
      const include = (q.get("include") || "data").split(",");
      const body = { ...item };
      if (include.includes("bib")) {
        body.bib = `<div class="csl-entry">${item.data.title}. (${q.get("style") || "default"})</div>`;
      }
      return json(res, 200, body);
    }
    if (path === "collections") {
      return list(res, LIBRARY.collections, q);
    }
    if ((m = /^collections\/([A-Z0-9]{8})$/.exec(path))) {
      const collection = LIBRARY.collections.find((c) => c.key === m[1]);
      return collection ? json(res, 200, collection) : json(res, 404, "Not found");
    }
    if ((m = /^collections\/([A-Z0-9]{8})\/items\/top$/.exec(path))) {
      // Paperly drops the condition on a collection it cannot find, and so lists
      // every top-level item in the library
      const known = LIBRARY.collections.some((c) => c.key === m[1]);
      return list(res, LIBRARY.items.filter((i) => isTop(i) && (!known || i.data.collections?.includes(m[1]))), q);
    }
    json(res, 404, "Not found");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/api/`, requests, options, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
