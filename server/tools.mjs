// What Claude can ask of the library. Every tool only reads.
import { ToolError } from "./mcp.mjs";
import { charBoundary, htmlToText, itemDetails, itemLine } from "./text.mjs";

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };

const KEY = {
  type: "string",
  pattern: "^[A-Z0-9]{8}$",
  description: "An item's 8-character key, as shown in [brackets] by search_library",
};

// Full text comes back in slices: long papers would otherwise fill the context
const SLICE = 20000;
const SLICE_MAX = 60000;

// Annotations and notes come back in pages of about this many characters, for
// the same reason: a book highlighted from cover to cover runs far past it
const PAGE = 40000;

// When an item has several files, read the one most likely to be the paper
const FULLTEXT_PREFERENCE = { "application/pdf": 0, "application/epub+zip": 1, "text/html": 2 };

const COLORS = {
  "#ffd400": "yellow",
  "#ff6666": "red",
  "#5fb236": "green",
  "#2ea8e5": "blue",
  "#a28ae5": "purple",
  "#e56eee": "magenta",
  "#f19837": "orange",
  "#aaaaaa": "grey",
};

function ofType(items, type) {
  return (items || []).filter((child) => child.data?.itemType === type);
}

async function requireItem(paperly, key) {
  const item = await paperly.item(key);
  if (!item) {
    throw new ToolError(`No item in the library has the key ${key}. Find keys with search_library.`);
  }
  return item;
}

/** The item itself if it is an attachment, or its attachments, best first. */
async function attachmentsOf(paperly, item) {
  if (item.data.itemType === "attachment") {
    return [item];
  }
  const attachments = ofType(await paperly.children(item.key), "attachment");
  const rank = (a) => FULLTEXT_PREFERENCE[a.data.contentType] ?? 9;
  return attachments.sort((a, b) => rank(a) - rank(b));
}

function annotationLine(annotation) {
  const d = annotation.data;
  const where = d.annotationPageLabel ? `p. ${d.annotationPageLabel}` : "";
  const color = COLORS[(d.annotationColor || "").toLowerCase()];
  const kind = [d.annotationType, color && `(${color})`].filter(Boolean).join(" ");
  const parts = [`- ${[where, kind].filter(Boolean).join(", ")}`];
  if (d.annotationText) {
    parts.push(`: “${d.annotationText.trim()}”`);
  }
  if (d.annotationComment) {
    parts.push(` — comment: ${d.annotationComment.trim()}`);
  }
  if (d.tags?.length) {
    parts.push(` [tags: ${d.tags.map((t) => t.tag).join(", ")}]`);
  }
  return parts.join("");
}

/** Text longer than a page, in pieces that fit: cut at a line break if one is near the end, else anywhere. */
function pieces(text) {
  const parts = [];
  while (text.length > PAGE) {
    const line = text.lastIndexOf("\n", PAGE);
    const cut = line > PAGE / 2 ? line : charBoundary(text, PAGE);
    parts.push(text.slice(0, cut));
    text = text.slice(line === cut ? cut + 1 : cut);
  }
  parts.push(text);
  return parts;
}

/**
 * As many of the entries ({ heading, text }) from `offset` on as fit in a page,
 * whole, each run of them under its heading, with `gap` before a new heading;
 * and, when entries are left, the call that reads on from there.
 */
function page(entries, offset, gap, readOn) {
  if (offset >= entries.length) {
    throw new ToolError(`There is nothing at offset ${offset}; the last offset is ${entries.length - 1}.`);
  }
  const parts = [];
  let size = 0;
  let end = offset;
  for (; end < entries.length; end++) {
    const { heading, text } = entries[end];
    const previous = entries[end - 1]?.heading;
    let part = text;
    if (end === offset) {
      part = `${heading}${previous === heading ? " (continued)" : ""}\n${text}`;
    } else if (heading !== previous) {
      part = `${gap}${heading}\n${text}`;
    }
    // A page always has one entry, however long
    if (end > offset && size + part.length + 1 > PAGE) {
      break;
    }
    parts.push(part);
    size += part.length + 1;
  }
  const more = end < entries.length ? `\n\n(There is more: call ${readOn} and offset ${end}.)` : "";
  return `${parts.join("\n")}${more}`;
}

