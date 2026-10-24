/**
 * Bug 597 —— `migrate status` / `retire --all` **看不见 pnpm 嵌套 workspace 包**
 * （`packages/**` 只展开一层、多段 pattern 整条静默丢弃）⇒ 仍带 `typescript` + `tsc`
 * 的成员包**完全不存在**于审计与退役范围里 ⇒ `retire --all` 报「nothing to retire」
 * 并 exit 0（**退役假绿**）。
 *
 * 根因：`packageRoots` 用「一层 `readdirSync`」近似 glob。
 * 本钉锁住：`packages/**` 覆盖**任意深度**的嵌套成员、多段 pattern 逐段展开；
 * 嵌套成员在 status 里**可见**、在 `retire --all` 的作用域里、且**真的**被退役（落盘可见）。
 * oracle = pnpm 自身的 workspace 解析（`pnpm ls -r --depth -1` 两个成员都在）。
 */
import { describe, it, expect, afterAll } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { migrateStatus, migrateRetireAll } from "../migrate.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});


function memberPkg(name: string): string {
  return `${JSON.stringify(
    {
      name,
      version: "1.0.0",
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.4.0" },
    },
    null,
    2,
  )}\n`;
}

/** pnpm workspace：`packages/**` —— 一层成员 + 嵌套成员 */
function nestedFixture(): { dir: string; plain: string; nested: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-597-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "pnpm-workspace.yaml"),
    ["packages:", "  - 'packages/**'", ""].join("\n"),
    "utf-8",
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "root-597", version: "1.0.0", private: true }),
    "utf-8",
  );
  const plain = join(dir, "packages", "plain");
  const nested = join(dir, "packages", "group", "sub");
  mkdirSync(plain, { recursive: true });
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(plain, "package.json"), memberPkg("plain-597"), "utf-8");
  writeFileSync(join(nested, "package.json"), memberPkg("sub-597"), "utf-8");
  return { dir, plain, nested };
}

/** 多段 pattern（`packages` 目录下两层 `*`）—— 改前整条被静默丢弃 */
function multiSegmentFixture(): { dir: string; nested: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-597-seg-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "pnpm-workspace.yaml"),
    ["packages:", "  - 'packages/*/*'", ""].join("\n"),
    "utf-8",
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "root-597-seg", version: "1.0.0", private: true }),
    "utf-8",
  );
  const nested = join(dir, "packages", "group", "sub");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "package.json"), memberPkg("sub2-597"), "utf-8");
  return { dir, nested };
}

describe("Bug 597 — pnpm 嵌套 / 多段 workspace pattern 看得见", () => {
  it("status 列出嵌套成员（一层与深层都在）", () => {
    const { dir, plain, nested } = nestedFixture();
    const roots = migrateStatus(dir).map((r) => resolve(r.root));
    expect(roots).toContain(resolve(plain));
    expect(roots).toContain(resolve(nested));
    const row = migrateStatus(dir).find((r) => resolve(r.root) === resolve(nested));
    expect(row!.typescriptDep).toBe(true);
    expect(row!.tscScripts).toContain("typecheck");
  });

  it("retire --all 把嵌套成员纳入作用域并真的退役（落盘可见）", () => {
    const { dir, plain, nested } = nestedFixture();
    const results = migrateRetireAll(dir, { workflows: false });
    const roots = results.map((r) => resolve(r.root));
    expect(roots).toContain(resolve(nested));
    expect(roots).toContain(resolve(plain));
    expect(roots).toHaveLength(2);
    const pkg = JSON.parse(readFileSync(join(nested, "package.json"), "utf-8"));
    expect(pkg.devDependencies.typescript).toBeUndefined();
    expect(pkg.scripts.typecheck).toContain("nudo check");
    expect(existsSync(join(nested, ".nudo", "migrate-retired.json"))).toBe(true);
  });

  it("多段 pattern（两层 `*`）不再被整条丢弃", () => {
    const { dir, nested } = multiSegmentFixture();
    const roots = migrateStatus(dir).map((r) => resolve(r.root));
    expect(roots).toContain(resolve(nested));
    const results = migrateRetireAll(dir, { workflows: false });
    expect(results.map((r) => resolve(r.root))).toEqual([resolve(nested)]);
  });

  it("CLI：migrate status 的 stdout 列出嵌套成员（改前：整行缺席）", () => {
    const { dir, nested } = nestedFixture();
    const r = runCliTsx(["migrate", "status", dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(relative(process.cwd(), nested));
  });

  it("CLI：retire --all --dry-run 不再报 nothing to retire（改前：假绿 exit 0）", () => {
    const { dir, nested } = nestedFixture();
    const r = runCliTsx(["migrate", "retire", "--all", "--dry-run", dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("nothing to retire");
    expect(r.stdout).toContain("packages/group/sub");
  });
});
