/**
 * 模块套件：cli-products-contract-emit（CLI e2e 分片；1 文件 = 1 worker）。
 */
import { describe, it, expect, afterAll, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { runCliTsx as runCli, writeSrcTsconfig, repoRoot } from "./helpers/run-cli.ts";
import { spawnSync } from "node:child_process";


// ---------------------------------------------------------------------------
// TS-only 的模块出口语句必须被剥除（产物是合法 JS）
// ---------------------------------------------------------------------------
describe("TS-only 的模块出口语句必须被剥除（产物是合法 JS）", () => {
/**
 * TS-only 的 `export =` / `export as namespace` 未剥 ⇒ 产物**根本
 * 不是合法 JS**（`node --check` 报 SyntaxError），而 `migrate verify` 对同一
 * 文件**报 OK / exit 0**（假绿）。
 *
 * **真源**：`packages/core/src/strip-types.ts`（语句级删除判定补
 * `TSExportAssignment` / `TSNamespaceExportDeclaration`）。本钉是**产物面**
 * 的回归钉：产物必须 `node --check` 过，且不得残留这两条 TS-only 语句。
 *
 * ⚠ 验收口径是「**strip 不产出坏产物**」——`migrate verify` 的契约是「跑
 * `nudo check`」，**不在**族 12 的改动范围（跨族增强须先改文档）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const EXPORT_ASSIGN_TS = `declare namespace N { const x: number; }
export = N;
`;
const NAMESPACE_EXPORT_TS = `export as namespace MyGlobal;
export declare const v: number;
`;

/** node --check（语法检查，不执行） */
function nodeCheck(path: string): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf-8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}


  it("`export =` 被剥除 ⇒ 产物 `node --check` 过；`export as namespace` 被剥除 ⇒ 产物 `node --check` 过；兜底闸门认得这两条语句（真源漏网 ⇒ 拒绝写盘 + 点名文件 + exit 1）", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-446-"));
    dirs.push(dir);
    writeFileSync(join(dir, "a.ts"), EXPORT_ASSIGN_TS, "utf-8");

    const r = runCli(["migrate", "strip", "--write", "--no-draft", join(dir, "a.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "a.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    expect(code).not.toContain("export =");
    // 分析面把 `export =` 降级成等价的 CJS 出口（BUG-160），**产物面**不得跟着
    // 多出这条语句：`export =` 仍然整条删除 + 仍然打那条「出口面没了」的提示。
    expect(code).not.toContain("module.exports");
    expect(`${r.stdout}${r.stderr}`).toContain("CommonJS export surface is gone");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-446b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "b.ts"), NAMESPACE_EXPORT_TS, "utf-8");

    const r = runCli(["migrate", "strip", "--write", "--no-draft", join(dir, "b.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "b.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    expect(code).not.toContain("export as namespace");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  }
  {
    // 判据层断言：闸门对「剥完仍有 TS-only 出口语句」的文件必须报错。
    // 这里用**只读**的探针口径：以 `.ts` 源为输入 ⇒ 若真源漏网，命令层闸门
    // 会拦下（真源修好后不拦 ⇒ 下面的 exit 0 就是「不误伤」）。
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-446c-"));
    dirs.push(dir);
    writeFileSync(join(dir, "a.ts"), EXPORT_ASSIGN_TS, "utf-8");
    writeFileSync(join(dir, "b.ts"), NAMESPACE_EXPORT_TS, "utf-8");

    const r = runCli(["migrate", "strip", "--write", "--no-draft", dir]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");
    for (const name of ["a.js", "b.js"]) {
      const check = nodeCheck(join(dir, name));
      expect(check.status, `${name}\n${check.stderr}`).toBe(0);
    }
  }
});



});


// ---------------------------------------------------------------------------
// export — @nudo:skip 的函数不被静默丢掉（）
// ---------------------------------------------------------------------------
describe("export — @nudo:skip 的函数不被静默丢掉（）", () => {
/**
 * `@nudo:skip` 的函数被导出入口 filter **静默丢掉**。
 *
 * 根因：`selectExportFunctions` 只放行「有 case 见证」的函数，而 `@nudo:skip`
 * 按设计**不合成** entry@ 见证（零 case）⇒ skip 函数永远进不了导出面 ⇒
 * 导出面少一块，且 dts 生成器专为 skip 建的 `contractOnlySignature` 路径永不可达。
 *
 * 钉：skip 函数（带契约）必须出现在四个产物面里。
 */






/** 带 `@nudo:skip` + 参数契约的导出函数（约束名走 `@nudo:import` 绑定）。 */
function writeSkipFixture(dir: string): void {
  writeFileSync(
    join(dir, "std.nudo.js"),
    `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "skipped.js"),
    `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:skip
 * @nudo:contract a positive
 */
export function skipped(a) {
  throw new Error("unreachable");
}
`,
    "utf-8",
  );
}


  it("skip 函数进导出面（zod / standard / dts / guard 四面都有）；skip 函数在 --out 落盘面同样有产物（四个文件都在）", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug600-"));
    writeSkipFixture(dir);

    const r = runCli(["export", join(dir, "skipped.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    // zod 面：skip 函数的入参校验器在（契约面 a: number > 0）
    expect(r.stdout).toContain("skippedInput");
    // standard 面：skip 函数的参数位在
    expect(r.stdout).toContain("skipped_a");
    // guard 面：skip 函数的块在（无 case ⇒ 无守卫函数，但块本身不被丢掉）
    expect(r.stdout).toContain("// === skipped Type Guards ===");
    // dts 面：skip 函数的声明在（走 contractOnlySignature 路径）
    expect(r.stdout).toMatch(/export declare function skipped\(/);
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug600-out-"));
    writeSkipFixture(dir);

    const out = join(dir, "out");
    const r = runCli(["export", join(dir, "skipped.js"), "--format", "all", "--out", out]);
    expect(r.status).toBe(0);
    const files = readdirSync(out);
    // schema / standard / guard / dts —— skip 函数不再让任何一面缺席
    expect(files.some((f) => f.includes("schema"))).toBe(true);
    expect(files.some((f) => f.includes("standard"))).toBe(true);
    expect(files.some((f) => f.includes("guard"))).toBe(true);
    expect(files.some((f) => f.endsWith(".d.ts"))).toBe(true);
    const std = files.find((f) => f.includes("standard"));
    expect(std).toBeDefined();
    expect(readFileSync(join(out, std!), "utf-8")).toContain("skipped_a");
  }
});


});


// ---------------------------------------------------------------------------
// nudo export --out · 不覆盖手写产物
// ---------------------------------------------------------------------------
describe("nudo export --out · 不覆盖手写产物", () => {
/**
 * `nudo export --out` **静默覆盖手写的 `.d.ts`** ⇒ 类型精度倒退，
 * exit 0、零提示。
 *
 * 钉：目标已存在且**不是本工具生成的** ⇒ 拒绝覆盖（exit 1 + 可诊断的
 * `nudo:path-io` 面），手写文件逐字不变。
 */






const HANDWRITTEN = "export declare function add(a: number, b: number): number;\n";


  it("手写 .d.ts 在 out 目录里 ⇒ 拒绝覆盖 + exit 1 + 文件逐字不变；本工具自己生成的产物 ⇒ 允许覆盖更新（同模块重导）", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-617-"));
    const file = join(dir, "lib.js");
    writeFileSync(file, "export function add(a, b) {\n  return a + b;\n}\n", "utf-8");
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });
    const target = join(out, "lib.d.ts");
    writeFileSync(target, HANDWRITTEN, "utf-8");

    const r = runCli(["export", file, "--format", "dts", "--out", out]);
    expect(r.status).toBe(1);
    // 手写文件逐字不变（类型精度没被替换成 unknown）
    expect(readFileSync(target, "utf-8")).toBe(HANDWRITTEN);
    // 诊断面可读：说清「不是本工具生成的」
    expect(r.stderr).toContain("was not generated by nudo export");
    expect(r.stderr).toContain("lib.d.ts");
    expect(r.stderr).toContain("fix:");
    // 没有谎报成功
    expect(r.stdout).not.toContain("wrote ");
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-617b-"));
    const file = join(dir, "lib.js");
    writeFileSync(file, "export function add(a, b) {\n  return a + b;\n}\n", "utf-8");
    const out = join(dir, "out");

    const first = runCli(["export", file, "--format", "dts", "--out", out]);
    expect(first.status).toBe(0);
    const body = readFileSync(join(out, "lib.d.ts"), "utf-8");
    const second = runCli(["export", file, "--format", "dts", "--out", out]);
    expect(second.status).toBe(0);
    expect(readFileSync(join(out, "lib.d.ts"), "utf-8")).toBe(body);
  }
}); // 1 个 CLI 子进程（tsx 冷启动）

   // 2 个顺序 CLI 子进程

});


// ---------------------------------------------------------------------------
// export — 四个产物面共用导出面闸门（）
// ---------------------------------------------------------------------------
describe("export — 四个产物面共用导出面闸门（）", () => {
/**
 * 四个产物面「哪些函数算公开」有**四套口径**：dts 面按模块导出面
 * 裁剪，zod / standard / guard 三面**不裁剪** ⇒ 源模块**一个导出都没有**时，
 * 三个运行时校验器产物照样产出（内部实现被当成公开契约），`.d.ts` 却静默缺席。
 *
 * 根因：`onExportFace` 这道**模块公开面**闸门只装在 dts 分支上。
 *
 * 钉：导出面过滤下沉到循环入口 ⇒ 四个面共用一道闸门（内部函数不进任何一面）。
 */






/** 只有一个**非导出**函数的模块（的原始夹具形状）。 */
function writeInternalOnlyFixture(dir: string): void {
  writeFileSync(
    join(dir, "lib.js"),
    `/** @nudo:case "c1" (1) => 2 */
function internal(x) {
  return x + 1;
}
`,
    "utf-8",
  );
}


  it("非导出函数不进 zod / standard / guard 三面（stdout 面）；非导出函数不进任何落盘产物（--out 面）；导出面函数照常进四（闸门不误伤公开面）", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug621-"));
    writeInternalOnlyFixture(dir);

    const r = runCli(["export", join(dir, "lib.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    // 内部函数不得出现在任何产物面
    expect(r.stdout).not.toContain("internalInput");
    expect(r.stdout).not.toContain("internalOutput");
    expect(r.stdout).not.toContain("internal_x");
    expect(r.stdout).not.toContain("isinternalOutput");
    // 零产物如实说明（不是静默零产物）
    expect(r.stdout).toContain("No exported declarations found");
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug621-out-"));
    writeInternalOnlyFixture(dir);

    const out = join(dir, "out");
    const r = runCli(["export", join(dir, "lib.js"), "--format", "all", "--out", out]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("No exported declarations found");
    // 目录里没有任何产物文件（四个面一致缺席）
    expect(existsSync(out) ? readdirSync(out) : []).toEqual([]);
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug621-keep-"));
    writeFileSync(
      join(dir, "pub.js"),
      `/** @nudo:case "c1" (1) => 2 */
export function public1(x) {
  return x + 1;
}
`,
      "utf-8",
    );

    const r = runCli(["export", join(dir, "pub.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("public1Input");
    expect(r.stdout).toContain("public1_x");
    expect(r.stdout).toContain("ispublic1Output");
    expect(r.stdout).toContain("export declare function public1");
  }
});



});


// ---------------------------------------------------------------------------
// nudo contract --emit --fn 未命中 · 过滤器不降级
// ---------------------------------------------------------------------------
describe("nudo contract --emit --fn 未命中 · 过滤器不降级", () => {
/**
 * `nudo contract --emit --fn <拼错的名字>` **静默丢弃过滤器**。
 *
 * 改前（`runContractEmit`）：`--fn` 名单经 `localNamedExports` 过滤后，
 * **命中数为 0 时把过滤结果整段降级成 `undefined`** ⇒ 发射器收不到任何
 * `fnNames` ⇒ 作用域从「只写这一个」静默放大成「刷新全部既有 `@generated` 段」
 * （叠加 `--all` 时放大成「新建全部导出段」）⇒ **写盘**、exit 0、零告警。
 *
 * 钉（族 20 · 片 C）：
 * ① **全部未命中** ⇒ 当**用法错误**：列出本地导出名候选、**exit 1**、**不写盘**
 * （侧车逐字不变 ⇒ 作用域没有被放大）；
 * ② **部分命中** ⇒ 未命中的名字**原样**传给发射器 ⇒ 走发射器**已存在**的
 * `skipped <fn> (not-an-export)` 通道（与 LSP / agent 面同款文案）；
 * ③ 对照组：名字正确时**只**改那一个（作用域没被放大）。
 *
 * ⚠ **口径**（对照组里的 alpha 段）：emit 持久化**精确观测字面量**（BUG-113）
 * —— 一次调用 `alpha({ x: 5 })` 折出 `shape({ x: lit(5) })` / `lit(5)`。
 * `widenObservationAbs` 的宽化只属于 **draft 面**；`@generated` 段本身是
 * 事实快照（不执法、只 drift），公开产物面（export）也不拿它当义务。
 */






const LIB = `export function alpha(p) {
  return p.x;
}
export function beta(p) {
  return p.y;
}
`;

const USAGE = `import { alpha, beta } from "./lib.js";

alpha({ x: 5 });
beta({ y: 6 });
`;

const SIDECAR = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:alpha
export const alpha = fn({ p: shape({ x: lit(1) }) }, lit(1));

// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:beta
export const beta = fn({ p: shape({ y: lit(2) }) }, lit(2));
`;

/** 夹具：lib.js + 调用点 usage.js（域证据）+ 已有生成段的 lib.nudo.js */
function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-657-"));
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");
  writeFileSync(join(dir, "usage.js"), USAGE, "utf-8");
  writeFileSync(join(dir, "lib.nudo.js"), SIDECAR, "utf-8");
  return dir;
}


  it("全部未命中 ⇒ 用法错误（exit 1）+ 列出候选 + **侧车逐字不变**；未命中 ⇒ 连 dry-run 预览都不给（不产生放大作用域的 diff）；部分命中 ⇒ 未命中的名字走 `skipped <fn> (not-an-export)` 通道（与 LSP/agent 同构）；对照组：名字正确 ⇒ 只改那一个（beta 的段不被刷新）", () => {
  {
    const dir = makeFixture();
    const sidecar = join(dir, "lib.nudo.js");

    const r = runCli(
      ["contract", "--emit", "--fn", "alhpa", "--from", "usage.js", "--", "lib.js"],
      { cwd: dir },
    );

    // 用法错误面：exit 1 + 说清哪个名字没命中 + 列出本地导出名候选
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("alhpa");
    expect(r.stderr).toContain("available exports");
    expect(r.stderr).toContain("alpha");
    expect(r.stderr).toContain("beta");
    // 没有谎报成功，也没有偷偷写盘
    expect(r.stdout).not.toContain("written:");
    expect(r.stdout).not.toContain("Updated");
    // 侧车逐字不变（作用域没被放大成「刷新全部既有生成段」）
    expect(readFileSync(sidecar, "utf-8")).toBe(SIDECAR);
  }
  {
    const dir = makeFixture();

    const r = runCli(
      ["contract", "--emit", "--fn", "alhpa", "--dry-run", "--from", "usage.js", "--", "lib.js"],
      { cwd: dir },
    );

    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("would update");
    expect(r.stdout).not.toContain("+export const beta");
  }
  {
    const dir = makeFixture();

    const r = runCli(
      [
        "contract",
        "--emit",
        "--fn",
        "alpha",
        "--fn",
        "nope",
        "--dry-run",
        "--from",
        "usage.js",
        "--",
        "lib.js",
      ],
      { cwd: dir },
    );

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("skipped nope (not-an-export)");
    // 命中的那个照常处理（只改 alpha）
    expect(r.stdout).toContain("would update lib.nudo.js");
    expect(r.stdout).not.toContain("-export const beta");
  }
  {
    const dir = makeFixture();

    const r = runCli(
      ["contract", "--emit", "--fn", "alpha", "--dry-run", "--from", "usage.js", "--", "lib.js"],
      { cwd: dir },
    );

    expect(r.status).toBe(0);
    // BUG-113：emit 持久化**精确观测字面量** —— `alpha({ x: 5 })` 折出
    // `shape({ x: lit(5) })` / `lit(5)`（宽化只属于 draft 面）。
    expect(r.stdout).toContain("+export const alpha = fn({ p: shape({ x: lit(5) }) }, lit(5));");
    // beta 的生成段**不在**改动面里（只作为 diff 上下文出现）
    expect(r.stdout).not.toContain("-export const beta");
    expect(r.stdout).not.toContain("+export const beta");
  }
}); // 1 个 CLI 子进程（tsx 冷启动）

   // 1 个 CLI 子进程

   // 1 个 CLI 子进程

   // 1 个 CLI 子进程

});


// ---------------------------------------------------------------------------
// contract --json 的 stdout 必须是**一份** JSON（跨文件聚合）
// ---------------------------------------------------------------------------
describe("contract --json 的 stdout 必须是**一份** JSON（跨文件聚合）", () => {
/**
 * `nudo contract <目录> --draft --json` 的 stdout 是 **N 份 JSON 拼接**
 * （`JSON.parse` 抛 "Unexpected non-whitespace character after JSON"）。
 *
 * 根因：JSON 出口是**单文档**（每个 root 一次 `console.log`），而命令层对每个
 * root 各跑一次 ⇒ **没有跨文件聚合层**。
 *
 * 修法（族 20 · 片 A）：命令层加**跨文件聚合层** ⇒ 收集所有 root 的机器文档后
 * **一次**打印；**单文件也走同一路径** ⇒ 顶层恒为**数组**（单文件 = 单元素数组）。
 *
 * ⚠ 本钉同时锁住 **print 分支**（`nudo contract --json <目录>`）：改前它同样
 * 是多份 JSON 拼接（报告标题只写了 `--draft --json`，实测 print 分支也拼）。
 */






let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-658-"));
  writeFileSync(join(dir, "a.js"), "export function one() { return 1; }\n", "utf-8");
  writeFileSync(join(dir, "b.js"), "export function two() { return 2; }\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type JsonEntry = {
  file?: string;
  entries?: { fn: string }[];
  draftPath?: string;
  draftSource?: string;
  diff?: string;
};


  it("目录 + --draft --json：stdout 可被 JSON.parse 解析（改前抛）；目录 + --json（print 分支）：同样是一份 JSON 数组（改前是多份拼接）；单文件 + --json：顶层仍是数组（单元素）⇒ 形态恒定；单文件 + --draft --json：顶层仍是数组（单元素）⇒ 形态恒定；非 --json 面不受影响（人类面仍是逐文件文本，不是 JSON）", () => {
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-658-"));
  writeFileSync(join(dir, "a.js"), "export function one() { return 1; }\n", "utf-8");
  writeFileSync(join(dir, "b.js"), "export function two() { return 2; }\n", "utf-8");


    const r = runCli(["contract", ".", "--draft", "--json"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    let parsed: JsonEntry[];
    expect(() => {
      parsed = JSON.parse(r.stdout) as JsonEntry[];
    }).not.toThrow();
    const docs = parsed!;
    // 顶层恒为数组（形态恒定）
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.file).sort()).toEqual(["a.js", "b.js"]);
    for (const d of docs) {
      expect(typeof d.draftSource).toBe("string");
      expect(typeof d.draftPath).toBe("string");
      expect(typeof d.diff).toBe("string");
      expect(Array.isArray(d.entries)).toBe(true);
    }
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-658-"));
  writeFileSync(join(dir, "a.js"), "export function one() { return 1; }\n", "utf-8");
  writeFileSync(join(dir, "b.js"), "export function two() { return 2; }\n", "utf-8");


    const r = runCli(["contract", ".", "--json"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    const docs = JSON.parse(r.stdout) as JsonEntry[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.file).sort()).toEqual(["a.js", "b.js"]);
    expect(docs.map((d) => d.entries?.map((e) => e.fn)).flat().sort()).toEqual(["one", "two"]);
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-658-"));
  writeFileSync(join(dir, "a.js"), "export function one() { return 1; }\n", "utf-8");
  writeFileSync(join(dir, "b.js"), "export function two() { return 2; }\n", "utf-8");


    const r = runCli(["contract", "a.js", "--json"], { cwd: dir });
    expect(r.status).toBe(0);
    const docs = JSON.parse(r.stdout) as JsonEntry[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(1);
    expect(docs[0].file).toBe("a.js");
    expect(docs[0].entries?.map((e) => e.fn)).toEqual(["one"]);
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-658-"));
  writeFileSync(join(dir, "a.js"), "export function one() { return 1; }\n", "utf-8");
  writeFileSync(join(dir, "b.js"), "export function two() { return 2; }\n", "utf-8");


    const r = runCli(["contract", "a.js", "--draft", "--json"], { cwd: dir });
    expect(r.status).toBe(0);
    const docs = JSON.parse(r.stdout) as JsonEntry[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(1);
    expect(docs[0].file).toBe("a.js");
    expect(docs[0].draftSource).toContain("// @nudo:draft");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-658-"));
  writeFileSync(join(dir, "a.js"), "export function one() { return 1; }\n", "utf-8");
  writeFileSync(join(dir, "b.js"), "export function two() { return 2; }\n", "utf-8");


    const r = runCli(["contract", "."], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("a.js");
    expect(r.stdout).toContain("one");
    expect(() => JSON.parse(r.stdout)).toThrow();
  }
});





});


// ---------------------------------------------------------------------------
// --from-dts 不得绕过用法校验（先校验、后分派）
// ---------------------------------------------------------------------------
describe("--from-dts 不得绕过用法校验（先校验、后分派）", () => {
/**
 * `nudo contract --from-dts` 在**所有用法校验之前**短路
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

describe("-from-dts 不得绕过用法校验（先校验、后分派）", () => {
  it("--from-dts + --emit --draft：报互斥错误 + exit 1（改前：静默出 draft、exit 0）；--from-dts + --exit-on-diff：报前置条件错误 + exit 1（改前：静默忽略、exit 0）；--from-dts + --json：显式拒绝（机器面拿不到 JSON ⇒ 不是静默吞旗标）；控制组：--from-dts（无旗标）仍然照常出 draft 正文 + exit 0（不误伤）；控制组：--from-dts + --", () => {
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-659-"));
  dts = join(dir, "types.d.ts");
  writeFileSync(dts, "export declare function mul(a: number, b: number): number;\n", "utf-8");


    const r = runCli(["contract", "--from-dts", dts, "--emit", "--draft"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Usage error: --emit and --draft are mutually exclusive");
    // 不得产出 draft 正文（分派在校验之后 ⇒ 根本没跑）
    expect(r.stdout).not.toContain("// @nudo:draft");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-659-"));
  dts = join(dir, "types.d.ts");
  writeFileSync(dts, "export declare function mul(a: number, b: number): number;\n", "utf-8");


    const r = runCli(["contract", "--from-dts", dts, "--exit-on-diff"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--exit-on-diff requires --emit --dry-run");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-659-"));
  dts = join(dir, "types.d.ts");
  writeFileSync(dts, "export declare function mul(a: number, b: number): number;\n", "utf-8");


    const r = runCli(["contract", "--from-dts", dts, "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    // stdout 是**机器可读**的拒绝信封（不是 draft 文本）
    const docs = JSON.parse(r.stdout) as { pathErrors?: { code: string; message: string }[] }[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(1);
    expect(docs[0].pathErrors?.[0]?.code).toBe("nudo:usage-error");
    expect(docs[0].pathErrors?.[0]?.message).toContain("--json cannot be combined with --from-dts");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-659-"));
  dts = join(dir, "types.d.ts");
  writeFileSync(dts, "export declare function mul(a: number, b: number): number;\n", "utf-8");


    const r = runCli(["contract", "--from-dts", dts], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("// @nudo:draft");
    expect(r.stdout).toContain("export const mul = fn({ a: number(), b: number() }, number());");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-659-"));
  dts = join(dir, "types.d.ts");
  writeFileSync(dts, "export declare function mul(a: number, b: number): number;\n", "utf-8");


    const r = runCli(["contract", "--from-dts", dts, "--write"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("wrote");
    // ⚠ 族 20 · （片 C）起：草稿落点是**贴着源 `.d.ts`**的
    // `sidecarDraftPath` 口径，**不再**是以 CWD 为基准的
    // `types.nudo.draft.js`（那会静默覆盖同基名的另一个文件的草稿）。
    // ⚠ 落点名的 `.d.` 段按 （`tmp/bug-report/sections/.md`
    // + `.changeset/fix-bug-cat-09-cli-check.md`）：`.d.ts` 源的侧车/草稿名
    // **不得含 `.d.`**（basename 含 `.d.` ⇒ TypeScript 判成声明文件 ⇒
    // 草稿与它建议的复制落点都过不了 `tsc --strict`，TS1254）⇒
    // `types.d.ts` ⇒ `types.nudo.draft.ts`（**不是** `types.d.nudo.draft.ts`）。
    // 用例意图不变：「--from-dts + --write」是合法组合，不被用法校验误伤。
    expect(existsSync(join(dir, "types.nudo.draft.ts"))).toBe(true);
    expect(existsSync(join(dir, "types.nudo.draft.js"))).toBe(false);
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-659-"));
  dts = join(dir, "types.d.ts");
  writeFileSync(dts, "export declare function mul(a: number, b: number): number;\n", "utf-8");


    const lib = join(dir, "lib.js");
    writeFileSync(lib, "export function f() { return 1; }\n", "utf-8");
    const r = runCli(["contract", "--emit", "--draft", lib], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Usage error: --emit and --draft are mutually exclusive");
  }
});





});
});


// ---------------------------------------------------------------------------
// --from-dts 多文件草稿的接受目标提示（逐导出点名各自模块侧车）
// ---------------------------------------------------------------------------
describe("--from-dts 多文件草稿的接受目标提示", () => {
/**
 * 多文件模式合并 N 个 `.d.ts` 的导出，但草稿头行仍按**单个**接受目标说
 * `copy into a.nudo.ts to enforce`（`dtsFiles[0]` 的侧车）⇒ 照它把来自
 * `b.d.ts` 的导出抄进 a 的侧车 ⇒ 永不绑定（静默零义务）。
 *
 * 钉：多文件模式的 stdout **不得**出现单一接受的 `copy into …`；逐导出点名
 * 会绑定的侧车（每个导出各自的运行时模块旁边），并说明跨模块接受不生效。
 * 单文件模式的既有提示由 `cli-contract.e2e` 的钉子覆盖（不在本文件里回归）。
 */
it("stdout 头行不得再点名单一 sidecar（逐导出点名各自模块侧车）", () => {
  const dir = mkdtempSync(join(tmpdir(), "nudo-from-dts-multi-guidance-"));
  try {
    writeFileSync(join(dir, "package.json"), `{"name":"multi","type":"module"}\n`, "utf-8");
    writeFileSync(join(dir, "a.js"), "export function alpha(n) { return n; }\n", "utf-8");
    writeFileSync(join(dir, "a.d.ts"), "export declare function alpha(n: number): number;\n", "utf-8");
    writeFileSync(join(dir, "b.js"), "export function beta(s) { return s; }\n", "utf-8");
    writeFileSync(join(dir, "b.d.ts"), "export declare function beta(s: string): string;\n", "utf-8");

    const r = runCli(["contract", "--from-dts", "."], { cwd: dir });
    expect(r.status).toBe(0);
    // 头行不得再给单一接受目标（旧口径：`copy into a.nudo.ts to enforce`）
    expect(r.stdout).not.toContain("copy into ");
    // 逐导出点名**会绑定**的侧车（定义该导出的运行时模块旁边）
    expect(r.stdout).toContain(
      "accept each export into the sidecar of the module that DEFINES it",
    );
    expect(r.stdout).toMatch(/alpha\s+\(from a\.d\.ts\) → a\.nudo\.js/);
    expect(r.stdout).toMatch(/beta\s+\(from b\.d\.ts\) → b\.nudo\.js/);
    expect(r.stdout).toContain("never bound (silent green)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000); // 1 个 CLI 子进程（tsx 冷启动）
});


// ---------------------------------------------------------------------------
// contract --draft --write --dry-run 必须打 unified diff
// ---------------------------------------------------------------------------
describe("contract --draft --write --dry-run 必须打 unified diff", () => {
/**
 * `nudo contract --draft --write --dry-run` **不打 unified diff**
 * （只打一行「[dry-run] would write → …」），而 CLI Reference 承诺
 * `--dry-run` = "Print a unified diff instead of writing"
 * （`packages/website/docs/api/cli-reference.md` 的 contract 选项表）。
 *
 * 根因：unified diff 的生成器**只接在 `--emit` 分支**上 ⇒ 同一个 `--dry-run`
 * 旗标在 `--emit` 与 `--draft` 两条分支上**语义不同**。
 *
 * 修法（族 20 · 片 B）：`--draft` 分支的 `--dry-run` **复用 `--emit` 分支的
 * 同一个 diff 生成器**（`unifiedDiff` 已在 `@nudojs/service/emit`
 * ⇒ 零新增导出、两侧共用同一实现，不另写一份）。
 *
 * ⚠ 本钉的夹具**全部写在临时目录**里（cwd = 临时目录）⇒ 绝不往仓里写文件。
 */






let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-660-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "b660", "private": true, "type": "module" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "calc.js"), "export function calc(x) {\n  return x + 1;\n}\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});


  it("dry-run 打 unified diff（--- a/ + ++ b/ + @@ hunk）且**不写盘**；负控制：非 dry-run 的 `--draft --write` 仍然写盘，且**不打** diff；diff 头与 `--emit --dry-run` 的头**同款**（同一个 unifiedDiff 生成器）", () => {
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-660-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "b660", "private": true, "type": "module" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "calc.js"), "export function calc(x) {\n  return x + 1;\n}\n", "utf-8");


    const r = runCli(["contract", "--draft", "--write", "--dry-run", "calc.js"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    // diff 头（与 `--emit --dry-run` 同一个生成器 ⇒ 同款头）
    expect(r.stdout).toContain("--- a/calc.nudo.draft.js");
    expect(r.stdout).toContain("+++ b/calc.nudo.draft.js");
    // 真正的 hunk（不是只有一行路径提示）
    expect(r.stdout).toMatch(/^@@ /m);
    expect(r.stdout).toContain("+export const calc = fn({});");
    // dry-run **不写盘**
    expect(existsSync(join(dir, "calc.nudo.draft.js"))).toBe(false);
    // 改前：stdout 只有「[dry-run] would write → …」，**没有** diff
    expect(r.stdout).toContain("[dry-run] would write → calc.nudo.draft.js");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-660-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "b660", "private": true, "type": "module" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "calc.js"), "export function calc(x) {\n  return x + 1;\n}\n", "utf-8");


    const r = runCli(["contract", "--draft", "--write", "calc.js"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("Draft written → calc.nudo.draft.js");
    expect(r.stdout).not.toContain("--- a/");
    expect(existsSync(join(dir, "calc.nudo.draft.js"))).toBe(true);
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-660-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "b660", "private": true, "type": "module" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "calc.js"), "export function calc(x) {\n  return x + 1;\n}\n", "utf-8");


    // `--emit --dry-run` 的对照面：既有 `@generated` 侧车 + 改了返回值的源
    // ⇒ 发射器算出「侧车会变」⇒ 打出 diff 头。
    writeFileSync(
      join(dir, "lib.nudo.js"),
      "// @generated by nudo — do not edit; regenerate with `nudo contract --emit`\n// source: lib.js:one\nexport const one = fn({  }, lit(1));\n",
      "utf-8",
    );
    writeFileSync(join(dir, "lib.js"), "export function one() {\n  return 2;\n}\n", "utf-8");

    const emit = runCli(["contract", "--emit", "--dry-run", "lib.js"], { cwd: dir });
    const draft = runCli(["contract", "--draft", "--write", "--dry-run", "calc.js"], { cwd: dir });

    expect(emit.status).toBe(0);
    expect(draft.status).toBe(0);
    // 两条分支的 diff 头**同形**（`--- a/<path>` / `+++ b/<path>`）
    const headOf = (s: string): string[] =>
      s.split("\n").filter((l) => l.startsWith("--- a/") || l.startsWith("+++ b/"));
    expect(headOf(emit.stdout)).toEqual(["--- a/lib.nudo.js", "+++ b/lib.nudo.js"]);
    expect(headOf(draft.stdout)).toEqual([
      "--- a/calc.nudo.draft.js",
      "+++ b/calc.nudo.draft.js",
    ]);
  }
}); // 1 个 CLI 子进程（tsx 冷启动）

   // 1 个 CLI 子进程（tsx 冷启动）

   // 2 个 CLI 子进程（tsx 冷启动）

});


// ---------------------------------------------------------------------------
// nudo contract --emit --dry-run · 预览标签取侧车
// ---------------------------------------------------------------------------
describe("nudo contract --emit --dry-run · 预览标签取侧车", () => {
/**
 * `nudo contract --emit --dry-run` 的**预览标签点名源文件**，
 * 而 **diff 的目标是侧车** ⇒ 工具声称「会更新 `lib.js`」，实际只会改
 * `lib.nudo.js`；同文件另两分支（派生分支 / 写盘分支）都取**侧车** ⇒
 * **单点笔误**，不是取舍。
 *
 * 钉（族 20 · 片 C）：dry-run 预览标签取**侧车路径**
 * （`result.sidecarPath`），与 diff 头、与另两分支**同口径**。
 */






const LIB = `export function alpha(p) {
  return p.x;
}
export function beta(p) {
  return p.y;
}
`;

const USAGE = `import { alpha, beta } from "./lib.js";

alpha({ x: 5 });
beta({ y: 6 });
`;

const SIDECAR = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:alpha
export const alpha = fn({ p: shape({ x: lit(1) }) }, lit(1));

// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:beta
export const beta = fn({ p: shape({ y: lit(2) }) }, lit(2));
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-662-"));
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");
  writeFileSync(join(dir, "usage.js"), USAGE, "utf-8");
  writeFileSync(join(dir, "lib.nudo.js"), SIDECAR, "utf-8");
  return dir;
}


  it("dry-run 标签点名**侧车**（与 diff 头同口径），不再点名源文件", () => {
    const dir = makeFixture();

    const r = runCli(
      ["contract", "--emit", "--dry-run", "--from", "usage.js", "--", "lib.js"],
      { cwd: dir },
    );

    expect(r.status).toBe(0);
    // 标签 = 侧车
    expect(r.stdout).toContain("[dry-run] would update lib.nudo.js:");
    // 不再是源文件（标签与 diff 头指向两个不同文件的笔误已消）
    expect(r.stdout).not.toContain("would update lib.js:");
    // diff 头本来就指侧车 ⇒ 标签与 diff 头现在一致
    expect(r.stdout).toContain("--- a/lib.nudo.js");
    expect(r.stdout).toContain("+++ b/lib.nudo.js");
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

});


// ---------------------------------------------------------------------------
// contract --draft --json --write 必须**显式拒绝**
// ---------------------------------------------------------------------------
describe("contract --draft --json --write 必须**显式拒绝**", () => {
/**
 * `nudo contract --draft --json --write`：`--write` 被**静默丢弃**
 * ⇒ 草稿**根本没落盘**、**exit 0**、**零提示**（stdout 是合法 JSON、无
 * 「Draft written」）⇒ agent / CI 据此认为「契约已落盘」，磁盘上**没有**
 * 侧车草稿 ⇒ **假绿 + 静默数据丢失**。
 *
 * 根因：`--json` 分支以 `return` 早退 ⇒ 后面的 `--write` 分支**不可达**；
 * 而 `--json` 与 `--write` 都是 `--draft` 的合法搭配，**没有**互斥拒绝。
 *
 * 修法（族 20 · 片 B · 裁决 = **显式拒绝**）：`--json` 与 `--write` 互斥
 * ⇒ `error: --write cannot be combined with --json` + **exit 1**
 * ⇒ 「给了不生效且不报错」不再可能。
 *
 * ⚠ 机器面（`--json`）：stdout 仍是**一份合法 JSON 文档**（命令层的跨文件
 * 聚合层会把它收进恒定数组外壳）⇒ 载荷形状与命令层的 per-root 失败条目
 * 同款（`{file, errors:[{code, message}]}`）。
 *
 * ⚠ 本钉的夹具**全部写在临时目录**里（cwd = 临时目录）⇒ 绝不往仓里写文件。
 */






let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-663-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "b663", "private": true, "type": "module" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), "export function f(o) {\n  return o.v;\n}\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type JsonEntry = {
  file?: string;
  draftSource?: string;
  errors?: { code: string; message: string; suggestion?: string }[];
};

/**
 * 取「第一个 root 的机器文档」。
 *
 * 命令层的跨文件聚合层（族 20 · 片 A）让顶层**恒为数组**（单文件 = 单元素
 * 数组）；聚合层落地前的旧形态是**单文档**（顶层就是对象）⇒ 这里两种都吃，
 * 免得负控制用例被聚合层的形态变化误伤。
 */
function firstDoc(stdout: string): JsonEntry {
  const parsed = JSON.parse(stdout) as JsonEntry | JsonEntry[];
  return Array.isArray(parsed) ? (parsed[0] as JsonEntry) : parsed;
}


  it("--json + --write：exit 1 + 机器面给出理由 + 草稿**没有**落盘；负控制：`--draft --json`（无 --write）仍然照常出审阅载荷（不误伤）；负控制：`--draft --write`（无 --json）仍然照常写盘（不误伤）", () => {
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-663-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "b663", "private": true, "type": "module" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), "export function f(o) {\n  return o.v;\n}\n", "utf-8");


    const r = runCli(["contract", "--draft", "--json", "--write", "lib.js"], { cwd: dir });

    // 改前：exit 0、stdout 是合法 JSON、**草稿文件不存在**、零提示
    expect(r.status).toBe(1);
    // stdout 仍是**一份**合法 JSON（聚合层的外壳：恒为数组）
    const docs = JSON.parse(r.stdout) as JsonEntry[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(1);
    expect(docs[0].file).toBe("lib.js");
    expect(docs[0].errors?.[0]?.code).toBe("nudo:usage-error");
    expect(docs[0].errors?.[0]?.message).toContain("--write cannot be combined with --json");
    // 假绿 / 静默数据丢失已消：草稿**没有**被写出来
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(false);
    expect(r.stdout).not.toContain("Draft written");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-663-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "b663", "private": true, "type": "module" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), "export function f(o) {\n  return o.v;\n}\n", "utf-8");


    const r = runCli(["contract", "--draft", "--json", "lib.js"], { cwd: dir });

    expect(r.status).toBe(0);
    const doc = firstDoc(r.stdout);
    expect(doc.draftSource).toContain("// @nudo:draft");
    expect(doc.errors).toBeUndefined();
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-663-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "b663", "private": true, "type": "module" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), "export function f(o) {\n  return o.v;\n}\n", "utf-8");


    const r = runCli(["contract", "--draft", "--write", "lib.js"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Draft written → lib.nudo.draft.js");
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(true);
  }
}); // 1 个 CLI 子进程（tsx 冷启动）

   // 1 个 CLI 子进程（tsx 冷启动）

   // 1 个 CLI 子进程（tsx 冷启动）

});


// ---------------------------------------------------------------------------
// contract --json 遇语法错文件：失败 root 必须进载荷
// ---------------------------------------------------------------------------
describe("contract --json 遇语法错文件：失败 root 必须进载荷", () => {
/**
 * `nudo contract --draft --json` 遇**语法错文件**：
 * 单文件 ⇒ stdout **0 字节** + exit 1（违反同文件里自己写下的「绝不空 stdout +
 * exit 1」不变量）；多文件 ⇒ stdout 是一份**只含好文件**的合法 JSON，
 * **失败文件在载荷里彻底消失** ⇒ 机器消费者无法从 JSON 知道哪个文件失败。
 *
 * 修法（族 20 · 片 A）：per-root `catch` 在 `--json` 形态下**必须产 JSON body**
 * ⇒ 失败 root 进聚合结果的 `errors[]`（聚合层见 ）⇒ stdout 永不为空、
 * 载荷不缺项。
 */






let dir: string;
let good: string;
let broken: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-664-"));
  good = join(dir, "good.js");
  broken = join(dir, "syn.js");
  writeFileSync(good, "export function good() { return 1; }\n", "utf-8");
  writeFileSync(broken, "export function bad( {\n  return 1;\n}\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type JsonDoc = {
  file?: string;
  draftSource?: string;
  errors?: { code: string; message: string }[];
};


  it("单文件（语法错）+ --draft --json：stdout 非空 + 合法 JSON + errors[] + exit 1；目录（好文件 + 坏文件）+ --draft --json：坏文件**不再消失**（载荷不缺项）；print 形态（--json）+ 语法错：同样有 errors 条目（机器面统一）；人类面不变：stderr 仍点名失败文件 + exit 1", () => {
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-664-"));
  good = join(dir, "good.js");
  broken = join(dir, "syn.js");
  writeFileSync(good, "export function good() { return 1; }\n", "utf-8");
  writeFileSync(broken, "export function bad( {\n  return 1;\n}\n", "utf-8");


    const r = runCli(["contract", broken, "--draft", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout.trim().length).toBeGreaterThan(0);
    const docs = JSON.parse(r.stdout) as JsonDoc[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(1);
    expect(docs[0].file).toBe("syn.js");
    expect(docs[0].errors).toHaveLength(1);
    expect(docs[0].errors?.[0]?.code).toBe("nudo:contract-analysis-failed");
    expect(docs[0].errors?.[0]?.message.length).toBeGreaterThan(0);
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-664-"));
  good = join(dir, "good.js");
  broken = join(dir, "syn.js");
  writeFileSync(good, "export function good() { return 1; }\n", "utf-8");
  writeFileSync(broken, "export function bad( {\n  return 1;\n}\n", "utf-8");


    const r = runCli(["contract", ".", "--draft", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    const docs = JSON.parse(r.stdout) as JsonDoc[];
    expect(docs.length).toBeGreaterThanOrEqual(2);
    // 好文件的文档在
    expect(docs.some((d) => d.file === "good.js" && typeof d.draftSource === "string")).toBe(true);
    // 坏文件的失败条目也在
    const failed = docs.find((d) => d.file === "syn.js");
    expect(failed).toBeDefined();
    expect(failed?.errors?.[0]?.code).toBe("nudo:contract-analysis-failed");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-664-"));
  good = join(dir, "good.js");
  broken = join(dir, "syn.js");
  writeFileSync(good, "export function good() { return 1; }\n", "utf-8");
  writeFileSync(broken, "export function bad( {\n  return 1;\n}\n", "utf-8");


    const r = runCli(["contract", broken, "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout.trim().length).toBeGreaterThan(0);
    const docs = JSON.parse(r.stdout) as JsonDoc[];
    expect(docs[0].file).toBe("syn.js");
    expect(docs[0].errors?.[0]?.code).toBe("nudo:contract-analysis-failed");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-664-"));
  good = join(dir, "good.js");
  broken = join(dir, "syn.js");
  writeFileSync(good, "export function good() { return 1; }\n", "utf-8");
  writeFileSync(broken, "export function bad( {\n  return 1;\n}\n", "utf-8");


    const r = runCli(["contract", broken, "--draft", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Error analyzing");
    expect(r.stderr).toContain("syn.js");
  }
});




});


// ---------------------------------------------------------------------------
// nudo contract --json --emit · 机器面拿得到合法载荷
// ---------------------------------------------------------------------------
describe("nudo contract --json --emit · 机器面拿得到合法载荷", () => {
/**
 * `nudo contract --json --emit` **静默忽略 `--json`**。
 *
 * 改前（`runContractEmit`）：opts 类型里**没有** `json` 字段、函数体**不读**它，
 * action 的 emit 分支也**不传** ⇒ stdout 是**人类文本**、exit 0 ⇒ 机器面拿到
 * **非法 JSON** 且**无失败信号**。
 *
 * ⚠ 勘误（族 20 · 实测）：族 21 的 修好了 `--json`（无 `--draft`）那一支；
 * **本条只剩 `--json --emit` 一支**。且片 A 的 658/664 聚合层落地后，
 * 症状从「人类文本 + exit 0」变成「聚合信封里塞 `nudo:contract-json-payload-invalid`
 * 错误条目 + exit 1」⇒ **emit 结果仍然拿不到机器载荷**（退化成了 `output` 字符串）。
 *
 * 钉（族 20 · 片 C）：`--json --emit` ⇒ stdout 是**合法 JSON**、载荷是
 * **emit 的机器文档**（`file` / `sidecar` / `changed` / `written` / `skipped` /
 * `issues` / `diff`），与 print / draft 分支**同构**（聚合层的外壳 = 恒定数组）。
 */






const LIB = `export function alpha(p) {
  return p.x;
}
export function beta(p) {
  return p.y;
}
`;

const USAGE = `import { alpha, beta } from "./lib.js";

alpha({ x: 5 });
beta({ y: 6 });
`;

const SIDECAR = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:alpha
export const alpha = fn({ p: shape({ x: lit(1) }) }, lit(1));

// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:beta
export const beta = fn({ p: shape({ y: lit(2) }) }, lit(2));
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-667-"));
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");
  writeFileSync(join(dir, "usage.js"), USAGE, "utf-8");
  writeFileSync(join(dir, "lib.nudo.js"), SIDECAR, "utf-8");
  return dir;
}


  it("--json --emit ⇒ stdout 是合法 JSON 且载荷是 emit 的机器文档；--json --emit --dry-run ⇒ 载荷里带 diff（与 draft 分支同构）", () => {
  {
    const dir = makeFixture();

    const r = runCli(
      ["contract", "--json", "--emit", "--from", "usage.js", "--", "lib.js"],
      { cwd: dir },
    );

    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    // 机器面：stdout 恒为**一份**合法 JSON（聚合外壳 = 恒定数组）
    const parsed = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    const doc = parsed[0];
    expect(doc.file).toBe("lib.js");
    expect(doc.sidecar).toBe("lib.nudo.js");
    expect(doc.changed).toBe(true);
    expect(doc.written).toEqual(["alpha", "beta"]);
    expect(doc.skipped).toEqual([]);
    expect(doc.issues).toEqual([]);
    // 不是「分支层没吐 JSON 文档」的错误条目
    expect(doc.errors).toBeUndefined();
  }
  {
    const dir = makeFixture();

    const r = runCli(
      ["contract", "--json", "--emit", "--dry-run", "--from", "usage.js", "--", "lib.js"],
      { cwd: dir },
    );

    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
    const doc = parsed[0];
    expect(typeof doc.diff).toBe("string");
    expect(doc.diff as string).toContain("--- a/lib.nudo.js");
  }
}); // 1 个 CLI 子进程（tsx 冷启动）

   // 1 个 CLI 子进程

});


// ---------------------------------------------------------------------------
// [merged] from-dts-draft-invariants
// ---------------------------------------------------------------------------
describe("from-dts-draft-invariants", () => {
// MERGED (topic-related bug pins): from-dts-draft-invariants + from-dts-dry-run-diff + from-dts-write-path
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>






{
/**
 * `--from-dts --write` 的**草稿落点族**不变量（族 20 · 的
 * 收口回归；与 `from-dts-write-path` /
 * `nudojs--contract-cli-text.part.ts` 互补 —— 那两处钉的是
 * 「用例意图」，这里钉的是**规则本身**）。
 *
 * 钉：
 * ① 落点**贴着源 `.d.ts`**（`sidecarDraftPath` 口径）⇒ **不以 CWD 为基准**
 * ⇒ CWD 里的同名草稿不会被静默覆盖；
 * ② 落点名的 basename **不含 `.d.`**（`tmp/bug-report/sections/
 * .md` + `.changeset/fix-bug-cat-09-cli-check.md`）—— basename 含
 * `.d.` ⇒ TypeScript 的 `getDeclarationFileExtension` 判它是**声明文件**
 * ⇒ 草稿与工具建议的复制落点都过不了 `tsc --strict`（TS1254）⇒
 * 「next」提示点名的侧车路径同样不得含 `.d.`；
 * ③ 既有草稿**存在且内容不同** ⇒ **拒绝覆盖**（exit 1）+ 提示，提示**同时**
 * 给出两个放行口子（CLI 旗标 `--force` **与** 环境变量 `NUDO_DRAFT_FORCE`）
 * 并说明「人工改过的草稿永不被覆盖」；
 * ④ 放行口子是真的：**机器原稿**（内容不同）+ `--force` / `NUDO_DRAFT_FORCE=1`
 * ⇒ 覆盖成功；**人工改过的草稿** ⇒ `--force` 也**不放行**（逐字不变）。
 */






const DTS = `export declare function mul(a: number, b: number): number;
`;

/** 夹具：`types/index.d.ts`（源）+ CWD 里另一个文件的既有草稿 */
function makeFixture(dts: string = DTS): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-from-dts-inv-"));
  mkdirSync(join(dir, "types"), { recursive: true });
  writeFileSync(join(dir, "types", "index.d.ts"), dts, "utf-8");
  // CWD 里**另一个文件**（index.js）的既有草稿 —— 不得被 `--from-dts` 覆盖
  writeFileSync(join(dir, "index.nudo.draft.js"), "// @nudo:draft\n// 别的文件的草稿\n", "utf-8");
  return dir;
}

/** 落点（贴着源 `.d.ts`；basename 不含 `.d.`） */
function draftPathOf(dir: string): string {
  return join(dir, "types", "index.nudo.draft.ts");
}

describe("nudo contract --from-dts --write · 草稿落点族不变量", () => {
  it("落点贴着源 `.d.ts`，且 basename **不含 `.d.`**（BUG-264）；「next」提示点名的侧车路径也**不含 `.d.`**（建议的复制落点必须可编译）；既有草稿存在且内容不同 ⇒ 拒绝覆盖（exit 1）+ 提示**同时**给出两个放行口子；内容未变 ⇒ **不**拒绝（exit 0 + 「draft unchanged」）；机器原稿（内容不同）+ `--force` ⇒ 覆盖成功；机器原稿（内容不同）+ `NUDO_DRAFT_FORCE=1` ", () => {
  {
    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(0);
    const draft = draftPathOf(dir);
    expect(existsSync(draft)).toBe(true);
    // basename 含 `.d.` ⇒ TypeScript 判成声明文件 ⇒ 草稿过不了 tsc
    expect(basename(draft)).not.toContain(".d.");
    expect(readFileSync(draft, "utf-8")).toContain("export const mul");
    // 不以 CWD 为基准 ⇒ CWD 里**没有**同名新草稿，别的文件的草稿逐字不变
    expect(existsSync(join(dir, "index.nudo.draft.ts"))).toBe(false);
    expect(readFileSync(join(dir, "index.nudo.draft.js"), "utf-8")).toBe(
      "// @nudo:draft\n// 别的文件的草稿\n",
    );
  }
  {
    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("types/index.nudo.ts");
    // 旧名 `types/index.d.nudo.ts` 过不了 `tsc --strict`（TS1254）
    expect(r.stdout).not.toContain("types/index.d.nudo.ts");
  }
  {
    const dir = makeFixture();
    const draft = draftPathOf(dir);
    const existing = "// @nudo:draft\n// 人工留存的既有草稿（与新生成的内容不同）\n";
    writeFileSync(draft, existing, "utf-8");

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(1);
    expect(r.stderr).toContain("refusing to overwrite");
    // 提示**点名**目标落点（用户知道该去哪儿看）
    expect(r.stderr).toContain("types/index.nudo.draft.ts");
    // 两个放行口子都可见（旗标 + 环境变量）
    expect(r.stderr).toContain("--force");
    expect(r.stderr).toContain("NUDO_DRAFT_FORCE");
    // 措辞要准：人工改过的草稿永不被覆盖 ⇒ 这条拒绝是预期行为
    expect(r.stderr).toContain("hand-edited");
    // 既有草稿逐字不变 + 没有谎报成功
    expect(readFileSync(draft, "utf-8")).toBe(existing);
    expect(r.stdout).not.toContain("wrote ");
  }
  {
    const dir = makeFixture();
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const written = readFileSync(draftPathOf(dir), "utf-8");

    const second = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("draft unchanged");
    expect(readFileSync(draftPathOf(dir), "utf-8")).toBe(written);
  }
  {
    const dir = makeFixture();
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const machine = readFileSync(draftPathOf(dir), "utf-8");
    // 源 `.d.ts` 变了 ⇒ 新草稿内容不同（但仍是机器原稿 ⇒ 可覆盖）
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
    const after = readFileSync(draftPathOf(dir), "utf-8");
    expect(after).not.toBe(machine);
    expect(after).toContain("export const div");
  }
  {
    const dir = makeFixture();
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const machine = readFileSync(draftPathOf(dir), "utf-8");
    writeFileSync(
      join(dir, "types", "index.d.ts"),
      `${DTS}export declare function div(a: number, b: number): number;\n`,
      "utf-8",
    );

    const second = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], {
      cwd: dir,
      env: { NUDO_DRAFT_FORCE: "1" },
    });

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("wrote ");
    const after = readFileSync(draftPathOf(dir), "utf-8");
    expect(after).not.toBe(machine);
    expect(after).toContain("export const div");
  }
  {
    const dir = makeFixture();
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const draft = draftPathOf(dir);
    const machine = readFileSync(draft, "utf-8");
    expect(machine).toContain("@nudo:draft-fingerprint");
    // 人工改过正文 ⇒ 指纹失配 ⇒ 判定为「人工改过」
    const handEdited = `${machine}\n// 人工改动\n`;
    writeFileSync(draft, handEdited, "utf-8");

    const second = runCli(
      ["contract", "--from-dts", "types/index.d.ts", "--write", "--force"],
      { cwd: dir },
    );

    expect(second.status).toBe(1);
    expect(second.stderr).toContain("hand-edited");
    expect(readFileSync(draft, "utf-8")).toBe(handEdited);
    expect(second.stdout).not.toContain("wrote ");
  }
}); // 1 个 CLI 子进程（tsx 冷启动）

   // 1 个 CLI 子进程

   // 1 个 CLI 子进程

   // 2 个顺序 CLI 子进程

   // 2 个顺序 CLI 子进程

   // 2 个顺序 CLI 子进程

   // 2 个顺序 CLI 子进程
});
}

describe("from-dts-dry-run-diff", () => {
/**
 * （续）—— `nudo contract --from-dts --write --dry-run` 的预览是
 * **整份草稿正文的 dump**，不是 unified diff；且「既有草稿不同 ⇒ 拒绝覆盖」
 * 那一关跑在 dry-run 分支**之前** ⇒ dry-run 遇到既有草稿**直接报错退出**，
 * **连 diff 都看不到**。
 *
 * 改后（同一片修）：
 * ① dry-run 打 **unified diff**（对照面 = 既有草稿文件的磁盘内容；文件不存在
 * ⇒ 对空串求 diff ⇒ 整份都是新增行），**不再**倾倒草稿全文；
 * ② 标签行 `[dry-run] would write <path>` 保留（用户仍看得到目标路径）；
 * ③ dry-run 的**退出码与真写盘同口径**：真写会被拒（既有草稿不同且无
 * `--force` / 人工改过的草稿即使有 `--force`）⇒ dry-run 也 exit 1，但
 * **预览照打**（diff 仍然可见）；会写成功 ⇒ exit 0；
 * ④ dry-run **绝不写盘**（既有草稿逐字不变、新草稿不被创建）。
 *
 * ⚠ 夹具全部写在临时目录里（cwd = 临时目录），`finally` 里清理；夹具里写
 * `writeSrcTsconfig`（CLI 子进程按 cwd 找 tsconfig，否则 `@nudojs/*` 落到
 * `<pkg>/dist` 的旧构建 ⇒ 断言会测到陈旧实现）。夹具**不**依赖
 * `package.json`（`--from-dts` 的落点贴着源 `.d.ts`，不需要项目根）。
 */






const DTS = `export declare function mul(a: number, b: number): number;
`;

/** 新的机器草稿里 `mul` 那一行（harvester 的 fn() DSL 口径） */
const MUL_LINE = "export const mul = fn({ a: number(), b: number() }, number());";

/** 既有草稿：与新生成的内容**不同**（无指纹 ⇒ 会被判成人工改过） */
const EXISTING_DRAFT = `// @nudo:draft
// 人工留存的既有草稿（与新生成的内容不同）
`;

/** 落盘路径（贴着源 `.d.ts`，`sidecarDraftPath` 口径） */
const DRAFT_REL = "types/index.nudo.draft.ts";

/** 夹具：`types/index.d.ts`；`fn` 在 try/finally 里跑（临时目录必定清理）。 */
function withFixture(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-944-dry-run-"));
  try {
    writeSrcTsconfig(dir);
    mkdirSync(join(dir, "types"), { recursive: true });
    writeFileSync(join(dir, "types", "index.d.ts"), DTS, "utf-8");
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** stdout 里所有含 `needle` 的行（用来判「是不是全文 dump」） */
function linesWith(stdout: string, needle: string): string[] {
  return stdout.split("\n").filter((l) => l.includes(needle));
}

describe("nudo contract --from-dts --write --dry-run · （续）· unified diff 预览", () => {
  it("无既有草稿 ⇒ exit 0，打 unified diff（不再是全文 dump），且**不建**草稿文件；既有草稿不同 + 无 --force ⇒ exit 1（与真写同口径），**仍**打 diff + 报拒绝 + 文件逐字不变；人工改过的草稿 + `--force` ⇒ exit 1（force 也放行不了），diff 照打、文件逐字不变；负控制：真写（无 --dry-run）遇既有不同草稿仍 exit 1、文件逐字不变，且**不打** diff", () => {
  {
    withFixture((dir) => {
      const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write", "--dry-run"], {
        cwd: dir,
      });

      expect(r.status).toBe(0);
      // 标签行保留：用户仍看得到目标路径
      expect(r.stdout).toContain(`[dry-run] would write ${DRAFT_REL}`);
      // diff 头与 `--emit --dry-run` / `--draft --write --dry-run` **同形**
      expect(r.stdout).toContain(`--- a/${DRAFT_REL}`);
      expect(r.stdout).toContain(`+++ b/${DRAFT_REL}`);
      // 真正的 hunk（文件不存在 ⇒ 对照面是空串 ⇒ 整份都是新增行）
      expect(r.stdout).toMatch(/^@@ /m);
      expect(r.stdout).toContain(`+${MUL_LINE}`);
      // 改前：stdout 是整份草稿正文的 dump ⇒ 这些行**不带** diff 前缀也出现
      for (const needle of ["export const mul", 'from "@nudojs/core"', "// @nudo:draft"]) {
        const hits = linesWith(r.stdout, needle);
        expect(hits.length, `stdout 里应出现 ${needle}`).toBeGreaterThan(0);
        expect(
          hits.every((l) => l.startsWith("+")),
          `「${needle}」只能以新增行（+）出现 —— 不得出现无前缀的全文 dump`,
        ).toBe(true);
      }
      // dry-run **不写盘**
      expect(existsSync(join(dir, DRAFT_REL))).toBe(false);
    });
  }
  {
    withFixture((dir) => {
      const draftPath = join(dir, DRAFT_REL);
      writeFileSync(draftPath, EXISTING_DRAFT, "utf-8");

      // 环境变量通道也算「force」⇒ 显式置空，免得开发机的 NUDO_DRAFT_FORCE=1
      // 把「无 --force ⇒ 拒绝」这一钉变成假绿（断言本身不变）。
      const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write", "--dry-run"], {
        cwd: dir,
        env: { NUDO_DRAFT_FORCE: "" },
      });

      // 退出码镜像真写：真写会拒绝 ⇒ dry-run 也 1（不得静默 0 谎报「会写」）
      expect(r.status).toBe(1);
      // 预览仍然可见：标签行 + diff 头 + 新增行
      expect(r.stdout).toContain(`[dry-run] would write ${DRAFT_REL}`);
      expect(r.stdout).toContain(`--- a/${DRAFT_REL}`);
      expect(r.stdout).toContain(`+++ b/${DRAFT_REL}`);
      expect(r.stdout).toContain(`+${MUL_LINE}`);
      // 拒绝理由仍然报出来（与真写同一套文案）
      expect(r.stderr).toContain("refusing to overwrite");
      expect(r.stderr).toContain(DRAFT_REL);
      // dry-run 绝不写盘：既有草稿逐字不变
      expect(readFileSync(draftPath, "utf-8")).toBe(EXISTING_DRAFT);
    });
  }
  {
    withFixture((dir) => {
      const draftPath = join(dir, DRAFT_REL);
      // 先真写一次机器原稿，再人工改动正文 ⇒ 指纹失配
      const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
      expect(first.status).toBe(0);
      const machine = readFileSync(draftPath, "utf-8");
      expect(machine).toContain("@nudo:draft-fingerprint");
      const handEdited = `${machine}// 人工改动\n`;
      writeFileSync(draftPath, handEdited, "utf-8");

      const r = runCli(
        ["contract", "--from-dts", "types/index.d.ts", "--write", "--dry-run", "--force"],
        { cwd: dir },
      );

      // 真写会被拒（hand-edited 通道，force 放行不了）⇒ dry-run 也 1
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("hand-edited");
      // 预览照打：标签行 + diff（被删掉的人工行是 diff 的一部分）
      expect(r.stdout).toContain(`[dry-run] would write ${DRAFT_REL}`);
      expect(r.stdout).toContain(`--- a/${DRAFT_REL}`);
      expect(r.stdout).toMatch(/^@@ /m);
      expect(r.stdout).toContain("-// 人工改动");
      // 人工改过的草稿逐字不变
      expect(readFileSync(draftPath, "utf-8")).toBe(handEdited);
    });
  }
  {
    withFixture((dir) => {
      const draftPath = join(dir, DRAFT_REL);
      writeFileSync(draftPath, EXISTING_DRAFT, "utf-8");

      // 同上一钉：显式置空 NUDO_DRAFT_FORCE（环境变量也是 force 通道）
      const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], {
        cwd: dir,
        env: { NUDO_DRAFT_FORCE: "" },
      });

      expect(r.status).toBe(1);
      expect(r.stderr).toContain("refusing to overwrite");
      // 既有草稿逐字不变（真写的保证）
      expect(readFileSync(draftPath, "utf-8")).toBe(EXISTING_DRAFT);
      // 没有谎报成功，也没有把 diff 预览塞进真写面
      expect(r.stdout).not.toContain("wrote ");
      expect(r.stdout).not.toContain("--- a/");
    });
  }
}); // 1 个 CLI 子进程（tsx 冷启动）

   // 1 个 CLI 子进程

   // 2 个顺序 CLI 子进程

   // 1 个 CLI 子进程
});
});

describe("from-dts-write-path", () => {
/**
 * `nudo contract --from-dts --write` 把草稿写进 **CWD**
 * （不是源 `.d.ts` 旁边）且**无条件覆盖** ⇒ 静默覆盖同基名的**另一个文件**的
 * 草稿，零告警、exit 0。
 *
 * 钉（族 20 · 片 C）：
 * ① 输出路径**贴着源 `.d.ts`**（`sidecarDraftPath` 口径，与 `--draft --write`
 * 同款）⇒ **不再**以 CWD 为基准 ⇒ CWD 里的同名草稿**逐字不变**；
 * ② 写盘前做**存在性检查**（已存在且内容不同 ⇒ **拒绝覆盖** + 提示、exit 1）;
 * ③ 写盘**复用** service 的写盘助手（五重保护）；
 * ④ 「next」提示**点名目标侧车路径**。
 *
 * ⚠ 落点名的 `.d.` 段按 ****（`tmp/bug-report/sections/.md`
 * + `.changeset/fix-bug-cat-09-cli-check.md`）：`.d.ts` 源的侧车/草稿名
 * **不得含 `.d.`** —— basename 含 `.d.` ⇒ TypeScript 的
 * `getDeclarationFileExtension` 判它是**声明文件** ⇒ 草稿与工具建议的
 * 复制落点都过不了 `tsc --strict`（TS1254）⇒ `types/index.d.ts` 的草稿是
 * `types/index.nudo.draft.ts`、侧车是 `types/index.nudo.ts`
 * （**不是** `types/index.d.nudo.draft.ts` / `types/index.d.nudo.ts`）。
 */






/** CWD 里**另一个文件**（index.js）的既有草稿 —— 不得被 `--from-dts` 覆盖 */
const OTHER_DRAFT = `// @nudo:draft
// Generated by \`nudo contract --draft\` from index
//
// dts draft of index.js — 手工留存的既有草稿（不得被 --from-dts 静默覆盖）

import { fn, number } from "@nudojs/core";

// add — from analysis
export const add = fn({ a: number(), b: number() }, number());
`;

const DTS = `export declare function mul(a: number, b: number): number;
`;

/** 夹具：index.js + 它的既有草稿 + types/index.d.ts（另一个基名的源） */
function makeFixture(dts: string = DTS): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-944-"));
  mkdirSync(join(dir, "types"), { recursive: true });
  writeFileSync(
    join(dir, "index.js"),
    "export function add(a, b) {\n  return a + b;\n}\n",
    "utf-8",
  );
  writeFileSync(join(dir, "index.nudo.draft.js"), OTHER_DRAFT, "utf-8");
  writeFileSync(join(dir, "types", "index.d.ts"), dts, "utf-8");
  return dir;
}

describe("nudo contract --from-dts --write · 落盘位置与覆盖保护", () => {
  it("草稿落在**源 .d.ts 旁边**（不再是 CWD）⇒ CWD 里的同名草稿逐字不变；「next」提示**点名目标侧车路径**；目标已存在且内容不同 ⇒ **拒绝覆盖**（exit 1）+ 提示 + 既有草稿逐字不变", () => {
  {
    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(0);
    // 产物贴着源 .d.ts（落点名不含 `.d.` 段 —— ）
    const draft = join(dir, "types", "index.nudo.draft.ts");
    expect(existsSync(draft)).toBe(true);
    expect(readFileSync(draft, "utf-8")).toContain("export const mul");
    // CWD 里**不再**出现新草稿
    expect(existsSync(join(dir, "index.nudo.draft.ts"))).toBe(false);
    // 另一个文件（index.js）的既有草稿**逐字不变**（改前被静默覆盖）
    expect(readFileSync(join(dir, "index.nudo.draft.js"), "utf-8")).toBe(OTHER_DRAFT);
  }
  {
    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("types/index.nudo.ts");
  }
  {
    const dir = makeFixture();
    // 先写一次（产物落盘）
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const draft = join(dir, "types", "index.nudo.draft.ts");
    const written = readFileSync(draft, "utf-8");
    // 源 .d.ts 变了 ⇒ 草稿内容会变
    writeFileSync(
      join(dir, "types", "index.d.ts"),
      `${DTS}export declare function div(a: number, b: number): number;\n`,
      "utf-8",
    );

    const second = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    // 拒绝覆盖 ⇒ 非 0 退出 + 可诊断的理由
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("refusing to overwrite");
    expect(second.stderr).toContain("types/index.nudo.draft.ts");
    // 既有草稿逐字不变（没有静默丢内容）
    expect(readFileSync(draft, "utf-8")).toBe(written);
    // 没有谎报成功
    expect(second.stdout).not.toContain("wrote ");
  }
}); // 1 个 CLI 子进程（tsx 冷启动）

   // 1 个 CLI 子进程

   // 2 个顺序 CLI 子进程
});
});
});

