/**
 * Bug 194 回归：`delete X.prototype.m` 不从**方法注册表**移除（删除后仍可调用
 * / 继承面不更新）。
 *
 * 根因：方法在**方法注册表**（`spec.methods`）里，不在原型对象的槽上；
 * `$del`（runtime/members.ts）只删内层 obj 的槽 ⇒ 删的是一个不存在的键 ⇒
 * 删除事件**不留任何痕迹**，注册表侧无人通知 ⇒ `findMethod` 继续沿链命中。
 *
 * 修法（本片，packages/core/src/algebra/exec/class/declare.ts）：新增
 * `deleteProtoMethod(ctorName, key)`——把方法条目从注册表摘掉（读面 / 调用面
 * / in 面三面同步缺席）。
 *
 * **接线点在 runtime/members.ts 的 `$del`（S16 已接线）**：删除的
 * 接收者是 `.prototype` brand（`A.prototype`）时，按名取 owner 类并调用本
 * 钩子。端到端用例（`delete A.prototype.m`）见文件末尾。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, isNever, throwsError } from "./eval-helpers.ts";
import { diffBody } from "./differential/harness.ts";
import { deleteProtoMethod, findMethod, findStaticMethod } from "../exec/class/declare.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 194 — 原型方法删除钩子（deleteProtoMethod）", () => {
  it("钩子把方法条目从注册表摘掉（findMethod 沿链不再命中）", () => {
    call(wrap(`class DelMe194 { m(){ return 1; } } class DelMe194Sub extends DelMe194 {} return 1;`), "f");
    expect(findMethod("DelMe194", "m")).toBeDefined();
    expect(findMethod("DelMe194Sub", "m")).toBeDefined();
    expect(deleteProtoMethod("DelMe194", "m")).toBe(true);
    expect(findMethod("DelMe194", "m")).toBeUndefined();
    // 派生类沿链继承该方法——删除后继承面同步更新
    expect(findMethod("DelMe194Sub", "m")).toBeUndefined();
  });

  it("钩子不误伤静态方法（原生：delete A.prototype.m 不动 A.m）", () => {
    call(wrap(`class DelMe194b { m(){ return 1; } static sm(){ return 2; } } return 1;`), "f");
    expect(findStaticMethod("DelMe194b", "sm")).toBeDefined();
    expect(deleteProtoMethod("DelMe194b", "m")).toBe(true);
    expect(findStaticMethod("DelMe194b", "sm")).toBeDefined();
  });

  it("钩子对不存在的方法返回 false（幂等）", () => {
    call(wrap(`class DelMe194c { m(){ return 1; } } return 1;`), "f");
    expect(deleteProtoMethod("DelMe194c", "nope")).toBe(false);
    expect(deleteProtoMethod("DelMe194c", "m")).toBe(true);
    expect(deleteProtoMethod("DelMe194c", "m")).toBe(false);
  });

  it("负控制：删除钩子不动别的类", () => {
    call(wrap(`class DelMe194d { m(){ return 1; } } class DelMe194e { m(){ return 2; } } return 1;`), "f");
    expect(deleteProtoMethod("DelMe194d", "m")).toBe(true);
    expect(findMethod("DelMe194e", "m")).toBeDefined();
  });

  it("端到端：delete A.prototype.m 后 A.prototype.m / B.prototype.m → undefined、\"m\" in B.prototype → false", () => {
    expect(
      v(wrap(`class A { m(){ return 1; } } class B extends A {} delete A.prototype.m; return String(A.prototype.m);`)),
    ).toEqual({ ok: true, value: "undefined" });
    expect(
      v(wrap(`class A { m(){ return 1; } } class B extends A {} delete A.prototype.m; return String(B.prototype.m);`)),
    ).toEqual({ ok: true, value: "undefined" });
    expect(
      v(wrap(`class A { m(){ return 1; } } class B extends A {} delete A.prototype.m; return String("m" in B.prototype);`)),
    ).toEqual({ ok: true, value: "false" });
  });

  it("负控制：delete A.prototype.m 不动别的类的方法", () => {
    expect(
      v(
        wrap(
          `class DelMe194f { m(){ return 1; } } class DelMe194g { m(){ return 2; } } delete DelMe194f.prototype.m; return typeof DelMe194g.prototype.m;`,
        ),
      ),
    ).toEqual({ ok: true, value: "function" });
  });

  it("负控制：delete A.prototype.<不存在的键> → 原有方法仍在", () => {
    expect(
      v(wrap(`class DelMe194h { m(){ return 1; } } delete DelMe194h.prototype.nope; return typeof DelMe194h.prototype.m;`)),
    ).toEqual({ ok: true, value: "function" });
  });
});

/**
 * Bug 194 · S19（**调用面**）：`delete X.prototype.m` 之后**调用** `a.m()`——
 * 原生定抛 TypeError（`a.m is not a function`），引擎此前折 unknown
 * （never throws ⇒ L2 `nudo:entry-may-throw` 门禁假绿）。
 *
 * 修法（packages/core/src/algebra/exec/class/invoke.ts）：调用点读不到
 * **可调用**目标时记 TypeError——两种情形原生同抛：
 *  - 方法确实不存在（delete 之后 / 从未定义）；
 *  - 方法在但值不是函数（`a.m = undefined`）。
 * 读面**不抛**（读 `a.m` 得 undefined 不抛）——本片只改调用面。
 */
