/**
 * 直接 const 别名的**词法遮蔽**回归（fork/pack 绑定集的别名展开）。
 *
 * 背景：`const a = {...}; const b = a;` 的别名身份要跨 fork / pack 保持
 * （臂内写 `a` 时快照须带上 `b`，否则臂结束重绑 `a` 会断开 `b` 的引用）。
 * 别名组此前**只按名字**匹配，且外层作用域的组会漏进内层作用域 ⇒ 三个
 * 缺陷（均产出**自信错值**）：
 *
 * - D1：嵌套函数体拿到**外层**的别名组（`fn-body.ts` 的条件展开让空组
 *   保留外层组）⇒ 体内 fork 把外层别名伙伴拉进绑定集 ⇒ 复制/重绑外层
 *   绑定 ⇒ 外层 `a`/`b` 身份断开；
 * - D2：别名展开忽略词法遮蔽——块内 `let a` 遮蔽外层 `a` 时，块内 fork
 *   仍把外层 `b` 拉进绑定集 ⇒ 外层 `b` 被复制/重绑 ⇒ 外层别名断开；
 * - D3：命名空间独占 import 发成 `import { * as ns } from "…"`（非法
 *   ESM）——见 transpile-module-host.test.ts。
 *
 * 修法：别名组在**作用域边界**上计算——本层自有组（前导 const 直接别名）
 * + 外层组按本层**遮蔽名**过滤；展开仍按名字匹配（存活组内成员在本处
 * 指向同一绑定）。
 *
 * 钉：三个程序与原生 JS 逐值一致（native 值在括号里），并用差分 oracle
 * （vm.runInNewContext strict）对账；另钉两条护栏（外层别名伙伴被嵌套
 * 函数写 / 别处无关的遮蔽块）——修法不得把外层组整体丢掉。
 */
import { describe, it, expect } from "vitest";
import { callLit, tupleEls } from "../../__tests__/eval-helpers.ts";
import { litValue } from "../../abs.ts";
import { diffBody } from "../../__tests__/differential/harness.ts";

/** 调用导出函数并取字面量值（非字面量 ⇒ 抛，测试即红）。 */
function lit(src: string, ...args: unknown[]): unknown {
  const r = callLit(src, "f", ...args);
  const v = litValue(r.result);
  if (!v.ok) {
    throw new Error(`expected literal result, got non-literal (conf=${r.result.conf})`);
  }
  return v.value;
}

describe("别名组：词法遮蔽不得让外层别名伙伴进绑定集", () => {
  it("D1 嵌套函数体内遮蔽别名成员 ⇒ 外层 a/b 身份保持（native [3, 5]）", () => {
    const src = `export function f(p) {
      const a = { v: 1 };
      const b = a;
      function inner(q) {
        let b = { v: 99 };
        if (q) { b.v = 3; }
        return b.v;
      }
      const r = inner(p);
      a.v = 5;
      return [r, b.v];
    }`;
    expect(tupleEls(callLit(src, "f", true).result)).toEqual([3, 5]);
    expect(tupleEls(callLit(src, "f", false).result)).toEqual([99, 5]);
  });

  it("D2 块内遮蔽别名成员（if 臂）⇒ 外层 b 仍与 a 同对象（native 5）", () => {
    const src = `export function f(p) {
      const a = { v: 1 };
      const b = a;
      {
        let a = { v: 99 };
        if (p) { a = { v: 3 }; }
      }
      a.v = 5;
      return b.v;
    }`;
    expect(lit(src, true)).toBe(5);
  });

  it("D2 块内遮蔽别名成员（三元）⇒ 外层 b 仍与 a 同对象（native 5）", () => {
    const src = `export function f(p) {
      const a = { v: 1 };
      const b = a;
      {
        let a = { v: 99 };
        p ? (a = { v: 3 }) : 0;
      }
      a.v = 5;
      return b.v;
    }`;
    expect(lit(src, true)).toBe(5);
  });

  it("护栏：嵌套函数写**外层**别名伙伴 ⇒ 外层别名身份保持（native 5）", () => {
    // 外层组不得整体丢弃：内层未遮蔽 `a`/`b` 时，体内写外层 `b` 仍要
    // 把外层 `a` 一起快照/重绑（否则外层 a/b 断开 ⇒ 写丢失）。
    const src = `export function f(p) {
      const a = { v: 1 };
      const b = a;
      function inner(q) { if (q) { b.v = 3; } }
      inner(p);
      a.v = 5;
      return b.v;
    }`;
    expect(lit(src, true)).toBe(5);
  });

  it("护栏：别处的无关遮蔽块不影响函数级别名保持（native 5）", () => {
    const src = `export function f(c) {
      const a = { x: 0 };
      const b = a;
      if (c) { a.x = 5; }
      { let a = { x: 9 }; }
      return b.x;
    }`;
    expect(lit(src, true)).toBe(5);
  });

  it("差分对账（native oracle）：三个程序与原生逐值一致", () => {
    expect(
      diffBody(
        `const a = { v: 1 };
         const b = a;
         function inner(q) { let b = { v: 99 }; if (q) { b.v = 3; } return b.v; }
         const r = inner(true);
         a.v = 5;
         return [r, b.v];`,
      ),
    ).toBeNull();
    expect(
      diffBody(
        `const a = { v: 1 };
         const b = a;
         { let a = { v: 99 }; if (true) { a = { v: 3 }; } }
         a.v = 5;
         return b.v;`,
      ),
    ).toBeNull();
    expect(
      diffBody(
        `const a = { v: 1 };
         const b = a;
         { let a = { v: 99 }; true ? (a = { v: 3 }) : 0; }
         a.v = 5;
         return b.v;`,
      ),
    ).toBeNull();
  });
});
