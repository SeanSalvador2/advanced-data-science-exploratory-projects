import { Command, InvalidArgumentError } from "commander";
import { prepare, summarize } from "./commands/prepare.js";
import { extractSpans } from "./commands/extract-spans.js";
import { renderPages } from "./commands/render-pages.js";
import { hashSpans } from "./commands/hash-spans.js";
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
