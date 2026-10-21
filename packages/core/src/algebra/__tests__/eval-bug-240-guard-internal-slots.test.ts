/**
 * Bug 240（S21 分片）：**guard / 约束面**不发布 internal 槽。
 *
 * ── 背景 ────────────────────────────────────────────────────────────────
 * S18 分片修了**签名面**（`algebra/format.ts`）：投影面剔除 `Slot.internal`
 * 槽（**数字下标槽除外**——它承载元素域，族 01 的 `eval-spread-iter-elems`
 * 钉住 `"0": string`）。
 *
 * 但**guard 面**（`algebra/denote.ts` 的 `denoteGuard`）与**约束面**
 * （`algebra/projection.ts` 的 `absToConstraint`）没跟上 ⇒ 不过滤 internal 槽：
 *
 * - 生成器对象的协议槽（`next` / `return` / `throw` / `constructor` /
 *   `@@iterator`）是 internal 槽（原生挂在**原型**上，不是自有属性）；
 * - `@@iterator` 更是 **symbol 键**槽（`Symbol.iterator`），guard 面却按
 *   **字符串键** `"@@iterator"` 取值 ⇒ 原生恒 `undefined` ⇒
 *   `typeof data["@@iterator"] === "function"` **恒假** ⇒ 恒假条款污染
 *   guard 产物。
 *
 * 根因在 **core**（不在 service）：`service/src/emit/guard-generator.ts`
 * 直接 `import { denoteGuard } from "@nudojs/core/internal"` ⇒ 产物面
 * 恒假条款的根因是 core 的投影通道。与 dts/schema 面发布 internal 槽
 * 不同源（后者归族 15 的 Bug 554）。
 *
 * ── 修法 ────────────────────────────────────────────────────────────────
 * 与 `format.ts` **同口径**：剔除 internal 槽，**保留数字下标槽**（元素域，
 * 族 01 约定）。
 *
 * ── 负控制 ──────────────────────────────────────────────────────────────
 * 普通对象的**非 internal** 成员仍须出现在 guard / 约束产物里——guard 面
 * 不能被"改空"（那会把所有 obj 守卫退化成 `typeof data === "object"`）。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { denoteGuard } from "../denote.ts";
import { absToConstraint } from "../projection.ts";
import { formatAbs } from "../format.ts";
import type { Abs } from "../abs.ts";

/** 生成器导出（协议槽为 internal 槽 + 数字下标槽承载元素域） */
const GEN_SRC = `export function* g() { yield 1; yield "s"; }`;
/** 普通对象（成员为公有槽，非 internal） */
const PLAIN_SRC = `export function f() { return { a: 1, b: "x" }; }`;

/** guard 产物面（`nudo export --format guard` 的同源渲染） */
function guardOf(src: string, fn = "f"): string {
  return denoteGuard(call(src, fn).result, "data");
}

/** 约束产物面（zod / standard 契约面的同源） */
function constraintOf(src: string, fn = "f") {
  return absToConstraint(call(src, fn).result);
}

/** 生成器对象的 internal 协议槽键（数字下标槽除外——它承载元素域） */
const PROTOCOL_SLOT_KEYS = ["next", "return", "throw", "constructor", "@@iterator"];