// ---------------------------------------------------------------------------
// 打印面 --fn 的名单口径 = 导出名（与 --draft / --emit 两面一致）
// ---------------------------------------------------------------------------
describe("打印面 --fn 的名单口径 = 导出名", () => {
/**
 * `contract --fn <导出名>` 被拒、`--fn <非导出本地名>` 反而命中。
 *
 * 改前：打印面 `entries.filter((e) => fnNames.includes(e.fn))` —— `e.fn` 是
 * **本地名**（`ContractSurfaceEntry` 没有导出身份字段），候选表同样取本地名。
 * `export { shout as yell }` 的条目只能按 `shout` 选中 ⇒
 *
 * ```
 * $ nudo contract --fn yell lib.js
 * Usage error: --fn `yell` matched no contract entry in lib.js
 * available exports: helper, pub, shout      # ← 前两个不是导出，第三个是本地名
 * ```
 *
 * 而同命令族的 `--draft --fn yell` / `--emit --fn yell` 都是 exit 0（它们比
 * `e.fn` **和** `e.identity`）⇒ 三面结论相反；候选表还把非导出名标成
 * `available exports`，按提示改名会继续失败。
 *
 * 钉：
 * - `--fn <导出名>` ⇒ exit 0 且打印该条目的本地名（身份是导出名）；
 * - 未命中 ⇒ exit 1，候选表**只列导出名**（不含 `helper` / `shout`）；
 * - 对照：`--fn <普通导出名>` 行为不变。
 */
const LIB = `function helper(x) { return x + 1; }
/**
 * @nudo:case "dom" (string())
 */
function shout(s) { return s.toUpperCase(); }
export { shout as yell };
export function pub(y) { return helper(y); }
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-contract-fn-export-"));
  writeFileSync(join(dir, "package.json"), `{"type":"module"}\n`, "utf-8");
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");
  // 夹具 cwd 下 `@nudojs/*` 会落到各包 dist（陈旧构建）⇒ paths 钉到仓内 src
  writeSrcTsconfig(dir);
  return dir;
}

  it("--fn yell ⇒ exit 0（改前 usage error）；未命中候选只列导出名；对照 --fn pub 不变", () => {
    const dir = makeFixture();
    try {
      const hit = runCli(["contract", "--fn", "yell", "lib.js"], { cwd: dir });
      expect(hit.status).toBe(0);
      expect(hit.stdout).toContain("shout");

      const miss = runCli(["contract", "--fn", "nope", "lib.js"], { cwd: dir });
      expect(miss.status).toBe(1);
      expect(miss.stderr).toContain("available exports: pub, yell");
      // 非导出本地名不得被推荐（按提示改名会继续失败）
      expect(miss.stderr).not.toContain("helper");
      expect(miss.stderr).not.toContain("shout");

      const control = runCli(["contract", "--fn", "pub", "lib.js"], { cwd: dir });
      expect(control.status).toBe(0);
      expect(control.stdout).toContain("pub");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90000); // 3 个 CLI 子进程（tsx 冷启动）
});

// ---------------------------------------------------------------------------
// `.nudo.ts` 侧车的 builder 声明头必须幂等
// ---------------------------------------------------------------------------
describe("contract --emit 刷新 `.nudo.ts` 侧车：builder 声明头幂等", () => {
/**
 * `.nudo.ts` 侧车没有 import 行，只有 `declare const fn: typeof
 * import("@nudojs/core").fn;` 这类**纯类型**声明头（tsc 看得见、装载器在
 * 运行时剥掉）。刷新时「哪些 builder 还缺声明」的判据必须看得见**已有**的
 * 声明头；看不见 ⇒ 每次都判「全缺」⇒ 再前置一份 ⇒ 第二轮起 TS2451（重复
 * 声明）、`nudo check` 报 `nudo:contract-load`、第三轮直接以 `is not
 * parseable` 拒写：生成器把自己的产物写坏，用户只能手工删重复行。
 *
 * 钉（唯一变量 = 第几轮）：
 * - 第 1 轮写出的侧车在第 2/3 轮**逐字不变**（声明头恒一份，且第 2/3 轮
 *   报 `no contract changes`）；
 * - 侧车始终能被 tsc 编译（无 TS2451）、`nudo check` 始终绿；
 * - 唯一变量换成**证据**（调用实参 1,2 → 7,8）时只有生成段变化，声明头仍是
 *   一份，且再刷一轮仍逐字不变；
 * - 对照 `.js` 侧车（BUILD 走 import 行）：同一轮序下同样只出现一次。
 */
const TSC_ARGS = [
  "--ignoreConfig",
  "--strict",
  "--noEmit",
  "--module",
  "nodenext",
  "--moduleResolution",
  "nodenext",
];

/** 夹具里的 tsc：只编译侧车一个文件（@nudojs/core 走 node_modules 符号链接）。 */
function tscOn(dir: string, file: string): { status: number; stderr: string } {
  const r = spawnSync(join(repoRoot, "node_modules/.bin/tsc"), [...TSC_ARGS, file], {
    cwd: dir,
    encoding: "utf-8",
  });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

/** 造一个「仓内源码解析 + core 可解析」的夹具目录（浅链接 @nudojs/core）。 */
function makeEmitFixture(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, "package.json"), `{"type":"module"}\n`, "utf-8");
  // 子进程 CLI 按 cwd 的 tsconfig 解析 @nudojs/*（否则落到陈旧 dist）
  writeSrcTsconfig(dir);
  mkdirSync(join(dir, "node_modules/@nudojs"), { recursive: true });
  symlinkSync(join(repoRoot, "packages/core"), join(dir, "node_modules/@nudojs/core"), "dir");
  return dir;
}

  it("连续三轮 emit 同一 `.nudo.ts` 侧车：第 2/3 轮逐字不变（声明头恒一份）、tsc 编译过、check 绿；证据变化后仍只改生成段且再轮不变（BUG-169）", () => {
    const dir = makeEmitFixture("nudo-emit-ts-sidecar-");
    try {
      writeFileSync(
        join(dir, "lib.ts"),
        `export function add(a: number, b: number): number { return a + b; }\n`,
        "utf-8",
      );
      writeFileSync(join(dir, "use.ts"), `import { add } from "./lib.js";\nexport const v = add(1, 2);\n`, "utf-8");

      const emit = () => runCli(["contract", "--emit", "--all", "lib.ts", "--from", "use.ts"], { cwd: dir });
      const sidecar = join(dir, "lib.nudo.ts");
      const read = () => readFileSync(sidecar, "utf-8");
      /** 声明头行数（同一个 builder 声明的次数）——幂等判据的最小可读量。 */
      const declCount = (text: string, builder: string) =>
        text.split("\n").filter((line) => line === `declare const ${builder}: typeof import("@nudojs/core").${builder === "lit" ? "litC" : builder};`).length;

      // ---- 第 1 轮：写出侧车（各一份声明头） ----
      const round1 = emit();
      expect(round1.status, `stderr=${round1.stderr}`).toBe(0);
      const first = read();
      expect(declCount(first, "fn")).toBe(1);
      expect(declCount(first, "lit")).toBe(1);
      expect(first).toContain("export const add = fn({ a: lit(1), b: lit(2) }, lit(3));");

      // ---- 第 2/3 轮：逐字不变（唯一变量 = 轮次） ----
      for (const round of [2, 3]) {
        const again = emit();
        expect(again.status, `round ${round} stderr=${again.stderr}`).toBe(0);
        expect(again.stderr, `round ${round}`).not.toContain("not parseable");
        expect(read(), `round ${round} 与第 1 轮必须逐字相同`).toBe(first);
        expect(again.stdout, `round ${round} 应报无改动`).toContain("no contract changes");
      }
      // 侧车可被 tsc 编译（重复声明头会在这里报 TS2451 ×N）
      const tsc1 = tscOn(dir, sidecar);
      expect(tsc1.stderr, `tsc=${tsc1.stderr}`).not.toContain("TS2451");
      expect(tsc1.status, `tsc stderr=${tsc1.stderr}`).toBe(0);
      // `nudo check` 看得见侧车（重复声明会报 nudo:contract-load）
      const check1 = runCli(["check", "lib.ts"], { cwd: dir });
      expect(check1.status, `stderr=${check1.stderr}`).toBe(0);
      expect(check1.stdout).not.toContain("nudo:contract-load");

      // ---- 证据变化：只改生成段的载荷，声明头不多不少仍一份 ----
      writeFileSync(join(dir, "use.ts"), `import { add } from "./lib.js";\nexport const v = add(7, 8);\n`, "utf-8");
      const afterEvidence = emit();
      expect(afterEvidence.status, `stderr=${afterEvidence.stderr}`).toBe(0);
      const changed = read();
      expect(changed).not.toBe(first);
      expect(changed).toContain("fn({ a: lit(7), b: lit(8) }, lit(15))");
      expect(declCount(changed, "fn")).toBe(1);
      expect(declCount(changed, "lit")).toBe(1);
      // 第 3 轮（证据已变过的文件再刷）⇒ 仍是 no changes + 逐字不变，
      // 旧实现的「第三轮 is not parseable」不再出现
      for (const round of [2, 3]) {
        const again = emit();
        expect(again.status, `round ${round} stderr=${again.stderr}`).toBe(0);
        expect(again.stderr, `round ${round}`).not.toContain("not parseable");
        expect(read(), `evidence round ${round}`).toBe(changed);
      }
      const tsc2 = tscOn(dir, sidecar);
      expect(tsc2.status, `tsc stderr=${tsc2.stderr}`).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000); // 6 个 CLI 子进程 + 2 次 tsc

  it("对照 `.js` 侧车：同一轮序下 builder import 行同样只出现一次（行为不变）", () => {
    const dir = makeEmitFixture("nudo-emit-js-sidecar-");
    try {
      writeFileSync(join(dir, "lib.js"), `export function add(a, b) { return a + b; }\n`, "utf-8");
      writeFileSync(join(dir, "use.js"), `import { add } from "./lib.js";\nexport const v = add(1, 2);\n`, "utf-8");
      const emit = () => runCli(["contract", "--emit", "--all", "lib.js", "--from", "use.js"], { cwd: dir });
      const sidecar = join(dir, "lib.nudo.js");
      const read = () => readFileSync(sidecar, "utf-8");
      const importLines = (text: string) =>
        text.split("\n").filter((line) => line.includes("nudo:emit-builders")).length;

      const round1 = emit();
      expect(round1.status, `stderr=${round1.stderr}`).toBe(0);
      const first = read();
      expect(importLines(first)).toBe(1);
      const round2 = emit();
      expect(round2.status, `stderr=${round2.stderr}`).toBe(0);
      expect(read()).toBe(first);
      expect(importLines(read())).toBe(1);
      const syntax = spawnSync(process.execPath, ["--check", sidecar], { encoding: "utf-8" });
      expect(syntax.status, `node --check=${syntax.stderr}`).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90000);
});