describe("Bug 194 · S19 — 调用面：delete X.prototype.m 后调用定抛 TypeError", () => {
  it("repro：delete A.prototype.m 后 a.m() → throws TypeError（原生同抛）", () => {
    const r = call(
      wrap(`class A { m(){ return 1; } } class B extends A {} delete A.prototype.m; const a = new B(); return a.m();`),
      "f",
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
    expect(
      diffBody(
        `class A { m(){ return 1; } } class B extends A {} delete A.prototype.m; const a = new B(); return a.m();`,
      ),
    ).toBeNull();
  });

  it("自有类实例同折：delete A.prototype.m 后 new A().m() → TypeError", () => {
    const r = call(
      wrap(`class A { m(){ return 1; } } delete A.prototype.m; const a = new A(); return a.m();`),
      "f",
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("方法从未定义同折：a.neverDefined() → TypeError（原生同抛）", () => {
    const r = call(wrap(`class A { m(){ return 1; } } const a = new A(); return a.neverDefined();`), "f");
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
    expect(
      diffBody(`class A { m(){ return 1; } } const a = new A(); return a.neverDefined();`),
    ).toBeNull();
  });

  it("方法在但值不是函数：ctor `this.m = undefined` → a.m() → TypeError（原生同抛）", () => {
    const r = call(
      wrap(`class A { constructor(){ this.m = undefined; } } return new A().m();`),
      "f",
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
    expect(
      diffBody(`class A { constructor(){ this.m = undefined; } } return new A().m();`),
    ).toBeNull();
  });

  it("user try/catch 可吸收（原生同：抛错被 catch 捕获）", () => {
    expect(
      v(
        wrap(
          `class A { m(){ return 1; } } delete A.prototype.m; const a = new A(); try { a.m(); } catch (e) { return e.name; } return "no-throw";`,
        ),
      ),
    ).toEqual({ ok: true, value: "TypeError" });
  });

  it("负控制：**读面**不抛——a.m 读回 undefined（调用面才抛）", () => {
    expect(
      v(
        wrap(`class A { m(){ return 1; } } class B extends A {} delete A.prototype.m; const a = new B(); return String(a.m);`),
      ),
    ).toEqual({ ok: true, value: "undefined" });
    expect(
      diffBody(
        `class A { m(){ return 1; } } class B extends A {} delete A.prototype.m; const a = new B(); return String(a.m);`,
      ),
    ).toBeNull();
  });

  it("负控制：方法仍在 → 调用不变（a.m() → 1，不抛）", () => {
    expect(
      v(wrap(`class A { m(){ return 1; } } class B extends A {} const a = new B(); return a.m();`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("负控制：删除不误伤别的类（new C().m() → 2，不抛）", () => {
    expect(
      v(
        wrap(
          `class DelMe194i { m(){ return 1; } } class DelMe194j { m(){ return 2; } } delete DelMe194i.prototype.m; return new DelMe194j().m();`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  });

  it("负控制：Object.prototype 名恒可得（a.toString() 不抛）", () => {
    expect(
      v(
        wrap(`class A { m(){ return 1; } } delete A.prototype.m; const a = new A(); return typeof a.toString;`),
      ),
    ).toEqual({ ok: true, value: "function" });
  });

  it("负控制：静态面不受影响（A.s() → 2，不抛）", () => {
    expect(
      v(wrap(`class A { m(){ return 1; } static s(){ return 2; } } delete A.prototype.m; return A.s();`)),
    ).toEqual({ ok: true, value: 2 });
  });

  it("负控制：内建 brand 实例不受影响（new Date().getTime() 不抛）", () => {
    const r = call(wrap(`const d = new Date(); return typeof d.getTime();`), "f");
    expect(isNever(r.result)).toBe(false);
  });

  it("负控制：ctor 自有 fn 槽调用不变（this.m = fn → 42，不抛）", () => {
    expect(
      v(
        wrap(`class A { constructor(){ this.m = function(){ return 42; }; } } return new A().m();`),
      ),
    ).toEqual({ ok: true, value: 42 });
  });

  it("负控制：内建父类链保守不判（class MyMap extends Map {} → 链有内建父，原型面不完备）", () => {
    const r = call(wrap(`class MyMap extends Map {} return new MyMap().nope();`), "f");
    expect(isNever(r.result)).toBe(false);
  });
});
