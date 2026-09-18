import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { collectLoadDepContents } from "../dep-contents.ts";
import { checkCacheKey } from "../disk-cache.ts";

describe("collectLoadDepContents sidecar ESM closure", () => {
  it("includes ambient sidecar of imported dep, not only @nudo:import comments", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-dep-"));
    writeFileSync(join(dir, "std.nudo.js"), `export function positive(x) { return x; }\n`);
    const source = `import { positive } from "./std.nudo.js";\nexport function f(x) { return positive(x); }\n`;
    writeFileSync(join(dir, "user.js"), source);
    writeFileSync(join(dir, "user.nudo.js"), `// user sidecar\n`);
    const loadModule = (spec: string, fromFile: string) => {
      const base = dirname(fromFile);
      const absPath = spec.startsWith(".") || spec.startsWith("/") ? resolve(base, spec) : spec;
      if (!existsSync(absPath)) return undefined;
      return readFileSync(absPath, "utf-8");
    };
    const { depContents } = collectLoadDepContents(join(dir, "user.js"), source, loadModule);
    const paths = depContents.map((d) => d.path.replace(/\\/g, "/"));
    expect(paths.some((p) => p.includes("std.nudo.js"))).toBe(true);
    expect(paths.some((p) => p.includes("user.nudo.js"))).toBe(true);

    const key1 = checkCacheKey(join(dir, "user.js"), source, {
      autoBind: true,
      projectDir: dir,
      sidecarContent: "// user sidecar\n",
      depContents,
    });
    const flipped = depContents.map((d) =>
      d.path.includes("std.nudo.js")
        ? { ...d, content: `${d.content ?? ""}\n// changed\n` }
        : d,
    );
    const key2 = checkCacheKey(join(dir, "user.js"), source, {
      autoBind: true,
      projectDir: dir,
      sidecarContent: "// user sidecar\n",
      depContents: flipped,
    });
    expect(key1).not.toBe(key2);
  });
});
