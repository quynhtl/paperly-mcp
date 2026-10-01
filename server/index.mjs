#!/usr/bin/env node
// The Paperly MCP server: Claude reads the user's Paperly library through it.
//
// Started by Claude (see .mcp.json) and spoken to over stdin and stdout. It
// talks only to Paperly's local API on this computer; set PAPERLY_API_URL to
// reach it elsewhere, and PAPERLY_LIBRARY to "groups/<id>" for a group library.
import { readFileSync } from "node:fs";
import { McpServer } from "./mcp.mjs";
import { DEFAULT_API_URL, Paperly } from "./paperly.mjs";
import { addTools } from "./tools.mjs";

const manifest = JSON.parse(readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8"));

const server = new McpServer({
  name: "paperly",
  title: "Paperly",
  version: manifest.version,
  instructions:
    "These tools read the user's Paperly library (a reference manager for research papers). " +
    "Start with search_library or list_collections to find items; every item has an 8-character key. " +
    "Use get_item for details, get_fulltext to read a paper, get_annotations for what the user highlighted, " +
    "and format_bibliography for references. Nothing here changes the library.",
});

addTools(
  server,
  new Paperly({
    apiURL: process.env.PAPERLY_API_URL || DEFAULT_API_URL,
    library: process.env.PAPERLY_LIBRARY || "users/0",
  }),
);

await server.listen();
