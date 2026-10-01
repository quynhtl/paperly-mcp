#!/usr/bin/env node
// Runs every tool against a Paperly that is open on this computer, with its
// local API on, and prints what Claude would see. Not part of `npm test`: it
// needs a real library.
//
//   node test/live.mjs [search words]
import { startServer } from "./client.mjs";

const query = process.argv.slice(2).join(" ") || "attention";
const server = startServer();
const show = (title, { text, isError, error }) => {
  console.log(`\n=== ${title}${isError ? " (error)" : ""}`);
  console.log(error ? JSON.stringify(error) : text);
  return text || "";
};

const init = await server.request("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
console.log(`Connected to ${init.result.serverInfo.title} ${init.result.serverInfo.version}, protocol ${init.result.protocolVersion}`);

const found = show(`search_library "${query}"`, await server.call("search_library", { query, mode: "everything" }));
const keys = [...found.matchAll(/^\[([A-Z0-9]{8})\]/gm)].map((m) => m[1]);
for (const key of keys.slice(0, 3)) {
  show(`get_item ${key}`, await server.call("get_item", { key }));
  show(`get_notes ${key}`, await server.call("get_notes", { key }));
  show(`get_annotations ${key}`, await server.call("get_annotations", { key }));
  show(`get_fulltext ${key}`, await server.call("get_fulltext", { key, length: 1000 }));
}
show("list_collections", await server.call("list_collections", {}));
if (keys.length) {
  show("format_bibliography", await server.call("format_bibliography", { keys, style: "apa" }));
}
await server.close();
