/**
 * 模块套件：emit draft/contract/case/freeze 面。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitContract } from "../contract-emitter.ts";
import { isDomainDeclarationCase } from "../domain-cases.ts";
import { abs as makeAbs, numLit, checkSource, pTrue, anyAbs, num, type Abs, constraintToEntryAbs, litC, effectiveContract } from "@nudojs/core";
import type { CaseResult } from "../../analyzer.ts";
import { spawnSync } from "node:child_process";
import { contractSurface, formatContractSurfaceLine } from "../contract-surface.ts";
import { tmpProject, writeTmpFiles } from "../../__tests__/tmp-project.ts";
import { draftContract, sidecarDraftPath, formatDraftSummary, writeContractDraft } from "../contract-draft.ts";
import { parse } from "@nudojs/parser";
import { addThrowsAnnotation, applyTextEdits } from "../quickfix-edits.ts";
import { absToTSType, projectFunctionDts } from "../dts-generator.ts";
import type { FunctionAnalysis } from "../../analyzer-types.ts";
import { nodeCheck } from "./draft-artifact.ts";
import { defaultLoadModule } from "../../load-module.ts";
import { absLit } from "@nudojs/core/internal";
import { defaultLoadModule as defaultLoadModule___nudojs_service, type AnalysisResult, type FunctionAnalysis as FunctionAnalysis___nudojs_service } from "@nudojs/service";
import { insertGeneratedCaseDirectives, stripGeneratedCaseDirectives } from "../case-emitter.ts";

// ---------------------------------------------------------------------------
// `@nudo:case` 的调试见证不进契约产物
// ---------------------------------------------------------------------------
describe("`@nudo:case` 的调试见证不进契约产物", () => {
/**
 * `nudo contract --emit` 把 `@nudo:case` 的**调试见证**写成契约。
 *
 * 现象（同一份文件，三个面三种说法）：
 *
 * | 面 | 输出 |
 * |---|---|
 * | `contract --emit --all` | `export const f = fn({ x: lit(5) }, lit(6));` ← **契约** |
 * | `nudo test` | `debug "one" (5) => 6` + `entry@L4 (any) => number \| string` |
 * | `nudo check` 签名 | `f(x: any) => number \| string` |
 *
 * ⇒ 写出来的契约说「f 只接受 x = 5、只返回 6」，门禁说「f 接受任意 x、
 * 返回 number | string」——**同一份源码，emit 产物与门禁结论互相矛盾**。
 *
 * 根因（`packages/service/src/emit/contract-emitter.ts` 的 `projectFunctionDsl`）：
 * 指令来源（`source === "directive"`）与调用点证据（`source === "callsite"`）
 * **平权**当域来源与返回义务来源 ⇒ 纯点观测见证被写成契约。
 *
 * 修法（与 `analyzer-orchestrate-uncached.ts` 的「点观测不得独占返回面」
 * 同口径）：指令来源**内部**再分档——
 * - **域声明**（实参是约束构建器 `number()`/`shape()`/`union()` … 的域形状，
 * 或带断言 `=> expected`）⇒ 可作域来源；
 * - **纯点观测见证**（实参全是字面量且无断言）⇒ **不产任何契约**（不生成域、
 * 不生成返回义务）。
 *
 * 钉：三种 case 形态（点观测 / 带断言 / 域形状）+ 「有调用点证据时指令见证
 * 不得污染返回义务」+ 分档判据本身（构造器实参 ⇒ 域；字面量实参且无断言 ⇒
 * 见证）。
 */









let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-035-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 写源文件 → 发射 → 返回（侧车文本 / 写盘结果） */
async function emit(name: string, src: string): Promise<{
  sidecar: string;
  exists: boolean;
  written: string[];
  skipped: Array<{ fn: string; reason: string }>;
}> {
  const file = join(dir, `${name}.js`);
  writeFileSync(file, src);
  const r = await emitContract(file, { fnNames: [name], mode: "add" });
  const sidecarPath = join(dir, `${name}.nudo.js`);
  const exists = existsSync(sidecarPath);
  return {
    sidecar: exists ? readFileSync(sidecarPath, "utf-8") : "",
    exists,
    written: r.written,
    skipped: r.skipped.map((s) => ({ fn: s.fn, reason: s.reason })),
  };
}


  it("点观测见证（实参全是字面量、无断言）不生成任何契约；带断言的 case 是域声明 ⇒ 仍可作域来源与返回义务来源；域形状实参（约束构建器）是域来源 ⇒ `not-projectable` 口径不变；有调用点证据时，指令见证不得污染返回义务；域声明与见证共存时：域声明生效，见证不污染", async () => {
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-035-"));


    // 改前：写盘产物是 `export const f = fn({ x: lit(5) }, lit(6));`
    const r = await emit(
      "f",
      `/**
 * @nudo:case "one" (5)
 */
export function f(x) {
  return x + 1;
}
`,
    );
    // 见证不是域来源、也不是返回义务来源 ⇒ 无可投影证据 ⇒ not-projectable
    expect(r.written).toEqual([]);
    expect(r.skipped).toEqual([{ fn: "f", reason: "not-projectable" }]);
    expect(r.exists).toBe(false);
    // 见证的字面量不得出现在任何产物里
    expect(r.sidecar).not.toContain("lit(5)");
    expect(r.sidecar).not.toContain("lit(6)");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-035-"));


    const r = await emit(
      "f",
      `/**
 * @nudo:case "as" (7) => 8
 */
export function f(x) {
  return x + 1;
}
`,
    );
    expect(r.written).toEqual(["f"]);
    expect(r.skipped).toEqual([]);
    expect(r.sidecar).toContain("export const f = fn({ x: lit(7) }, lit(8));");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-035-"));


    const r = await emit(
      "g",
      `/**
 * @nudo:case "dom" (number())
 */
export function g(x) {
  return x + 1;
}
`,
    );
    // 域形状 case 仍是域来源（不是见证）；它投影不出约束 ⇒ 口径不变
    expect(r.written).toEqual([]);
    expect(r.skipped).toEqual([{ fn: "g", reason: "not-projectable" }]);
    expect(r.exists).toBe(false);
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-035-"));


    const r = await emit(
      "f",
      `/**
 * @nudo:case "one" (5)
 */
export function f(x) {
  return x + 1;
}

f(9);
`,
    );
    expect(r.written).toEqual(["f"]);
    // 调用点证据优先（点观测拓宽到基类型）⇒ 见证的 lit(5)/lit(6) 不得混入
    expect(r.sidecar).toContain("export const f = fn({ x: number() }, number());");
    expect(r.sidecar).not.toContain("lit(5)");
    expect(r.sidecar).not.toContain("lit(6)");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-035-"));


    const r = await emit(
      "f",
      `/**
 * @nudo:case "witness" (5)
 * @nudo:case "declared" (7) => 8
 */
export function f(x) {
  return x + 1;
}
`,
    );
    expect(r.written).toEqual(["f"]);
    expect(r.sidecar).toContain("export const f = fn({ x: lit(7) }, lit(8));");
    expect(r.sidecar).not.toContain("lit(5)");
  }
});






