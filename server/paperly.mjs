// Reading the Paperly library through Paperly's local API: the HTTP server the
// app runs on this computer (port 23119), the same read-only API Zotero 7 and
// later offer. Nothing here writes to the library.
import { ToolError } from "./mcp.mjs";
import { charBoundary } from "./text.mjs";

export const DEFAULT_API_URL = "http://127.0.0.1:23119/api/";

export class Paperly {
  /**
   * @param {object} [options]
   * @param {string} [options.apiURL] - The local API's root, ending in /api/
   * @param {string} [options.library] - "users/0" for My Library, or "groups/<id>"
   */
  constructor({ apiURL = DEFAULT_API_URL, library = "users/0", fetch = globalThis.fetch } = {}) {
    this.root = apiURL.endsWith("/") ? apiURL : `${apiURL}/`;
    this.library = library;
    this.fetch = fetch;
  }

  /** GET a path under the library (or, with `absolute`, under /api/). */
  async get(path, params = {}, { absolute = false, as = "json" } = {}) {
    const url = new URL(absolute ? path : `${this.library}/${path}`, this.root);
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(name, String(value));
      }
    }
    let response;
    try {
      response = await this.fetch(url, { headers: { Accept: "application/json" } });
    } catch {
      throw new ToolError(
        "Paperly isn't answering. Make sure Paperly is open; if it is, its local server may be turned off.",
      );
    }
    if (response.status === 403) {
      throw new ToolError(
        'Paperly\'s local API is turned off. In Paperly, open Settings → Advanced and tick "Allow other applications on this computer to communicate with Paperly", then try again.',
      );
    }
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const body = await response.text();
      throw new ToolError(`Paperly answered ${response.status}: ${body.slice(0, charBoundary(body, 200))}`);
    }
    return as === "text" ? response.text() : response.json();
  }

  search({ query, mode = "titleCreatorYear", limit = 15, itemType, tag }) {
    return this.get("items/top", { q: query, qmode: mode, limit, itemType, tag, sort: "date", direction: "desc" });
  }

  item(key, { style } = {}) {
    return this.get(`items/${encodeURIComponent(key)}`, { include: "data,bib", style });
  }

  children(key) {
    return this.get(`items/${encodeURIComponent(key)}/children`);
  }

  fulltext(key) {
    return this.get(`items/${encodeURIComponent(key)}/fulltext`);
  }

  collections() {
    return this.get("collections", { limit: 500 });
  }

  collectionItems(key, { limit = 50 } = {}) {
    return this.get(`collections/${encodeURIComponent(key)}/items/top`, { limit, sort: "title" });
  }

  bibliography(keys, { style, locale } = {}) {
    return this.get("items", { itemKey: keys.join(","), format: "bib", style, locale }, { as: "text" });
  }
}
