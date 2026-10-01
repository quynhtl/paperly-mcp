// A stand-in for Paperly's local API with a small library in it, enough to
// exercise every tool. Answers as the real one does: JSON for data, HTML for
// format=bib, 404 for unknown keys, 403 when the API is "turned off".
import http from "node:http";

const pdfText = Array.from({ length: 2500 }, (_, i) => `Sentence ${i} of the paper about attention.`).join(" ");
// A character past U+FFFF (two UTF-16 units) across position 1000
export const MATH_X = String.fromCodePoint(0x1d465);
const mathText = `${"x".repeat(999)}${MATH_X}${"y".repeat(1500)}`;

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

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
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
    if (path === "items/top") {
      const query = (q.get("q") || "").toLowerCase();
      let items = LIBRARY.items.filter(isTop).filter((item) =>
        [item.data.title, item.data.date, ...(item.data.creators || []).map((c) => c.lastName)]
          .join(" ")
          .toLowerCase()
          .includes(query),
      );
      if (q.get("itemType")) items = items.filter((i) => i.data.itemType === q.get("itemType"));
      return json(res, 200, items.slice(0, Number(q.get("limit")) || 25));
    }
    if (path === "items" && q.get("format") === "bib") {
      const keys = (q.get("itemKey") || "").split(",");
      const items = LIBRARY.items.filter((i) => keys.includes(i.key));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<div class="csl-bib-body">${items
          .map((i) => `<div class="csl-entry">${i.data.creators[0].lastName}, ${i.data.title} (${q.get("style")}).</div>`)
          .join("")}</div>`,
      );
      return;
    }
    if ((m = /^items\/([A-Z0-9]{8})\/children$/.exec(path))) {
      return json(res, 200, LIBRARY.items.filter((i) => i.data.parentItem === m[1]));
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
      return json(res, 200, LIBRARY.collections);
    }
    if ((m = /^collections\/([A-Z0-9]{8})\/items\/top$/.exec(path))) {
      if (!LIBRARY.collections.some((c) => c.key === m[1])) return json(res, 404, "Not found");
      return json(res, 200, LIBRARY.items.filter((i) => isTop(i) && i.data.collections?.includes(m[1])));
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
