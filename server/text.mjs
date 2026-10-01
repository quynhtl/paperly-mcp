// Turning the library's JSON and HTML into text a model reads well.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Notes and formatted references are HTML; this keeps their words and line breaks. */
export function htmlToText(html) {
  return String(html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
      if (entity[0] === "#") {
        const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        // As in a browser, a number that is no character -- past U+10FFFF, or half
        // of a surrogate pair -- reads as U+FFFD. fromCodePoint would throw on the
        // first, and the second would leave text the model's API refuses.
        return code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : "\ufffd";
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * `index`, or one less when it falls between the halves of a surrogate pair (a
 * character past U+FFFF, such as the 𝑥 of a maths paper): a slice that starts
 * or ends there keeps every character whole. Half a pair is not valid text,
 * and the model's API can refuse it.
 */
export function charBoundary(text, index) {
  const before = text.charCodeAt(index - 1);
  const at = text.charCodeAt(index);
  return before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff ? index - 1 : index;
}

export function creatorName(creator) {
  return creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(" ");
}

/** "Smith, Jones and Lee" or "Smith et al.", for one line about an item. */
export function shortCreators(creators = []) {
  const authors = creators.filter((c) => !c.creatorType || c.creatorType === "author");
  const names = (authors.length ? authors : creators).map((c) => c.lastName || c.name || creatorName(c));
  if (names.length > 3) {
    return `${names[0]} et al.`;
  }
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
}

/** One line per item: what a search or a collection lists. */
export function itemLine(item) {
  const d = item.data || {};
  const year = item.meta?.parsedDate?.slice(0, 4) || (d.date || "").match(/\d{4}/)?.[0];
  const parts = [
    d.title || "(untitled)",
    [shortCreators(d.creators), year].filter(Boolean).join(", "),
    d.publicationTitle,
    d.DOI && `doi:${d.DOI}`,
  ].filter(Boolean);
  const extras = [];
  if (d.itemType && d.itemType !== "journalArticle") {
    extras.push(d.itemType);
  }
  if (item.meta?.numChildren) {
    extras.push(`${item.meta.numChildren} attached`);
  }
  return `[${item.key}] ${parts.join(" — ")}${extras.length ? ` (${extras.join(", ")})` : ""}`;
}

// Fields shown on their own, or not at all
const SKIPPED_FIELDS = new Set([
  "key",
  "version",
  "itemType",
  "title",
  "creators",
  "tags",
  "collections",
  "relations",
  "dateAdded",
  "dateModified",
  "abstractNote",
  "parentItem",
  "deleted",
  "inPublications",
  // A stored file's bookkeeping
  "md5",
  "mtime",
  "charset",
]);

/** Everything about one item worth reading, in a fixed order. */
export function itemDetails(item) {
  const d = item.data || {};
  const lines = [`# ${d.title || "(untitled)"}`, "", `Key: ${item.key}`, `Type: ${d.itemType}`];
  if (d.creators?.length) {
    lines.push(`Creators: ${d.creators.map((c) => `${creatorName(c)} (${c.creatorType})`).join("; ")}`);
  }
  for (const [field, value] of Object.entries(d)) {
    if (!SKIPPED_FIELDS.has(field) && value !== "" && value !== null && typeof value !== "object") {
      lines.push(`${field}: ${value}`);
    }
  }
  if (d.tags?.length) {
    lines.push(`Tags: ${d.tags.map((t) => t.tag).join(", ")}`);
  }
  // Files and notes have no reference of their own
  const reference = htmlToText(item.bib);
  if (reference) {
    lines.push("", `Reference: ${reference}`);
  }
  if (d.abstractNote) {
    lines.push("", "Abstract:", d.abstractNote);
  }
  return lines.join("\n");
}
