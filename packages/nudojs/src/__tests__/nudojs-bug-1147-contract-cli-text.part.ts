/**
 * Bug 1147 —— `nudo contract` 的两处**文案与实现口径分裂**（只改文案，
 * **不改行为**）。
 *
 * 1147-a：`contract --help` 把 `--json` 写成「With --draft: …」⇒ 用户以为
 *   `--json` **只能**配 `--draft`；实现里 print / `--draft` / `--emit`
 *   **三形态**都吐机器面载荷，且**顶层恒为 JSON 数组**（元素形状按形态不同）
 *   ⇒ 帮助文本与实现口径分裂。
 * 1147-b：`--from-dts --write` 拒绝覆盖「存在且不同」的草稿时，提示**只**提
 *   环境变量 `NUDO_DRAFT_FORCE=1`，**不提** CLI 旗标 `--force` ⇒ 用户按文档
 *   用 `--force` 仍被拒时**看不出还有旗标**（死胡同感）。
 *
 * 钉：
 * ① 帮助文本里 `--json` **不再**声称「仅 `--draft`」，且**提到三形态**
 *    （print / `--draft` / `--emit`）与「元素形状按形态不同」；
 * ② 拒绝提示**同时**含 `--force` 与 `NUDO_DRAFT_FORCE`（两个放行口子都可见）；
 * ③ **人工改过的草稿永不被覆盖** ⇒ 拒绝**仍然发生**（`--force` 也不放行）
 *    ⇒ 不得为了提示友好而放开覆盖（**不引入数据丢失**）；
 * ④ 提示里给出的放行口子是真的：机器原稿（内容不同）+ `--force` ⇒ 覆盖成功。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli } from "./helpers/run-cli.ts";

/**
 * 从 `nudo <cmd> --help` 的输出里抽出**某个选项**的描述文本。
 *
 * commander 把长描述按**词**换行（续行缩进更深）⇒ 按缩进续接即可还原
 * 原始文案（换行点都落在空格上 ⇒ 用空格拼回即原文）。
 */
function optionDescription(help: string, flag: string): string {
  const lines = help.split("\n");
  const start = lines.findIndex((l) => l.trimStart().startsWith(`${flag} `));
  if (start === -1) return "";
  const head = lines[start]!;
  const chunks = [head.slice(head.indexOf(flag) + flag.length).trim()];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) break;
    const indent = line.length - line.trimStart().length;
    if (indent <= 2) break; // 下一个选项 / 下一小节（缩进回到 2 或 0）
    chunks.push(line.trim());
  }
  return chunks.join(" ");
}

const DTS = `export declare function mul(a: number, b: number): number;\n`;

/** 夹具：`types/index.d.ts`（`--from-dts` 的源）+ 空的 `types/` 目录 */
function makeDtsFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-1147-"));
  mkdirSync(join(dir, "types"), { recursive: true });
  writeFileSync(join(dir, "types", "index.d.ts"), DTS, "utf-8");
  return dir;
}

/**
 * `--from-dts --write` 的落盘路径（贴着源 `.d.ts`，`sidecarDraftPath` 口径）。
 *
 * ⚠ 落点名**不含 `.d.` 段**（BUG-264：`tmp/bug-report/sections/BUG-264.md`
 *   + `.changeset/fix-bug-cat-09-cli-check.md`）—— basename 含 `.d.` ⇒
 *   TypeScript 判成声明文件 ⇒ 草稿与它建议的复制落点都过不了 `tsc --strict`
 *   ⇒ `types/index.d.ts` ⇒ `types/index.nudo.draft.ts`。
 */
function draftPathOf(dir: string): string {
  return join(dir, "types", "index.nudo.draft.ts");
}

