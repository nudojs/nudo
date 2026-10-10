/**
 * Bug 33 回归：`instanceof` RHS（右操作数）的可调用性校验。
 *
 * 原生 InstanceofOperator（node v26 实测）：
 * (1) 非对象 RHS（null/undefined/prim）→ TypeError "Right-hand side of
 *     'instanceof' is not an object"；
 * (2) RHS 链上有 @@hasInstance → GetMethod 取之：不可调用槽直接 TypeError
 *     （"x is not a function"），可调用则调用并 ToBoolean 结果；
 * (3) IsCallable(RHS) → OrdinaryHasInstance；
 * (4) 否则 TypeError "Right-hand side of 'instanceof' is not callable"。
 *
 * 修前 validateInstanceofRhs 只校验 (1)（prim/never/nullish 定抛 + any
 * may），obj/arr/tuple RHS 落未校验臂 → 静默成功（catch 面 "no-throw"、
 * L2 gate 假阴），而语义相同的 prim-RHS 形式被正确标记。修复口径：
 * - arr/tuple：继承面（Array/Object.prototype）无 @@hasInstance，引擎内
 *   也从不携带 call impl → 定抛 TypeError；
 * - 闭 obj（字面量 / Object.create(null) 闭 null-proto）：自有槽集完整，
 *   无 callable @@hasInstance 槽即确定 non-callable → 定抛；槽值不可调用
 *   同折定抛（原生 GetMeyhod 直接抛）；callable 槽 optional（可能缺位）→ may；
 * - open obj（Object.create(proto) / setPrototypeOf 产物，动态继承不建模）
 *   → 保守不抛（imprecision 优于 wrong-exact）；
 * - brand 实例（new Map() 等值）non-callable → 原生定抛，但 Proxy（apply
 *   trap）可 callable，引擎不可区分 → may TypeError；类值（内建构造器 /
 *   用户 class，classNameOfValue 已标）是 constructor 函数 → 合法不记。
 *
 * 已知 imprecision（fn 形状 RHS 不校验，node 实测钉原生口径）：
 * - 箭头 / async 函数 / 方法作 RHS：原生无 .prototype → TypeError
 *   ("Function has non-object prototype 'undefined' in instanceof check")；
 * - 普通 function / class / generator fn：有 .prototype → 合法（generator
 *   fn 原生**不**抛，实测 `({}) instanceof (function*(){})` → false）；
 * - 绑定函数取决于目标（目标无 .prototype 则抛，如
 *   `({}) instanceof Function.prototype.bind(null)` 抛、
 *   `({}) instanceof (function(){}).bind(null)` → false）。
 * 引擎 fn shape 的 ctor facet 把箭头/async 与 generator 混同（三者皆不可
 * new），definite 会误抛 generator RHS、may 会误报 generator RHS（假 gate
 * 噪声）——保持不校验，箭头/async RHS 静默 boolean 是 documented 债。
 */
import { describe, it, expect } from "vitest";
// 相对路径引 src 引擎面（不经 @nudojs/core 别名——本 worktree 的 vite8
// 别名解析会把裸包名落到 dist 旧产物，同 eval-ta-hofs.test.ts）。
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { litValue, anyAbs, type Abs } from "../abs.ts";
import { formatShape } from "../format.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

/** catch 面：体内 try/catch 吸收后返回字面量（"TypeError" / "no-throw"） */
function catchFace(src: string): string {
  const exports = runTranspiled(src, { mode: "analyze" });
  const r = callTranspiledExportFull(exports, "f", []);
  const lv = litValue(r.result);
  return lv.ok ? String(lv.value) : `abstract:${formatShape(r.result)}`;
}