describe("指令 case 的分档判据（见证 vs 域声明）", () => {
  const never = makeAbs({ k: "never" }, undefined, undefined, "exact");
  const primNumber = makeAbs({ k: "prim", type: "number" }, undefined, undefined, "exact");
  const base = (over: Partial<CaseResult>): CaseResult => ({
    name: "c",
    argAbs: [],
    abs: numLit(1),
    throwsAbs: never,
    source: "directive",
    ...over,
  });

  it("实参全是字面量且无断言 ⇒ 见证（不进契约）；实参全是字面量但带断言 ⇒ 域声明；实参是约束构建器（域形状）⇒ 域声明；实参混合（字面量 + 约束构建器）⇒ 域声明", () => {
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-035-"));


    const c = base({ argAbs: [numLit(5)] });
    expect(isDomainDeclarationCase(c)).toBe(false);
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-035-"));


    const c = base({ argAbs: [numLit(5)], expected: numLit(6) });
    expect(isDomainDeclarationCase(c)).toBe(true);
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-035-"));


    const c = base({ argAbs: [primNumber] });
    expect(isDomainDeclarationCase(c)).toBe(true);
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-035-"));


    const c = base({ argAbs: [numLit(5), primNumber] });
    expect(isDomainDeclarationCase(c)).toBe(true);
  }
});



});
});

