import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";

import { devFolderPlugin } from "./vite-plugin-dev-folder.ts";

const require = createRequire(import.meta.url);

/** Where the installed `pdfjs-dist` keeps the two asset folders it wants. */
const PDFJS_ROOT = path.dirname(require.resolve("pdfjs-dist/package.json"));

/** The URL prefix `src/pdf/pdfjs.ts` builds `cMapUrl` and `standardFontDataUrl` from. */
const PDFJS_PREFIX = "/pdfjs/";

/** Folder name -> what lives in it. Both are copies of a published folder. */
const PDFJS_ASSETS = ["cmaps", "standard_fonts"] as const;

const CONTENT_TYPES: Record<string, string> = {
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
  ".ttf": "font/ttf",
};

/**
 * Ship pdf.js's `cmaps/` and `standard_fonts/` with the app.
 *
 * Without them a deck that names a standard font (Helvetica, Times) without
 * embedding it, or that uses a CID encoding, makes pdf.js ask the network for
 * its own data folder and then fall back to whatever the browser has. That is
 * both a wrong-looking slide and a network fetch on the lecture path
 * (anti-pattern 8), so the folders are served from this origin instead: out of
 * `node_modules` by the dev server, and out of `dist/pdfjs/` in a build.
 *
 * They are copied at build time rather than committed into `public/`, because
 * they belong to the pinned `pdfjs-dist` and would drift from it silently.
 */
function pdfjsAssetsPlugin(): Plugin {
  return {
    name: "lecture-pdfjs-assets",

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0] ?? "";
        if (!url.startsWith(PDFJS_PREFIX)) return next();
        const rel = decodeURIComponent(url.slice(PDFJS_PREFIX.length));
        const folder = rel.split("/")[0] ?? "";
        if (!(PDFJS_ASSETS as readonly string[]).includes(folder)) return next();
        const file = path.resolve(PDFJS_ROOT, rel);
        if (file !== PDFJS_ROOT && !file.startsWith(PDFJS_ROOT + path.sep)) return next();
        void fs.stat(file).then(
          (stat) => {
            if (!stat.isFile()) return next();
            res.setHeader("content-type", CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream");
            res.setHeader("content-length", String(stat.size));
            createReadStream(file).pipe(res);
          },
          () => next(),
        );
      });
    },

    async writeBundle(options) {
      const outDir = options.dir ?? path.resolve(import.meta.dirname, "dist");
      for (const folder of PDFJS_ASSETS) {
        await fs.cp(path.join(PDFJS_ROOT, folder), path.join(outDir, "pdfjs", folder), {
          recursive: true,
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), devFolderPlugin(), pdfjsAssetsPlugin()],
  server: {
    port: 5175,
    strictPort: true,
  },
  build: {
    // The dev adapter is behind `import.meta.env.DEV`; keeping the build free
    // of dead branches is what lets `scripts/check-bundle.mjs` prove it is gone.
    target: "es2022",
    sourcemap: false,
  },
  worker: {
    format: "es",
  },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "node",
  },
});
