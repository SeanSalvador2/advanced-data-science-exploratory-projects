import type { SpanIndex } from "@lecture/core";
import { fixed3, sha256Text } from "../util.js";
import { readSpanIndex } from "./extract-spans.js";

/**
 * The canonical text a span index hashes to: one line per item, holding only
 * the fields the contract promises are stable — page, span id, string, box and
 * the end-of-line flag. Strings are JSON-escaped so a tab or newline inside a
 * PDF cannot shift the columns; box numbers are fixed to 3 decimals so a
 * trailing-zero difference cannot change the digest.
 */
export function canonicalSpanText(index: SpanIndex): string {
  const lines: string[] = [];
  for (const page of index.pages) {
    for (const item of page.items) {
      lines.push(
        [
          page.page,
          item.id,
          JSON.stringify(item.str),
          item.box.map(fixed3).join(","),
          item.eol ? 1 : 0,
        ].join("\t"),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function hashSpanIndex(index: SpanIndex): string {
  return sha256Text(canonicalSpanText(index));
}

export async function hashSpans(dir: string): Promise<string> {
  return hashSpanIndex(await readSpanIndex(dir));
}
