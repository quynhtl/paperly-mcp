// Reading the Paperly library through Paperly's local API: the HTTP server the
// app runs on this computer (port 23119), the same read-only API Zotero 7 and
// later offer. Nothing here writes to the library.
import { ToolError } from "./mcp.mjs";
import { charBoundary } from "./text.mjs";

export const DEFAULT_API_URL = "http://127.0.0.1:23119/api/";

// A request Paperly has taken but not answered in this long counts as lost.
// Paperly answers in milliseconds when it is well, though a search through the
// text of every file in a large library takes it a while; when it is stuck,
// fetch alone would wait five minutes, and the conversation with it.
export const DEFAULT_TIMEOUT = 60000;

// A request that names a citation style can make Paperly download the style,
// and then the style that one depends on, allowing itself 30 seconds for each.
// Waiting longer than both means the answer is the style or Paperly's own word
// on why it could not get it, not a guess that Paperly is stuck.
export const STYLE_TIMEOUT = 90000;

export class Paperly {
  /**
   * @param {object} [options]
   * @param {string} [options.apiURL] - The local API's root, ending in /api/
   * @param {string} [options.library] - "users/0" for My Library, or "groups/<id>"
   * @param {number} [options.timeout] - Milliseconds to wait for an answer
   * @param {number} [options.styleTimeout] - The same, for a request that names a citation style
   */
  constructor({
    apiURL = DEFAULT_API_URL,
    library = "users/0",
    fetch = globalThis.fetch,
    timeout = DEFAULT_TIMEOUT,
    styleTimeout = Math.max(timeout, STYLE_TIMEOUT),
  } = {}) {
    this.root = apiURL.endsWith("/") ? apiURL : `${apiURL}/`;
    this.library = library;
    this.fetch = fetch;
    this.timeout = timeout;
    this.styleTimeout = styleTimeout;
  }

  /** GET a path under the library (or, with `absolute`, under /api/). */
  async get(path, params = {}, { absolute = false, as = "json" } = {}) {
    const url = new URL(absolute ? path : `${this.library}/${path}`, this.root);
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(name, String(value));
      }
    }
    const timeout = params.style ? this.styleTimeout : this.timeout;
    const signal = AbortSignal.timeout(timeout);
    // Most likely Paperly is still at work and will finish: the advice to
    // restart is for when nothing gets an answer
    const notResponding = () =>
      new ToolError(
        `Paperly took the request but did not answer within ${timeout / 1000} seconds. ` +
          "It may only be busy, downloading a citation style it did not have for instance, and finish on its own; " +
          "try again in a moment. If even a simple search gets no answer, Paperly is stuck: restart it.",
      );
    let response;
    try {
      response = await this.fetch(url, { headers: { Accept: "application/json" }, signal });
    } catch {
      throw signal.aborted
        ? notResponding()
        : new ToolError(
            "Paperly isn't answering. Make sure Paperly is open; if it is, its local server may be turned off.",
          );
    }
    // The time runs on while the answer arrives
    const read = (how) =>
      response[how]().catch((e) => {
        throw signal.aborted ? notResponding() : e;
      });
    if (response.status === 403) {
      throw new ToolError(
        'Paperly\'s local API is turned off. In Paperly, open Settings → Advanced and tick "Allow other applications on this computer to communicate with Paperly", then try again.',
      );
    }
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const body = await read("text");
      throw new ToolError(`Paperly answered ${response.status}: ${body.slice(0, charBoundary(body, 200))}`);
    }
    return read(as);
  }

  /**
   * Top-level items that match, newest first. Searching "everything" also
   * matches inside the full text of files, notes and annotations, but then
   * Paperly answers with the file, note or annotation itself -- which
   * items/top leaves out -- so that search runs over every item, and what it
   * lists are the items the matches belong to.
   */
  async search({ query, mode = "titleCreatorYear", limit = 15, itemType, tag }) {
    const newestFirst = { sort: "date", direction: "desc" };
    if (mode !== "everything") {
      return this.get("items/top", { q: query, qmode: mode, limit, itemType, tag, ...newestFirst });
    }
    const matches = (await this.get("items", { q: query, qmode: mode })) || [];
    const byKey = new Map(matches.map((item) => [item.key, item]));
    // An annotation's parent is a file, which may itself have a parent
    const files = new Set(
      matches
        .filter((item) => item.data.itemType === "annotation" && !byKey.has(item.data.parentItem))
        .map((item) => item.data.parentItem),
    );
    if (files.size) {
      for (const file of (await this.get("items", { itemKey: [...files].join(","), itemType: "attachment" })) || []) {
        byKey.set(file.key, file);
      }
    }
    const topKey = (item) => {
      if (!item.data.parentItem) {
        return item.key;
      }
      if (item.data.itemType !== "annotation") {
        return item.data.parentItem;
      }
      const file = byKey.get(item.data.parentItem);
      return file && (file.data.parentItem || file.key);
    };
    const keys = new Set(matches.map(topKey).filter(Boolean));
    if (!keys.size) {
      return [];
    }
    const items = await this.get("items/top", { itemKey: [...keys].join(","), itemType, tag, ...newestFirst });
    // itemType and tag also look among the children of the items they narrow,
    // so a child can come back with them; the limit counts only items
    return (items || []).filter((item) => !item.data.parentItem).slice(0, limit);
  }

  item(key, { style } = {}) {
    return this.get(`items/${encodeURIComponent(key)}`, { include: "data,bib", style });
  }

  children(key) {
    return this.get(`items/${encodeURIComponent(key)}/children`);
  }

  /**
   * The annotations on an item's files, or on a file. items/<key>/children
   * never has them: Paperly counts only notes and files as children.
   */
  annotations(key) {
    return this.get("items", { itemKey: key, itemType: "annotation" });
  }

  fulltext(key) {
    return this.get(`items/${encodeURIComponent(key)}/fulltext`);
  }

  collections() {
    // All of them: a list cut short would lose whole subtrees without a word
    return this.get("collections");
  }

  collection(key) {
    return this.get(`collections/${encodeURIComponent(key)}`);
  }

  collectionItems(key, { limit = 50 } = {}) {
    return this.get(`collections/${encodeURIComponent(key)}/items/top`, { limit, sort: "title" });
  }

  bibliography(keys, { style, locale } = {}) {
    return this.get("items", { itemKey: keys.join(","), format: "bib", style, locale }, { as: "text" });
  }
}
