import { access, cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const vscodePkg = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(vscodePkg, "..", "lsp", "dist", "server.js");
const destDir = join(vscodePkg, "server");
const dest = join(destDir, "server.js");

try {
  await access(src);
} catch {
  console.error(
    "Missing packages/lsp/dist/server.js — build the monorepo first (pnpm build, or pnpm --filter @nudojs/lsp run build).",
  );
  process.exit(1);
}

await mkdir(destDir, { recursive: true });
await cp(src, dest);
console.log(`Bundled LSP server → ${dest}`);