// ---------------------------------------------------------------------------
// 契约面与门禁面对无解契约给同一结论
// ---------------------------------------------------------------------------
describe("契约面与门禁面对无解契约给同一结论", () => {
/**
 * `nudo contract` 把**无解契约**印成**有效契约**并 exit 0，而
 * `nudo check` 报 `nudo:contract-conflict` error（exit 1）、`nudo export` 拒绝
 * 出货（exit 1）⇒ 三个一级动词对同一个事实给出**相反结论**。
 *
 * 根因：`effectiveEntry` 打印 `eff.params` / `eff.returns` 时只调
 * `formatConstraint`，**从不读** `eff.conflict` / `eff.undecidable`（信息早就在
 * 有效契约上，只是没接到打印边界）。
 *
 * 判据：契约面与门禁面同结论 —— 条目带 `conflict` / `undecidable` 字段、
 * 人读行有标记、`--json` 有同名字段、`conflict` ⇒ 非零退出。
 */






const CONFLICT_FILES = {
  "conflict.nudo.js": `import { fn, number } from "@nudojs/core";
export const big = number().ge(5);
export const conflict = fn({ n: number().le(3) });
`,
  "conflict.js": `/// @nudo:import { big } from "./conflict.nudo.js"
/**
 * @nudo:contract n big
 */
export function conflict(n) {
  return n;
}
`,
};

/** 造一个无解契约工程，返回入口文件绝对路径 */
function conflictProject(): string {
  const dir = tmpProject("nudo-bug-081-");
  writeTmpFiles(dir, CONFLICT_FILES);
  return join(dir, "conflict.js");
}

/** 真跑 CLI（退出码是本条 bug 的另一半，字符串断言抓不到） */
function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const repoRoot = join(import.meta.dirname, "../../../../..");
  // spawnSync 而非 execFileSync：只读 `contract` 修好 后 exit 0，但
  // 诊断仍写 stderr；execFileSync 的成功分支拿不到 stderr（只有抛错分支有）。
  const r = spawnSync(
    "npx",
    ["tsx", join(repoRoot, "packages/nudojs/src/index.ts"), ...args],
    { cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return {
    status: r.status ?? 1,
    stdout: String(r.stdout ?? ""),
    stderr: String(r.stderr ?? ""),
  };
}


  it("契约条目透出 conflict（此前被静默跳过 ⇒ 印成有效契约）；人读行带 `[unsatisfiable: n]` 标记（不再印成「有效契约」）；`nudo contract` 与 check 同诊断：stderr 报同码 error + 只读命令 exit 0；`--json` 机器面：同名字段 + 只读命令 exit 0（stdout 仍是合法 JSON）；负控制：普通契约不带标记且 exit 0", async () => {
  {
    const entries = await contractSurface(conflictProject());
    const entry = entries.find((e) => e.fn === "conflict");
    expect(entry).toBeDefined();
    expect(entry!.conflict?.params).toEqual(["n"]);
  }
  {
    const entries = await contractSurface(conflictProject());
    const line = formatContractSurfaceLine(entries.find((e) => e.fn === "conflict")!);
    expect(line).toContain("[unsatisfiable: n]");
  }
  {
    // 只读 `contract` 的 exit 契约是「仅用法 / IO 错误时 exit 1」；
    // 契约冲突是被分析代码的状态，诊断照发但不再把进程判失败。
    const file = conflictProject();
    const text = runCli(["contract", file]);
    expect(text.status).toBe(0);
    expect(text.stderr).toContain("nudo:contract-conflict");
    expect(text.stderr).toContain("conflict: handwritten contract conjunction unsatisfiable (n)");
    expect(text.stdout).toContain("[unsatisfiable: n]");
  }
  {
    const file = conflictProject();
    const res = runCli(["contract", "--json", file]);
    expect(res.status).toBe(0);
    const payload = JSON.parse(res.stdout) as Array<{
      entries: Array<{ fn: string; conflict?: { params: string[] } }>;
    }>;
    expect(payload[0]!.entries[0]!.conflict?.params).toEqual(["n"]);
  }
  {
    const dir = tmpProject("nudo-bug-081-ok-");
    writeTmpFiles(dir, {
      "ok.nudo.js": `import { number } from "@nudojs/core";
export const num = number().ge(5);
`,
      "ok.js": `/// @nudo:import { num } from "./ok.nudo.js"
/**
 * @nudo:contract n num
 */
export function ok(n) {
  return n;
}
`,
    });
    const file = join(dir, "ok.js");
    const entries = await contractSurface(file);
    const line = formatContractSurfaceLine(entries.find((e) => e.fn === "ok")!);
    expect(line).not.toContain("[unsatisfiable");
    expect(line).not.toContain("[conjunction not computable");
    const res = runCli(["contract", file]);
    expect(res.status).toBe(0);
    expect(res.stderr).toBe("");
  }
});




  // ── 负控制：无冲突的契约照旧 exit 0、无标记 ─────────────────────

});

// ---------------------------------------------------------------------------
// contract --draft 必须带抛错证据
// ---------------------------------------------------------------------------
describe("contract --draft 必须带抛错证据", () => {
/**
 * `nudo:entry-may-throw` 的 `fix:` 行把 `nudo contract --draft` 指为
 * 补救手段，但草稿**只投影参数 / 返回证据**、不含 `throws` 槽 ⇒ 照建议落盘后
 * 诊断原样还在（建议不可执行）；源码里显式 `@nudo:throws` 也在草稿里消失
 * （草稿与源码矛盾）。
 *
 * 判据：草稿带抛错证据 —— 已申报的**原样**带上，未申报的取**门禁同一事实**
 * （`nudo:entry-may-throw` 的错误种类）⇒ `fn(params, returns?, { throws: "…" })`；
 * 把这条 DSL 当侧车就能让入口抛错诊断转绿（对照组）。
 */






const MAY_THROW = `export function add(a, b) {
  return a + b;
}
`;

const DECLARED = `/**
 * @nudo:throws TypeError
 */
export function add(a, b) {
  return a + b;
}
`;

const TOTAL = `export function twice(n) {
  if (typeof n !== "number") return 0;
  return n * 2;
}
`;

/** 把草稿 DSL 当侧车文本跑门禁，返回残留的 entry-may-throw 条数 */
function mayThrowAfterSidecar(file: string, source: string, dsl: string): number {
  const r = checkSource(file, source, pTrue, {
    fromFile: file,
    loadModule: (spec: string) =>
      spec.includes("nudo") ? `export const add = ${dsl};\n` : undefined,
  });
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw").length;
}


  it("未申报但门禁判「可能抛」⇒ 草稿头给出可照抄的 throws 补救（DSL 不擅自加义务）；按提示补 throws 槽后入口抛错诊断真的消失（建议可执行）；源码显式 `@nudo:throws` 原样进草稿（不再凭空消失）；多个错误种类 ⇒ `union(lit(…), lit(…))`（throws 槽要求具名错误）；负控制：不抛错的函数草稿里没有 throws 槽", async () => {
  {
    const dir = tmpProject("nudo-bug-198-");
    writeTmpFiles(dir, { "lib.js": MAY_THROW });
    const res = await draftContract(join(dir, "lib.js"));
    // DSL 形态不变（不把「可能抛」变成草稿义务）
    expect(res.entries[0]?.dsl).toBe("fn({})");
    // 但草稿头必须写明补救（此前完全没有）
    expect(res.draftSource).toContain('nudo:entry-may-throw add → add { throws: "TypeError" }');
    expect(res.entries[0]?.throws).toEqual({ kinds: ["TypeError"], declared: false });
  }
  {
    const dir = tmpProject("nudo-bug-198-rt-");
    writeTmpFiles(dir, { "lib.js": MAY_THROW });
    const file = join(dir, "lib.js");
    const res = await draftContract(file);
    const dsl = res.entries[0]!.dsl!;
    const kinds = res.entries[0]!.throws!.kinds;
    const slot = `, any(), { throws: ${kinds.map((k) => `"${k}"`).join(", ")} }`;
    // 提示里给出的就是这条：`fn({} , any(), { throws: "TypeError" })`
    expect(mayThrowAfterSidecar(file, MAY_THROW, `${dsl.slice(0, -1)}${slot})`)).toBe(0);
  }
  {
    const dir = tmpProject("nudo-bug-198-decl-");
    writeTmpFiles(dir, { "lib.js": DECLARED });
    const res = await draftContract(join(dir, "lib.js"));
    expect(res.entries[0]?.dsl).toContain('{ throws: "TypeError" }');
    expect(res.entries[0]?.throws).toEqual({ kinds: ["TypeError"], declared: true });
  }
  {
    const dir = tmpProject("nudo-bug-198-multi-");
    const src = `/**
 * @nudo:throws TypeError
 * @nudo:throws RangeError
 */
export function f(x) {
  return x;
}
`;
    writeTmpFiles(dir, { "lib.js": src });
    const res = await draftContract(join(dir, "lib.js"));
    const dsl = res.entries[0]!.dsl!;
    expect(dsl).toContain('union(lit("TypeError"), lit("RangeError"))');
  }
  {
    const dir = tmpProject("nudo-bug-198-total-");
    writeTmpFiles(dir, { "lib.js": TOTAL });
    const res = await draftContract(join(dir, "lib.js"));
    const dsl = res.entries[0]?.dsl;
    expect(dsl).toBeDefined();
    expect(dsl).not.toContain("throws");
    expect(res.entries[0]?.throws).toBeUndefined();
  }
});




  // ── 负控制：总函数不得凭空长 throws 槽 ─────────────────────────

});

// ---------------------------------------------------------------------------
// 草稿返回义务的来源
// ---------------------------------------------------------------------------
describe("草稿返回义务的来源", () => {
/**
 * `nudo contract --draft` 写的**返回义务**只来自**观测到的调用点**
 * ⇒ 接受草稿就是**假红**（函数被自己产生的草稿判违规）。
 *
 * 症状（旧口径）：
 * ```js
 * export function opt(flag) { if (flag) return 1; return null; }
 * opt(true); // ← 只观测到 true 这一支
 * ```
 * 草稿写 `fn({ flag: boolean() }, number())`；照抄进 `lib.nudo.js` 后
 * `nudo check` 报 `return value ⊭ @nudo:contract return number()`
 * （actual `1 | null`），而同一次运行的签名面打印的是 `=> 1 | null`
 * —— 草稿与自己的签名自相矛盾。
 *
 * 根因：返回义务从**观测到的返回值**推出，而观测集只是真实返回域的**子集**；
 * 函数自身的推断返回域（generalizeFromAst 的 symbolic，与签名面同源）就在
 * 手边却只用于展示文案。
 *
 * 修法：返回义务投影前先与**推断返回域**对拍——义务的类型盖不住推断域
 * （观测集是真子集）时**不投影**这条义务（宁可少写，不可写假红）。
 */






let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-509-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});


  it("观测集是真实返回域的真子集 ⇒ 不投影返回义务（改前：number() ⇒ 假红）；负控制：观测域覆盖推断域 ⇒ 返回义务照旧投影（不误伤）；负控制：无观测 ⇒ 不发明返回义务（symbolic 只作注释）", async () => {
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-509-"));


    const file = join(dir, "opt.js");
    writeFileSync(
      file,
      `export function opt(flag) {\n  if (flag) return 1;\n  return null;\n}\nopt(true);\n`,
    );
    const r = await draftContract(file);
    const entry = r.entries.find((e) => e.fn === "opt");
    expect(entry).toBeDefined();
    // 返回位：null 分支从未被观测到 ⇒ 观测集是真子集 ⇒ 不写这条义务
    expect(entry!.returns?.projected).toBe(false);
    expect(entry!.returns?.display).toContain("is not covered");
    expect(entry!.dsl).toBe("fn({ flag: boolean() })");
    expect(r.draftSource).not.toContain("number())");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-509-"));


    const file = join(dir, "double.js");
    writeFileSync(file, `export function double(x) {\n  return x * 2;\n}\n\ndouble(21);\n`);
    const r = await draftContract(file);
    const entry = r.entries.find((e) => e.fn === "double");
    expect(entry!.returns?.projected).toBe(true);
    expect(entry!.dsl).toBe("fn({ x: number() }, number())");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-509-"));


    const file = join(dir, "lonely.js");
    writeFileSync(file, `export function lonely(y) {\n  return y;\n}\n`);
    const r = await draftContract(file);
    const entry = r.entries.find((e) => e.fn === "lonely");
    expect(entry!.returns?.projected).toBe(false);
    expect(entry!.dsl).toBe("fn({})");
    expect(r.draftSource).toContain("symbolic");
  }
});



});

