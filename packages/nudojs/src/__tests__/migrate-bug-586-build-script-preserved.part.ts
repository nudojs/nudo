/**
 * Bug 586 — `nudo migrate retire` 把**编译脚本**（`build`）改写成 `nudo check .`
 * —— 构建不再产出任何产物，却绿灯通过并写下「已退役」标记。
 *
 * 期望：只改写**门禁角色**的脚本（`--noEmit` / 裸 tsc）；
 *       编译角色脚本（脚本名是构建角色 / 发射旗标 / `-b` / `-p` 无 `--noEmit`）**原样保留**，
 *       并且 typescript 依赖因此保留（摘掉它 build 当场坏掉）。
 * 反向闸：门禁脚本照常改写（断言非永真）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateRetire } from "../migrate.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function buildPkg(scripts: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m5-586-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), "export const x: number = 1;\n", "utf-8");
  writeFileSync(
    join(dir, "tsconfig.build.json"),
    '{ "compilerOptions": { "outDir": "dist", "declaration": true } }\n',
    "utf-8",
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "buildpkg",
      version: "1.0.0",
      scripts,
      devDependencies: { typescript: "^5.0.0" },
    }),
    "utf-8",
  );
  return dir;
}

describe("Bug 586: 编译脚本不得被改写成 nudo check", () => {
  it("build（tsc -p tsconfig.build.json）原样保留，门禁脚本照常改写", () => {
    const dir = buildPkg({ build: "tsc -p tsconfig.build.json", typecheck: "tsc --noEmit" });
    const result = migrateRetire(dir, { workflows: false });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    // 编译脚本未被改写（仍产出 dist）
    expect(pkg.scripts["build"]).toBe("tsc -p tsconfig.build.json");
    expect(pkg.scripts["build"]).not.toContain("nudo check");
    // 门禁脚本被改写
    expect(pkg.scripts["typecheck"]).toContain("nudo check");
    // 报告里点出保留的编译器脚本
    expect(result.preservedScripts.map((s) => s.name)).toContain("build");
    // 编译器脚本仍要 tsc ⇒ 依赖不得摘（摘了 build 当场坏掉）
    expect(pkg.devDependencies["typescript"]).toBe("^5.0.0");
    expect(result.removedDeps).not.toContain("devDependencies");
  });

  it("只有编译脚本的包：明确拒绝退役，脚本零改动", () => {
    const dir = buildPkg({ build: "tsc -p tsconfig.build.json" });
    const before = readFileSync(join(dir, "package.json"), "utf-8");
    expect(() => migrateRetire(dir, { workflows: false })).toThrow(/nothing to retire/);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
  });

  it("CLI 面：build 不被改写", () => {
    const dir = buildPkg({ build: "tsc -p tsconfig.build.json", typecheck: "tsc --noEmit" });
    const r = runCliTsx(["migrate", "retire", dir, "--no-workflows"]);
    expect(r.status).toBe(0);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["build"]).toBe("tsc -p tsconfig.build.json");
    expect(r.stdout).not.toContain("script build:");
  });

  it("反向闸：纯门禁脚本照常改写 + 摘依赖（断言非永真）", () => {
    const dir = buildPkg({ typecheck: "tsc --noEmit" });
    const result = migrateRetire(dir, { workflows: false });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts["typecheck"]).toBe("nudo check .");
    expect(pkg.devDependencies["typescript"]).toBeUndefined();
    expect(result.removedDeps).toContain("devDependencies");
  });
});
