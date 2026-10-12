/**
 * resolveNpmNudo 子路径要归一成 exports 键（./sub），不能带前导 /。
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveNpmNudo } from "../evaluator/resolve-npm.ts";
import { tmpProject } from "./tmp-project.ts";

describe("resolveNpmNudo subpath key", () => {
  it("resolves pkg/sub via exports['./sub']", () => {
    const dir = tmpProject("nudo-npm-");
    const pkgDir = join(dir, "node_modules", "pkg");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "pkg",
        exports: { "./sub": { nudo: "./sub.nudo.js" } },
      }),
    );
    writeFileSync(join(pkgDir, "sub.nudo.js"), "export const x = 1;");
    const hit = resolveNpmNudo("pkg/sub", dir);
    expect(hit).toBe(join(pkgDir, "sub.nudo.js"));
  });

  it("resolves pkg root via exports['.']", () => {
    const dir = tmpProject("nudo-npm-");
    const pkgDir = join(dir, "node_modules", "pkg");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "pkg", exports: { ".": { nudo: "./index.nudo.js" } } }),
    );
    writeFileSync(join(pkgDir, "index.nudo.js"), "export const x = 1;");
    expect(resolveNpmNudo("pkg", dir)).toBe(join(pkgDir, "index.nudo.js"));
  });
});
