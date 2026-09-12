import { readdir } from "node:fs/promises";
import path from "node:path";
import type { LectureManifest } from "@lecture/core";
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
    artifacts.push({ name, present: await exists(at(dir, rel)) });
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
