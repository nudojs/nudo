/**
 * entry@ 回退 × 有效契约注解（DX：`nudo check` 全绿 vs `nudo test` 打
 * `(any) => any throws TypeError` 的表面矛盾）：
 * - 有契约（侧车手写绑定 / 源码 @nudo:contract，与 check 门禁同判定
 *   effectiveInterface handwritten）且打印 case 是 entry@ → case 区块尾
 *   加注解行
 * - 无契约（真 entry-only 回退）不注解
 * - --json 机器面 / --abs 输出面不含注解
 * - 注解不进 assertions 计数
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { analyzeFileAsync } from "@nudojs/service";
import {
  buildTestReport,
  entryContractNoteFns,
  ENTRY_CONTRACT_NOTE,
  formatTestReport,
} from "../run-test.ts";
import { registerTestCommand } from "../commands/test.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const MINI_JS = `export function greet(u) { return u.name; }\n`;
const MINI_SIDECAR = `export const greet = fn({ u: shape({ name: string() }) });\n`;
const PLAIN_JS = `export function plain(u) { return u.name; }\n`;

/** 源码 @nudo:contract 形态：模板经 @nudo:import 从 shapes.nudo.js 进来 */
const INLINE_JS = `/// @nudo:import { userShape } from "./shapes.nudo.js"
/**
 * @nudo:contract u userShape
 */
export function greet(u) { return u.name; }
`;
const SHAPES_SIDECAR = `import { shape, string } from "@nudojs/core";
export const userShape = shape({ name: string() });
`;

function tmpProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-entry-note-"));
  for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src);
  return dir;
}

/** 进程内跑真 CLI 装配（commander wiring → runTest → buildTestReport） */
async function runTestCommand(
  args: string[],
): Promise<{ out: string; err: string; exitCode: number | undefined }> {
  const program = new Command();
  program.exitOverride();
  registerTestCommand(program);
  const logs: string[] = [];
  const errs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  const origExit = process.exitCode as number | undefined;
  console.log = ((...a: unknown[]) => void logs.push(a.map(String).join(" "))) as typeof console.log;
  console.error = ((...a: unknown[]) => void errs.push(a.map(String).join(" "))) as typeof console.error;
  try {
    await program.parseAsync(["node", "test", ...args]);
    return {
      out: logs.join("\n"),
      err: errs.join("\n"),
      exitCode: process.exitCode as number | undefined,
    };
  } finally {
    console.log = origLog;
    console.error = origErr;
    process.exitCode = origExit;
  }
}

describe("entryContractNoteFns + buildTestReport — entry@ × contract annotation", () => {
  it("sidecar contract + entry@ fallback → note line printed (assertions untouched)", async () => {
    const dir = tmpProject({ "mini.js": MINI_JS, "mini.nudo.js": MINI_SIDECAR });
    const filePath = join(dir, "mini.js");
    const result = await analyzeFileAsync(filePath, MINI_JS, undefined, undefined, undefined, "all");

    const notes = entryContractNoteFns(filePath, MINI_JS, result);
    expect(notes.has("greet")).toBe(true);

    const report = buildTestReport(filePath, result, { entryContractNotes: notes });
    const text = formatTestReport(report);
    // entry@ + throws 保留（无约束 face 的诚实结果），注解随其后
    expect(text).toContain("entry@L1  (any) => any   throws TypeError");
    expect(text).toContain(ENTRY_CONTRACT_NOTE);
    const lines = text.split("\n");
    const noteIdx = lines.indexOf(ENTRY_CONTRACT_NOTE);
    const entryIdx = lines.findIndex((l) => l.startsWith("  entry@L1"));
    expect(entryIdx).toBeGreaterThanOrEqual(0);
    expect(noteIdx).toBe(entryIdx + 1);
    // 注解不进断言：entry@ 合成 case 唯一，declared 空
    expect(report.passed).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.unchecked).toBe(0);
    expect(report.outcomes.every((o) => o.synthetic)).toBe(true);
  });

  it("inline @nudo:contract + entry@ fallback → note line printed", async () => {
    const dir = tmpProject({ "inline.js": INLINE_JS, "shapes.nudo.js": SHAPES_SIDECAR });
    const filePath = join(dir, "inline.js");
    const result = await analyzeFileAsync(
      filePath,
      INLINE_JS,
      undefined,
      undefined,
      undefined,
      "all",
    );

    const notes = entryContractNoteFns(filePath, INLINE_JS, result);
    expect(notes.has("greet")).toBe(true);
    const text = formatTestReport(
      buildTestReport(filePath, result, { entryContractNotes: notes }),
    );
    expect(text).toContain(ENTRY_CONTRACT_NOTE);
  });

  it("no contract (true entry-only fallback) → no note", async () => {
    const dir = tmpProject({ "plain.js": PLAIN_JS });
    const filePath = join(dir, "plain.js");
    const result = await analyzeFileAsync(filePath, PLAIN_JS, undefined, undefined, undefined, "all");

    expect(entryContractNoteFns(filePath, PLAIN_JS, result).size).toBe(0);
    const text = formatTestReport(
      buildTestReport(filePath, result, {
        entryContractNotes: entryContractNoteFns(filePath, PLAIN_JS, result),
      }),
    );
    expect(text).toContain("entry@");
    expect(text).not.toContain("unconstrained entry face");
  });

  it("contracted fn WITH a call site (call@, no entry@) → no note", async () => {
    const src = `${MINI_JS}greet({ name: "a" });\n`;
    const dir = tmpProject({ "called.js": src, "called.nudo.js": MINI_SIDECAR });
    const filePath = join(dir, "called.js");
    const result = await analyzeFileAsync(filePath, src, undefined, undefined, undefined, "all");

    const fn = result.functions.find((f) => f.name === "greet")!;
    expect(fn.cases.some((c) => c.name.startsWith("call@"))).toBe(true);
    expect(fn.cases.some((c) => c.name.startsWith("entry@"))).toBe(false);
    expect(entryContractNoteFns(filePath, src, result).size).toBe(0);
  });

  it("mixed file: note only under the contracted function's block", async () => {
    const src = `${MINI_JS}\n${PLAIN_JS}`;
    const dir = tmpProject({ "mix.js": src, "mix.nudo.js": MINI_SIDECAR });
    const filePath = join(dir, "mix.js");
    const result = await analyzeFileAsync(filePath, src, undefined, undefined, undefined, "all");

    const notes = entryContractNoteFns(filePath, src, result);
    expect(notes.has("greet")).toBe(true);
    expect(notes.has("plain")).toBe(false);
    const text = formatTestReport(
      buildTestReport(filePath, result, { entryContractNotes: notes }),
    );
    expect(text.split("\n").filter((l) => l === ENTRY_CONTRACT_NOTE)).toHaveLength(1);
    // plain 的区块在 greet 之后（functions 序）——只检查全文本里恰一条注解即可
    expect(text.indexOf("=== plain ===")).toBeGreaterThan(text.indexOf(ENTRY_CONTRACT_NOTE));
  });

  it("buildTestReport without opts keeps the legacy noteless face", async () => {
    const dir = tmpProject({ "mini.js": MINI_JS, "mini.nudo.js": MINI_SIDECAR });
    const filePath = join(dir, "mini.js");
    const result = await analyzeFileAsync(filePath, MINI_JS, undefined, undefined, undefined, "all");
    expect(formatTestReport(buildTestReport(filePath, result))).not.toContain(
      "unconstrained entry face",
    );
  });
});

