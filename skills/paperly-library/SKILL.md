---
name: paperly-library
description: Work from the user's Paperly library of research papers. Use when the user asks about papers, articles or books they have saved, what they highlighted or noted while reading, a summary or literature review drawn from their own sources, or references and citations for items in their library.
---

# Working from a Paperly library

The `paperly` tools read the user's library in the Paperly app on their
computer. They never change it.

## Find before you read

1. Start with `search_library`. Search titles, authors and years first; use
   `mode: "everything"` only when the words are more likely to be inside the
   papers or the user's notes. Each result starts with the item's key in
   [brackets].
2. If the user names a project or a folder, look in `list_collections` and
   then `get_collection_items`.
3. Use `get_item` to see an item's details and what is attached to it.

## Prefer what the user marked

When the user asks what a paper says *to them* -- what they found important,
what to cite, what they disagreed with -- read `get_annotations` and
`get_notes` before the full text. Their highlights and comments are the most
direct evidence of what matters to them. Quote highlights exactly as they are.

## Read full text in slices

`get_fulltext` returns up to 20,000 characters at a time and says which offset
comes next. Read only as much as the question needs; for a summary, the
abstract (in `get_item`) and the user's annotations are often enough.

## Cite only what is there

- Name items by title and give their key when you refer to them, so the user
  can find them in Paperly.
- Never invent a reference, a page number or a quotation. If the library
  doesn't hold something, say so.
- For a reference list, use `format_bibliography` with the keys and the style
  the user wants (APA unless they say otherwise) rather than writing references
  by hand.

## When the tools can't reach Paperly

If a tool says Paperly isn't answering, ask the user to open Paperly. If it
says the local API is turned off, tell them: in Paperly, open **Settings →
Advanced** and tick **Allow other applications on this computer to communicate
with Paperly**.
