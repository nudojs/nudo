/**
 * 运行时 import 面漂移守卫。
 *
 * 转译产物的 `import { $… } from "<runtime>";` 行是「生成物 ↔ 运行时符号面」
 * 的唯一契约：清单漏一个名字 ⇒ 产物作为真实 ESM 装载时 ReferenceError（或
 * `new Function` 路径被宿主全局解析成 undefined）；清单多一个名字 ⇒ 产物
 * 多出未使用导入（且暗示该符号已不再发射）。名字清单与剥离正则的单一真值
 * 源是 `exec/transpile/runtime-import.ts`（本测试按公开路径 + 叶子双面校验）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as execSurface from "../exec/index.ts";
import {
  runtimeImportOf as facadeRuntimeImportOf,
  transpileSource,
} from "../exec/transpile.ts";
import {
  RUNTIME_IMPORT_NAMES,
  RUNTIME_IMPORT_RE,
  runtimeImportOf,
} from "../exec/transpile/runtime-import.ts";
import { RUNTIME_IMPORT_RE as RUN_RUNTIME_IMPORT_RE } from "../exec/run.ts";

/** 解析生成 import 行的具名表（同时钉住行格式）。 */
function importNamesOf(line: string): { spec: string; names: string[] } {
  const m = /^import \{([^}]+)\} from "([^"]+)";$/.exec(line);
  expect(m, `生成的 import 行格式不符：${line.slice(0, 120)}…`).not.toBeNull();
  return {
    spec: m![2]!,
    names: m![1]!.split(",").map((s) => s.trim()),
  };
}

