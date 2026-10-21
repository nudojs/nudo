/**
 * Bug 168 回归（core 转译层）：`switch` 的 **case 测试按源码序求值，命中即停**。
 *
 * 修复前：发射面把 case 测试当**普通实参内联**——`$switch(disc, [{ test: t(1) },
 * { test: t(2) }])` 的实参数组在**进入 switch 之前**全部求值（JS 实参语义）
 * ⇒ 命中第一个 case 后**后续 case 测试仍会执行**（求值顺序 / 副作用错）。
 *
 * 修复后：case 测试改为 **getter**（`{ get test() { … } }`）——`$switch` 按序
 * 匹配时才读 `c.test` ⇒ 只求值到命中为止（原生 CaseBlock 语义）。抽象判别式
 * 路径（`$switch` 不读 getter）由臂入口补求值全部 case 测试（上界）。
 *
 * 负控制钉住：① 每个 case 测试**只求值一次**；② 抽象判别式下 case 测试
 * 仍全部求值（副作用不丢）；③ 相邻形态（if/else 判别）不受影响。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";
import { anyAbs } from "../abs.ts";

/** 原生 oracle（node 直接求值） */
function native(body: string): unknown {
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

/** 引擎求值（结果字面量值；非字面量 → "not-lit"） */
function engine(body: string, args: unknown[] = []): unknown {
  const r = call(
    `export function f(x) { ${body} }`,
    "f",
    args.map(() => anyAbs),
  );
  const lv = litValue(r.result);
  return lv.ok ? lv.value : `not-lit:${r.result}`;
}

describe("Bug 168: switch 的 case 测试命中即停", () => {
  it("命中第一个 case：后续 case 测试不求值（原生 1）", () => {
    const body = `let n = 0; function t(v){n=n+1;return v;} switch (1){case t(1):break; case t(2):break;} return n;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  });

  it("命中第二个 case：第一个 case 测试仍求值（原生 2）", () => {
    const body = `let n = 0; function t(v){n=n+1;return v;} switch (2){case t(1):break; case t(2):break;} return n;`;
    expect(native(body)).toBe(2);
    expect(engine(body)).toBe(2);
  });

  it("全不命中：所有 case 测试都求值（原生 2）", () => {
    const body = `let n = 0; function t(v){n=n+1;return v;} switch (9){case t(1):break; case t(2):break;} return n;`;
    expect(native(body)).toBe(2);
    expect(engine(body)).toBe(2);
  });

  it("命中即停：命中后的 case 测试的副作用不发生（原生 \"t1,one\"）", () => {
    const body = `const log=[]; function t(v){log.push("t"+v);return v;} switch (1){case t(1):log.push("one");break; case t(2):log.push("two");break;} return log.join(",");`;
    expect(native(body)).toBe("t1,one");
    expect(engine(body)).toBe("t1,one");
  });

  it("命中即停：命中后的 case 体的副作用也不发生（原生 101）", () => {
    const body = `let n=0; function t(v){n=n+1;return v;} switch (1){case t(1): n+=100; break; case t(2): n+=200; break;} return n;`;
    expect(native(body)).toBe(101);
    expect(engine(body)).toBe(101);
  });

  // --- 负控制 ---------------------------------------------------------
  it("负控制：每个 case 测试只求值一次（原生 1）", () => {
    const body = `let n = 0; function t(v){n=n+1;return v;} switch (1){case t(1):break;} return n;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  });

  it("负控制：抽象判别式下 case 测试全部求值（副作用不丢）", () => {
    // 判别式为抽象值 ⇒ 判不出命中 ⇒ 全部 case 测试求值 = 原生上界
    const body = `let n = 0; function t(v){n=n+1;return v;} switch (x){case t(1):break; case t(2):break;} return n;`;
    expect(engine(body)).toBe(2);
  });

  it("负控制：相邻形态（if/else 判别）不受影响", () => {
    const body = `let n=0; function t(v){n=n+1;return v;} if (1===1) { n+=t(1); } return n;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  });
});
