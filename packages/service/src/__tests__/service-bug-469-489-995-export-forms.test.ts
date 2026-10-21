/**
 * Bug 469 / 489 / 995 回归钉 —— service 面**顶层函数普查**
 * （`collectTopLevelFunctions`）的导出形态覆盖 + 入口求值的**导出槽**解析。
 *
 * 三条同源：service 面的普查比 core 面（`listTopFunctions`）窄 ⇒
 * `nudo check` 看得见的函数，`nudo test` / `export` / `contract` / `health`
 * 看不见（或看不见返回值）——两个面互相矛盾。
 *
 *   469：`export const f = fn` —— ExportNamedDeclaration 分支只收
 *        FunctionDeclaration，不收 VariableDeclaration 的声明符 ⇒ 普查 0 项。
 *   489：`export default function f` —— 普查按**局部名** f 登记，但模块的
 *        导出键是 `default`（f 只是模块内局部名）⇒ 入口求值按导出表键查表
 *        落空 ⇒ 签名退 `unknown`。
 *   995：`module.exports = { f: fn }` —— 普查不下钻对象字面量 ⇒ 成员函数
 *        不可见。
 *
 * 原生 oracle（node）：
 *   export const f = () => 1    → 具名导入后 f() === 1
 *   export default function f() → 默认导入后 f() === 1
 *   module.exports = { f: fn }  → require(...).f() === 1
 */
import { describe, it, expect, beforeEach } from "vitest";
import { formatShape } from "@nudojs/core";
import { listTopFunctions } from "@nudojs/core/internal";
import { parse } from "@nudojs/parser";
import { analyzeFile } from "../analyzer.ts";
import { resetAllAnalysisCaches } from "../index.ts";
import { collectTopLevelFunctions } from "../analyzer-ast.ts";

beforeEach(() => {
  resetAllAnalysisCaches();
});

/** 普查名（service 面） */
const censusNames = (source: string): string[] =>
  collectTopLevelFunctions(parse(source)).map((r) => r.name);

/** 普查名 + 导出槽（assignedName；无则空串） */
const censusSlots = (source: string): string[] =>
  collectTopLevelFunctions(parse(source)).map((r) => `${r.name}@${r.assignedName ?? ""}`);

/** 分析面（test / export / contract 共用）里的函数名 */
const analysisNames = (source: string, file = "/test/census.js"): string[] =>
  analyzeFile(file, source).functions.map((f) => f.name);

describe("Bug 469：export const/let/var f = fn 进普查", () => {
  it("export const 箭头 / 函数表达式都进普查（普查名 = 导出槽名）", () => {
    expect(censusNames("export const f = () => 1;")).toEqual(["f"]);
    expect(censusNames("export const f = function () { return 1; };")).toEqual(["f"]);
    expect(censusNames("export let f = () => 1;")).toEqual(["f"]);
    expect(censusNames("export var f = () => 1;")).toEqual(["f"]);
  });

  it("多声明符逐个收（不只首个）", () => {
    expect(censusNames("export const a = () => 1, b = () => 2;")).toEqual(["a", "b"]);
  });

  it("非函数初始化不进普查", () => {
    expect(censusNames("export const x = 1;")).toEqual([]);
  });

  it("分析面看得见该函数，且入口求值拿到返回值", () => {
    const source = "export const slugify = (s) => String(s).toLowerCase();";
    const result = analyzeFile("/test/bug469.js", source);
    expect(result.functions.map((f) => f.name)).toEqual(["slugify"]);
    const entry = result.functions[0]!.cases.find((c) => c.name.startsWith("entry@"));
    expect(entry).toBeDefined();
    // 原生：slugify("AbC") === "abc"
    expect(formatShape(entry!.abs)).toBe("string");
  });
});

describe("Bug 489：具名 default 导出按 default 槽回退求值", () => {
  it("普查名 = 局部名，导出槽 = default", () => {
    expect(censusSlots("export default function f() { return 1; }")).toEqual(["f@default"]);
  });

  it("入口求值回退到 default 槽 ⇒ 返回值不再是 unknown", () => {
    const source = "export default function f() { return 1; }";
    const result = analyzeFile("/test/bug489.js", source);
    expect(result.functions.map((f) => f.name)).toEqual(["f"]);
    const entry = result.functions[0]!.cases.find((c) => c.name.startsWith("entry@"));
    expect(entry).toBeDefined();
    // 原生：默认导入后 f() === 1（退 unknown 即查表落空）
    expect(formatShape(entry!.abs)).toBe("1");
  });

  it("匿名 default 导出形态不变（普查名 = default）", () => {
    expect(censusNames("export default function () { return 1; }")).toEqual(["default"]);
    expect(censusNames("export default () => 1;")).toEqual(["default"]);
  });
});

