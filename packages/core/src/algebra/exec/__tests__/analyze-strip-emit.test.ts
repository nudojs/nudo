/**
 * analyze 模式**发射期顶层剥离**（transpile/analyze-strip.ts）的回归。
 *
 * 语义契约由 run-strip-effectful.test.ts 锁（走 runTranspiled）；本文件锁
 * 发射层事实：
 * - 判定表（源 AST：控制流**按发射形态**——for/while 剥，if 按块包装判据，
 *   for-in/for-of 保留；危险与未知全局调用；簿记 / `$` 前缀 / 本地调用）；
 * - analyze 产物**已在发射期干净**（无顶层效应语句、无生成码 post-pass）；
 * - var 提升按原始 body 计算（被剥块内的 `var` 仍有模块顶绑定）；
 * - exec 模式逐字节不变；analyze 与 exec 的差异只是「语句被整条删除」。
 */
import { describe, it, expect } from "vitest";
import { parse } from "@babel/parser";

import { transpileModule, transpileSource } from "../transpile.ts";
import { analyzeTopLevelStatements } from "../transpile/analyze-strip.ts";
import { parseSource } from "../../parse-source.ts";
import { runTranspiled, callTranspiledExportFull } from "../run.ts";

/** 源 AST 过滤结果（按源码切片保留原文，便于逐条断言）。 */
function keptStatements(src: string): string[] {
  const file = parseSource(src);
  return analyzeTopLevelStatements(file.program.body).map((s) =>
    src.slice(s.start!, s.end!),
  );
}

/** 生成码顶层语句的源文本（host 产物无 import/export 语句）。 */
function topLevelTexts(code: string): string[] {
  const ast = parse(code, { sourceType: "module" });
  return ast.program.body.map((n) => code.slice(n.start!, n.end!));
}

/** 生成码中仍存在的顶层效应形态（应被剥的控制流语句 / 插桩控制流调用）。 */
function topLevelEffectSummary(code: string): string[] {
  const ast = parse(code, { sourceType: "module" });
  const out: string[] = [];
  for (const stmt of ast.program.body) {
    if (stmt.type === "ForStatement" || stmt.type === "WhileStatement") {
      out.push(stmt.type);
      continue;
    }
    if (stmt.type !== "ExpressionStatement") continue;
    if (stmt.expression.type !== "CallExpression") continue;
    const callee = stmt.expression.callee;
    if (callee.type !== "Identifier") continue;
    if (callee.name === "$for" || callee.name === "$fork" || callee.name.startsWith("$while")) {
      out.push(callee.name);
    }
  }
  return out;
}

function analyzeHost(src: string, mode: "exec" | "analyze"): string {
  return transpileModule(src, { mode, target: "host", runtimeImport: null }).code;
}

function litOf(abs: unknown): unknown {
  const term = (abs as { term?: { op: string; value: unknown } }).term;
  return term?.op === "lit" ? term.value : undefined;
}

function callExport(src: string, name: string): { result: unknown } {
  const run = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(run, name, []);
}