/** 从 guard 串里抽出被访问的成员键（`data.x` / `data["x"]` 两种写法） */
function accessedKeys(guard: string): string[] {
  const keys: string[] = [];
  for (const m of guard.matchAll(/\bdata\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) keys.push(m[1]!);
  for (const m of guard.matchAll(/\bdata\[("(?:[^"\\]|\\.)*")\]/g)) {
    keys.push(JSON.parse(m[1]!) as string);
  }
  return keys;
}

/** 按顶层 `&&` 拆 guard 条款（core 生成的守卫串顶层连接符固定为 " && "） */
function splitClauses(guard: string): string[] {
  return guard
    .split(" && ")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** 在原生对象上求值单条 guard 条款（原生 oracle） */
function evalClause(clause: string, data: unknown): unknown {
  // eslint-disable-next-line no-new-func
  return new Function("data", `return (${clause});`)(data);
}

/** 原生生成器对象（协议方法在原型上；无任何自有可枚举属性） */
function nativeGen(): unknown {
  return (function* () {
    yield 1;
    yield "s";
  })();
}

describe("Bug 240（S21）：guard 面不发布 internal 槽", () => {
  it("恒假条款 `typeof data[\"@@iterator\"] === \"function\"` 消失", () => {
    const guard = guardOf(GEN_SRC, "g");
    expect(guard).not.toContain('@@iterator');
    expect(guard).not.toContain('typeof data["@@iterator"] === "function"');
  });

  it("协议槽条款全消失（next / return / throw / constructor）", () => {
    const guard = guardOf(GEN_SRC, "g");
    for (const k of PROTOCOL_SLOT_KEYS) {
      expect(guard).not.toContain(`data.${k}`);
      expect(guard).not.toContain(`data["${k}"]`);
    }
  });

  it("guard 产物逐条等于期望串（改前多出 6 条协议槽条款）", () => {
    // 改前：typeof data === "object" && data !== null && data["0"] === 1 &&
    //       data["1"] === "s" && typeof data.next === "function" &&
    //       typeof data.return === "function" && typeof data.throw === "function" &&
    //       typeof data.constructor === "object" && data.constructor !== null &&
    //       data.constructor.name === "" && typeof data["@@iterator"] === "function"
    // 改后：只剩元素域（数字下标）两条
    expect(guardOf(GEN_SRC, "g")).toBe(
      'typeof data === "object" && data !== null && data["0"] === 1 && data["1"] === "s"',
    );
  });

  it("guard 访问的成员键里没有 internal 协议槽键", () => {
    const keys = accessedKeys(guardOf(GEN_SRC, "g"));
    for (const k of PROTOCOL_SLOT_KEYS) expect(keys).not.toContain(k);
  });

  it("数字下标槽（元素域）仍被发布——族 01 约定不被破", () => {
    const guard = guardOf(GEN_SRC, "g");
    expect(guard).toContain('data["0"] === 1');
    expect(guard).toContain('data["1"] === "s"');
    expect(accessedKeys(guard)).toEqual(expect.arrayContaining(["0", "1"]));
  });

  it("负控制：普通对象的非 internal 成员仍出现在 guard 里（guard 面没被改空）", () => {
    const guard = guardOf(PLAIN_SRC);
    expect(guard).toContain("data.a === 1");
    expect(guard).toContain('data.b === "x"');
    expect(guard).toBe(
      'typeof data === "object" && data !== null && data.a === 1 && data.b === "x"',
    );
  });

  it("负控制：非 internal 成员仍被 guard 访问（不是被剔除成空）", () => {
    const keys = accessedKeys(guardOf(PLAIN_SRC));
    expect(keys).toEqual(expect.arrayContaining(["a", "b"]));
  });
});

describe("Bug 240（S21）：原生 oracle 对拍（guard 条款逐条对照）", () => {
  it("改前的恒假条款在原生生成器上恒 false（问题确实存在）", () => {
    const g = nativeGen();
    expect(evalClause('typeof data["@@iterator"] === "function"', g)).toBe(false);
    expect(evalClause('data["@@iterator"]', g)).toBeUndefined();
  });

  it("改后 guard 的逐条原生求值：仅元素域条款为 false（族 01 已知残留）", () => {
    const clauses = splitClauses(guardOf(GEN_SRC, "g"));
    const g = nativeGen();
    const falseOnes = clauses.filter((c) => evalClause(c, g) === false);
    // 族 01 已知残留：数字下标槽承载元素域（族 01「数字下标读（历史口径）」结论）
    // ⇒ 原生生成器上恒 false。本分片按「不改族 01 已提交语义」约束保留。
    expect(falseOnes).toEqual(['data["0"] === 1', 'data["1"] === "s"']);
  });

  it("负控制：普通对象的 guard 每条在原生对象上都是 true", () => {
    const clauses = splitClauses(guardOf(PLAIN_SRC));
    const native = { a: 1, b: "x" };
    expect(clauses.length).toBeGreaterThan(2);
    for (const c of clauses) expect(evalClause(c, native)).toBe(true);
  });
});

describe("Bug 240（S21）：约束面同口径（absToConstraint 不发布 internal 槽）", () => {
  it("协议槽不进约束产物", () => {
    const c = constraintOf(GEN_SRC, "g");
    expect(c).toBeDefined();
    const fields = c?.fields ?? {};
    for (const k of PROTOCOL_SLOT_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(fields, k)).toBe(false);
    }
  });

  it("数字下标槽（元素域）仍被发布（族 01 约定）", () => {
    const c = constraintOf(GEN_SRC, "g");
    expect(Object.keys(c?.fields ?? {})).toEqual(["0", "1"]);
  });

  it("负控制：普通对象的公有字段仍在约束产物里", () => {
    const c = constraintOf(PLAIN_SRC);
    expect(Object.keys(c?.fields ?? {}).sort()).toEqual(["a", "b"]);
  });
});

describe("Bug 240（S21）：私有字段槽（internal）同样不进 guard 面", () => {
  /** 私有字段 `#x` 是 internal 槽（原生私有字段对属性 introspection 不可见） */
  const PRIV_SRC = `export class C { #x = 1; getX() { return this.#x; } }
export function f() { return new C(); }`;

  it("私有字段槽不进 guard（改前恒假条款 `data[\"#C::x\"] === 1` 消失）", () => {
    const guard = guardOf(PRIV_SRC);
    expect(guard).not.toContain("#C::x");
    expect(guard).toBe('typeof data === "object" && data !== null');
  });

  it("原生 oracle：私有字段不是自有属性（恒假条款的依据）", () => {
    const native = new (class {
      #x = 1;
    })();
    expect(evalClause('data["#C::x"] === 1', native)).toBe(false);
    expect(Object.keys(native)).toEqual([]);
  });
});

describe("Bug 240（S21）：与 S18 签名面 / Bug 191 访问器读域同口径", () => {
  it("签名面（S18）仍不发布 internal 槽——本分片不回退", () => {
    const sig = formatAbs(call(GEN_SRC, "g").result as Abs);
    expect(sig).not.toContain("@@iterator");
    expect(sig).not.toContain("next");
    expect(sig).toContain('"0": 1');
  });

  it("Bug 191：访问器键的 guard 仍按 getter 读域判定（不被本分片改坏）", () => {
    const src = `export function f() { return { get ab() { return 1; } }; }`;
    expect(denoteGuard(call(src, "f").result, "data")).toBe(
      'typeof data === "object" && data !== null && data.ab === 1',
    );
  });

  it("Bug 191：访问器键的约束投影仍取 getter 读域", () => {
    const src = `export function f() { return { get ab() { return 1; } }; }`;
    const c = absToConstraint(call(src, "f").result);
    const eq = c?.fields?.["ab"]?.constraint?.preds.find((p) => p.op === "eq");
    expect(eq?.op).toBe("eq");
    expect(eq?.op === "eq" && eq.b.op === "lit" ? eq.b.value : undefined).toBe(1);
  });
});
