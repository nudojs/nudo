/**
 * BUG-143 回归：`export declare namespace Space { … }` 被导出面扫描器一起跳过
 * （`NamespaceDeclaration` 与 ambient module 共用 `ModuleDeclaration` 节点）
 * ⇒ 整块 API 漏导出（裸包 import 拿到 unknown、零信号），而契约草稿面却登记了它。
 *
 * 契约：具名 namespace 导出进导出面，且与 `.d.ts` 声明一致。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Abs } from "@nudojs/core";
import { dtsFileScan } from "../harvest-package.ts";
import { harvestToAbsModules } from "../harvest-to-abs.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const DTS = `export declare namespace Space {
  const inner: number;
}
export declare function plain(x: number): string;
`;

function writePkg(): { pkg: string; dir: string; entry: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug143-"));
  dirs.push(dir);
  const pkg = "spacepkg";
  const pkgDir = join(dir, "node_modules", pkg);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: pkg, version: "1.0.0", types: "index.d.ts" }), "utf-8");
  const entry = join(pkgDir, "index.d.ts");
  writeFileSync(entry, DTS, "utf-8");
  return { pkg, dir, entry };
}

describe("BUG-143 —— export declare namespace 进导出面", () => {
  it("导出面扫描登记 Space（不只是 plain）", () => {
    const { entry } = writePkg();
    const scan = dtsFileScan(entry);
    expect([...scan.exported].sort()).toEqual(["Space", "plain"]);
    expect(scan.private.size).toBe(0);
  });

  it("包导出表含 Space，且成员 inner 有具体类型", () => {
    const { pkg, dir } = writePkg();
    const named = harvestToAbsModules(pkg, dir)[pkg]!.named;
    expect(Object.keys(named).sort()).toEqual(["Space", "plain"]);
    const slots = (named.Space as Abs).shape;
    expect(slots.k).toBe("obj");
    if (slots.k !== "obj") return;
    expect(slots.slots.inner!.value.shape).toEqual({ k: "prim", type: "number" });
  });
});
