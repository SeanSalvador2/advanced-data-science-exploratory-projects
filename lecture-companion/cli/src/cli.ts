#!/usr/bin/env node
/** Dev entry point: `npm run dev -- prepare ...` runs this through tsx. */
import { main } from "./main.js";

await main(process.argv.slice(2));
