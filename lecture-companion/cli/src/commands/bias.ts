import { readFile } from "node:fs/promises";
import {
  BiasTermsSchema,
  MAX_GLOBAL_BIAS_TERMS,
  MAX_PAGE_BIAS_TERMS,
  TermIndexSchema,
  deriveBias,
  formatIssues,
  toIssues,
  type BiasTerms,
} from "@lecture/core";
import { at, FILES, readManifest } from "../folder.js";
import { CliError, canonicalJson, exists, median, writeAtomic } from "../util.js";

export interface BiasOptions {
  maxPage?: number;
  maxGlobal?: number;
}

export interface BiasResult {
  file: string;
  bias: BiasTerms;
}

/**
 * Write `bias.json` from `terms.json`. Deterministic by construction: the
 * judgement happened in `/lecture-terms`, this only re-shapes it for the
 * transcriber (architecture.md §4.3).
 */
export async function bias(dir: string, opts: BiasOptions = {}): Promise<BiasResult> {
  await readManifest(dir);
  const termsFile = at(dir, FILES.terms);
  if (!(await exists(termsFile))) {
    throw new CliError(`no ${FILES.terms} in ${dir} — run the /lecture-terms skill, then \`lecture merge terms\``);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(termsFile, "utf8"));
  } catch (err) {
    throw new CliError(`${termsFile} is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = TermIndexSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CliError(`${termsFile} is not a valid TermIndex:\n${formatIssues(toIssues(parsed.error))}`);
  }

  const maxPage = opts.maxPage ?? MAX_PAGE_BIAS_TERMS;
  const maxGlobal = opts.maxGlobal ?? MAX_GLOBAL_BIAS_TERMS;
  if (maxPage < 1 || maxPage > MAX_PAGE_BIAS_TERMS) {
    throw new CliError(`--max-page must be between 1 and ${MAX_PAGE_BIAS_TERMS}, got ${maxPage}`);
  }
  if (maxGlobal < 1 || maxGlobal > MAX_GLOBAL_BIAS_TERMS) {
    throw new CliError(`--max-global must be between 1 and ${MAX_GLOBAL_BIAS_TERMS}, got ${maxGlobal}`);
  }

  const derived = deriveBias(parsed.data, { maxPage, maxGlobal });
  const checked = BiasTermsSchema.safeParse(derived);
  if (!checked.success) {
    throw new CliError(`the derived bias list is not valid:\n${formatIssues(toIssues(checked.error))}`);
  }

  const file = at(dir, FILES.bias);
  await writeAtomic(file, canonicalJson(derived));
  return { file, bias: derived };
}

/** "6 pages, terms per page min 0 / median 5 / max 9, global 23 terms" */
export function summarizeBias(result: BiasResult): string {
  const counts = result.bias.pages.map((p) => p.terms.length).sort((a, b) => a - b);
  const empty = result.bias.pages.filter((p) => p.terms.length === 0).map((p) => p.page);
  return [
    `wrote ${result.file}`,
    `  source ${result.bias.source}, ${result.bias.pages.length} pages, terms per page ` +
      `min ${counts[0] ?? 0} / median ${median(counts)} / max ${counts[counts.length - 1] ?? 0}`,
    `  global ${result.bias.global.length} terms`,
    `  pages with zero terms: ${empty.length === 0 ? "none" : empty.join(", ")}`,
  ].join("\n");
}
