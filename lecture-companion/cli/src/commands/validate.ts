import { readFile } from "node:fs/promises";
import { formatIssues, validateFile, type ValidationResult } from "@lecture/core";
import { CliError, exists } from "../util.js";

/** Validate one JSON file against the schema named in its own `schema` field. */
export async function validateJsonFile(file: string): Promise<ValidationResult> {
  if (!(await exists(file))) throw new CliError(`no such file: ${file}`);
  const text = await readFile(file, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new CliError(`${file} is not valid JSON: ${(err as Error).message}`);
  }
  return validateFile(json);
}

export function renderValidation(file: string, result: ValidationResult): string {
  if (result.ok) return `ok  ${file}  (${result.schema})`;
  const named = result.schema === null ? "" : ` (${result.schema})`;
  return `fail  ${file}${named}\n${formatIssues(result.issues)}`;
}
