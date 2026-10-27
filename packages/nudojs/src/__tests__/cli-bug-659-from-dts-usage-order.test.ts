/**
 * Bug 659 —— `nudo contract --from-dts` 在**所有用法校验之前**短路
 * ⇒ `--emit` / `--draft` / `--json` 被静默吞掉。
 *
 * 改前：`--from-dts … --emit --draft` **不报**互斥错误、exit 0、直接出 draft 正文；
 * `--from-dts … --json` 的 stdout 是 draft 文本、**不是** JSON、exit 0。
 *
 * 修法（族 20 · 片 A）：`--from-dts` **不早退** ⇒ 与其它模式共用同一套
 * 「先校验、后分派」的顺序（互斥 / `--write` 需要草稿模式 / `--exit-on-diff`
 * 的前置条件 / `--json` 与 `--from-dts` 互斥）。
 *
 * ⚠ `--write` + `--from-dts` 是**合法**组合（help 与 cli-reference 的口径都是
 * 「With --draft / --from-dts」）⇒ 校验按**模式**判定，不误伤。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

let dir: string;
let dts: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-659-"));
  dts = join(dir, "types.d.ts");
  writeFileSync(dts, "export declare function mul(a: number, b: number): number;\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Bug 659 —— --from-dts 不得绕过用法校验（先校验、后分派）", () => {
  it("--from-dts + --emit --draft：报互斥错误 + exit 1（改前：静默出 draft、exit 0）", () => {
    const r = runCli(["contract", "--from-dts", dts, "--emit", "--draft"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Usage error: --emit and --draft are mutually exclusive");
    // 不得产出 draft 正文（分派在校验之后 ⇒ 根本没跑）
    expect(r.stdout).not.toContain("// @nudo:draft");
  });

  it("--from-dts + --exit-on-diff：报前置条件错误 + exit 1（改前：静默忽略、exit 0）", () => {
    const r = runCli(["contract", "--from-dts", dts, "--exit-on-diff"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--exit-on-diff requires --emit --dry-run");
  });

  it("--from-dts + --json：显式拒绝（机器面拿不到 JSON ⇒ 不是静默吞旗标）", () => {
    const r = runCli(["contract", "--from-dts", dts, "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    // stdout 是**机器可读**的拒绝信封（不是 draft 文本）
    const docs = JSON.parse(r.stdout) as { pathErrors?: { code: string; message: string }[] }[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(1);
    expect(docs[0].pathErrors?.[0]?.code).toBe("nudo:usage-error");
    expect(docs[0].pathErrors?.[0]?.message).toContain("--json cannot be combined with --from-dts");
  });

  it("控制组：--from-dts（无旗标）仍然照常出 draft 正文 + exit 0（不误伤）", () => {
    const r = runCli(["contract", "--from-dts", dts], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("// @nudo:draft");
    expect(r.stdout).toContain("export const mul = fn({ a: number(), b: number() }, number());");
  });

  it("控制组：--from-dts + --write 仍然可用（合法组合，不被校验误伤）", () => {
    const r = runCli(["contract", "--from-dts", dts, "--write"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("wrote");
    // ⚠ 族 20 · Bug 944（片 C）起：草稿落点是**贴着源 `.d.ts`**的
    //   `sidecarDraftPath` 口径，**不再**是以 CWD 为基准的
    //   `types.nudo.draft.js`（那会静默覆盖同基名的另一个文件的草稿）。
    //   ⚠ 落点名的 `.d.` 段按 BUG-264（`tmp/bug-report/sections/BUG-264.md`
    //   + `.changeset/fix-bug-cat-09-cli-check.md`）：`.d.ts` 源的侧车/草稿名
    //   **不得含 `.d.`**（basename 含 `.d.` ⇒ TypeScript 判成声明文件 ⇒
    //   草稿与它建议的复制落点都过不了 `tsc --strict`，TS1254）⇒
    //   `types.d.ts` ⇒ `types.nudo.draft.ts`（**不是** `types.d.nudo.draft.ts`）。
    //   用例意图不变：「--from-dts + --write」是合法组合，不被用法校验误伤。
    expect(existsSync(join(dir, "types.nudo.draft.ts"))).toBe(true);
    expect(existsSync(join(dir, "types.nudo.draft.js"))).toBe(false);
  });

  it("控制组：非 from-dts 模式的既有校验不变（--emit/--draft 互斥仍报同一句）", () => {
    const lib = join(dir, "lib.js");
    writeFileSync(lib, "export function f() { return 1; }\n", "utf-8");
    const r = runCli(["contract", "--emit", "--draft", lib], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Usage error: --emit and --draft are mutually exclusive");
  });
});
