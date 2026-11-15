/**
 * BUG-100 —— `nudo contract --from-dts` 把 `--emit` / `--fn` / `--all` /
 * `--dry-run` / `--exit-on-diff` **静默吞掉** ⇒ 漂移门禁恒 exit 0（假绿）。
 *
 * 改前（`contract.ts` 的分派）：`--from-dts` 只把 `write` / `dryRun` / `force`
 * 交给 `runContractFromDts`，`opts.emit` / `opts.fn` / `opts.all` **既没转发
 * 也没校验** ⇒ `--from-dts --emit --all --dry-run --exit-on-diff x.d.ts` 与单跑
 * `--from-dts` **逐字节相同**：exit 0、无侧车、无警告 ⇒ 把
 * `nudo contract --emit --dry-run --exit-on-diff` 当漂移门禁的流水线一旦多带
 * 一个 `--from-dts`（或反过来）就**彻底失效且无提示**。
 *
 * 钉（与 `--json` 同一条策略：「不许给了不生效且不报错」）：互斥旗标 ⇒
 * 用法错误（exit 1）+ 点名冲突旗标；`--from-dts` 单独跑仍然出草稿。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli } from "./helpers/run-cli.ts";

const TYPES_DTS = `export declare function addOne(n: number): number;
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-100-"));
  writeFileSync(join(dir, "package.json"), `{"name":"fixture","type":"module"}\n`, "utf-8");
  writeFileSync(join(dir, "types.d.ts"), TYPES_DTS, "utf-8");
  return dir;
}

describe("nudo contract --from-dts · BUG-100 · 不许静默吞旗标", () => {
  it("--from-dts + --emit/--all/--dry-run/--exit-on-diff ⇒ 用法错误（exit 1）+ 不写侧车", () => {
    const dir = makeFixture();

    const r = runCli(
      [
        "contract",
        "--from-dts",
        "--emit",
        "--all",
        "--dry-run",
        "--exit-on-diff",
        "--",
        "types.d.ts",
      ],
      { cwd: dir },
    );

    // 改前：exit 0 + 一份草稿（门禁假绿）；改后：显式拒绝
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--from-dts cannot be combined with");
    expect(r.stderr).toContain("--emit");
    expect(r.stderr).toContain("--all");
    // 没有侧车、也没有草稿正文
    expect(existsSync(join(dir, "types.d.nudo.js"))).toBe(false);
    expect(r.stdout).not.toContain("// @nudo:draft");
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

  it("--from-dts + --fn ⇒ 同样用法错误（过滤不许被吞）", () => {
    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "--fn", "addOne", "--", "types.d.ts"], { cwd: dir });

    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--from-dts cannot be combined with --fn");
  }, 60000); // 1 个 CLI 子进程

  it("对照组：--from-dts 单独跑 ⇒ 仍出草稿（exit 0）", () => {
    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "--", "types.d.ts"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("// @nudo:draft");
    expect(r.stdout).toContain("addOne");
  }, 60000); // 1 个 CLI 子进程

  it("机器面控制组：--from-dts + --emit + --json ⇒ 仍是合法 JSON + exit 1（绝不假绿）", () => {
    const dir = makeFixture();

    const r = runCli(
      ["contract", "--from-dts", "--emit", "--json", "--", "types.d.ts"],
      { cwd: dir },
    );

    expect(r.status).toBe(1);
    const doc = JSON.parse(r.stdout) as Array<{
      pathErrors?: Array<{ code?: string; message?: string }>;
    }>;
    expect(doc[0]?.pathErrors?.[0]?.code).toBe("nudo:usage-error");
    // `--json` 与 `--from-dts` 本身互斥（规则 ⑤ 先命中）⇒ 两种拒绝都是用法错误；
    // 关键是 stdout 有一份**可机器读取的理由**，且没有任何草稿/侧车正文。
    expect(doc[0]?.pathErrors?.[0]?.message).toContain("--from-dts");
  }, 60000); // 1 个 CLI 子进程
});
