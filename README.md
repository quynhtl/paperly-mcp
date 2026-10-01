# Paperly for Claude

Read your [Paperly](https://github.com/quynhtl/Paperly-client) library from
Claude. Ask Claude to find the papers you saved, summarise what you highlighted,
read a paper's full text, or put together a reference list, and it answers from
your own library instead of from memory.

The plugin adds a local MCP server and a skill that tells Claude how to use it.
Everything is read-only: it never changes your library. The one thing it can
add to Paperly is a citation style Claude asks for, from the Zotero Style
Repository (see the privacy policy below).

## What Claude can do with it

| Tool | What it does |
| --- | --- |
| `search_library` | Finds items by title, author or year, or by words anywhere in them: their full text, notes and highlights |
| `get_item` | An item's fields, abstract, formatted reference, and its files and notes |
| `get_fulltext` | The text Paperly extracted from a PDF, EPUB or web page, in slices |
| `get_annotations` | Your highlights and comments, with page numbers, in reading order |
| `get_notes` | Your notes on an item, as plain text |
| `list_collections` | Your collections, nested as in Paperly |
| `get_collection_items` | The items in one collection |
| `format_bibliography` | References in any citation style of the Zotero Style Repository |

## Set it up

1. **Turn on Paperly's local API.** In Paperly, open **Settings → Advanced** and
   tick **Allow other applications on this computer to communicate with
   Paperly**. Paperly has to be open while Claude uses the library.
2. **Install the plugin** in Claude Code:

   ```sh
   claude plugin marketplace add quynhtl/paperly-mcp
   claude plugin install paperly@paperly
   ```

   or try it from a copy of this repository with
   `claude --plugin-dir ./paperly-mcp`. Without the plugin, the server alone
   can be added with
   `claude mcp add paperly -- node /path/to/paperly-mcp/server/index.mjs`.

The server needs Node.js 18 or later and nothing else: it has no dependencies,
so nothing is downloaded when you install it.

To use another library than My Library, set `PAPERLY_LIBRARY` to
`groups/<group id>` in the server's environment. `PAPERLY_API_URL` changes where
the server looks for Paperly (default `http://127.0.0.1:23119/api/`).

## Privacy policy

**What the plugin reads.** Only what Claude asks for through the tools above:
item metadata, abstracts, notes, highlights and comments, and the full text
Paperly has extracted from your files. It reads them from Paperly's local API on
your own computer (`127.0.0.1`).

**Where it goes.** What a tool returns becomes part of your conversation with
Claude, and is handled under the terms of your Claude account, like anything
else you share in a conversation. The plugin itself sends nothing anywhere
else: it makes no network requests other than to Paperly on your computer.

**Citation styles.** `get_item` and `format_bibliography` name a citation
style by its id in the [Zotero Style Repository](https://www.zotero.org/styles),
such as `apa`. When Claude asks for a style Paperly doesn't have yet, Paperly
downloads it from `https://www.zotero.org/styles/<id>` and installs it,
without asking first. That request carries the style's id and nothing from
your library. The plugin accepts only such ids, never an address, so no style
can come from anywhere else.

**What it keeps.** Nothing. It has no storage, no logs beyond Claude's own, no
analytics and no telemetry.

**Third parties.** None, other than Anthropic as the provider of the Claude
conversation you use it in, and zotero.org when Paperly downloads a citation
style from it.

**Contact.** Questions or problems: open an issue at
<https://github.com/quynhtl/paperly-mcp/issues>.

## Develop

```sh
npm test                     # protocol and tool tests, against a fake Paperly
node test/live.mjs           # the tools against a running Paperly
```

The MCP protocol is implemented in [server/mcp.mjs](server/mcp.mjs) without the
SDK, which is what keeps the server free of dependencies.

## License

MIT, see [LICENSE](LICENSE).
