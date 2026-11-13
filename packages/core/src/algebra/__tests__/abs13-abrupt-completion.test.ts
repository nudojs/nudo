/**
 * ABS-13 · 生成器 **abrupt completion**（`.return()` / `.throw()` / `for-of break`
 * / `yield*` 委托）与 `try/finally` 的值面语义。
 *
 * 背景（2026-11-13 样例搜索）：引擎 eager 收集生成器体、靠「挂起点绑定回放」
 * 复现值面挂起，但 abrupt completion 会执行外围 `finally`——旧实现在
 * `try { yield } finally { cleaned = true }` 之后读到 **确定的 `false`**
 * （native 是 `true`）⇒ wrong-exact（native 不可能的值）。
 *
 * 方案 C 护栏：abrupt completion 时把「挂起点快照」与「终态格」逐绑定 join
 * （sound 过近似），因此 finalizer 写过的绑定不再给出 native 不可能的定值。
 * 精度（把 `false | true` 收窄成 `true`）属方案 A（finalizer 重放），另行立项。
 *
 * 本夹具就是 native-vs-nudo 对照的**最小复现集**：
 * | 场景 | native | 旧引擎 | 现在 |
 * |---|---|---|---|
 * | `.return()` 穿 finally | `true` | `false` ✗ | `false \| true` ✓ |
 * | `.throw()` 穿 finally | `true` | `false` ✗ | `false \| true` ✓ |
 * | `for-of break`（隐式 return） | `true` | `false \| true` | `false \| true` |
 * | `yield*` + break | `true` | `false \| true` | `false \| true` |
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { formatShape } from "../format/format.ts";

const shapeOf = (src: string): string => formatShape(call(src, "f").result);

describe("ABS-13 · abrupt completion 不得给出 native 不可能的值", () => {
  it(".return() 穿过 try/finally：cleaned 不再是确定的 false", () => {
    const src = `
let cleaned = false;
function* g() {
  try {
    yield 1;
  } finally {
    cleaned = true;
  }
}
export function f() {
  const it = g();
  it.next();
  it.return(0);
  return cleaned;
}`;
    expect(shapeOf(src)).toBe("true");
  });

  it(".throw() 穿过 try/finally：cleaned 不再是确定的 false", () => {
    const src = `
let cleaned = false;
function* g() {
  try {
    yield 1;
  } finally {
    cleaned = true;
  }
}
export function f() {
  const it = g();
  it.next();
  try {
    it.throw(new Error("x"));
  } catch {}
  return cleaned;
}`;
    expect(shapeOf(src)).toBe("true");
  });

  it("for-of 提前 break（隐式 .return()）穿过 finally", () => {
    const src = `
let cleaned = false;
function* g() {
  try {
    yield 1;
    yield 2;
  } finally {
    cleaned = true;
  }
}
export function f() {
  for (const _v of g()) {
    break;
  }
  return cleaned;
}`;
    expect(shapeOf(src)).toBe("true");
  });

  it("yield* 委托 + break 穿过内层 finally", () => {
    const src = `
let cleaned = false;
function* inner() {
  try {
    yield 1;
  } finally {
    cleaned = true;
  }
}
function* outer() {
  yield* inner();
}
export function f() {
  for (const _v of outer()) {
    break;
  }
  return cleaned;
}`;
    expect(shapeOf(src)).toBe("false | true");
  });
});

describe("ABS-13 · 护栏不扩大无 finally 的既有精度", () => {
  it("无 finally 时 .return() 仍停在挂起点：yield 之后的写不生效", () => {
    const src = `
let x = 0;
function* g() {
  x = 1;
  yield 1;
  x = 2;
}
export function f() {
  const it = g();
  it.next();
  it.return(0);
  return x;
}`;
    // A1 步骤 4 的挂起点回放：native 在 .return() 后 x 仍是 1
    expect(shapeOf(src)).toBe("1");
  });

  it("正常耗尽推进到终态格（join(事前, 事后)，sound 过近似）", () => {
    const src = `
let x = 0;
function* g() {
  x = 1;
  yield 1;
  x = 2;
}
export function f() {
  const it = g();
  it.next();
  it.next();
  return x;
}`;
    // 终态格 = join(事前, 事后) ⇒ 0 | 2（A1 步骤 4 口径；不是 wrong-exact）
    expect(shapeOf(src)).toBe("0 | 2");
  });
});

describe("ABS-13 A · finalizer 重放（可安全抽取的 finally）", () => {
  it("嵌套 finally：内→外重放，精确 [true, true]", () => {
    const src = `
let a = false;
let b = false;
function* g() {
  try {
    try {
      yield 1;
    } finally {
      a = true;
    }
  } finally {
    b = true;
  }
}
export function f() {
  const it = g();
  it.next();
  it.return(0);
  return [a, b];
}`;
    expect(shapeOf(src)).toBe("[true, true]");
  });

  it("try 之后的语句不执行（重放而非推进终态）", () => {
    const src = `
let cleaned = false;
function* g() {
  try {
    yield 1;
  } finally {
    cleaned = true;
  }
  cleaned = false;
}
export function f() {
  const it = g();
  it.next();
  it.return(0);
  return cleaned;
}`;
    expect(shapeOf(src)).toBe("true");
  });

  it("第二次 .return() 不重跑 finalizer", () => {
    const src = `
let n = 0;
function* g() {
  try {
    yield 1;
  } finally {
    n = n + 1;
  }
}
export function f() {
  const it = g();
  it.next();
  it.return(0);
  it.return(0);
  return n;
}`;
    expect(shapeOf(src)).toBe("1");
  });

  it("不可安全抽取的 finalizer（含 var）退回 C：sound 过近似", () => {
    const src = `
let cleaned = false;
function* g() {
  try {
    yield 1;
  } finally {
    var local = 1;
    cleaned = true;
  }
}
export function f() {
  const it = g();
  it.next();
  it.return(0);
  return cleaned;
}`;
    expect(shapeOf(src)).toBe("false | true");
  });

  it(".throw() 被内层 catch 吸收 + finally：C 兜底（不误用 finalizer 单侧状态）", () => {
    const src = `
let cleaned = false;
function* g() {
  try {
    try {
      yield 1;
    } catch {
      cleaned = false;
    } finally {
      cleaned = true;
    }
  } finally {
  }
}
export function f() {
  const it = g();
  it.next();
  it.throw(new Error("x"));
  return cleaned;
}`;
    expect(shapeOf(src)).toBe("false | true");
  });
});

describe("ABS-13 A · finalizer 抛错（无外层自由写，无需快照）", () => {
  it(".return() 触发 finalizer 异常：异常上抛，不误报正常完成", () => {
    const src = `
function* g() {
  try {
    yield 1;
  } finally {
    null.x;
  }
}
export function f() {
  const it = g();
  it.next();
  try {
    it.return(0);
    return "resolved";
  } catch {
    return "rejected";
  }
}`;
    expect(shapeOf(src)).toBe('"rejected"');
  });
});
