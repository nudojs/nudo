/**
 * 族 16 主 agent 接线钉 —— Bug 586 的**判据**收口。
 *
 * 报告 586 的诉求是「**编译脚本**被改成 `nudo check .` ⇒ 构建不再产出任何产物，
 * 却绿灯通过并写下『已退役』标记」。判定必须以「**这个脚本会不会真的产出产物**」
 * 为准 —— 而不是「命令行里出现了 `-p`」或「脚本名叫 build」。
 *
 * 旧判定（按形态猜）会把两种东西都判错：
 * - `tsc -p tsconfig.build.json`（带 `outDir` + `declaration`）⇒ **真的会 emit**
 *   ⇒ 编译器角色 ⇒ 原样保留（**报告 586 要的就是这个**）；
 * - `tsc -p .` 而 tsconfig 里 `compilerOptions.noEmit: true` ⇒ **不产出任何产物**
 *   ⇒ 它其实是**类型门禁** ⇒ 应改写成 `nudo check` 且 typescript 依赖**可摘**
 *   （仓内公开样板 `docs/examples/migrate/before` 正是这一形状 —— 它的 tsconfig
 *   带 `noEmit: true`，旧判定会让「退役 tsc」的故事落空：依赖摘不掉）。
 *
 * 这里的钉覆盖两种形状 + `extends` 链 + 反向闸。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateRetire } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Fixture = { dir: string; tsconfig: Record<string, unknown> };

function pkgWith(
  name: string,
  scripts: Record<string, string>,
  tsconfig: Record<string, unknown>,
  extra?: Record<string, unknown>,
): Fixture {
  const dir = mkdtempSync(join(tmpdir(), `nudo-migrate-emit-${name}-`));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      devDependencies: { typescript: "^5.0.0" },
      scripts,
      ...extra,
    }),
    "utf-8",
  );
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2), "utf-8");
  return { dir, tsconfig };
}

describe("族 16 接线 —— 586 的判据：脚本会不会**真的**产出产物", () => {
  it("`-p` 指向 noEmit 的 tsconfig ⇒ 它是门禁角色 ⇒ 改写成 nudo check 且依赖可摘", () => {
    const { dir } = pkgWith(
      "noemit",
      { typecheck: "tsc --noEmit", build: "tsc -p ." },
      { compilerOptions: { noEmit: true, strict: true } },
    );
    const result = migrateRetire(dir, { workflows: false });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    // 不产产物的脚本 ⇒ 门禁角色 ⇒ 改写
    expect(pkg.scripts["build"]).toBe("nudo check .");
    expect(pkg.scripts["typecheck"]).toBe("nudo check .");
    // 没有编译器角色脚本了 ⇒ typescript 依赖**可摘**
    expect(pkg.devDependencies["typescript"]).toBeUndefined();
    expect(result.removedDeps).toContain("devDependencies");
    expect(result.preservedScripts).toEqual([]);
  });

  it("`-p` 指向**真的会 emit** 的 tsconfig ⇒ 编译器角色 ⇒ 原样保留且依赖不摘", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-emit-build-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "emitbuild",
        version: "1.0.0",
        devDependencies: { typescript: "^5.0.0" },
        // 门禁脚本（可退役）+ 构建脚本（真会 emit ⇒ 保留）⇒ 包整体**可退役**
        scripts: { typecheck: "tsc --noEmit", build: "tsc -p tsconfig.build.json" },
      }),
      "utf-8",
    );
    writeFileSync(
      join(dir, "tsconfig.build.json"),
      JSON.stringify({ compilerOptions: { outDir: "dist", declaration: true } }),
      "utf-8",
    );
    const result = migrateRetire(dir, { workflows: false });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    // 真的会 emit ⇒ 原样保留（报告 586 的核心诉求）
    expect(pkg.scripts["build"]).toBe("tsc -p tsconfig.build.json");
    // 门禁脚本照常改写
    expect(pkg.scripts["typecheck"]).toBe("nudo check .");
    // 编译器脚本仍要 tsc ⇒ 依赖不得摘
    expect(pkg.devDependencies["typescript"]).toBeDefined();
    expect(result.preservedScripts.map((s) => s.name)).toEqual(["build"]);
  });

  it("`extends` 链上任何一层设了 noEmit ⇒ 不 emit（门禁角色）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-emit-extends-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "extendsemit",
        version: "1.0.0",
        devDependencies: { typescript: "^5.0.0" },
        scripts: { build: "tsc -p ." },
      }),
      "utf-8",
    );
    writeFileSync(
      join(dir, "tsconfig.base.json"),
      JSON.stringify({ compilerOptions: { noEmit: true } }),
      "utf-8",
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({ extends: "./tsconfig.base.json", compilerOptions: { strict: true } }),
      "utf-8",
    );
    migrateRetire(dir, { workflows: false });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["build"]).toBe("nudo check .");
    expect(pkg.devDependencies["typescript"]).toBeUndefined();
  });

  it("反向闸：tsconfig 读不到 ⇒ 保守按「会 emit」⇒ 脚本保留（不得猜着改写）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-emit-nocfg-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "nocfg",
        version: "1.0.0",
        devDependencies: { typescript: "^5.0.0" },
        scripts: { typecheck: "tsc --noEmit", build: "tsc -p ./missing-dir" },
      }),
      "utf-8",
    );
    // 没有 tsconfig.json ⇒ 读不到配置 ⇒ 保守：当作会 emit ⇒ 视为编译器角色
    const result = migrateRetire(dir, { workflows: false });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    // 读不到配置 ⇒ **不得猜着改写**（build 原样）
    expect(pkg.scripts["build"]).toBe("tsc -p ./missing-dir");
    // 门禁脚本照常退役
    expect(pkg.scripts["typecheck"]).toBe("nudo check .");
    // 还有编译器角色脚本 ⇒ typescript 依赖不得摘
    expect(pkg.devDependencies["typescript"]).toBeDefined();
    expect(result.removedDeps).not.toContain("devDependencies");
    expect(result.preservedScripts.map((s) => s.name)).toEqual(["build"]);
  });

  it("反向闸：JSONC 注释与尾逗号不得让读取失败（读失败会误判成「会 emit」）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-emit-jsonc-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "jsonccfg",
        version: "1.0.0",
        devDependencies: { typescript: "^5.0.0" },
        scripts: { build: "tsc -p ." },
      }),
      "utf-8",
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      [
        "{",
        "  // 行注释",
        "  /* 块注释 */",
        "  \"compilerOptions\": {",
        "    \"noEmit\": true,",
        "  },",
        "}",
      ].join("\n"),
      "utf-8",
    );
    migrateRetire(dir, { workflows: false });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["build"]).toBe("nudo check .");
    expect(pkg.devDependencies["typescript"]).toBeUndefined();
  });
});