// ---------------------------------------------------------------------------
// @nudo:throws 注解不得写出语法错误文件
// ---------------------------------------------------------------------------
describe("@nudo:throws 注解不得写出语法错误文件", () => {
/**
 * quickfix「[silence] Declare @nudo:throws X」在**块注释**场景写出
 * **语法错误**的文件。
 *
 * 根因：addThrowsAnnotation 从声明行**向下**扫「首个含 JSDoc 收尾标记的行」
 * 当 JSDoc 收尾——普通块注释（`/* note *\/`）同样含该标记 ⇒ 裸 tag（无 JSDoc
 * 外壳）被插到注释之外 ⇒ 文件不再是合法 JS。
 *
 * 本钉：产物必须**仍可解析**（@nudojs/parser 解析不抛），且 tag 必须落在
 * 声明**附着**的 JSDoc 里（不是函数体里的注释）。
 */




function annotate(src: string, fn = "f", kind = "TypeError"): string {
  const r = addThrowsAnnotation(src, fn, kind);
  expect(r, "addThrowsAnnotation 必须给出编辑").toBeDefined();
  return applyTextEdits(src, r!.edits);
}

function parses(src: string): boolean {
  try {
    parse(src);
    return true;
  } catch {
    return false;
  }
}


  it("函数体首行是普通块注释：产物仍可解析（改前失败）；声明行尾带普通块注释：产物仍可解析（改前失败）；多行 JSDoc 后的普通块注释：tag 落在 JSDoc 内（不落进注释外）；负控制：已有 JSDoc 的函数仍把 tag 插进 JSDoc（既有行为不变）；负控制：单行 JSDoc 仍展开成块（既有行为不变）；负控制：已有 @nudo:throws 时不重复插（既有行为不变）", () => {
  {
    const src = `export function f(x) {
  /* note */
  return x + 1;
}
`;
    const next = annotate(src);
    // 改前：裸 tag 被插进 `/* note *\/` 里 → 解析失败
    expect(parses(next)).toBe(true);
    expect(next).toContain("@nudo:throws TypeError");
    // tag 必须落在声明上方的 JSDoc 里（不在函数体内）
    const docIdx = next.indexOf("@nudo:throws TypeError");
    const declIdx = next.indexOf("export function f");
    expect(docIdx).toBeGreaterThanOrEqual(0);
    expect(docIdx).toBeLessThan(declIdx);
  }
  {
    const src = `export function f(x) { /* note */
  return x + 1;
}
`;
    const next = annotate(src);
    expect(parses(next)).toBe(true);
    expect(next).toContain("@nudo:throws TypeError");
    expect(next.indexOf("@nudo:throws TypeError")).toBeLessThan(
      next.indexOf("export function f"),
    );
  }
  {
    const src = `/**
 * helper
 */
export function f(x) {
  /* note */
  return x + 1;
}
`;
    const next = annotate(src);
    expect(parses(next)).toBe(true);
    const lines = next.split("\n");
    const tagLine = lines.findIndex((l) => l.includes("@nudo:throws TypeError"));
    const closeLine = lines.findIndex((l) => l.trim().endsWith("*/"));
    expect(tagLine).toBeGreaterThan(0);
    expect(tagLine).toBeLessThan(closeLine); // tag 在 JSDoc 收尾之前
  }
  {
    const src = `/**
 * helper
 */
export function f(n) {
  return n.type;
}
`;
    const next = annotate(src, "f");
    expect(parses(next)).toBe(true);
    expect(next).toContain(" * helper\n * @nudo:throws TypeError\n */");
  }
  {
    const src = `/** helper */
export function f(n) {
  return n.type;
}
`;
    const next = annotate(src, "f");
    expect(parses(next)).toBe(true);
    expect(next).toContain("/**\n * helper\n * @nudo:throws TypeError\n */");
  }
  {
    const src = `/**
 * @nudo:throws TypeError
 */
export function f(n) {
  return n.type;
}
`;
    const next = annotate(src, "f");
    expect(next).toBe(src);
  }
});






});

// ---------------------------------------------------------------------------
// 契约返回位保形（lit(n) → n）
// ---------------------------------------------------------------------------
describe("契约返回位保形（lit(n) → n）", () => {
/**
 * dts 把**手写契约**的 `lit(42)` 返回 widen 成 `number`。
 *
 * 症状（改前）：`export declare function only42(a: number): number;`
 * 而同一次导出的其它三面都保 `42`：
 * - zod：`only42Output = z.literal(42)`
 * - standard：`{"k":"lit","value":42}`
 * - `nudo check` 签名：`only42(a: number) => 42`
 *
 * 根因：契约返回域在 Abs 里是「prim + eq(self, lit(v)) **pred**」（core 的
 * `constraintToEntryAbs` 形态）——字面量在 pred 里、不在 term 里 ⇒ 只看
 * term 的 widen 路径永远看不到它。
 *
 * 修法：契约返回位走**保形**渲染（`contractReturnTSType`）：pred 钉住单
 * 字面量 ⇒ 渲染该字面量；观测返回位（case 观测 / combined）沿用调用面
 * widen 口径（顶层字面量 → 基类型）——那条 widen 是有意为之。
 */






const neverAbs = (): Abs =>
  ({ shape: { k: "never" }, term: undefined, pred: undefined, conf: "exact" }) as Abs;

function fnOf(name: string, paramNames: string[], cases: FunctionAnalysis["cases"]): FunctionAnalysis {
  return {
    name,
    loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
    paramNames,
    cases,
  } as FunctionAnalysis;
}

const entryCase = (argAbs: Abs[], result: Abs): FunctionAnalysis["cases"] => [
  { name: "entry@L1", argAbs, abs: result, throwsAbs: neverAbs() },
];


  it("手写契约的 lit(42) 返回渲染成 42（不是 number）；字面量在 pred 里（不在 term 里）也能取到；契约返回是 number() 时仍是 number（不回归）；观测返回位（无契约）仍按调用面 widen：42 → number（负控制）", () => {
  {
    const fn = fnOf("only42", ["a"], entryCase([anyAbs], numLit(42)));
    const p = projectFunctionDts(fn, {
      params: [{ name: "a", abs: num() }],
      return: constraintToEntryAbs(litC(42), "return"),
    });
    expect(p.lines.join("\n")).toContain("export declare function only42(a: number): 42;");
    expect(p.lines.join("\n")).not.toContain(": number;");
  }
  {
    const a = constraintToEntryAbs(litC(42), "return");
    // 前提：契约返回 Abs 的字面量确实住在 pred 上
    expect(a.term?.op).toBe("var");
    expect(a.pred?.op).toBe("eq");
    // 负控制：裸 Abs 渲染仍是基类型（保形只作用在契约返回位）
    expect(absToTSType(a)).toBe("number");
  }
  {
    const fn = fnOf("n", ["a"], entryCase([anyAbs], anyAbs));
    const p = projectFunctionDts(fn, {
      params: [{ name: "a", abs: num() }],
      return: constraintToEntryAbs(
        { prim: "number", preds: [] } as never,
        "return",
      ),
    });
    expect(p.lines.join("\n")).toContain("export declare function n(a: number): number;");
  }
  {
    const fn = fnOf("obs", ["a"], entryCase([anyAbs], numLit(42)));
    const p = projectFunctionDts(fn);
    expect(p.lines.join("\n")).toContain("export declare function obs(a: unknown): number;");
  }
});




});

