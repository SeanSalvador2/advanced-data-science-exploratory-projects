#!/usr/bin/env node
import { main } from "../dist/main.js";

await main(process.argv.slice(2));
