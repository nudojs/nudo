/**
 * Bug 294 回归：array-like 的 `length` / 索引是**访问器**时不再整体失效。
 *
 * ES 语义（node 实测）：
 * - `Array.from(arrayLike)` 走 array-like 路径时**先** GetMethod(items,
 *   @@iterator)（无 ⇒ 走 length 路径），随后 `len = ToLength(Get(items,
 *   "length"))`，再对 k ∈ [0, len) 逐个 `Get(items, k)`；
 * - 对象字面量的 `get length()` / `get 0()` 是**真访问器**——每次
 *   Array.from 恰好读一次 length、每个索引各读一次（getter 的副作用
 *   真实发生）。
 *
 * 修复前：array-like 读数**裸读 shape 槽**，而 transpile 只在槽里留
 * `$lit(void 0)` 占位（真 getter 住 accessorTable 侧表）⇒ length 被当
 * undefined（ToLength → 0 ⇒ 折 exact 空数组）、索引读成 undefined，且
 * getter 的副作用（计数 / 写状态）整体消失。
 *
 * 修法：`evalArrayFrom` 的 array-like 臂改经 `accessorReadDomain`
 * （accessors.ts——投影面同款读法）取 length / 索引的读域；每次
 * Array.from 对同一键只读一次（原生同款）。
 *
 * 负控制钉住：data-length 形态、数组 / 字符串 / Set 迭代物、无 length
 * 槽、只有索引访问器而 length 是数据槽——全部与原生同口径不变。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";
import { checkSource } from "../check.ts";
import { pTrue } from "../pred.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 294 — array-like 的访问器 length / 索引不再被忽略", () => {
  it("Array.from：访问器 length 决定元素数（原生 \"a,b\"，改前 \"\"）", () => {
    expect(
      v(wrap(`const o = { get length(){ return 2; }, 0: "a", 1: "b" }; return Array.from(o).join(",");`)),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("Array.from：getter 副作用落地且**只发生一次**（原生 \"2:1\"，改前 \"0:0\"）", () => {
    expect(
      v(
        wrap(
          `let n = 0; const o = { get length(){ n++; return 2; }, 0: "a", 1: "b" }; const a = Array.from(o); return a.length + ":" + n;`,
        ),
      ),
    ).toEqual({ ok: true, value: "2:1" });
  });

  it("Array.from：索引访问器的值被取到（原生 \"g\"，改前 \"\"）", () => {
    expect(
      v(wrap(`const o = { get 0(){ return "g"; }, length: 1 }; return Array.from(o).join(",");`)),
    ).toEqual({ ok: true, value: "g" });
  });

  it("借用调用 slice.call：访问器 length 生效（原生 \"a,b\"，改前 \"\"）", () => {
    expect(
      v(
        wrap(
          `const o = { get length(){ return 2; }, 0: "a", 1: "b" }; return Array.prototype.slice.call(o).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("借用调用 map.call：访问器 length 生效（原生 \"A,B\"，改前 \"\"）", () => {
    expect(
      v(
        wrap(
          `const o = { get length(){ return 2; }, 0: "a", 1: "b" }; return Array.prototype.map.call(o, x => x.toUpperCase()).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "A,B" });
  });

  it("借用调用 indexOf.call：访问器 length 生效（原生 1，改前 -1）", () => {
    expect(
      v(
        wrap(
          `const o = { get length(){ return 2; }, 0: "a", 1: "b" }; return Array.prototype.indexOf.call(o, "b");`,
        ),
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("索引访问器 + 数据 length：两个来源各按其读域（原生 \"a,z,\"）", () => {
    expect(
      v(wrap(`const o = { get 1(){ return "z"; }, length: 3, 0: "a" }; return Array.from(o).join(",");`)),
    ).toEqual({ ok: true, value: "a,z," });
  });
});

describe("Bug 294 负控制：非访问器形态不受影响", () => {
  it("data-length 的 array-like 仍按槽读", () => {
    expect(
      v(wrap(`const o = { length: 2, 0: "a", 1: "b" }; return Array.from(o).join(",");`)),
    ).toEqual({ ok: true, value: "a,b" });
    expect(
      v(wrap(`const o = { length: 2, 0: "a", 1: "b" }; return Array.prototype.slice.call(o).join(",");`)),
    ).toEqual({ ok: true, value: "a,b" });
    expect(
      v(wrap(`const o = { length: 2, 0: "a", 1: "b" }; return Array.prototype.indexOf.call(o, "b");`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("迭代物（数组 / 字符串 / Set）不受 array-like 臂影响", () => {
    // 迭代物走迭代路径（返抽象 arr——元素域 join，非 tuple）：与 array-like 臂无关
    expect(call(wrap(`return Array.from([1,2]);`)).result.shape.k).toBe("arr");
    expect(call(wrap(`return Array.from("ab");`)).result.shape.k).toBe("arr");
    expect(call(wrap(`return Array.from(new Set([1,2]));`)).result.shape.k).toBe("arr");
  });

  it("无 length 槽的闭对象仍折 0 长（原生 0）", () => {
    expect(v(wrap(`const o = { 0: "a", 1: "b" }; return Array.from(o).length;`))).toEqual({
      ok: true,
      value: 0,
    });
  });

  it("访问器 length 返回 undefined ⇒ ToLength 0（原生 0）", () => {
    expect(v(wrap(`const o = { get length(){ return undefined; }, 0: "a" }; return Array.from(o).length;`)))
      .toEqual({ ok: true, value: 0 });
  });

  it("访问器 length 返回字符串 \"2\" ⇒ ToLength 2（原生 2）", () => {
    expect(v(wrap(`const o = { get length(){ return "2"; }, 0: "a", 1: "b" }; return Array.from(o).length;`)))
      .toEqual({ ok: true, value: 2 });
  });

  it("L2 门禁：访问器 array-like 是**纯值错**——门禁恒绿，差异在签名", () => {
    // 改前改后门禁都是 0 诊断（不抛）——差异只体现在签名值上。
    const r = checkSource(
      "/t/bug294-arrlike.js",
      `export function fromAccessorLength() {
  const o = { get length() { return 2; }, 0: "a", 1: "b" };
  return Array.from(o).join(",");
}
`,
      pTrue,
      {},
    );
    expect(r.issues.some((i) => i.code === "nudo:entry-may-throw")).toBe(false);
  });
});

describe("Bug 294 越界待办（读面 / apply 面仍绕过访问器侧表）", () => {
  // 下列三处的读数在**我方文件之外**（arr-index.ts 的 $len / $idx、
  // invoke.ts 的 expandApplyArgs）——裸读槽 ⇒ 拿到占位 undefined。
  // 修法：同款经 accessorReadDomain（accessors.ts 已导出）取读域。
  it.todo("原生 o.length === 2（引擎当前 undefined）——需 arr-index.ts 的 $len 经 accessorReadDomain");
  it.todo("原生 o[0] === \"g\"（引擎当前 undefined）——需 arr-index.ts 的 $idx 经 accessorReadDomain");
  it.todo("原生 f.apply(null, o) === 3（引擎当前 0）——需 invoke.ts 的 expandApplyArgs 经 accessorReadDomain");
});