describe("analyzeTopLevelStatements：源 AST 判定表", () => {
  it("剥离顶层 for / while（发射为顶层 $for / $whileSeq）", () => {
    expect(keptStatements(`for (;;) {}`)).toEqual([]);
    expect(keptStatements(`while (a) {}`)).toEqual([]);
  });

  it("顶层 if 按发射形态：有自由绑定写 ⇒ 保留（block）；否则剥（裸 $fork）", () => {
    expect(keptStatements(`if (a) { b(); }`)).toEqual([]);
    expect(keptStatements(`let n = 0;\nif (n > 0) { n = 2; }`)).toEqual([
      `let n = 0;`,
      `if (n > 0) { n = 2; }`,
    ]);
  });

  it("保留顶层 for-in / for-of / do-while（旧 post-pass 均保留）", () => {
    expect(keptStatements(`for (const k in o) {}`)).toEqual([
      `for (const k in o) {}`,
    ]);
    expect(keptStatements(`for (const k of o) {}`)).toEqual([`for (const k of o) {}`]);
    expect(keptStatements(`do { } while (a)`)).toEqual([`do { } while (a)`]);
  });

  it("剥离危险全局与未知全局调用；console / 成员调用保留（$invoke 等价）", () => {
    expect(keptStatements(`fetch("x");`)).toEqual([]);
    expect(keptStatements(`setTimeout(f, 1);`)).toEqual([]);
    expect(keptStatements(`setInterval(f, 1);`)).toEqual([]);
    expect(keptStatements(`registerThing(1);`)).toEqual([]);
    expect(keptStatements(`require("./m");`)).toEqual([]);
    // 成员调用（含 console.*）生成形态是 $invoke —— 旧谓词保留
    expect(keptStatements(`console.log("x");`)).toEqual([`console.log("x");`]);
    expect(keptStatements(`console["warn"]("x");`)).toEqual([
      `console["warn"]("x");`,
    ]);
    expect(keptStatements(`obj.m();`)).toEqual([`obj.m();`]);
    // 非调用表达式（赋值 / 更新 / new / IIFE / 可选调用链）保留
    expect(keptStatements(`x = 1;`)).toEqual([`x = 1;`]);
    expect(keptStatements(`new Foo();`)).toEqual([`new Foo();`]);
    expect(keptStatements(`(() => {})();`)).toEqual([`(() => {})();`]);
    expect(keptStatements(`a?.();`)).toEqual([`a?.();`]);
  });

  it("剥离插桩控制流名；其它 $ 前缀运算符保留", () => {
    expect(keptStatements(`$for(0, f, f, f, 8);`)).toEqual([]);
    expect(keptStatements(`$fork(t, a, b);`)).toEqual([]);
    expect(keptStatements(`$whileSeq(t, b);`)).toEqual([]);
    expect(keptStatements(`$while(t, b);`)).toEqual([]);
    expect(keptStatements(`$lit(1);`)).toEqual([`$lit(1);`]);
    expect(keptStatements(`$invoke(console, "log", () => [], [1, 0]);`)).toEqual([
      `$invoke(console, "log", () => [], [1, 0]);`,
    ]);
  });

  it("被剥 for 的 init 保留：var 声明 / 表达式；let/const 丢弃", () => {
    // 旧生成形态：init 在 $for 之前（var 是模块顶提升绑定 / 表达式副作用）
    expect(keptStatements(`for (var i = 0; i < 1; i++) {}`)).toEqual([`var i = 0`]);
    expect(keptStatements(`for (var i = 0, j = 5; false;) {}`)).toEqual([
      `var i = 0, j = 5`,
    ]);
    expect(keptStatements(`let i = 0;\nfor (i = 3; i < 4; i++) {}`)).toEqual([
      `let i = 0;`,
      `i = 3`,
    ]);
    expect(keptStatements(`label: for (var i = 0; i < 1; i++) {}`)).toEqual([
      `var i = 0`,
    ]);
    // let/const 是循环块作用域：不逃出循环 ⇒ 不补发
    expect(keptStatements(`for (let k = 0; k < 1; k++) {}`)).toEqual([]);
    expect(keptStatements(`for (const k = 0; false;) {}`)).toEqual([]);
  });

  it("簿记调用保留（全部六种）", () => {
    const names = [
      "__nudoExport",
      "__nudoExportLazy",
      "__nudoExportStar",
      "__nudoRecordBinding",
      "__nudoRecordAssign",
      "__nudoRegisterImportRefresh",
    ];
    for (const name of names) {
      expect(keptStatements(`${name}("x");`)).toEqual([`${name}("x");`]);
    }
  });

  it("已声明本地调用保留（声明可后置）；未声明 $callNamed 剥离", () => {
    expect(keptStatements(`local();\nfunction local() {}`)).toEqual([
      `local();`,
      `function local() {}`,
    ]);
    expect(
      keptStatements(`function local() {}\n$callNamed("local", local, []);`),
    ).toEqual([`function local() {}`, `$callNamed("local", local, []);`]);
    expect(keptStatements(`$callNamed("ghost", ghost, []);`)).toEqual([]);
  });

  it("成员调用 / try / switch / throw / 声明保留", () => {
    expect(keptStatements(`obj.m();`)).toEqual([`obj.m();`]);
    expect(keptStatements(`arr.forEach((x) => {});`)).toEqual([
      `arr.forEach((x) => {});`,
    ]);
    expect(keptStatements(`try { } catch (e) { }`)).toEqual([
      `try { } catch (e) { }`,
    ]);
    expect(keptStatements(`switch (x) { default: break; }`)).toEqual([
      `switch (x) { default: break; }`,
    ]);
    expect(keptStatements(`throw new Error("x");`)).toEqual([
      `throw new Error("x");`,
    ]);
    expect(keptStatements(`const a = 1;`)).toEqual([`const a = 1;`]);
    expect(keptStatements(`export function f() { return 1; }`)).toEqual([
      `export function f() { return 1; }`,
    ]);
  });

  it("解构 / import 本地名 / var 提升名算已声明", () => {
    expect(keptStatements(`const { a } = o;\na();`)).toEqual([
      `const { a } = o;`,
      `a();`,
    ]);
    expect(keptStatements(`import { x } from "./m.js";\nx();`)).toEqual([
      `import { x } from "./m.js";`,
      `x();`,
    ]);
    // 块内 var 提升到模块顶（发射期 let <名> = $lit(void 0)）⇒ 同名调用保留；
    // if 臂内 var 赋值算自由绑定写 ⇒ if 生成 block（旧 post-pass 保留整块）
    expect(keptStatements(`if (c) { var hv = 1; }\nhv();`)).toEqual([
      `if (c) { var hv = 1; }`,
      `hv();`,
    ]);
  });

  it("标签语句按内层循环口径：for/while 剥，for-in/for-of/块保留", () => {
    expect(keptStatements(`label: for (;;) {}`)).toEqual([]);
    expect(keptStatements(`label: while (a) {}`)).toEqual([]);
    expect(keptStatements(`label: for (const k in o) {}`)).toEqual([
      `label: for (const k in o) {}`,
    ]);
    expect(keptStatements(`label: for (const k of o) {}`)).toEqual([
      `label: for (const k of o) {}`,
    ]);
    expect(keptStatements(`label: {}`)).toEqual([`label: {}`]);
  });
});