// ---------------------------------------------------------------------------
// 草稿的 rest 形参
// ---------------------------------------------------------------------------
describe("草稿的 rest 形参", () => {
/**
 * `nudo contract --draft` 对**剩余参数（rest）**函数写出**语法非法**
 * 的草稿 ⇒ 照抄进侧车后**整份侧车语法错误**，该文件**所有**契约一起失联。
 *
 * 症状（旧口径）：草稿正文出现 `export const sum = fn({ first: number(),
 * ...rest: number() }, number());` —— `{ ...rest: number() }` 既不是合法对象
 * 字面量也不是合法契约 DSL ⇒ `node --check` 直接 SyntaxError；照抄进
 * `lib.nudo.js` 后 `nudo check` 报 `nudo:contract-load`
 * （sidecar '…/lib.nudo.js' failed to load）⇒ **整个文件**的契约失联。
 *
 * 根因：草稿的形参表渲染把 rest 形参的 `...` 标记原样写进 DSL；emitter 面
 * （`--emit`）写盘前有 `roundTrips` 自检（装不上就 not-projectable 跳过），
 * drafter 面**没有**这道闸。
 *
 * 修法：drafter 补上同一道闸——rest 形参 ⇒ 整个函数 not-projectable 跳过；
 * 且任何 DSL 落盘前先经 `execNudoModule` 装一次，装不上就不写。
 */







let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-527-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const REST_JS = `export function sum(first, ...rest) { return first + rest.length; }
export function greet(user) { return "hi " + user; }
sum(1, 2, 3);
`;


  it("rest 函数 not-projectable 跳过（改前：写出 ...rest: number()）；草稿产物真能过 node --check（改前：SyntaxError: Unexpected token ':'）；负控制：非 rest 导出照旧出绑定行（不误跳过）", async () => {
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-527-"));


    const file = join(dir, "lib.js");
    writeFileSync(file, REST_JS);
    const r = await draftContract(file);
    const sum = r.entries.find((e) => e.fn === "sum");
    expect(sum).toBeDefined();
    expect(sum!.skipped).toBe("not-projectable");
    expect(sum!.dsl).toBeUndefined();
    expect(r.draftSource).not.toContain("...rest");
    expect(r.draftSource).toContain("sum (not-projectable)");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-527-"));


    const file = join(dir, "lib.js");
    writeFileSync(file, REST_JS);
    const r = await draftContract(file);
    const draftPath = sidecarDraftPath(file);
    writeFileSync(draftPath, r.draftSource, "utf-8");
    const check = nodeCheck(draftPath);
    expect(check.ok, check.stderr).toBe(true);
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-527-"));


    const file = join(dir, "lib.js");
    writeFileSync(file, REST_JS);
    const r = await draftContract(file);
    const greet = r.entries.find((e) => e.fn === "greet");
    expect(greet!.skipped).toBeUndefined();
    expect(r.draftSource).toContain("export const greet = fn({});");
  }
});



});

// ---------------------------------------------------------------------------
// 草稿的 import ↔ export 撞名
// ---------------------------------------------------------------------------
describe("草稿的 import ↔ export 撞名", () => {
/**
 * 契约草稿生成器写出的模块里，**builder 的 import 绑定**与生成的
 * `export const <name>` **撞名** ⇒ 写出的文件是**非法 JavaScript**
 * （`node --check` 直接 SyntaxError）。
 *
 * 症状（旧口径）：
 * ```js
 * import { fn, number } from "@nudojs/core";
 * export const number = fn({ x: number() }, number());
 * ```
 * ⇒ `SyntaxError: Identifier 'number' has already been declared`（同一模块
 * 作用域重名）⇒ 工具写出的**交付物本身不是合法 JS**，照抄进侧车同样是坏侧车。
 *
 * 根因：草稿模块的 import 绑定与 export 绑定共用一个模块作用域，但冲突检查
 * 只做了「export ↔ export」去重，**从不与 import 名单比对**；import 名单又
 * 是按 DSL 正文正则扫出来的 ⇒ 源函数名本身是 builder 名时正面撞车。
 *
 * 修法：草稿侧车键取**导出身份**，绑定名不安全时走别名形态
 * `const _nudo_N = …; export { _nudo_N as <identity> };`（与 `--emit` 面同源）。
 */







let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-545-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});


  it("导出名撞 builder import ⇒ 走别名形态（改前：export const number）；草稿产物真能过 node --check（改前：Identifier 'number' has already been declared）；负控制：普通导出名仍是 export const <name>（不误改别名形态）", async () => {
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-545-"));


    const file = join(dir, "src.js");
    writeFileSync(
      file,
      `/**\n * @nudo:case "n" (1)\n */\nexport function number(x) { return x + 1; }\n`,
    );
    const r = await draftContract(file);
    const entry = r.entries.find((e) => e.fn === "number");
    expect(entry).toBeDefined();
    // 身份仍是导出名 `number`；绑定换别名 ⇒ 与 import { number } 不撞
    expect(entry!.identity).toBe("number");
    expect(r.draftSource).not.toMatch(/^export const number = /m);
    expect(r.draftSource).toContain("export { _nudo_1 as number };");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-545-"));


    const file = join(dir, "src.js");
    writeFileSync(
      file,
      `/**\n * @nudo:case "n" (1)\n */\nexport function number(x) { return x + 1; }\n`,
    );
    const r = await draftContract(file);
    const draftPath = sidecarDraftPath(file);
    writeFileSync(draftPath, r.draftSource, "utf-8");
    const check = nodeCheck(draftPath);
    expect(check.ok, check.stderr).toBe(true);
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-545-"));


    const file = join(dir, "lib.js");
    writeFileSync(
      file,
      `/**\n * @nudo:case "n" (1)\n */\nexport function add(x) { return x + 1; }\n`,
    );
    const r = await draftContract(file);
    expect(r.draftSource).toContain("export const add = fn({ x: number() });");
    expect(r.draftSource).not.toContain("_nudo_1");
  }
});



});

