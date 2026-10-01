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

// At most this many files a search has Paperly describe to learn whose they
// are: describing one makes Paperly read the whole file
export const FILE_LIMIT = 50;

const NEWEST_FIRST = { sort: "date", direction: "desc" };

export class Paperly {
  /**
   * @param {object} [options]
   * @param {string} [options.apiURL] - The local API's root, ending in /api/
   * @param {string} [options.library] - "users/0" for My Library, or "groups/<id>"
   * @param {number} [options.timeout] - Milliseconds to wait for an answer
   * @param {number} [options.styleTimeout] - The same, for a request that names a citation style
   * @param {number} [options.fileLimit] - At most this many files a search traces to their items
   */
  constructor({
    apiURL = DEFAULT_API_URL,
    library = "users/0",
    fetch = globalThis.fetch,
    timeout = DEFAULT_TIMEOUT,
    styleTimeout = Math.max(timeout, STYLE_TIMEOUT),
    fileLimit = FILE_LIMIT,
  } = {}) {
    this.root = apiURL.endsWith("/") ? apiURL : `${apiURL}/`;
    this.library = library;
    this.fetch = fetch;
    this.timeout = timeout;
    this.styleTimeout = styleTimeout;
    this.fileLimit = fileLimit;
  }

  /**
   * GET a path under the library (or, with `absolute`, under /api/).
   *
   * A 404 for a `lookup` -- one item, collection or full text, by its key --
   * is null: that one is not there. For a list it is never that, as Paperly
   * answers a list with what it has, if nothing: the library itself is not
   * there, or Paperly's local API is not at that address.
   */
  async get(path, params = {}, { absolute = false, as = "json", lookup = false } = {}) {
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
      if (lookup) {
        return null;
      }
      throw new ToolError(
        `Paperly has no library "${this.library}" at ${this.root}. Check PAPERLY_LIBRARY ` +
          `("users/0" for My Library, "groups/<group id>" for a group's) and PAPERLY_API_URL ` +
          `(normally ${DEFAULT_API_URL}) in the Paperly MCP server's environment.`,
      );
    }
    if (!response.ok) {
      const body = await read("text");
      throw new ToolError(`Paperly answered ${response.status}: ${body.slice(0, charBoundary(body, 200))}`);
    }
    return read(as);
  }

  /**
   * Top-level items that match, newest first, as { items, untraced }.
   *
   * Searching "everything" also matches inside the full text of files, notes
   * and annotations, but then Paperly answers with the file, note or
   * annotation itself -- which items/top leaves out -- so that search runs
   * over every item, and what it lists are the items the matches belong to.
   *
   * Paperly describes a stored file only with its MD5 hash, and reads the
   * whole file to compute it, so a broad search that had it describe every
   * match would have it read gigabytes of PDFs. The matches are gathered as
   * bare keys instead, which cost it nothing to list; only notes and
   * annotations whose item is not already known are described, and files only
   * when nothing else says whose they are -- at most `fileLimit` of them.
   * `untraced` counts the files left over.
   */
  async search({ query, mode = "titleCreatorYear", limit = 15, itemType, tag }) {
    const found = { q: query, qmode: mode };
    if (mode !== "everything") {
      if (!itemType && !tag) {
        const items = await this.get("items/top", { ...found, limit, ...NEWEST_FIRST });
        return { items, untraced: 0 };
      }
      // itemType and tag also bring in the files, notes and annotations of the
      // matches, so the answer is picked by key, as for everything. The search
      // names the matches to Paperly a second time, rather than their keys,
      // which could run to thousands.
      const owners = new Set(await this.keys("items/top", found));
      return { items: await this.newest(owners, found, { limit, itemType, tag }), untraced: 0 };
    }
    // Every match, with the files and notes of each
    const matches = await this.keys("items", found);
    if (!matches.length) {
      return { items: [], untraced: 0 };
    }
    const top = await this.keys("items/top", found);
    const owners = new Set(top);
    let rest = matches.filter((key) => !owners.has(key));
    if (rest.length && top.length) {
      // What matched inside a top-level match adds nothing to it. itemType
      // narrows through a scope that includes children, so this lists the
      // files, notes and annotations of the top-level matches.
      const theirs = new Set(await this.keys("items/top", { ...found, itemType: "attachment || note || annotation" }));
      rest = rest.filter((key) => !theirs.has(key));
    }
    const files = new Set();
    if (rest.length) {
      const isFile = new Set(await this.keys("items", { ...found, itemType: "attachment" }));
      const others = [];
      for (const key of rest) {
        if (isFile.has(key)) {
          files.add(key);
        } else {
          others.push(key);
        }
      }
      if (others.length) {
        // A note names its item; an annotation, its file. Never a file here.
        for (const part of await this.get("items", { itemKey: others.join(","), itemType: "note || annotation" })) {
          if (part.data.itemType === "annotation") {
            files.add(part.data.parentItem);
          } else {
            owners.add(part.data.parentItem || part.key);
          }
        }
      }
    }
    const traced = [...files].slice(0, this.fileLimit);
    if (traced.length) {
      // A file stands alone or names its item
      for (const file of await this.get("items", { itemKey: traced.join(","), itemType: "attachment" })) {
        owners.add(file.data.parentItem || file.key);
      }
    }
    const items = await this.newest(owners, { itemKey: [...owners].join(",") }, { limit, itemType, tag });
    return { items, untraced: files.size - traced.length };
  }

  /** The keys of what a list request finds: Paperly lists them without describing anything. */
  async keys(path, params) {
    const text = await this.get(path, { ...params, format: "keys" }, { as: "text" });
    return text.split("\n").filter(Boolean);
  }

  /**
   * The newest `limit` of the top-level items `owners`, narrowed by itemType
   * and tag. `where` asks Paperly for the owners: by their keys, or by the
   * search that found them all and nothing else.
   *
   * Those two narrow through a scope that includes children, so the filtered
   * list also holds the files, notes and annotations of the owners -- every
   * child PDF of every owner, filtered to attachments. Described, each stored
   * file among them would cost Paperly a read of the whole file, and none of
   * them is an answer. So the filtered list comes back as bare keys, sorted,
   * the children are dropped by key, and only the items that make the answer
   * are described, asked for by key with no filter, which brings no child.
   */
  async newest(owners, where, { limit, itemType, tag }) {
    // Nothing to pick from; and by keys, none would list the whole library
    if (!owners.size) {
      return [];
    }
    const sorted = await this.keys("items/top", { ...where, itemType, tag, ...NEWEST_FIRST });
    const chosen = sorted.filter((key) => owners.has(key)).slice(0, limit);
    if (!chosen.length) {
      return [];
    }
    return this.get("items/top", { itemKey: chosen.join(","), ...NEWEST_FIRST });
  }

  /**
   * An item, and with a `style` its reference. Paperly formats one whenever
   * it is asked to, in its own default style if none is named, and downloads
   * that style if it does not have it: only a reference that is shown is
   * worth that.
   */
  item(key, { style } = {}) {
    return this.get(`items/${encodeURIComponent(key)}`, { include: style ? "data,bib" : "data", style }, { lookup: true });
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
    return this.get(`items/${encodeURIComponent(key)}/fulltext`, {}, { lookup: true });
  }

  collections() {
    // All of them: a list cut short would lose whole subtrees without a word
    return this.get("collections");
  }

  collection(key) {
    return this.get(`collections/${encodeURIComponent(key)}`, {}, { lookup: true });
  }

  collectionItems(key, { limit = 50 } = {}) {
    return this.get(`collections/${encodeURIComponent(key)}/items/top`, { limit, sort: "title" });
  }

  bibliography(keys, { style, locale } = {}) {
    return this.get("items", { itemKey: keys.join(","), format: "bib", style, locale }, { as: "text" });
  }
}
