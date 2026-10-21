/**
 * Bug 678 — `nudo init` 向上逃逸：目标目录**没有自己的 package.json** ⇒
 * 基线写到**仓库根**（整个 monorepo 的门禁档被改），而用户以为只初始化了
 * 一个包。
 *
 * 改前：`findPackageJsonUp` 无条件沿父目录链上溯 ⇒ `nudo init
 * packages/newpkg/src` 把 `"nudo"` 键写进**仓库根**的 package.json。
 * 改后：最近的 package.json 若是 **workspace / 容器根**（`pnpm-workspace.yaml`
 * / `lerna.json` / `package.json#workspaces` / 常规 workspace 目录下的子包）
 * ⇒ **拒绝写盘**（error:/fix: 引导 + exit 1），并提示「先给目标包建
 * package.json」。
 *
 * 反向闸：换回 HEAD 只读副本 ⇒ 「exit=1」「根 package.json 未被写」两条断言
 * **必红**（HEAD 往根写 nudo 键并 exit 0）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../commands/init.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** monorepo：根 package.json + 一个兄弟包；目标目录没有自己的 package.json */
function monoRepo(extra?: { pnpmWorkspace?: boolean }): { root: string; target: string } {
  const root = mkdtempSync(join(tmpdir(), "nudo-cli-bug-678-"));
  dirs.push(root);
  const target = join(root, "packages", "newpkg", "src");
  mkdirSync(target, { recursive: true });
  mkdirSync(join(root, "packages", "sibling"), { recursive: true });
  writeFileSync(join(root, "package.json"), '{ "name": "mono-root", "private": true }\n', "utf-8");
  writeFileSync(join(root, "packages", "sibling", "package.json"), '{ "name": "sibling" }\n', "utf-8");
  if (extra?.pnpmWorkspace) {
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf-8");
  }
  return { root, target };
}

describe("Bug 678 — init 不得向上逃逸到仓库根", () => {
  it("未声明 workspace 的 monorepo（packages/* 形态）⇒ 拒绝写盘（exit 1）", () => {
    const { root, target } = monoRepo();
    const before = readFileSync(join(root, "package.json"), "utf-8");
    const errors: string[] = [];
    const code = runInit(target, { out: () => {}, err: (l) => errors.push(l) });
    expect(code).toBe(1);
    expect(readFileSync(join(root, "package.json"), "utf-8")).toBe(before);
    expect(errors.join("\n")).toContain("error:");
    expect(errors.join("\n")).toContain("workspace / container root");
    expect(errors.join("\n")).toContain("fix:");
  });

  it("pnpm workspace（pnpm-workspace.yaml）⇒ 同样拒绝写盘", () => {
    const { root, target } = monoRepo({ pnpmWorkspace: true });
    const before = readFileSync(join(root, "package.json"), "utf-8");
    expect(runInit(target, { out: () => {}, err: () => {} })).toBe(1);
    expect(readFileSync(join(root, "package.json"), "utf-8")).toBe(before);
  });

  it("package.json#workspaces ⇒ 同样拒绝写盘", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-cli-bug-678-ws-"));
    dirs.push(root);
    const target = join(root, "packages", "newpkg");
    mkdirSync(target, { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      '{ "name": "root", "workspaces": ["packages/*"] }\n',
      "utf-8",
    );
    const before = readFileSync(join(root, "package.json"), "utf-8");
    expect(runInit(target, { out: () => {}, err: () => {} })).toBe(1);
    expect(readFileSync(join(root, "package.json"), "utf-8")).toBe(before);
  });

  it("单包仓库（无子包）⇒ 照常写到本包的 package.json（不得过度拦截）", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-cli-bug-678-solo-"));
    dirs.push(root);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), '{ "name": "solo" }\n', "utf-8");
    expect(runInit(join(root, "src"), { out: () => {}, err: () => {} })).toBe(0);
    const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    expect(parsed.nudo).toEqual({ check: { profile: "adoption" } });
  });
});