// ---------------------------------------------------------------------------
// 草稿落盘不覆盖人工改过的文件
// ---------------------------------------------------------------------------
describe("草稿落盘不覆盖人工改过的文件", () => {
/**
 * `nudo contract --draft --write` **静默覆盖**已手改的
 * `*.nudo.draft.js` ⇒ 用户评审成果**无声丢失**（而生成文件自己的头写着
 * 「Handwritten contracts are never overwritten.」）。
 *
 * 症状（旧口径）：落盘判定只比较「磁盘内容 vs 本次生成的文本」是否**逐字
 * 不同**（`prev !== draftSource`），**没有任何「这份草稿是否已被人工改过」的
 * 判定** ⇒ 只要用户改过草稿，重跑 `--draft --write` 就无条件覆盖，exit 0，
 * 零告警。
 *
 * 修法：草稿正文带**内容指纹**（生成时的正文 hash，写进文件头）。落盘前
 * 核对既有文件的指纹与它自己的正文：一致 ⇒ 仍是机器原稿，可覆盖；不一致
 * （或根本没有指纹 ⇒ 来源不明）⇒ **拒绝覆盖**并回报「已存在且被手改，
 * 未覆盖」。
 */






let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-557-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const LIB_JS = `export function add(a, b) {\n  return a + b;\n}\n`;


  it("既有草稿被手改过 ⇒ 拒绝覆盖且原样保留（改前：静默覆盖）；负控制：机器原稿（指纹一致）仍可被覆盖（源变化后重生成）；负控制：同内容重跑 ⇒ 幂等（unchanged，不写盘）", async () => {
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-557-"));


    const file = join(dir, "lib.js");
    writeFileSync(file, LIB_JS);
    const r = await draftContract(file);
    const draftPath = sidecarDraftPath(file);
    const handEdited = `// HAND EDITED BY USER\n${r.draftSource}`;
    writeFileSync(draftPath, handEdited, "utf-8");

    const w = writeContractDraft(file, r.draftSource, { entries: r.entries });
    expect(w.written).toBe(false);
    expect(w.skipped).toBe("hand-edited");
    expect(readFileSync(draftPath, "utf-8")).toBe(handEdited);

    const text = formatDraftSummary("lib.js", draftPath, r, w).join("\n");
    expect(text).toContain("hand-edited");
    expect(text).toContain("not overwritten");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-557-"));


    const file = join(dir, "lib.js");
    writeFileSync(file, LIB_JS);
    const r1 = await draftContract(file);
    const draftPath = sidecarDraftPath(file);
    const w1 = writeContractDraft(file, r1.draftSource, { entries: r1.entries });
    expect(w1.written).toBe(true);

    // 源变了 ⇒ 新草稿文本不同 ⇒ 机器原稿（指纹自洽）应被覆盖
    writeFileSync(file, `${LIB_JS}export function sub(a, b) {\n  return a - b;\n}\n`);
    const r2 = await draftContract(file);
    const w2 = writeContractDraft(file, r2.draftSource, { entries: r2.entries });
    expect(w2.written).toBe(true);
    expect(readFileSync(draftPath, "utf-8")).toBe(r2.draftSource);
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-557-"));


    const file = join(dir, "lib.js");
    writeFileSync(file, LIB_JS);
    const r = await draftContract(file);
    const draftPath = sidecarDraftPath(file);
    writeContractDraft(file, r.draftSource, { entries: r.entries });
    const w2 = writeContractDraft(file, r.draftSource, { entries: r.entries });
    expect(w2.changed).toBe(false);
    expect(w2.written).toBe(false);
    expect(w2.skipped).toBeUndefined();
  }
});



});

