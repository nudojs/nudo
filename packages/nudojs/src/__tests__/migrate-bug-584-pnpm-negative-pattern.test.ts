/**
 * Bug 584 —— `nudo migrate` 把 pnpm 用 `!packages/legacy` **显式排除**的包
 * 当成 workspace 包 ⇒ `retire --all` **真的改写**了被排除的包
 * （删 typescript 依赖 / 改 tsc 脚本 / 写退役 marker）——单向退役闸门下的数据损坏。
 *
 * 根因：`packageRoots` 把 `!…` 当成「不新增根的 pattern」直接 `continue`，
 * 排除**语义从未实现** ⇒ `packages/*` 把 `packages/legacy` 一并收进作用域。
 *
 * 本钉锁住：被排除的包**不进 status**、**不被 retire --all 改写**（落盘逐字不变）、
 * **不写 marker**；同 workspace 里未被排除的包**照常**退役。
 * oracle = pnpm 自身的 workspace 解析（`pnpm ls -r --depth -1` 不含 legacy）。
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
import { join, resolve } from "node:path";
import { migrateStatus, migrateRetireAll } from "../migrate.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const LEGACY_PKG = `${JSON.stringify(
  {
    name: "legacy-584",
    version: "1.0.0",
    scripts: { typecheck: "tsc --noEmit" },
    devDependencies: { typescript: "^5.0.0" },
  },
  null,
  2,
)}\n`;

/** pnpm workspace：`packages/*` + 负向模式 `!packages/legacy` */
function negativePatternFixture(): { dir: string; app: string; legacy: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-584-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "pnpm-workspace.yaml"),
    ["packages:", '  - "packages/*"', '  - "!packages/legacy"', ""].join("\n"),
    "utf-8",
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "root-584", version: "1.0.0", private: true }),
    "utf-8",
  );
  const app = join(dir, "packages", "app");
  const legacy = join(dir, "packages", "legacy");
  mkdirSync(app, { recursive: true });
  mkdirSync(legacy, { recursive: true });
  writeFileSync(
    join(app, "package.json"),
    JSON.stringify({
      name: "app-584",
      version: "1.0.0",
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.0.0" },
    }),
    "utf-8",
  );
  writeFileSync(join(legacy, "package.json"), LEGACY_PKG, "utf-8");
  return { dir, app, legacy };
}

describe("Bug 584 — pnpm 负向模式（`!packages/legacy`）真的排除", () => {
  it("status 不列出被 pnpm 排除的包（改前：legacy 占一行）", () => {
    const { dir, app, legacy } = negativePatternFixture();
    const roots = migrateStatus(dir).map((r) => resolve(r.root));
    expect(roots).toContain(resolve(app));
    expect(roots).not.toContain(resolve(legacy));
  });

  it("retire --all 只退役未被排除的包", () => {
    const { dir, app, legacy } = negativePatternFixture();
    const results = migrateRetireAll(dir, { workflows: false });
    expect(results.map((r) => resolve(r.root))).toEqual([resolve(app)]);
    // 被排除的包照常退役（对照组：排除不能把整仓都吃掉）
    const appPkg = JSON.parse(readFileSync(join(app, "package.json"), "utf-8"));
    expect(appPkg.devDependencies.typescript).toBeUndefined();
    expect(existsSync(join(app, ".nudo", "migrate-retired.json"))).toBe(true);
  });

  it("retire --all 不改写被排除的包：package.json 逐字不变、不写 marker", () => {
    const { dir, legacy } = negativePatternFixture();
    migrateRetireAll(dir, { workflows: false });
    expect(readFileSync(join(legacy, "package.json"), "utf-8")).toBe(LEGACY_PKG);
    expect(existsSync(join(legacy, ".nudo", "migrate-retired.json"))).toBe(false);
    expect(existsSync(join(legacy, ".nudo"))).toBe(false);
  });

  it("CLI：retire --all --dry-run 的 stdout 不含被排除的包，stderr 显式说明跳过", () => {
    const { dir, legacy } = negativePatternFixture();
    const r = runCliTsx(["migrate", "retire", "--all", "--dry-run", dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("packages/legacy");
    expect(r.stdout).toContain("packages/app");
    expect(r.stderr).toContain("skipped (pnpm excluded)");
    expect(r.stderr).toContain("packages/legacy");
  });

  it("CLI：retire --all 不落盘到被排除的包（package.json 不变）", () => {
    const { dir, legacy } = negativePatternFixture();
    const r = runCliTsx(["migrate", "retire", "--all", "--no-workflows", dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("packages/legacy");
    expect(readFileSync(join(legacy, "package.json"), "utf-8")).toBe(LEGACY_PKG);
    expect(existsSync(join(legacy, ".nudo"))).toBe(false);
  });
});