describe("Bug 995：module.exports = { f: fn } 的成员函数进普查", () => {
  it("对象字面量的成员函数逐个收（key 名 = 导出槽名）", () => {
    expect(censusNames("module.exports = { greet: function () { return 1; } };")).toEqual(["greet"]);
    expect(censusNames("module.exports = { greet: () => 1 };")).toEqual(["greet"]);
    expect(censusNames("module.exports = { greet: async function () { return 1; } };")).toEqual(["greet"]);
  });

  it("对象方法简写（ObjectMethod）进普查", () => {
    expect(censusNames("module.exports = { greet() { return 1; } };")).toEqual(["greet"]);
  });

  it("命名函数表达式的自有 id 优先于槽名（与 core listTopFunctions 同口径）", () => {
    expect(censusNames("module.exports = { greet: function named() { return 1; } };")).toEqual(["named"]);
    expect(censusSlots("module.exports = { greet: function named() { return 1; } };")).toEqual(["named@greet"]);
  });

  it("getter / setter 不是可调用入口，不进普查", () => {
    expect(censusNames("module.exports = { get g() { return 1; } };")).toEqual([]);
    expect(censusNames("module.exports = { set s(v) {} };")).toEqual([]);
  });

  it("非函数成员不进普查", () => {
    expect(censusNames("module.exports = { x: 1 };")).toEqual([]);
  });

  it("分析面看得见该函数", () => {
    const source = 'module.exports = { greet: function (name) { return "hi " + name; } };';
    const result = analyzeFile("/test/bug995.js", source);
    expect(result.functions.map((f) => f.name)).toEqual(["greet"]);
  });
});

describe("普查口径与 core listTopFunctions 对齐（check 面不与 service 面打架）", () => {
  const fixtures: Record<string, string> = {
    "fn 声明": "function f() { return 1; }",
    "const 箭头": "const f = () => 1;",
    "具名导出": "export function f() { return 1; }",
    "导出 const 箭头": "export const f = () => 1;",
    "导出 const 函数表达式": "export const f = function () { return 1; };",
    "导出 let": "export let f = () => 1;",
    "导出 var": "export var f = () => 1;",
    "导出多声明符": "export const a = () => 1, b = () => 2;",
    "具名 default": "export default function f() { return 1; }",
    "匿名 default": "export default function () { return 1; }",
    "default 箭头": "export default () => 1;",
    "CJS exports.f": "exports.f = function () { return 1; };",
    "CJS module.exports.f": "module.exports.f = function () { return 1; };",
    "CJS 对象字面量": "module.exports = { f: function () { return 1; } };",
    "CJS 对象字面量（具名函数表达式）": "module.exports = { f: function named() { return 1; } };",
    "CJS 对象字面量（箭头）": "module.exports = { f: () => 1 };",
    "CJS 对象方法": "module.exports = { f() { return 1; } };",
    "导出 class": "export class C { m() { return 1; } }",
    "default class": "export default class C { m() { return 1; } }",
  };

  for (const [label, source] of Object.entries(fixtures)) {
    it(`${label}：两面普查名一致`, () => {
      expect(censusNames(source).sort()).toEqual([...listTopFunctions(source)].sort());
    });
  }

  it("getter 形态：core 侧仍收（Bug 996 待收口），service 侧已不收——差异有界", () => {
    // core scan-top-functions.ts 的 ObjectMethod 分支未按 kind 过滤
    // （getter/setter 也被当函数）——core 侧修复属 14 分片外的越界项。
    expect(listTopFunctions("module.exports = { get g() { return 1; } };")).toEqual(["g"]);
    expect(censusNames("module.exports = { get g() { return 1; } };")).toEqual([]);
  });

  it("匿名 module.exports = fn：service 侧按 default 登记（core 侧不登记无名函数）", () => {
    // 两者都是既有口径（service 把裸 module.exports = fn 当 ESM default 类比），
    // 不在本轮改动范围——差异保持有界、不扩散。
    expect(censusNames("module.exports = function () { return 1; };")).toEqual(["default"]);
    expect(listTopFunctions("module.exports = function () { return 1; };")).toEqual([]);
  });
});
