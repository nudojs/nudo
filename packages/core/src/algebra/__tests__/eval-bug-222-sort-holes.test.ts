/**
 * Bug 222：Array.prototype.sort 把稀疏数组的空洞（hole）实体化成 undefined
 * 元素 → Object.keys 多一键、`in` 变真、HOF 不再跳过。
 *
 * 原生语义（node 实测）：
 * - 就地 `sort`：hole 位**不参与比较**、排序后**仍是 hole**
 *   （`[3,,1].sort()` → Object.keys = ["0","1"]、length 3、`2 in a` false、
 *   forEach 回调 2 次、filter 结果长度 2）。
 * - `toSorted`：拷贝面走 Get（hole 读成 undefined 并**写实**为元素）→
 *   Object.keys = ["0","1","2"]（本钉是负控制：不得把 toSorted 也改成保留洞）。
 * - 真实 `undefined` **元素**与 hole 不同：它始终是自有可枚举键。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string): unknown {
  const r = litValue(call(`export function f() { ${src} }`, "f").result);
  expect(r.ok).toBe(true);
  return r.value;
}

describe("Bug 222 — sort 保留稀疏数组的空洞", () => {
  it("sort 后 Object.keys 不含洞位（改前多出 '2'）", () => {
    expect(v(`const a=[3,,1]; a.sort(); return Object.keys(a).join(",");`)).toBe("0,1");
  });

  it("sort 后洞位 `in` 判定为 false（改前为 true）", () => {
    expect(v(`const a=[1,,2]; a.sort(); return String(2 in a);`)).toBe("false");
  });

  it("sort 后 HOF 跳过洞位（forEach 回调 2 次、改前 3 次）", () => {
    expect(
      v(`const a=[1,,2]; a.sort(); let n=0; a.forEach(()=>{n++;}); return String(n);`),
    ).toBe("2");
  });

  it("sort 后 filter 结果长度 2（改前 3）", () => {
    expect(v(`const a=[1,,2]; a.sort(); return String(a.filter(()=>true).length);`)).toBe("2");
  });

  it("自定义比较器分支同样保留洞位", () => {
    expect(
      v(`const a=[3,,1]; a.sort((x,y)=>x-y); return Object.keys(a).join(",");`),
    ).toBe("0,1");
  });

  it("长度不变（洞位仍在数组内）", () => {
    expect(v(`const a=[3,,1]; a.sort(); return String(a.length);`)).toBe("3");
  });

  it("负控制：toSorted 走 Get 语义把洞写实为 undefined 元素", () => {
    expect(v(`const a=[1,,2]; const b=a.toSorted(); return Object.keys(b).join(",");`)).toBe(
      "0,1,2",
    );
  });

  it("负控制：真实 undefined 元素仍是自有可枚举键（不是洞）", () => {
    expect(
      v(`const a=[3,undefined,1]; a.sort(); return Object.keys(a).join(",");`),
    ).toBe("0,1,2");
  });

  it("负控制：sort 之前洞位语义不变（keys 0,2 / forEach 2 次）", () => {
    expect(v(`const a=[3,,1]; return Object.keys(a).join(",");`)).toBe("0,2");
    expect(
      v(`const a=[1,,2]; let n=0; a.forEach(()=>{n++;}); return String(n);`),
    ).toBe("2");
  });

  it("负控制：稠密数组排序结果不变", () => {
    expect(v(`const a=[3,1,2]; a.sort(); return a.join(",");`)).toBe("1,2,3");
  });
});