describe("nudo contract --help · Bug 1147-a · `--json` 的三形态口径", () => {
  it("`--json` 不再声称「仅 `--draft`」，且**提到** print / `--draft` / `--emit` 三形态", () => {
    const r = runCli(["contract", "--help"]);
    expect(r.status).toBe(0);
    const help = r.stdout;
    const desc = optionDescription(help, "--json");
    expect(desc, `help:\n${help}`).not.toBe("");
    // ① 不再声称「With --draft: …」（即不再声称 `--json` 只能配 `--draft`）
    expect(desc, `help:\n${help}`).not.toMatch(/With --draft/);
    expect(help).not.toContain("machine-readable draftSource");
    // ② 三形态都被点名（print / `--draft` / `--emit`）
    expect(desc, `help:\n${help}`).toContain("print");
    expect(desc, `help:\n${help}`).toContain("--draft");
    expect(desc, `help:\n${help}`).toContain("--emit");
    // ③ 顶层恒为数组 + 元素形状按形态不同（逐形态一句）
    expect(desc, `help:\n${help}`).toMatch(/JSON array/);
    expect(desc, `help:\n${help}`).toMatch(/differs per mode/);
    expect(desc, `help:\n${help}`).toContain("print elements");
    expect(desc, `help:\n${help}`).toContain("--draft elements");
    expect(desc, `help:\n${help}`).toContain("--emit elements");
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

  it("帮助文本不骗人：print 形态的 `--json` 顶层**恒为数组**（帮助说的三形态都成立）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-1147-json-"));
    writeFileSync(
      join(dir, "a.js"),
      "export function add(a, b) {\n  return a + b;\n}\n",
      "utf-8",
    );

    const r = runCli(["contract", join(dir, "a.js"), "--json"], { cwd: dir });

    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].file).toContain("a.js");
    expect(Array.isArray(parsed[0].entries)).toBe(true);
  }, 60000); // 1 个 CLI 子进程
});

describe("nudo contract --from-dts --write · Bug 1147-b · 拒绝提示的双放行口子", () => {
  it("拒绝覆盖时提示**同时**给出 `--force` 与 `NUDO_DRAFT_FORCE`（既有草稿逐字不变）", () => {
    const dir = makeDtsFixture();
    const draftPath = draftPathOf(dir);
    // 既有草稿（内容与新生成的不同 ⇒ 触发「存在且不同」那一关）
    const existing = "// @nudo:draft\n// 人工留存的既有草稿（与新生成的内容不同）\n";
    writeFileSync(draftPath, existing, "utf-8");

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(1);
    expect(r.stderr).toContain("refusing to overwrite");
    // 两个放行口子都可见（旗标 + 环境变量）
    expect(r.stderr).toContain("--force");
    expect(r.stderr).toContain("NUDO_DRAFT_FORCE");
    // 措辞要准：人工改过的草稿永不被覆盖 ⇒ 这条拒绝是预期行为
    expect(r.stderr).toContain("hand-edited");
    // 既有草稿逐字不变（没有静默丢内容）+ 没有谎报成功
    expect(readFileSync(draftPath, "utf-8")).toBe(existing);
    expect(r.stdout).not.toContain("wrote ");
  }, 60000); // 1 个 CLI 子进程

  it("**人工改过的草稿永不被覆盖**（`--force` 也不放行）⇒ 拒绝仍然发生、文件逐字不变", () => {
    const dir = makeDtsFixture();
    const draftPath = draftPathOf(dir);
    // 先写一次机器原稿
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const machine = readFileSync(draftPath, "utf-8");
    expect(machine).toContain("@nudo:draft-fingerprint");
    // 人工改过正文 ⇒ 指纹失配 ⇒ 判定为「人工改过」
    const handEdited = `${machine}\n// 人工改动\n`;
    writeFileSync(draftPath, handEdited, "utf-8");

    const second = runCli(
      ["contract", "--from-dts", "types/index.d.ts", "--write", "--force"],
      { cwd: dir },
    );

    // `--force` 放行不了「人工改过」的草稿 ⇒ 拒绝**仍然发生**
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("hand-edited");
    expect(readFileSync(draftPath, "utf-8")).toBe(handEdited);
    expect(second.stdout).not.toContain("wrote ");
  }, 60000); // 2 个顺序 CLI 子进程

  it("提示里的放行口子是真的：机器原稿（内容不同）+ `--force` ⇒ 覆盖成功", () => {
    const dir = makeDtsFixture();
    const draftPath = draftPathOf(dir);
    // 先写一次机器原稿
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const machine = readFileSync(draftPath, "utf-8");
    // 源 `.d.ts` 变了 ⇒ 新草稿内容不同（但仍是机器原稿 ⇒ `--force` 可覆盖）
    writeFileSync(
      join(dir, "types", "index.d.ts"),
      `${DTS}export declare function div(a: number, b: number): number;\n`,
      "utf-8",
    );

    const second = runCli(
      ["contract", "--from-dts", "types/index.d.ts", "--write", "--force"],
      { cwd: dir },
    );

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("wrote ");
    const after = readFileSync(draftPath, "utf-8");
    expect(after).not.toBe(machine);
    expect(after).toContain("export const div");
  }, 60000); // 2 个顺序 CLI 子进程
});
