/**
 * Bug 581 —— `nudo migrate status` / `retire --all` **整个忽略对象式 workspaces**
 * （`{ "packages": [...] }`，npm / yarn berry 经典写法）⇒ 子包不可见、
 * 其 tsc 门禁留着却报「已退役」（假绿）。
 *
 * 根因：`packageRoots` 用 `Array.isArray(workspaces)` 判形态，对象形态被**静默丢弃**。
 * 本钉同时锁住：子包在 status 里**可见**、在 `retire --all` 的作用域里、
 * 且 `retire --all` **真的退役**它（落盘可见）。
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


/** 对象式 workspaces：`{ "packages": ["packages/*"] }` */
function objectFormFixture(): { dir: string; sub: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-581-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "root-581",
      version: "1.0.0",
      private: true,
      workspaces: { packages: ["packages/*"] },
    }),
    "utf-8",
  );
  const sub = join(dir, "packages", "a");
  mkdirSync(sub, { recursive: true });
  writeFileSync(
    join(sub, "package.json"),
    JSON.stringify({
      name: "a-581",
      version: "1.0.0",
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.0.0" },
    }),
    "utf-8",
  );
  return { dir, sub };
}

describe("Bug 581 — 对象式 workspaces（{ packages: [...] }）不被忽略", () => {
  it("status 能看到对象式 workspaces 的子包（改前：整行消失）", () => {
    const { dir, sub } = objectFormFixture();
    const rows = migrateStatus(dir);
    const roots = rows.map((r) => resolve(r.root));
    expect(roots).toContain(resolve(sub));
    const row = rows.find((r) => resolve(r.root) === resolve(sub));
    expect(row).toBeDefined();
    expect(row!.typescriptDep).toBe(true);
    expect(row!.tscScripts).toContain("typecheck");
    // 根行仍在（根目录自身始终是第一个根）
    expect(roots).toContain(resolve(dir));
  });

  it("retire --all 把对象式 workspaces 的子包纳入作用域并真的退役（落盘可见）", () => {
    const { dir, sub } = objectFormFixture();
    const results = migrateRetireAll(dir, { workflows: false });
    expect(results.map((r) => resolve(r.root))).toEqual([resolve(sub)]);
    const pkg = JSON.parse(readFileSync(join(sub, "package.json"), "utf-8"));
    expect(pkg.devDependencies.typescript).toBeUndefined();
    expect(pkg.scripts.typecheck).toContain("nudo check");
    expect(existsSync(join(sub, ".nudo", "migrate-retired.json"))).toBe(true);
  });

  it("CLI：migrate status 的 stdout 列出对象式 workspaces 的子包（exit 0）", () => {
    const { dir, sub } = objectFormFixture();
    const r = runCliTsx(["migrate", "status", dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(relative(process.cwd(), sub));
    expect(r.stdout).toContain("typescript dep: yes");
  });

  it("对照组：数组式 workspaces 仍然可见（回归护栏，不被本次改动带坏）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-581-arr-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "root-581-arr",
        version: "1.0.0",
        private: true,
        workspaces: ["packages/*"],
      }),
      "utf-8",
    );
    const sub = join(dir, "packages", "b");
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(sub, "package.json"),
      JSON.stringify({
        name: "b-581",
        version: "1.0.0",
        scripts: { typecheck: "tsc --noEmit" },
        devDependencies: { typescript: "^5.0.0" },
      }),
      "utf-8",
    );
    const rows = migrateStatus(dir);
    expect(rows.map((r) => resolve(r.root))).toContain(resolve(sub));
  });
});
