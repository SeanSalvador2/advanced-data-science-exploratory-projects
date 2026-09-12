import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { BiasTermsSchema, TermIndexSchema, type LectureManifest } from "@lecture/core";
import { at, FILES } from "../folder.js";
import { exists } from "../util.js";
import { readManifest } from "../folder.js";

export interface StatusLine {
  name: string;
  present: boolean;
  detail?: string;
}

export interface StatusReport {
  dir: string;
  manifest: LectureManifest | null;
  artifacts: StatusLine[];
}

async function countPages(dir: string): Promise<number> {
  try {
    const names = await readdir(path.join(dir, FILES.pages));
    return names.filter((n) => /^p\d{3}\.png$/.test(n)).length;
  } catch {
    return 0;
  }
}

/**
 * "42 terms, 18 in glossary" for a readable terms.json, or a short complaint
 * for one that will not parse. Never throws: `status` is what you run when
 * something is wrong.
 */
async function termsDetail(file: string): Promise<string | undefined> {
  try {
    const parsed = TermIndexSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
    if (!parsed.success) return "invalid TermIndex";
    const terms = parsed.data.pages.reduce((n, p) => n + p.terms.length, 0);
    const empty = parsed.data.pages.filter((p) => p.terms.length === 0).length;
    return (
      `${parsed.data.pages.length} pages, ${terms} terms, ${parsed.data.glossary.length} in glossary` +
      (empty > 0 ? `, ${empty} page(s) with none` : "")
    );
  } catch {
    return "unreadable";
  }
}

/** "source derived, 6 pages, 31 page terms, 23 global". */
async function biasDetail(file: string): Promise<string | undefined> {
  try {
    const parsed = BiasTermsSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
    if (!parsed.success) return "invalid BiasTerms";
    const terms = parsed.data.pages.reduce((n, p) => n + p.terms.length, 0);
    return `source ${parsed.data.source}, ${parsed.data.pages.length} pages, ${terms} page terms, ${parsed.data.global.length} global`;
  } catch {
    return "unreadable";
  }
}

export async function status(dir: string): Promise<StatusReport> {
  let manifest: LectureManifest | null = null;
  try {
    manifest = await readManifest(dir);
  } catch {
    manifest = null;
  }

  const pngs = await countPages(dir);
  const simple: Array<[string, string]> = [
    [FILES.manifest, FILES.manifest],
    [FILES.deck, FILES.deck],
    [FILES.spans, FILES.spans],
    [FILES.terms, FILES.terms],
    [FILES.bias, FILES.bias],
    [FILES.audio, FILES.audio],
    [FILES.recording, FILES.recording],
    [FILES.events, FILES.events],
    [FILES.transcript, FILES.transcript],
    [FILES.notes, FILES.notes],
    [FILES.heartbeat, FILES.heartbeat],
  ];

  const artifacts: StatusLine[] = [];
  for (const [name, rel] of simple) {
    const file = at(dir, rel);
    const present = await exists(file);
    let detail: string | undefined;
    if (present && rel === FILES.terms) detail = await termsDetail(file);
    if (present && rel === FILES.bias) detail = await biasDetail(file);
    artifacts.push({ name, present, ...(detail === undefined ? {} : { detail }) });
  }
  artifacts.splice(3, 0, {
    name: `${FILES.pages}/`,
    present: pngs > 0,
    detail: pngs > 0 ? `${pngs} png` : undefined,
  });

  return { dir, manifest, artifacts };
}

export function renderStatus(report: StatusReport): string {
  const out: string[] = [report.dir];
  for (const a of report.artifacts) {
    const mark = a.present ? "present" : "missing";
    out.push(`  ${a.present ? "+" : "-"} ${a.name.padEnd(24)} ${mark}${a.detail ? `  ${a.detail}` : ""}`);
  }
  const m = report.manifest;
  if (m === null) {
    out.push("  status: no readable lecture.json");
    return out.join("\n");
  }
  out.push(`  ${m.lectureId}  course ${m.course}  ${m.date}  ${m.deck.pages} pages`);
  const steps = ["prepared", "terms", "recorded", "transcribed", "notes", "exported"] as const;
  for (const step of steps) {
    out.push(`  ${step.padEnd(13)} ${m.status[step] ?? "-"}`);
  }
  return out.join("\n");
}