// ---------------------------------------------------------------------------
// （service 半）—— 项目根判据按**路径分量**，不按字符串前缀
// ---------------------------------------------------------------------------
describe("（service 半）—— 项目根判据按**路径分量**，不按字符串前缀", () => {
/**
 * `nudo contract --draft --write` 的**项目根边界**用
 * `rel.startsWith("..")` 判逃逸 ⇒ 项目根下的**合法目录** `..data/` 被判
 * 「在项目根之外」⇒ 草稿**拒写**。
 *
 * 根因：`relative()` 返回的是**相对路径字符串**——「向上逃逸」的判据是
 * 「整段等于 `..`」或「以 `..` + 路径分隔符开头」，**不是**裸
 * `startsWith("..")`：后者把 `..data/` / `...cfg/` 这类**合法**相对路径
 * （目录名以 `..` 开头）误判成父目录逃逸。
 *
 * 修法（族 20 · 片 B · **service 半**）：判据改成
 * `rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)`
 * —— 与 CLI 半（`packages/nudojs/src/commands/contract-draft.ts` 的
 * `runContractDraft`）**逐字同款**（同一个 bug 的两半 ⇒ 同一片修；
 * 不许抽成 core 的共享助手 —— core 冻结面不得新增导出）。
 *
 * ⚠ 本钉**只**钉 service 半（`writeContractDraft` 的项目根判据）；
 * CLI 半的钉在 `packages/nudojs/src/__tests__/cli--dotdir-escape.part.ts`。
 */






let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nudo-draft-665-"));
  writeFileSync(join(root, "package.json"), '{ "name": "dotdir-probe", "private": true }\n', "utf-8");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const DRAFT_SOURCE = `// @nudo:draft\nimport { fn } from "@nudojs/core";\n\nexport const f = fn({});\n`;


  it("项目根下的合法目录 `..data/` 不再被误判为越出项目根 ⇒ 草稿写盘成功；真正越出项目根的路径**仍被拒**（判据不许放宽成「一律放行」）；项目根下**文件名**以 `..` 开头（`..data.js`）同样不再被误判为逃逸", () => {
  {
  root = mkdtempSync(join(tmpdir(), "nudo-draft-665-"));
  writeFileSync(join(root, "package.json"), '{ "name": "dotdir-probe", "private": true }\n', "utf-8");


    const dir = join(root, "..data");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "f.js");
    writeFileSync(file, "export function f(x) { return x + 1; }\n", "utf-8");

    // 改前：这里抛 `draft write refused: outside project root …`
    const w = writeContractDraft(file, DRAFT_SOURCE, { projectDir: root });

    expect(w.written).toBe(true);
    expect(existsSync(sidecarDraftPath(file))).toBe(true);
  }
  {
  root = mkdtempSync(join(tmpdir(), "nudo-draft-665-"));
  writeFileSync(join(root, "package.json"), '{ "name": "dotdir-probe", "private": true }\n', "utf-8");


    const outside = mkdtempSync(join(tmpdir(), "nudo-draft-665-out-"));
    try {
      const file = join(outside, "f.js");
      writeFileSync(file, "export function f(x) { return x + 1; }\n", "utf-8");

      expect(() => writeContractDraft(file, DRAFT_SOURCE, { projectDir: root })).toThrow(
        /outside project root/,
      );
      expect(existsSync(sidecarDraftPath(file))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  }
  {
  root = mkdtempSync(join(tmpdir(), "nudo-draft-665-"));
  writeFileSync(join(root, "package.json"), '{ "name": "dotdir-probe", "private": true }\n', "utf-8");


    const file = join(root, "..data.js");
    writeFileSync(file, "export function f(x) { return x + 1; }\n", "utf-8");

    // 改前：`rel === "..data.js"` ⇒ `startsWith("..")` ⇒ 抛「outside project root」
    const w = writeContractDraft(file, DRAFT_SOURCE, { projectDir: root });

    expect(w.written).toBe(true);
    expect(existsSync(sidecarDraftPath(file))).toBe(true);
  }
});



});

// ---------------------------------------------------------------------------
// 匿名 default 导出的侧车键
// ---------------------------------------------------------------------------
describe("匿名 default 导出的侧车键", () => {
/**
 * `nudo contract --draft` 对**匿名 default 导出**写出的侧车键是
 * 合成的本地名 **`_default`**，而真正生效的键是 **`default`** ⇒ 用户照工具
 * 指引把草稿抄进 `*.nudo.js` 后，契约**完全失效**（门禁假绿）；而同一产品
 * 的 `--emit` 面却把同一个函数写成 `export { _nudo_1 as default }` ⇒ 两条
 * 路径自相矛盾。
 *
 * 根因：草稿把**分析名**洗成合法标识符当侧车键，**不查模块的导出名表**
 * ⇒ 侧车键 = 本地名（匿名 default 导出没有本地名 ⇒ 合成 `_default`）。
 *
 * 修法：草稿侧车键取**导出身份**（`exportedNameOfLocal`，与
 * `contract-emitter.ts` 的 `--emit` 面同源）；绑定名不安全时走别名形态
 * `const _nudo_N = …; export { _nudo_N as <identity> };`。
 */









let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-942-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const DEFAULT_JS = `/**\n * @nudo:case "ok" (1, 2)\n */\nexport default (a, b) => a + b;\n`;


  it("侧车键 = 导出身份 default（改前：_default ⇒ 绑不上）；草稿产物真能过 node --check；照抄草稿进侧车 ⇒ 契约真的绑上（改前：键 _default ⇒ 绑不上 ⇒ 假绿）", async () => {
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-942-"));


    const file = join(dir, "lib.js");
    writeFileSync(file, DEFAULT_JS);
    const r = await draftContract(file);
    const entry = r.entries.find((e) => e.fn === "default");
    expect(entry).toBeDefined();
    expect(entry!.identity).toBe("default");
    expect(r.draftSource).toContain("export { _nudo_1 as default };");
    expect(r.draftSource).not.toContain("_default");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-942-"));


    const file = join(dir, "lib.js");
    writeFileSync(file, DEFAULT_JS);
    const r = await draftContract(file);
    const draftPath = sidecarDraftPath(file);
    writeFileSync(draftPath, r.draftSource, "utf-8");
    const check = nodeCheck(draftPath);
    expect(check.ok, check.stderr).toBe(true);
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-942-"));


    const file = join(dir, "lib.js");
    writeFileSync(file, DEFAULT_JS);
    const r = await draftContract(file);
    // 照工具指引：把草稿原样抄成正式侧车
    writeFileSync(sidecarDraftPath(file).replace(/\.nudo\.draft\./, ".nudo."), r.draftSource, "utf-8");
    const eff = effectiveContract(DEFAULT_JS, "default", {
      loadModule: defaultLoadModule,
      fromFile: file,
      autoBind: true,
    });
    expect(eff).toBeDefined();
    expect(eff!.params.map((p) => p.param)).toEqual(["a", "b"]);
  }
});



});

// ---------------------------------------------------------------------------
// --freeze 不得把违反被调方契约的见证写进被调方
// ---------------------------------------------------------------------------
describe("--freeze 不得把违反被调方契约的见证写进被调方", () => {
/**
 * `nudo test --freeze` 把**违反被调方契约**的见证写进被调方 ⇒
 * 绿色被调方被自己的 freeze 操作冻成红色（`nudo:case-inconsistency`，error 级）。
 *
 * 根因：固化只筛「可序列化」与「非手写」，**从不把候选见证与被调方的有效契约
 * 比对** ⇒ 调用方的违约被搬进被调方，随后由见证面（check-case-scan）对着
 * **被调方**判红。
 *
 * 契约：违反**被写方自己的手写契约**的候选见证**不写入**；归因留在调用现场
 * （`nudo:contract-domain-exceeds`）。不可判（非字面量实参 / 结构契约）⇒ 放行
 * ——「不写」= 丢证据，比「写错」更危险。
 */





// 字面量助手单源：core/internal 的 absLit（与 case-emitter.test.ts 同源）


/** 无信息的实参 / 结果 Abs（`conf="partial"`，与 case-emitter.test.ts 同款） */
function unknownAbs(): Abs {
  return makeAbs({ k: "unknown" }, undefined, undefined, "partial");
}




const LIB = `/// @nudo:import { positive } from "./tmpl.nudo.js"
/**
 * @nudo:contract x positive
 */
export function needsPositive(x) {
  return x * 2;
}
`;

/** 手搓 analysis（固化只消费 callsite case 的 argAbs / 名字 / 锚点） */
function analysisOf(
  name: string,
  line: number,
  paramNames: string[],
  cases: Array<{ name: string; args: Abs[] }>,
): AnalysisResult {
  const fn: FunctionAnalysis___nudojs_service = {
    name,
    loc: { start: { line, column: 0 }, end: { line, column: 0 } },
    paramNames,
    cases: cases.map((c) => ({
      name: c.name,
      argAbs: c.args,
      abs: unknownAbs(),
      throwsAbs: unknownAbs(),
      source: "callsite",
    })),
  };
  return {
    functions: [fn],
    diagnostics: [],
    bindings: new Map(),
    nodeAbsMap: new Map(),
    caseHints: [],
  };
}

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-055-"));
  writeFileSync(join(dir, "tmpl.nudo.js"), "export const positive = number().gt(0);\n", "utf-8");
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("-freeze 不得把违反被调方契约的见证写进被调方", () => {
  it("违约见证（-1 ⊭ x > 0）不写入；合规见证照写；skip 记 contract-violation；不可判 ⇒ 放行（非字面量实参不猜；不写 = 丢证据）；无宿主接线（不给 filePath/loadModule）⇒ 契约不可读 ⇒ 契约闸不生效（行为与改前一致）", () => {
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-055-"));
  writeFileSync(join(dir, "tmpl.nudo.js"), "export const positive = number().gt(0);\n", "utf-8");
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");


    const out = insertGeneratedCaseDirectives(
      LIB,
      analysisOf("needsPositive", 5, ["x"], [
        { name: "call@usage.js:L2", args: [absLit(5)] },
        { name: "call@usage.js:L3", args: [absLit(-1)] },
      ]),
      { filePath: join(dir, "lib.js"), loadModule: defaultLoadModule___nudojs_service },
    );
    expect(out.source).toContain('@nudo:case "call@usage.js:L2" (5)');
    // 旧行为：`@nudo:case "call@usage.js:L3" (-1)` 被写进来 ⇒ 随后 check 判红
    expect(out.source).not.toContain("call@usage.js:L3");
    expect(out.written).toEqual([{ fn: "needsPositive", cases: ["call@usage.js:L2"] }]);
    const skip = out.skipped.find((s) => s.reason === "contract-violation");
    expect(skip?.fn).toBe("needsPositive");
    expect(skip?.detail).toContain("call@usage.js:L3");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-055-"));
  writeFileSync(join(dir, "tmpl.nudo.js"), "export const positive = number().gt(0);\n", "utf-8");
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");


    const out = insertGeneratedCaseDirectives(
      LIB,
      analysisOf("needsPositive", 5, ["x"], [
        // 形状未知的实参（unknown 无 term）→ 无法证明违约
        { name: "call@usage.js:L9", args: [unknownAbs()] },
      ]),
      { filePath: join(dir, "lib.js"), loadModule: defaultLoadModule___nudojs_service },
    );
    expect(out.skipped.some((s) => s.reason === "contract-violation")).toBe(false);
    expect(out.written.length).toBe(1);
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-055-"));
  writeFileSync(join(dir, "tmpl.nudo.js"), "export const positive = number().gt(0);\n", "utf-8");
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");


    const out = insertGeneratedCaseDirectives(
      LIB,
      analysisOf("needsPositive", 5, ["x"], [{ name: "call@usage.js:L3", args: [absLit(-1)] }]),
    );
    expect(out.source).toContain('@nudo:case "call@usage.js:L3" (-1)');
  }
});


});
});