describe("nudo test command wiring — annotation lives on the human face only", () => {
  it("default face prints the note for a sidecar-contracted entry@ function", async () => {
    const dir = tmpProject({ "mini.js": MINI_JS, "mini.nudo.js": MINI_SIDECAR });
    const r = await runTestCommand(["test", join(dir, "mini.js")]);
    expect(r.out).toContain("entry@L1  (any) => any   throws TypeError");
    expect(r.out).toContain(ENTRY_CONTRACT_NOTE);
    expect(r.exitCode).toBeUndefined();
  });

  it("default face: no contract → no note", async () => {
    const dir = tmpProject({ "plain.js": PLAIN_JS });
    const r = await runTestCommand(["test", join(dir, "plain.js")]);
    expect(r.out).toContain("entry@");
    expect(r.out).not.toContain("unconstrained entry face");
  });

  it("--json machine face stays note-free", async () => {
    const dir = tmpProject({ "mini.js": MINI_JS, "mini.nudo.js": MINI_SIDECAR });
    const r = await runTestCommand(["test", join(dir, "mini.js"), "--json"]);
    expect(r.out).toContain('"entry@');
    expect(r.out).not.toContain("unconstrained entry face");
  });
});

describe("nudo test CLI (runCliTsx) — entry@ contract annotation", () => {
  it("sidecar contract form prints the annotation and exits 0", () => {
    const dir = tmpProject({ "mini.js": MINI_JS, "mini.nudo.js": MINI_SIDECAR });
    const r = runCliTsx(["test", join(dir, "mini.js")]);
    expect(r.stdout, `status=${r.status}\n${r.stdout}\n${r.stderr}`).toContain("entry@L1");
    expect(r.stdout, `status=${r.status}\n${r.stdout}\n${r.stderr}`).toContain(ENTRY_CONTRACT_NOTE);
    expect(r.status).toBe(0);
  });

  it("inline @nudo:contract form prints the annotation", () => {
    const dir = tmpProject({ "inline.js": INLINE_JS, "shapes.nudo.js": SHAPES_SIDECAR });
    const r = runCliTsx(["test", join(dir, "inline.js")]);
    expect(r.stdout, `status=${r.status}\n${r.stdout}\n${r.stderr}`).toContain(ENTRY_CONTRACT_NOTE);
    expect(r.status).toBe(0);
  });

  it("no contract control: annotation absent", () => {
    const dir = tmpProject({ "plain.js": PLAIN_JS });
    const r = runCliTsx(["test", join(dir, "plain.js")]);
    expect(r.stdout).toContain("entry@");
    expect(r.stdout).not.toContain("unconstrained entry face");
    expect(r.status).toBe(0);
  });
});