export function addTools(server, paperly) {
  server.tool({
    name: "search_library",
    title: "Search the Paperly library",
    description:
      "Finds items (papers, books, chapters...) in the user's Paperly library. By default it matches titles, " +
      "authors and years; with mode \"everything\" it also searches notes and the full text of PDFs. Returns one " +
      "line per item, newest first, starting with the item's key in [brackets]; pass that key to the other tools.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 500, description: "Words to look for" },
        mode: {
          type: "string",
          enum: ["titleCreatorYear", "everything"],
          description: "titleCreatorYear (the default) or everything",
        },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "At most this many items (default 15)" },
        itemType: { type: "string", maxLength: 50, description: "Only this item type, such as journalArticle or book" },
        tag: { type: "string", maxLength: 200, description: "Only items with this tag" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    async run({ query, mode, limit = 15, itemType, tag }) {
      const items = await paperly.search({ query, mode, limit, itemType, tag });
      if (!items?.length) {
        return `Nothing in the library matches “${query}”.`;
      }
      return [`${items.length} item(s) match “${query}”:`, ...items.map(itemLine)].join("\n");
    },
  });

  server.tool({
    name: "get_item",
    title: "Get an item's details",
    description:
      "Everything the library holds about one item: its fields, creators, tags, abstract, a formatted reference, " +
      "and what is attached to it (files, notes).",
    inputSchema: {
      type: "object",
      properties: {
        key: KEY,
        style: {
          type: "string",
          maxLength: 200,
          description: "Citation style for the reference, such as apa (the default), chicago-author-date or ieee",
        },
      },
      required: ["key"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    async run({ key, style = "apa" }) {
      const item = await paperly.item(key, { style });
      if (!item) {
        throw new ToolError(`No item in the library has the key ${key}. Find keys with search_library.`);
      }
      const lines = [itemDetails(item)];
      if (item.data.itemType !== "attachment" && item.data.itemType !== "note") {
        const children = await paperly.children(key);
        const attachments = ofType(children, "attachment");
        const notes = ofType(children, "note");
        if (attachments.length) {
          lines.push("", "Attachments:");
          for (const a of attachments) {
            lines.push(`- [${a.key}] ${a.data.title || a.data.filename || "(file)"} (${a.data.contentType || a.data.linkMode})`);
          }
        }
        if (notes.length) {
          lines.push("", `Notes: ${notes.length}; read them with get_notes.`);
        }
      }
      return lines.join("\n");
    },
  });

  server.tool({
    name: "get_fulltext",
    title: "Read an item's full text",
    description:
      "The text Paperly extracted from an item's PDF, EPUB or web page, in slices of up to 20,000 characters. " +
      "Give the item's key (or an attachment's); when there is more, the answer says which offset to ask for next.",
    inputSchema: {
      type: "object",
      properties: {
        key: KEY,
        offset: { type: "integer", minimum: 0, description: "Start at this character (default 0)" },
        length: { type: "integer", minimum: 1000, maximum: SLICE_MAX, description: "Characters to return (default 20000)" },
      },
      required: ["key"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    async run({ key, offset = 0, length = SLICE }) {
      const item = await requireItem(paperly, key);
      let source = null;
      for (const attachment of await attachmentsOf(paperly, item)) {
        const fulltext = await paperly.fulltext(attachment.key);
        if (fulltext?.content) {
          source = { attachment, fulltext };
          break;
        }
      }
      if (!source) {
        throw new ToolError(
          `${item.data.title || key} has no full text in Paperly. It may have no PDF, or the PDF may not be indexed yet.`,
        );
      }
      const { attachment, fulltext } = source;
      const text = fulltext.content;
      const total = text.length;
      if (offset >= total) {
        throw new ToolError(`The text is ${total} characters long, so offset ${offset} is past its end.`);
      }
      // Offsets count UTF-16 units, so either end may fall inside a character
      const start = charBoundary(text, offset);
      const end = charBoundary(text, Math.min(total, start + length));
      const pages = fulltext.totalPages ? `; ${fulltext.indexedPages ?? "?"} of ${fulltext.totalPages} pages indexed` : "";
      const header = `Full text of ${attachment.data.title || attachment.data.filename || "the attachment"} [${attachment.key}], characters ${start}–${end} of ${total}${pages}:`;
      const more = end < total ? `\n\n(There is more: call get_fulltext with key ${key} and offset ${end}.)` : "";
      return `${header}\n\n${text.slice(start, end)}${more}`;
    },
  });

  server.tool({
    name: "get_annotations",
    title: "Get highlights and comments",
    description:
      "The user's highlights, underlines and comments on an item's PDFs and EPUBs, with page numbers, in reading order. " +
      "Many of them come in pages of about 40,000 characters; the answer says which offset to ask for next.",
    inputSchema: {
      type: "object",
      properties: {
        key: KEY,
        offset: { type: "integer", minimum: 0, description: "Where to start, from the previous page's answer (default 0)" },
      },
      required: ["key"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    async run({ key, offset = 0 }) {
      const item = await requireItem(paperly, key);
      // One request for the annotations on all of the item's files
      const annotations = ofType(await paperly.annotations(key), "annotation");
      if (!annotations.length) {
        return `There are no highlights or comments on ${item.data.title || key}.`;
      }
      // Each under its file, the best file first
      const files = await attachmentsOf(paperly, item);
      const fileKeys = new Set([...files.map((a) => a.key), ...annotations.map((a) => a.data.parentItem)]);
      const entries = [];
      for (const fileKey of fileKeys) {
        const own = annotations
          .filter((a) => a.data.parentItem === fileKey)
          .sort((a, b) => String(a.data.annotationSortIndex ?? "").localeCompare(String(b.data.annotationSortIndex ?? "")));
        const file = files.find((a) => a.key === fileKey)?.data ?? {};
        const heading = `## ${file.title || file.filename || "Attachment"} [${fileKey}]`;
        for (const annotation of own) {
          entries.push(...pieces(annotationLine(annotation)).map((text) => ({ heading, text })));
        }
      }
      return page(entries, offset, "", `get_annotations with key ${key}`);
    },
  });

  server.tool({
    name: "get_notes",
    title: "Read an item's notes",
    description:
      "The notes attached to an item, as plain text. Give a note's own key to read just that note. " +
      "Long or many notes come in pages of about 40,000 characters; the answer says which offset to ask for next.",
    inputSchema: {
      type: "object",
      properties: {
        key: KEY,
        offset: { type: "integer", minimum: 0, description: "Where to start, from the previous page's answer (default 0)" },
      },
      required: ["key"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    async run({ key, offset = 0 }) {
      const item = await requireItem(paperly, key);
      const notes = item.data.itemType === "note" ? [item] : ofType(await paperly.children(key), "note");
      if (!notes.length) {
        return `${item.data.title || key} has no notes.`;
      }
      // A note made from every annotation in a book can be longer than a page by itself
      const entries = notes.flatMap((note) =>
        pieces(htmlToText(note.data.note)).map((text) => ({ heading: `## Note [${note.key}]`, text })),
      );
      return page(entries, offset, "\n", `get_notes with key ${key}`);
    },
  });

  server.tool({
    name: "list_collections",
    title: "List collections",
    description: "The library's collections (folders), nested as they are in Paperly, with their keys and sizes.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
    async run() {
      const collections = (await paperly.collections()) || [];
      if (!collections.length) {
        return "The library has no collections.";
      }
      const byParent = new Map();
      for (const c of collections) {
        const parent = c.data.parentCollection || null;
        if (!byParent.has(parent)) {
          byParent.set(parent, []);
        }
        byParent.get(parent).push(c);
      }
      const lines = [];
      const walk = (parent, depth) => {
        const children = (byParent.get(parent) || []).sort((a, b) => a.data.name.localeCompare(b.data.name));
        for (const c of children) {
          const count = c.meta?.numItems;
          lines.push(`${"  ".repeat(depth)}- ${c.data.name} [${c.key}]${count !== undefined ? ` (${count} items)` : ""}`);
          walk(c.key, depth + 1);
        }
      };
      walk(null, 0);
      return lines.join("\n");
    },
  });

  server.tool({
    name: "get_collection_items",
    title: "List a collection's items",
    description: "The items in one collection, one line each with its key. Find collection keys with list_collections.",
    inputSchema: {
      type: "object",
      properties: {
        key: { ...KEY, description: "A collection's key, from list_collections" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "At most this many items (default 50)" },
      },
      required: ["key"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    async run({ key, limit = 50 }) {
      // Asked for the items of a collection it does not have, Paperly answers with
      // every item in the library; only the collection itself is a 404
      if (!(await paperly.collection(key))) {
        throw new ToolError(`No collection has the key ${key}. Find keys with list_collections.`);
      }
      const items = (await paperly.collectionItems(key, { limit })) || [];
      return items.length ? items.map(itemLine).join("\n") : "The collection is empty.";
    },
  });

  server.tool({
    name: "format_bibliography",
    title: "Format references",
    description:
      "A bibliography for the given items in a citation style installed in Paperly, such as apa, " +
      "chicago-author-date, ieee, modern-language-association or nature.",
    inputSchema: {
      type: "object",
      properties: {
        keys: { type: "array", items: KEY, minItems: 1, maxItems: 100, description: "The items' keys" },
        style: { type: "string", maxLength: 200, description: "Citation style (default apa)" },
        locale: { type: "string", maxLength: 20, description: "Language of the references, such as en-US or vi-VN" },
      },
      required: ["keys"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    async run({ keys, style = "apa", locale }) {
      const html = await paperly.bibliography(keys, { style, locale });
      const text = html === null ? "" : htmlToText(html);
      if (!text) {
        throw new ToolError("None of those keys are items in the library.");
      }
      return text;
    },
  });
}
