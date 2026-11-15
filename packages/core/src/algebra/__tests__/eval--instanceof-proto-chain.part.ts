// MERGED (topic-related bug pins): eval-bug-205-instanceof-proto-chain.test.ts + eval-bug-205-instanceof-prototype-chain.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { formatShape } from "../format/format.ts";
import { call, throwsError } from "./eval-helpers.ts";

describe("[merged] eval-bug-205-instanceof-proto-chain.test.ts", () => {
/**
 * Bug 205（族 43 · 片 S7）：`instanceof` 必须按**真实原型链**判定 —— 补面 +
 * 口径钉。
 *
 * 本文件是 `eval-bug-205-instanceof-prototype-chain.test.ts`（族 02 · S22 已
 * 落地：原型被替换 / 实例原型置 null 的面）的**补面**，两处分工：
 * - S22：brand 实例侧（`F.prototype = {}` / `Object.setPrototypeOf(f, null)`）
 *   —— 引擎此前按构造器**名**匹配折 exact true（unsound 的肯定判断）。
 * - 本片（S7）：
 *   1. **闭 obj 接收者**（对象字面量）：其 [[Prototype]] 恰是 Object.prototype
 *      ⇒ 原型链恰是 [Object.prototype] ⇒ 与 RHS 的 prototype 做**身份**比较
 *      即可定论（原生 false；此前只对**内建**构造器名折 exact false，用户类 /
 *      用户函数折抽象 boolean —— 精度债）。
 *   2. **左操作数是宿主函数**（`F instanceof Function`）：转译的函数声明 /
 *      函数表达式不是 Abs，此前直读 `left.shape` 崩 ⇒ 引擎 fail-closed 折
 *      unknown（原生 true —— 精度债）。
 *
 * **口径更正（宿主实测）**：`new F() instanceof Function` 的原生值是
 * **false**，不是 true——普通函数 `F` 的实例原型链是
 * `f → F.prototype → Object.prototype → null`，`Function.prototype` 不在其中
 * （原生 false：`node -e 'function F(){}; console.log(new F() instanceof
 * Function)'` ⇒ false）。只有**以 Function 为基类**的类实例
 * （`class X extends Function`）才是 true。引擎此前已给 exact false ⇒ 本片
 * 保持该口径并钉住。
 *
 * **已知债（不在本片范围，钉住「不误判」侧）**：替换 / setPrototypeOf 进来的
 * 新原型，其**自身**的 [[Prototype]] 链未建模 ⇒ 引擎诚实降 boolean（原生
 * true/false vs 引擎 boolean —— sound 不误判）。本片**不改**既有钉
 * `eval-bug-205-instanceof-prototype-chain.test.ts` 的该条断言。
 */





const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 结果展示串（抽象面用） */
function shapeOf(src: string): string {
  return formatShape(call(src, "f").result);
}

/** 抛面探针：throws 是 brand 且 name 匹配 */
function threw(src: string, name: string): boolean {
  return throwsError(call(src, "f").throws, name);
}

describe("Bug 205（片 S7）— instanceof 按真实原型链判定：回归面（族 02 已落地）", () => {
  it("函数 / 类实例 instanceof 自身 → true", () => {
    expect(v(wrap(`function F(){} const f=new F(); return f instanceof F;`))).toEqual({
      ok: true,
      value: true,
    });
    expect(v(wrap(`class A{} const a=new A(); return a instanceof A;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("派生类实例 instanceof 父类 → true", () => {
    expect(v(wrap(`class A{} class B extends A{} const b=new B(); return b instanceof A;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("原型被替换后旧实例 instanceof 构造器 → false", () => {
    expect(
      v(wrap(`function F(){} const f=new F(); F.prototype={}; return f instanceof F;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("原型被替换后新造的实例 instanceof 构造器 → true", () => {
    expect(v(wrap(`function F(){} F.prototype={}; const g=new F(); return g instanceof F;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("实例原型置 null 后 instanceof 构造器 / Object → false（链 null 终止）", () => {
    expect(
      v(wrap(`function F(){} const f=new F(); Object.setPrototypeOf(f,null); return f instanceof F;`)),
    ).toEqual({ ok: true, value: false });
    expect(
      v(
        wrap(`function F(){} const f=new F(); Object.setPrototypeOf(f,null); return f instanceof Object;`),
      ),
    ).toEqual({ ok: true, value: false });
    expect(
      v(wrap(`class A{} const a=new A(); Object.setPrototypeOf(a,null); return a instanceof A;`)),
    ).toEqual({ ok: true, value: false });
  });
});

describe("Bug 205（片 S7）— instanceof Function 的宿主口径（原生 false）", () => {
  it("普通函数 / 类的实例 instanceof Function → false（原生 false，非 true）", () => {
    // 原生：`new F() instanceof Function` ⇒ false（Function.prototype 不在
    // `f → F.prototype → Object.prototype` 链里）
    expect(v(wrap(`function F(){} const f=new F(); return f instanceof Function;`))).toEqual({
      ok: true,
      value: false,
    });
    expect(v(wrap(`class A{} const a=new A(); return a instanceof Function;`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("以 Function 为基类的类实例 instanceof Function → true", () => {
    expect(
      v(wrap(`class X extends Function{} const x=new X(); return x instanceof Function;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("函数值本身 instanceof Function / Object → true（本片修：此前直读 left.shape 崩 ⇒ unknown）", () => {
    expect(v(wrap(`function F(){} return F instanceof Function;`))).toEqual({
      ok: true,
      value: true,
    });
    expect(v(wrap(`function F(){} return F instanceof Object;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("函数值 instanceof 内建构造器（Array） → false", () => {
    expect(v(wrap(`function F(){} return F instanceof Array;`))).toEqual({
      ok: true,
      value: false,
    });
  });
});

describe("Bug 205（片 S7）— 负控：闭 obj 接收者（对象字面量）", () => {
  it("对象字面量 instanceof 用户函数 / 用户类 → false（此前折抽象 boolean）", () => {
    expect(v(wrap(`function F(){} return ({} ) instanceof F;`))).toEqual({
      ok: true,
      value: false,
    });
    expect(v(wrap(`class A{} return ({} ) instanceof A;`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("F.prototype = Object.prototype 之后对象字面量 instanceof F → true（原型身份命中）", () => {
    expect(
      v(wrap(`function F(){} F.prototype=Object.prototype; return ({} ) instanceof F;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("对象字面量 instanceof Object → true；instanceof Array → false（既有口径不变）", () => {
    expect(v(wrap(`return ({} ) instanceof Object;`))).toEqual({ ok: true, value: true });
    expect(v(wrap(`return ({} ) instanceof Array;`))).toEqual({ ok: true, value: false });
  });
});

describe("Bug 205（片 S7）— 不误判护栏：RHS 的 prototype 不可判 ⇒ 降抽象", () => {
  it("箭头函数 RHS（原生定抛 TypeError）不得折 exact false", () => {
    const src = wrap(`const F = () => {}; return ({} ) instanceof F;`);
    expect(v(src)).not.toEqual({ ok: true, value: false });
    // BUG-175 部分收口：箭头函数无 .prototype ⇒ OrdinaryHasInstance 定抛
    // TypeError（node 实测），故 shape 为 never。生成器 / bind 产物仍折抽象
    // boolean（见下方两例）。
    expect(shapeOf(src)).toBe("never");
  });

  it("生成器函数 RHS（原生 false）不得折 exact true", () => {
    const src = wrap(`function* g(){} return ({} ) instanceof g;`);
    expect(v(src)).not.toEqual({ ok: true, value: true });
    expect(shapeOf(src)).toBe("boolean");
  });

  it("bind 产物 RHS（原生 false）不得折 exact false / true", () => {
    const src = wrap(`function F(){} const B = F.bind(null); return ({} ) instanceof B;`);
    expect(v(src)).not.toEqual({ ok: true, value: false });
    expect(v(src)).not.toEqual({ ok: true, value: true });
    expect(shapeOf(src)).toBe("boolean");
  });

  it("生成器对象替身（内部槽 obj）不得折 exact（既有钉 exec-review-fixes 复钉）", () => {
    const src = wrap(`function* g(){ yield 1; } class Gen {} return g() instanceof Gen;`);
    expect(v(src)).not.toEqual({ ok: true, value: false });
    expect(shapeOf(src)).toBe("boolean");
  });
});

describe("Bug 205（片 S7）— 已知债：替换进来的原型其 [[Prototype]] 链未建模", () => {
  it("setPrototypeOf(f, {}) 之后 instanceof F → 抽象 boolean（不得 exact true）", () => {
    // 原生 false；替换进来的原型的**自身**原型链未建模 ⇒ 诚实降 boolean
    // （既有钉 eval-bug-205-instanceof-prototype-chain.test.ts 同时钉住
    // 「不得 exact false」——本片不改该钉）
    const src = wrap(`function F(){} const f=new F(); Object.setPrototypeOf(f,{}); return f instanceof F;`);
    expect(v(src)).not.toEqual({ ok: true, value: true });
    expect(shapeOf(src)).toBe("boolean");
  });

  it("F.prototype={} 之后新实例 instanceof Object → 抽象 boolean（原生 true）", () => {
    const src = wrap(`function F(){} F.prototype={}; const g=new F(); return g instanceof Object;`);
    expect(v(src)).not.toEqual({ ok: true, value: true });
    expect(shapeOf(src)).toBe("boolean");
  });
});

describe("Bug 205（片 S7）— RHS 的 prototype 非对象 ⇒ 原生定抛 TypeError", () => {
  it("F.prototype = 5 之后 f instanceof F → TypeError", () => {
    expect(
      threw(wrap(`function F(){} const f=new F(); F.prototype=5; return f instanceof F;`), "TypeError"),
    ).toBe(true);
  });
});
});

describe("[merged] eval-bug-205-instanceof-prototype-chain.test.ts", () => {
/**
 * Bug 205 回归：`instanceof` 必须沿实例的**真实原型链**判定，不得按构造器
 * **名字**匹配折 exact true。
 *
 * ES 语义：`Object.setPrototypeOf(f, null)` 之后 `f instanceof F` → false
 * （[[Prototype]] 链终止，OrdinaryHasInstance 无从命中 `F.prototype`）。
 * 修复前：brand 实例的 brand 名就是构造器名，`$instanceof` 用
 * `evalClassChain(name).includes(rightName)` 名字匹配 → 折 exact true
 * （unsound 的肯定判断——类型守卫会走错分支）。
 *
 * 原型**替换**面（`F.prototype = {}` / `= 5`）需要「实例记录真实
 * [[Prototype]]」的建模（构造期捕获 + 写面更新）——S22 落地：
 * - `member.ts`：`$set` 对**宿主函数**建 facade，让 `F.prototype = {}` 的写
 *   落进槽（此前写穿后引擎完全无感）；
 * - `declare.ts`：实例**构造期**记录 [[Prototype]]（brand 实例带一条原型
 *   链记录）；
 * - `objects.ts`：`setPrototypeOf` 对 **brand 接收者**也记（此前只对 obj
 *   接收者记）；
 * - `members.ts`：`$instanceof` 沿**记录的链**做**身份**比较（RHS 的
 *   prototype 身份，不是名字）；原型不可判时降 boolean（不得 exact true）；
 *   RHS 的 `prototype` 为非对象时按 spec 抛 TypeError。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 抛面探针：throws 是 brand 且 name 匹配 */
function threw(src: string, name: string): boolean {
  return throwsError(call(src, "f").throws, name);
}

describe("Bug 205 — 原型被改写后 instanceof 不得折 exact true", () => {
  it("函数构造器实例：Object.setPrototypeOf(f, null) → false", () => {
    expect(
      v(wrap(`function F(){} const f=new F(); Object.setPrototypeOf(f,null); return f instanceof F;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("类实例：Object.setPrototypeOf(a, null) → false", () => {
    expect(
      v(wrap(`class A{} const a=new A(); Object.setPrototypeOf(a,null); return a instanceof A;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("负控制：未改写原型的实例仍折 exact true", () => {
    expect(v(wrap(`function F(){} const f=new F(); return f instanceof F;`))).toEqual({
      ok: true,
      value: true,
    });
    expect(v(wrap(`class A{} const a=new A(); return a instanceof A;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("负控制：派生类实例 instanceof 父类 → true", () => {
    expect(v(wrap(`class A{} class B extends A{} const b=new B(); return b instanceof A;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("负控制：原型对象 instanceof 自身 → false；instanceof 父类 → true", () => {
    expect(v(wrap(`class A{} return A.prototype instanceof A;`))).toEqual({ ok: true, value: false });
    expect(v(wrap(`class A{} class B extends A{} return B.prototype instanceof A;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("F.prototype = {} 之后 f instanceof F → false（实例记录真实 [[Prototype]]）", () => {
    expect(
      v(wrap(`function F(){} const f=new F(); F.prototype={}; return f instanceof F;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("F.prototype = 5 之后 f instanceof F → TypeError（RHS prototype 非对象）", () => {
    expect(
      threw(
        wrap(`function F(){} const f=new F(); F.prototype=5; return f instanceof F;`),
        "TypeError",
      ),
    ).toBe(true);
  });

  it("换原型前造的旧实例与换后造的新实例可区分（原生 \"false|true\"）", () => {
    expect(
      v(
        wrap(
          `function F(){} const f=new F(); F.prototype={x:1}; const g=new F(); return (f instanceof F)+"|"+(g instanceof F);`,
        ),
      ),
    ).toEqual({ ok: true, value: "false|true" });
  });

  it("原型替换后新造的实例仍 instanceof 构造器 → true", () => {
    expect(
      v(wrap(`function F(){} F.prototype={}; const g=new F(); return g instanceof F;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("原型替换写成 null → TypeError（RHS prototype 非对象）", () => {
    expect(
      threw(wrap(`function F(){} const f=new F(); F.prototype=null; return f instanceof F;`), "TypeError"),
    ).toBe(true);
  });

  it("setPrototypeOf 到普通对象后不再折 exact true（原型链不可判 → 降 boolean）", () => {
    const r = call(
      wrap(`function F(){} const f=new F(); Object.setPrototypeOf(f,{}); return f instanceof F;`),
      "f",
    );
    // 原生 false；引擎不得折 exact true（链不可判 → boolean），也不得折
    // exact false（那需要「替换进来的原型」的 [[Prototype]] 链可判）
    expect(litValue(r.result)).not.toEqual({ ok: true, value: true });
    expect(litValue(r.result)).not.toEqual({ ok: true, value: false });
  });

  it("负控制：原型替换后 fn 仍可调用、prototype 读回是新原型", () => {
    expect(v(wrap(`function F(){ return 7; } F.prototype={}; return F();`))).toEqual({
      ok: true,
      value: 7,
    });
  });
});
});