/** gate 面：入口 throws（definite）+ may-throw 效果种类（L2） */
function gateFace(
  src: string,
  args: Abs[] = [],
): { throws: string; effects: string[] } {
  const exports = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: { throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(exports, "f", args as never) as never;
    } catch {
      /* 入口整抛：definite 经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  return {
    throws: result.throws ? formatShape(result.throws as never) : "",
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

/** try/catch 包裹模板：RHS 表达式定抛时返回 "TypeError" */
const thrown = (rhsExpr: string, left = "({})"): string =>
  `export function f() { try { ${left} instanceof ${rhsExpr}; return "no-throw"; } catch (e) { return e.constructor.name; } }`;

describe("Bug 33: obj/arr/tuple RHS 定抛 TypeError（catch 面）", () => {
  const cases: [string, string][] = [
    ["({}) instanceof ({})", thrown("({})")],
    ["({}) instanceof []", thrown("[]")],
    ["({}) instanceof [1]", thrown("[1]")],
    ["ident 绑定 obj RHS", `export function f() { const C = {}; try { ({}) instanceof C; return "no-throw"; } catch (e) { return e.constructor.name; } }`],
    ["({}) instanceof Object.create(null)", thrown("Object.create(null)")],
    ["({}) instanceof {[@@hasInstance]:3}（不可调用槽）", thrown("{ [Symbol.hasInstance]: 3 }")],
    ["5 instanceof {}（prim 左值同抛）", thrown("{}", "5")],
  ];
  for (const [label, src] of cases) {
    it(label, () => {
      expect(catchFace(src)).toBe("TypeError");
    });
  }
});

describe("Bug 33: prim RHS 控制组（Bug 5 既有臂不回退）", () => {
  const cases: [string, string][] = [
    ["({}) instanceof 1", thrown("1")],
    ["({}) instanceof null", thrown("null")],
    ["({}) instanceof undefined", thrown("undefined")],
    ["({}) instanceof \"s\"", thrown('"s"')],
  ];
  for (const [label, src] of cases) {
    it(label, () => {
      expect(catchFace(src)).toBe("TypeError");
    });
  }
});

describe("Bug 33: gate 面（L2）", () => {
  it("obj/arr/tuple RHS definite → 入口 throws TypeError（修前静默）", () => {
    expect(gateFace(`export function f() { return ({}) instanceof ({}); }`).throws).toContain("TypeError");
    expect(gateFace(`export function f() { return ({}) instanceof []; }`).throws).toContain("TypeError");
    expect(gateFace(`export function f() { const C = {}; return ({}) instanceof C; }`).throws).toContain("TypeError");
    expect(gateFace(`export function f() { return ({}) instanceof Object.create(null); }`).throws).toContain("TypeError");
  });

  it("brand 实例 RHS（new Map()）→ may TypeError，不定抛（Proxy 面）", () => {
    const g = gateFace(`export function f() { return ({}) instanceof new Map(); }`);
    expect(g.effects).toContain("TypeError");
    expect(g.throws).not.toContain("TypeError");
    expect(catchFace(thrown("new Map()"))).not.toBe("TypeError");
  });

  it("any RHS → may TypeError（既有 any 臂不回退）", () => {
    const g = gateFace(`export function f(c) { return ({}) instanceof c; }`, [anyAbs]);
    expect(g.effects).toContain("TypeError");
  });

  it("合法 RHS 控制组 → 无 TypeError 效果 / 无 throws", () => {
    expect(gateFace(`export function f() { return [] instanceof Array; }`).effects).not.toContain("TypeError");
    expect(gateFace(`export function f() { return ({}) instanceof Object; }`).effects).not.toContain("TypeError");
    expect(gateFace(`export function f() { return ({}) instanceof Function; }`).effects).not.toContain("TypeError");
    expect(gateFace(`export function f() { class A {} return new A() instanceof A; }`).effects).not.toContain("TypeError");
    expect(gateFace(`export function f() { let o = { [Symbol.hasInstance](v) { return true; } }; return 5 instanceof o; }`).effects).not.toContain("TypeError");
    expect(gateFace(`export function f() { return ({}) instanceof Object.create({ x: 1 }); }`).effects).not.toContain("TypeError");
    // fn 形状 RHS（普通 function / 箭头）不校验——见文件头 documented 债
    expect(gateFace(`export function f() { return ({}) instanceof (function () {}); }`).effects).not.toContain("TypeError");
    expect(gateFace(`export function f() { return ({}) instanceof ((v) => true); }`).effects).not.toContain("TypeError");
  });
});

describe("Bug 33: 合法控制组值面不回退（@@hasInstance / class / D 类口径）", () => {
  it("自定义 @@hasInstance 调用面保持（callable 槽放行）", () => {
    expect(
      litValue(
        callTranspiledExportFull(
          runTranspiled(
            `export function f() { let o = { [Symbol.hasInstance](v) { return true; } }; return 5 instanceof o; }`,
            { mode: "analyze" },
          ),
          "f",
          [],
        ).result,
      ),
    ).toEqual({ ok: true, value: true });
    expect(
      litValue(
        callTranspiledExportFull(
          runTranspiled(
            `export function f() { let o = { [Symbol.hasInstance](v) { return 0; } }; return 5 instanceof o; }`,
            { mode: "analyze" },
          ),
          "f",
          [],
        ).result,
      ),
    ).toEqual({ ok: true, value: false });
  });

  it("内建构造器 / class RHS 值面保持", () => {
    expect(catchFace(`export function f() { return [] instanceof Array ? "true" : "false"; }`)).toBe("true");
    expect(catchFace(`export function f() { return ({}) instanceof Object ? "true" : "false"; }`)).toBe("true");
    expect(catchFace(`export function f() { class A {} return new A() instanceof A ? "true" : "false"; }`)).toBe("true");
    expect(catchFace(`export function f() { return 's' instanceof String ? "true" : "false"; }`)).toBe("false");
  });

  it("D 类（Bug 16）open obj 左值口径不回退：open obj instanceof Array 不断言精确 false", () => {
    const r = catchFace(`export function f() { return Object.create([]) instanceof Array ? "true" : "false"; }`);
    expect(r.startsWith("abstract:")).toBe(true);
    expect(r).not.toBe("false");
    expect(catchFace(`export function f() { return Object.create(null) instanceof Object ? "true" : "false"; }`)).toBe("false");
  });

  it("open obj RHS（Object.create(proto)）保守不抛（原生 TypeError，documented 债）", () => {
    expect(catchFace(thrown("Object.create({ x: 1 })"))).toBe("no-throw");
  });

  it("nullish 左值 + 合法 RHS：原生不抛恒 false（Bug 5 既有口径）", () => {
    expect(catchFace(`export function f() { return null instanceof Object ? "true" : "false"; }`)).toBe("false");
    expect(catchFace(`export function f() { return undefined instanceof Array ? "true" : "false"; }`)).toBe("false");
  });

  it("fn 形状 RHS 不校验：boolean 而非定抛（箭头原生 TypeError，generator 原生合法——见文件头）", () => {
    // 普通函数 / 箭头 RHS：引擎折抽象 boolean（$instanceofNonIdent）
    expect(catchFace(thrown("(function () {})"))).not.toBe("TypeError");
    expect(catchFace(thrown("((v) => true)"))).not.toBe("TypeError");
  });
});
