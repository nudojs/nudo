/**
 * 语法错文件 UX（DX P1）：`export function broken( {` 跑 check 旧行为是
 * `error: eval injection setup failed: Unexpected token (2:0)`——引擎黑话、
 * 无文件名/摘录/指位，且 checkSource 的同一解析错漏到顶层 catch 再打一行
 * 裸 message、stdout 全空。新行为：
 * - 人类面：`path:line:col — syntax error: <本质信息>` + 源码行摘录 + `^` 指位
 *   （tsc 风格）；EOF 错（错误行为空）摘录回落最后一个非空行、^ 落行尾。
 * - --json：错误并入信封 pathErrors（与路径错误同字段，attachPathErrors →
 *   ok:false）；单文件也走 multi 信封（有 pathError 必须有 body 且 ok:false）。
 * - exit 1 语义不变；不再出现 "eval injection setup failed" 黑话。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dir = mkdtempSync(join(tmpdir(), "nudo-cli-syntax-"));

function write(name: string, src: string): string {
  const p = join(dir, name);
  writeFileSync(p, src, "utf-8");
  return p;
}

/** EOF 语法错：错误定位在末行之后（Babel (2:0)，文件实际只有 1 行内容） */
const EOF_BROKEN = "export function broken( {\n";
/** 行中语法错：line 2 col 12（0-based）→ 显示 2:13，^ 指向 `}` */
const MID_BROKEN = "export function a() {\n  return b( };\n}\n";
const CLEAN_SRC = "export function id(x) { return x; }\n";

describe("check syntax error UX — 人类面", () => {
  it("EOF 语法错：path:line:col + 摘录 + ^ 指位；无黑话；exit 1", () => {
    const file = write("broken-eof.js", EOF_BROKEN);
    const r = runCliTsx(["check", file], { cwd: dir });
    expect(r.status).toBe(1);
    // 文件路径 + line:col（Babel 0-based col → 显示 1-based）
    expect(r.stderr).toContain(`${file}:2:1 — syntax error: Unexpected token`);
    // 源码摘录（EOF 错回落最后一个非空行）
    expect(r.stderr).toContain("export function broken( {");
    // ^ 指位：行尾（len("export function broken( {") = 25 空格 + ^）
    expect(r.stderr.split("\n")).toContain(" ".repeat(25) + "^");
    // 去黑话；不再有第二行裸 message（顶层 catch 泄漏）
    expect(r.stderr).not.toContain("eval injection setup failed");
    expect(r.stderr).not.toContain("analysis setup failed");
    expect(r.stderr.match(/Unexpected token/g)?.length).toBe(1);
  });

  it("行中语法错：^ 指向错误列（2:13 → 12 空格 + ^）", () => {
    const file = write("broken-mid.js", MID_BROKEN);
    const r = runCliTsx(["check", file], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`${file}:2:13 — syntax error: Unexpected token`);
    expect(r.stderr).toContain("  return b( };");
    expect(r.stderr.split("\n")).toContain(" ".repeat(12) + "^");
  });
});

describe("check syntax error UX — --json 面", () => {
  it("单文件：错误进信封 pathErrors 且 ok:false；stdout 是 JSON body", () => {
    const file = write("broken-json.js", EOF_BROKEN);
    const r = runCliTsx(["check", file, "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    const envelope = JSON.parse(r.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.pathErrors).toHaveLength(1);
    expect(envelope.pathErrors[0]).toMatchObject({
      path: file,
      code: "syntax-error",
    });
    expect(envelope.pathErrors[0].message).toContain("2:1 — syntax error: Unexpected token");
    // 机器面 stderr 干净（人类面摘录块只在非 --json 打）
    expect(r.stderr).toBe("");
  });

  it("多文件混编：坏文件进 pathErrors、好文件照常进 reports", () => {
    const broken = write("mixed-broken.js", EOF_BROKEN);
    const clean = write("mixed-clean.js", CLEAN_SRC);
    const r = runCliTsx(["check", broken, clean, "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    const envelope = JSON.parse(r.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.reports).toHaveLength(1);
    expect(envelope.reports[0].file).toBe(clean);
    expect(envelope.reports[0].ok).toBe(true);
    expect(envelope.pathErrors).toHaveLength(1);
    expect(envelope.pathErrors[0].path).toBe(broken);
    // 族 21 Bug 695：信封的 `summary.errors` 是**分析诊断**计数，必须等于
    // Σ`reports[].summary.errors`（= 人类面计数）。语法错是**路径错误**
    // （走 `pathErrors[]`），不是分析诊断 ⇒ 这里应是 0。
    // （改前这里断言 1，把路径错误混进了分析 error 计数 ⇒ 信封内部自相矛盾。）
    expect(envelope.summary.errors).toBe(0);
    expect(envelope.summary.errors).toBe(
      envelope.reports.reduce((n: number, rep: { summary?: { errors?: number } }) => n + (rep.summary?.errors ?? 0), 0),
    );
  });

  it("干净文件 --json 不受影响：单 CheckJson、无 pathErrors 字段", () => {
    const clean = write("json-clean.js", CLEAN_SRC);
    const r = runCliTsx(["check", clean, "--json"], { cwd: dir });
    expect(r.status).toBe(0);
    const single = JSON.parse(r.stdout);
    expect(single.ok).toBe(true);
    expect(single.file).toBe(clean);
    expect(single.pathErrors).toBeUndefined();
    expect(single.kind).toBeUndefined();
  });
});