describe("analyze 模式发射：产物已无顶层效应语句（无需 post-pass）", () => {
  const SRC = [
    `const obj = { a: 1, b: 2 };`,
    `if (cond) { console.log("if"); }`,
    `for (let i = 0; i < 2; i++) { console.log("for"); }`,
    `for (const k in obj) { console.log(k); }`,
    `while (cond) { console.log("while"); }`,
    `console.log("console");`,
    `fetch("http://x");`,
    `setTimeout(() => {}, 1);`,
    `setInterval(() => {}, 1);`,
    `registerThing(1);`,
    `function local() { return 1; }`,
    `local();`,
    `try { registerThing(); } catch (e) {}`,
    `export function f() { return local(); }`,
  ].join("\n");

  it("无顶层 for/while / 插桩控制流 / 危险全局调用残留", () => {
    const code = analyzeHost(SRC, "analyze");
    expect(topLevelEffectSummary(code)).toEqual([]);
    expect(code).not.toContain("$for(");
    expect(code).not.toContain("$whileSeq(");
    expect(code).not.toContain(`$callNamed("fetch"`);
    expect(code).not.toContain(`$callNamed("setTimeout"`);
    expect(code).not.toContain(`$callNamed("setInterval"`);
    // 只有 try 体内的未知全局调用留下（顶层那条被剥）
    expect(code.match(/\$callNamed\("registerThing"/g)).toHaveLength(1);
  });

  it("for-in / console.* / 本地调用 / try / 声明保留（旧 post-pass 口径）", () => {
    const code = analyzeHost(SRC, "analyze");
    expect(code).toContain("$forInKeys(");
    expect(code).toContain(`$invoke(console, "log"`);
    expect(code).toContain(`$callNamed("local"`);
    expect(code).toContain("try {");
    expect(code).toContain('__nudoExportLazy("f"');
  });

  it("顶层 if（臂内写自由绑定）保留：block $fork 执行（旧 post-pass 保留）", () => {
    const IF_SRC = `let n = 1;
if (n > 0) { n = 2; }
export function f() { return n; }`;
    const code = analyzeHost(IF_SRC, "analyze");
    expect(code).toContain("$fork(");
    expect(litOf(callExport(IF_SRC, "f").result)).toBe(2);
  });

  it("exec 模式保留效应语句（对照）", () => {
    const code = analyzeHost(SRC, "exec");
    expect(topLevelEffectSummary(code).length).toBeGreaterThan(0);
    expect(code).toContain(`$callNamed("fetch"`);
    expect(code).toContain(`$callNamed("registerThing"`);
  });
});

describe("analyze 模式：var 提升 / for-init 保留（旧 post-pass 口径）", () => {
  const FOR_SRC = `for (var i = 0; i < 1; i++) {}
export function f() { return i; }`;

  it("被剥 for 内的 var 仍有模块顶提升行 + init 赋值 / 记录发射", () => {
    const code = analyzeHost(FOR_SRC, "analyze");
    expect(code).toMatch(/let i = \$lit\(void 0\)/);
    expect(code).toContain("i = $lit(0)");
    expect(code).toContain('$recordBinding("i", i)');
    expect(code).not.toContain("$for(");
  });

  it("for (var i = 0; …) 的循环不执行但 i 读 0（旧：init 在 $for 之前保留）", () => {
    expect(litOf(callExport(FOR_SRC, "f").result)).toBe(0);
  });

  it("多声明符 var init 全部保留", () => {
    const SRC = `for (var i = 0, j = 5; false;) {}
export function f() { return i + j; }`;
    expect(litOf(callExport(SRC, "f").result)).toBe(5);
  });

  it("表达式 init 的副作用保留（赋值在 $for 之前求值）", () => {
    const SRC = `let i = 0;
for (i = 3; i < 4; i++) {}
export function f() { return i; }`;
    const code = analyzeHost(SRC, "analyze");
    expect(code).not.toContain("$for(");
    expect(code).toContain("$assignRecord(");
    expect(litOf(callExport(SRC, "f").result)).toBe(3);
  });

  it("let / const init 丢弃（块级作用域不逃出循环）", () => {
    const code = analyzeHost(
      `for (let k = 0; k < 1; k++) {}
for (const m = 0; false;) {}
export function f() { return 1; }`,
      "analyze",
    );
    expect(code).not.toContain("k = $lit(0)");
    expect(code).not.toContain("m = $lit(0)");
    expect(code).not.toContain("$for(");
  });

  it("顶层 if（保留块）内的 var 提升行 + 赋值都发射", () => {
    const SRC = `if (true) { var hv = 7; }
export function f() { return hv; }`;
    const code = analyzeHost(SRC, "analyze");
    expect(code).toMatch(/let hv = \$lit\(void 0\)/);
    expect(code).toContain("hv = $lit(7)");
    expect(litOf(callExport(SRC, "f").result)).toBe(7);
  });
});

describe("analyze 模式保留语句的执行语义", () => {
  it("for-of 保留：体执行（n=3）", () => {
    const SRC = `let n = 0;
for (const k of [1, 2]) { n = n + k; }
export function f() { return n; }`;
    expect(analyzeHost(SRC, "analyze")).toContain("$forOf(");
    expect(litOf(callExport(SRC, "f").result)).toBe(3);
  });

  it("for-in 保留（发射 $forOf($forInKeys(...))）：体执行（n=2）", () => {
    const SRC = `let n = 0;
for (const k in { a: 1, b: 2 }) { n = n + 1; }
export function f() { return n; }`;
    const code = analyzeHost(SRC, "analyze");
    expect(code).toContain("$forOf(");
    expect(code).toContain("$forInKeys(");
    expect(litOf(callExport(SRC, "f").result)).toBe(2);
  });

  it("本地调用 / 成员调用保留：副作用可见（n=2）", () => {
    const SRC = `let n = 0;
function bump() { n = n + 1; }
bump();
[1].forEach((x) => { n = n + x; });
export function f() { return n; }`;
    expect(litOf(callExport(SRC, "f").result)).toBe(2);
  });

  it("顶层 try/catch 保留：catch 吸收未知全局", () => {
    const SRC = `try { registerThing(); } catch (e) {}
export function f() { return 1; }`;
    expect(litOf(callExport(SRC, "f").result)).toBe(1);
  });
});

describe("exec 与 analyze 的差异只是整条删除语句", () => {
  // 注意：这里刻意不放 `for` —— 循环变量槽名用模块级序号（__nudoLv<n>），
  // 同进程多次 transpile 会递增，逐字节比较只对不含该计数器的源成立。
  const SRC = [
    `if (cond) { console.log("if"); }`,
    `console.log("console");`,
    `fetch("http://x");`,
    `function local() { return 1; }`,
    `local();`,
    `export const a = 1;`,
    `export function f() { return local(); }`,
  ].join("\n");

  it("exec 模式逐字节等于缺省发射", () => {
    expect(transpileSource(SRC, { mode: "exec" })).toBe(transpileSource(SRC));
  });

  it("analyze 顶层语句是 exec 顶层语句的有序子序列（未改写保留语句）", () => {
    const execTexts = topLevelTexts(analyzeHost(SRC, "exec"));
    const analyzeTexts = topLevelTexts(analyzeHost(SRC, "analyze"));
    expect(analyzeTexts.length).toBeGreaterThan(0);
    expect(analyzeTexts.length).toBeLessThan(execTexts.length);
    let idx = 0;
    for (const text of analyzeTexts) {
      while (idx < execTexts.length && execTexts[idx] !== text) idx++;
      expect(idx).toBeLessThan(execTexts.length);
      idx++;
    }
  });
});
