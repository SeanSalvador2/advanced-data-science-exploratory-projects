import { Command, InvalidArgumentError } from "commander";
import { prepare, summarize } from "./commands/prepare.js";
import { extractSpans } from "./commands/extract-spans.js";
import { renderPages } from "./commands/render-pages.js";
import { hashSpans } from "./commands/hash-spans.js";
import { termsContext } from "./commands/terms-context.js";
import { checkPartials, mergeTerms, summarizeCheck, summarizeMerge } from "./commands/merge-terms.js";
import { notesContext } from "./commands/notes-context.js";
import {
  checkNotesPartials,
  mergeNotes,
  summarizeNotesCheck,
  summarizeNotesMerge,
} from "./commands/merge-notes.js";
import { exportMarkdown, summarizeExport } from "./commands/export-md.js";
import { bias, summarizeBias } from "./commands/bias.js";
import { renderValidation, validateJsonFile } from "./commands/validate.js";
import { renderStatus, status } from "./commands/status.js";
import { CliError } from "./util.js";

function asFloat(value: string): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) throw new InvalidArgumentError("expected a number");
  return n;
}

function asInt(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n)) throw new InvalidArgumentError("expected an integer");
  return n;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("lecture")
    .description("Prepare and inspect a lecture folder (architecture.md §3)")
    .exitOverride()
    .configureOutput({ writeErr: (s) => process.stderr.write(s) });

  program
    .command("prepare")
    .argument("<dir>", "lecture folder to create")
    .requiredOption("--deck <pdf>", "source PDF to copy in as deck.pdf")
    .requiredOption("--course <code>", "course code, e.g. TDL")
    .option("--id <lectureId>", "lecture id (default: the folder's basename)")
    .option("--date <YYYY-MM-DD>", "lecture date (default: today)")
    .option("--title <t>", "lecture title")
    .option("--number <n>", "lecture number", asInt)
    .option("--scale <s>", "page render scale", asFloat, 1.5)
    .option("--prior <lectureId>", "prior lecture id, repeatable", collect, [])
    .option("--force", "replace an existing deck.pdf and re-render pages", false)
    .description("create a lecture folder: deck.pdf, lecture.json, spans.json, pages/")
    .action(async (dir: string, o: Record<string, unknown>) => {
      const result = await prepare(dir, {
        deck: o["deck"] as string,
        course: o["course"] as string,
        ...(o["id"] === undefined ? {} : { id: o["id"] as string }),
        ...(o["date"] === undefined ? {} : { date: o["date"] as string }),
        ...(o["title"] === undefined ? {} : { title: o["title"] as string }),
        ...(o["number"] === undefined ? {} : { number: o["number"] as number }),
        scale: o["scale"] as number,
        prior: o["prior"] as string[],
        force: o["force"] as boolean,
      });
      console.log(`prepared ${result.dir}`);
      console.log(`  ${result.summary}`);
      console.log(`  rendered ${result.rendered} pages, skipped ${result.skipped}`);
    });

  program
    .command("extract-spans")
    .argument("<dir>", "lecture folder")
    .description("write spans.json from deck.pdf")
    .action(async (dir: string) => {
      const { index, file } = await extractSpans(dir);
      console.log(`wrote ${file}`);
      console.log(`  ${summarize(index)}`);
    });

  program
    .command("render-pages")
    .argument("<dir>", "lecture folder")
    .option("--scale <s>", "render scale", asFloat, 1.5)
    .option("--force", "re-render pages whose PNG already exists", false)
    .description("render every page to pages/pNNN.png")
    .action(async (dir: string, o: Record<string, unknown>) => {
      const r = await renderPages(dir, { scale: o["scale"] as number, force: o["force"] as boolean });
      console.log(`rendered ${r.written.length} pages at ${r.scale}x, skipped ${r.skipped.length}`);
    });

  program
    .command("terms-context")
    .argument("<dir>", "lecture folder")
    .requiredOption("--pages <a-b>", "inclusive page range for one batch, e.g. 1-8")
    .option("--json", "print JSON (the default, and the only format today)", false)
    .description("print the text inputs /lecture-terms needs for one batch, as JSON")
    .action(async (dir: string, o: Record<string, unknown>) => {
      const result = await termsContext(dir, o["pages"] as string);
      for (const w of result.warnings) console.error(`lecture: ${w}`);
      console.log(JSON.stringify(result.context, null, 2));
    });

  program
    .command("notes-context")
    .argument("<dir>", "lecture folder")
    .requiredOption("--pages <a-b>", "inclusive page range for one batch, e.g. 1-6")
    .option("--json", "print JSON (the default, and the only format today)", false)
    .description("print the text inputs /lecture-notes needs for one batch, as JSON")
    .action(async (dir: string, o: Record<string, unknown>) => {
      const result = await notesContext(dir, o["pages"] as string);
      for (const w of result.warnings) console.error(`lecture: ${w}`);
      console.log(JSON.stringify(result.context, null, 2));
    });

  const merge = program
    .command("merge")
    .description("merge a skill's .lecture/*.partial batch files into one artefact");

  merge
    .command("terms")
    .argument("<dir>", "lecture folder")
    .option("--allow-missing", "fill pages no batch covered with empty pages", false)
    .option("--clean", "delete the partial files after a successful merge", false)
    .option("--check", "validate the partials written so far and write nothing", false)
    .description("merge .lecture/terms.partial/*.json into terms.json")
    .action(async (dir: string, o: Record<string, unknown>) => {
      if (o["check"] === true) {
        console.log(summarizeCheck(await checkPartials(dir)));
        return;
      }
      const result = await mergeTerms(dir, {
        allowMissing: o["allowMissing"] as boolean,
        clean: o["clean"] as boolean,
      });
      console.log(summarizeMerge(result));
    });

  merge
    .command("notes")
    .argument("<dir>", "lecture folder")
    .option("--allow-missing", "accept pages that were shown but carry no partial", false)
    .option("--clean", "delete the partial files after a successful merge", false)
    .option("--check", "validate the partials written so far and write nothing", false)
    .description("merge .lecture/notes.partial/*.json into notes.json")
    .action(async (dir: string, o: Record<string, unknown>) => {
      if (o["check"] === true) {
        console.log(summarizeNotesCheck(await checkNotesPartials(dir)));
        return;
      }
      const result = await mergeNotes(dir, {
        allowMissing: o["allowMissing"] as boolean,
        clean: o["clean"] as boolean,
      });
      console.log(summarizeNotesMerge(result));
    });

  program
    .command("bias")
    .argument("<dir>", "lecture folder")
    .option("--max-page <n>", "spellings kept per page", asInt, 40)
    .option("--max-global <n>", "spellings kept in the global list", asInt, 60)
    .description(
      "derive bias.json from terms.json: each page's asrBias, and a global list of " +
        "the spellings the most pages asked for (spoken forms only, not aliases)",
    )
    .action(async (dir: string, o: Record<string, unknown>) => {
      const result = await bias(dir, {
        maxPage: o["maxPage"] as number,
        maxGlobal: o["maxGlobal"] as number,
      });
      console.log(summarizeBias(result));
    });

  program
    .command("export-md")
    .argument("<dir>", "lecture folder")
    .option("--quotes", "include each generated note's transcript evidence", false)
    .option("--out <path>", "write somewhere other than <dir>/<lectureId>.md")
    .description("render notes.json and terms.json into the lecture's Markdown file")
    .action(async (dir: string, o: Record<string, unknown>) => {
      const result = await exportMarkdown(dir, {
        quotes: o["quotes"] as boolean,
        ...(o["out"] === undefined ? {} : { out: o["out"] as string }),
      });
      for (const w of result.warnings) console.error(`lecture: ${w}`);
      console.log(summarizeExport(result));
    });

  program
    .command("validate")
    .argument("<file>", "JSON file carrying a `schema` field")
    .description("validate a file against the schema it names")
    .action(async (file: string) => {
      const result = await validateJsonFile(file);
      const text = renderValidation(file, result);
      if (result.ok) {
        console.log(text);
      } else {
        console.error(text);
        process.exitCode = 1;
      }
    });

  program
    .command("status")
    .argument("<dir>", "lecture folder")
    .description("list which artefacts exist and the manifest timestamps")
    .action(async (dir: string) => {
      console.log(renderStatus(await status(dir)));
    });

  program
    .command("hash-spans")
    .argument("<dir>", "lecture folder")
    .description("sha256 over the canonical (page, id, str, box, eol) tuples")
    .action(async (dir: string) => {
      console.log(await hashSpans(dir));
    });

  return program;
}

export async function main(argv: string[]): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    // commander throws for --help and --version too; those are not failures.
    if (e.code === "commander.helpDisplayed" || e.code === "commander.help" || e.code === "commander.version") {
      return;
    }
    if (err instanceof CliError) {
      console.error(`lecture: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    if (typeof e.code === "string" && e.code.startsWith("commander.")) {
      process.exitCode = 1;
      return;
    }
    console.error(`lecture: ${(err as Error).stack ?? String(err)}`);
    process.exitCode = 1;
  }
}
