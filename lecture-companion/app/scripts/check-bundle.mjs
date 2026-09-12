import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * The dev storage adapter must not survive `vite build`. Its only fingerprint
 * is the URL prefix it talks to, so the production bundle is grepped for it.
 * architecture.md §8: the dev adapter is "never shipped in the production
 * build", and this is what makes that claim checkable.
 */
const NEEDLE = "__lecture/";
const dist = path.resolve(import.meta.dirname, "..", "dist");

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else yield full;
  }
}

let checked = 0;
const offenders = [];
for await (const file of files(dist)) {
  if (!/\.(js|mjs|css|html)$/.test(file)) continue;
  checked += 1;
  const text = await readFile(file, "utf8");
  if (text.includes(NEEDLE)) offenders.push(path.relative(dist, file));
}

if (checked === 0) {
  console.error("check-bundle: no build output found in dist/");
  process.exit(1);
}
if (offenders.length > 0) {
  console.error(`check-bundle: the dev adapter leaked into ${offenders.join(", ")}`);
  process.exit(1);
}
console.log(`check-bundle: ${checked} files, no "${NEEDLE}" in the production bundle`);