// ---------------------------------------------------------------------------
// update 链不得净删除活着的生成态见证
// ---------------------------------------------------------------------------
describe("update 链不得净删除活着的生成态见证", () => {
/**
 * `nudo test --freeze=update` **静默删除**一条**仍然活着**的见证 ⇒
 * 不可恢复（add 模式又因「有手写 case ⇒ 整函数跳过」拒绝重建）⇒ 数据丢失 +
 * 事后 health 转绿（假绿）。
 *
 * 根因（两处，同一族）：
 * ① `stripGeneratedCaseDirectives` 无条件剥离 `call@` 指令 → 残留的手写 case
 * 让回写阶段按**函数级**「hand-written」整跳 ⇒ 生成态见证净损失；
 * ② `insertGeneratedCaseDirectives` 的「手写 ⇒ 整函数跳过」规则是**只增不改**
 * 的 add 模式规则，被 update 链的重建阶段沿用了。
 *
 * 契约：含手写 case 的块**不剥离**生成态见证（剥离 → 回写往返闭合）；
 * 重建阶段按**见证身份**逐条重建（手写 case 只挡**同名**）。
 */


// 字面量助手单源：core/internal 的 absLit（与 case-emitter.test.ts 同源）


/** 无信息的实参 / 结果 Abs（`conf="partial"`，与 case-emitter.test.ts 同款） */
function unknownAbs(): Abs {
  return makeAbs({ k: "unknown" }, undefined, undefined, "partial");
}



const MIXED = `/**
 * @nudo:case "call@site.js:L2" (5, 6)
 * @nudo:case "mine" (3, 4) => 7
 */
export function add(a, b) { return a + b; }
`;

const HAND_WRITTEN_ONLY = `/**
 * @nudo:case "mine" (3, 4) => 7
 */
export function add(a, b) { return a + b; }
`;

function analysisOf(cases: Array<{ name: string; args: Abs[] }>): AnalysisResult {
  const fn: FunctionAnalysis___nudojs_service = {
    name: "add",
    loc: { start: { line: 4, column: 0 }, end: { line: 4, column: 0 } },
    paramNames: ["a", "b"],
    cases: cases.map((c) => ({
      name: c.name,
      argAbs: c.args,
      abs: unknownAbs(),
      throwsAbs: unknownAbs(),
      source: "callsite",
    })),
  };
  return {
    functions: [fn],
    diagnostics: [],
    bindings: new Map(),
    nodeAbsMap: new Map(),
    caseHints: [],
  };
}


  it("① strip 不剥离「含手写 case 的块」里的生成态见证（往返闭合）；① 对照：块内**没有**手写 case ⇒ 照常剥离（update 仍能重同步）；② rebuildGenerated：手写 case 只挡同名，不挡 call@ 见证的重建；② 对照：add 模式（默认）仍是「手写 ⇒ 整函数跳过」（不动用户手写块）；② 手写 case 的载荷与新调用点相同不得顶掉该见证（载荷等价只判生成态之间）", () => {
  {
    const { source, removed } = stripGeneratedCaseDirectives(MIXED);
    expect(source).toBe(MIXED);
    expect(removed).toEqual([]);
  }
  {
    const only = `/**
 * @nudo:case "call@site.js:L2" (5, 6)
 */
export function add(a, b) { return a + b; }
`;
    const { source, removed } = stripGeneratedCaseDirectives(only);
    expect(removed).toEqual(["call@site.js:L2"]);
    expect(source).not.toContain("@nudo:case");
  }
  {
    const out = insertGeneratedCaseDirectives(
      HAND_WRITTEN_ONLY,
      analysisOf([{ name: "call@site.js:L2", args: [absLit(5), absLit(6)] }]),
      { rebuildGenerated: true },
    );
    expect(out.skipped.some((s) => s.reason === "hand-written")).toBe(false);
    expect(out.written).toEqual([{ fn: "add", cases: ["call@site.js:L2"] }]);
    const text = out.source;
    expect(text).toContain('@nudo:case "call@site.js:L2" (5, 6)');
    expect(text).toContain('@nudo:case "mine" (3, 4) => 7');
  }
  {
    const out = insertGeneratedCaseDirectives(
      HAND_WRITTEN_ONLY,
      analysisOf([{ name: "call@site.js:L2", args: [absLit(5), absLit(6)] }]),
    );
    expect(out.source).toBe(HAND_WRITTEN_ONLY);
    expect(out.skipped).toEqual([{ fn: "add", reason: "hand-written" }]);
  }
  {
    const out = insertGeneratedCaseDirectives(
      HAND_WRITTEN_ONLY,
      analysisOf([{ name: "call@site.js:L7", args: [absLit(3), absLit(4)] }]),
      { rebuildGenerated: true },
    );
    expect(out.written).toEqual([{ fn: "add", cases: ["call@site.js:L7"] }]);
  }
});





});