/** 生成代码里的 `$` 符号（跳过注释行与那条 import 行——后者本身就是清单）。 */
function emittedRuntimeNames(code: string): Set<string> {
  const out = new Set<string>();
  for (const line of code.split("\n")) {
    if (/^\s*\/\//.test(line)) continue;
    if (/^import \{/.test(line)) continue;
    for (const m of line.matchAll(/\$[A-Za-z][\w$]*/g)) out.add(m[0]);
  }
  return out;
}

describe("runtime import surface", () => {
  it("生成的 import 行与 exec/index.ts 导出面自洽（每个名字可具名导入）", () => {
    const line = runtimeImportOf("@nudojs/core/exec");
    const { spec, names } = importNamesOf(line);
    expect(spec).toBe("@nudojs/core/exec");
    // 行内表 === 导出的真值源（防有人手改 runtimeImportOf 另写一份）
    expect(names).toEqual([...RUNTIME_IMPORT_NAMES]);
    expect(names.length).toBeGreaterThan(100);
    // 无重名（重复具名导入是 SyntaxError）
    expect(new Set(names).size).toBe(names.length);
    const surface = execSurface as unknown as Record<string, unknown>;
    const missing = names.filter((n) => !(n in surface));
    expect(missing, `exec/index.ts 缺少具名导出：${missing.join(", ")}`).toEqual([]);
    // 运行时符号面全是函数（$fnKindStamp 等也是）——误加常量/类型会在此翻红
    const notFn = names.filter((n) => typeof surface[n] !== "function");
    expect(notFn, `非函数导出：${notFn.join(", ")}`).toEqual([]);
  });

  it("历史漂移已闭合：9 个发射符号在清单，5 个死符号已移除", () => {
    const names = new Set(RUNTIME_IMPORT_NAMES);
    // 曾经发射但漏在清单里（生成物引用未导入符号）
    for (const n of [
      "$invokeKey",
      "$optionalInvokeKey",
      "$nodoPos",
      "$assumeAnchor",
      "$asyncGen",
      "$litTruth",
      "$throwConstAssign",
      "$throwFreeArguments",
      "$tryReleaseSoftCatch",
    ]) {
      expect(names.has(n), `发射符号缺清单项：${n}`).toBe(true);
    }
    // 曾经在清单里但转译器早已不发射
    for (const n of ["$while", "$forIter", "$staticInit", "$staticInvoke", "$asyncReturn"]) {
      expect(names.has(n), `死符号仍在清单：${n}`).toBe(false);
    }
  });

  it("transpileSource 产物里的每个 `$` 符号都在 import 清单（语料漂移守卫）", () => {
    const listed = new Set(RUNTIME_IMPORT_NAMES);
    const emitted = new Set<string>();
    for (const src of CORPUS) {
      for (const opts of OPTION_VARIANTS) {
        const code = transpileSource(src, opts);
        // 第一行 import 必须就是真值源拼的那行（transpileFile 不再另写清单）
        const firstImport = code.split("\n").find((l) => l.startsWith("import {"));
        expect(firstImport).toBe(runtimeImportOf("@nudojs/core/exec"));
        for (const n of emittedRuntimeNames(code)) emitted.add(n);
      }
    }
    const unknown = [...emitted].filter((n) => !listed.has(n)).sort();
    expect(unknown, `发射但未在 import 清单：${unknown.join(", ")}`).toEqual([]);
    // 语料必须真的覆盖新增符号（否则守卫退化成空转）
    for (const n of [
      "$invokeKey",
      "$nodoPos",
      "$assumeAnchor",
      "$asyncGen",
      "$litTruth",
      "$throwConstAssign",
      "$throwFreeArguments",
      "$tryReleaseSoftCatch",
      "$catchReturn",
    ]) {
      expect(emitted.has(n), `语料未触发 ${n}（扩展语料或查发射点）`).toBe(true);
    }
  });

  it("RUNTIME_IMPORT_RE 单一真值源（run.ts 与叶子同一对象；body-fn 不再本地定义）", () => {
    // 公开路径不变：transpile.ts facade / run.ts / exec/index.ts 都指向同一定义
    expect(facadeRuntimeImportOf).toBe(runtimeImportOf);
    expect(execSurface.runtimeImportOf).toBe(runtimeImportOf);
    expect(RUN_RUNTIME_IMPORT_RE).toBe(RUNTIME_IMPORT_RE);
    expect(execSurface.RUNTIME_IMPORT_RE).toBe(RUNTIME_IMPORT_RE);
    // 生成行必须被整行命中（宿主 new Function 前按它剥离）
    expect(RUNTIME_IMPORT_RE.test(runtimeImportOf("@nudojs/core/exec"))).toBe(true);
    // 单引号说明符不匹配（runtimeImportOf 产物口径；用户 import 另行改写）
    expect(RUNTIME_IMPORT_RE.test(`import { $lit } from './x.js';`)).toBe(false);
    const bodyFnSrc = readFileSync(new URL("../exec/body-fn.ts", import.meta.url), "utf8");
    expect(bodyFnSrc).not.toMatch(/const RUNTIME_IMPORT_RE\s*=/);
    expect(bodyFnSrc).toContain('from "./transpile/runtime-import.ts"');
  });
});

/** 语料：覆盖计算键调用 / try-catch（软抛出与 $catchReturn）/ @nudo:assume /
 *  async / 类 / 对象字面量 / 赋值（含 const 面）——每新增发射点都应加一行。 */
const CORPUS: readonly string[] = [
  // 计算键调用（$invokeKey）与可选链
  `function f(o, k, x) { return o[k](x); }`,
  `function f(o, k) { return o[k]?.(1); }`,
  `const v = o?.[k]?.();`,
  // try/catch：软抛出 rethrow、catch 返回（$catchReturn）、无 binding catch
  `function f() { try { g(); } catch (e) { throw e; } }`,
  `function f(x) { try { if (x) return 1; g(); } catch (e) { return e; } }`,
  `function f() { try { g(); } catch { h(); } }`,
  `function f() { try { return 1; } finally { g(); } }`,
  // @nudo:assume 引理锚定（$assumeAnchor）
  `// @nudo:assume x > 0\nfunction f(x) { const y = x + 1; return y; }`,
  // async（生成器路径 $asyncGen；同步路径 $async/$await）
  `async function f(x) { const y = await x; return y; }`,
  `const o = { async m(x) { return await x; } };`,
  // 类：私有字段 / 静态字段 / 静态块 / 访问器 / 继承 / super
  `class A { #x = 1; static s = 2; static { this.t = 1; } m() { return this.#x; } get g() { return 1; } }`,
  `class B extends A { constructor() { super(); } m() { return super.m(); } static m() { return super.m(); } }`,
  `const C = class { m() {} };`,
  // 对象字面量 / 方法 / 访问器 / rest
  `const o = { a: 1, m() { return this.a; }, get b() { return 2; }, ...rest };`,
  // 赋值：成员写 / 复合赋值 / 逻辑赋值 / 解构
  `function f(o, x) { o.x = x; o[k] = 1; x += 1; x ||= 2; x &&= 3; x ??= 4; return o; }`,
  `const { a, ...rest } = o; const [p, ...q] = xs;`,
  // const 面：import 绑定再赋值（$throwConstAssign）/ 逻辑赋值真值判定（$litTruth）
  `import { k } from "./m.js"; k = 1;`,
  `import { k } from "./m.js"; function f() { k ||= 1; }`,
  // 自由 arguments（$throwFreeArguments）
  `const f = () => arguments.length;`,
  // 循环 / 生成器 / switch / new
  `let i = 0; while (i < 3) { i++; } for (const x of xs) { if (x) continue; break; }`,
  `for (const k in o) { void k; }`,
  `function* g() { yield 1; yield* xs; }`,
  `function f(x) { switch (x) { case 1: return 2; default: return 3; } }`,
  `const a = new A(1);`,
  // 运算符 / 字面量 / 模板 / 正则 / typeof / delete / in / instanceof
  `const a = 1 + 2 * 3 - 4 / 2 % 3; const b = a & 1 | 2 ^ 3; const c = ~a << 1 >> 2 >>> 3; const d = 2 ** 3;`,
  `const a = x == y; const b = x != y; const c = x === y; const d = x <= y; const e = x >= y; const g = !x; const h = -x;`,
  `const t = \`a\${1}b\`; const r = /ab+c/g; r.test("x"); const u = typeof x; const d = delete o.k; const i = k in o; const n = x instanceof Y;`,
  `const a = [1, , 3]; const b = [...xs];`,
  // 收窄 / nullish 删除
  `function f(x) { if (typeof x === "string") return x; if (x != null) return x; return 1; }`,
  // 模块面 / 动态导入 / import.meta
  `const u = import.meta.url;`,
  `async function f() { return await import("./x.js"); }`,
  `export function f() { return 1; } export const k = 2; export default 3;`,
];

const OPTION_VARIANTS = [{}, { disableAsyncGen: true }, { recordPositions: true }] as const;
