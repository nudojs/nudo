/**
 * fork 臂 × try 区域早退 join（wrong-definite 修复）回归。
 *
 * 根因：`stmtReturns` 无 TryStatement case → try 区域内的 return 不能触发
 * if 臂提升/双 return 改写，臂值以裸 JS return 退出 thunk 后被语句位
 * $fork 丢弃，fall-through 值独占结果（错定）。修复三件套：
 *  1. stmt-predicates：TryShape / finalizerJumpsOut / stmtReturns(try)
 *  2. 臂内 return 信号：conditionalFlow>0 时 $loopReturn（NudoReturn 经
 *     settleForkArms ret 臂恰一次交付：双 ret 抛出 join / 单 ret 入 exits）
 *  3. 边界吸收：函数体自包含（$catchReturn）、callAtFunctionBoundary /
 *     $call 编译体路径 join 帧 exits（此前 ret 臂值被丢弃 → 错定）
 *
 * 引擎值口径：callTranspiledExportFull；native 口径（strict new Function）
 * 已在调试脚本对拍，此处钉引擎期望。
 */
import { describe, it, expect } from "vitest";
import { formatShape } from "../format.ts";
import { anyAbs, numLit, litValue } from "../abs.ts";
import { $call } from "../exec/call.ts";
import { absFunction } from "../abs-fn.ts";
import { parseSource } from "../parse-source.ts";
import { call, val, isNever, throwsError } from "./eval-helpers.ts";

describe("fork-arm × try-region early-return join", () => {
  it("repro: catch-return inside if-arm (kind literal folds test definite)", () => {
    expect(
      val(`export function f() {
  const kind = 1;
  if (kind > 0) { try { throw [1, 2]; } catch (e) { return e[0] + e[1]; } }
  return 0;
}`),
    ).toEqual({ ok: true, value: 3 });
  });

  it("try-finally return inside if-arm", () => {
    expect(
      val(`export function f() {
  const kind = 1;
  if (kind > 0) { try { return 9; } finally { } }
  return 0;
}`),
    ).toEqual({ ok: true, value: 9 });
  });

  it("try/catch both-return inside if-arm", () => {
    expect(
      val(`export function f() {
  const kind = 1;
  if (kind > 0) { try { return 9; } catch (e) { return 1; } }
  return 0;
}`),
    ).toEqual({ ok: true, value: 9 });
  });

  it("controls: no enclosing if / plain if-return still work", () => {
    expect(val(`export function f() { try { throw [1, 2]; } catch (e) { return e[0] + e[1]; } return 0; }`))
      .toEqual({ ok: true, value: 3 });
    expect(val(`export function f() { const k = 1; if (k > 0) { return 3; } return 0; }`))
      .toEqual({ ok: true, value: 3 });
  });
});

describe("fork-arm × try-region sibling shapes", () => {
  it("if+else both arms try-return", () => {
    expect(
      val(`export function f() {
  const kind = 1;
  if (kind > 0) { try { return 8; } catch (e) { return 1; } }
  else { try { return 2; } catch (e) { return 3; } }
  return 0;
}`),
    ).toEqual({ ok: true, value: 8 });
  });

  it("else-arm try-return", () => {
    expect(
      val(`export function f() {
  const kind = -1;
  if (kind > 0) { return 1; }
  else { try { return 5; } catch (e) { return 2; } }
  return 0;
}`),
    ).toEqual({ ok: true, value: 5 });
  });

  it("else-if chain try arm", () => {
    expect(
      val(`export function f() {
  const kind = 2;
  if (kind > 3) { return 1; }
  else if (kind > 1) { try { return 7; } catch (e) { return 2; } }
  return 0;
}`),
    ).toEqual({ ok: true, value: 7 });
  });

  it("nested if try-return inside arm", () => {
    expect(
      val(`export function f() {
  const kind = 1;
  if (kind > 0) {
    if (kind > 0) { try { return 4; } catch (e) { return 2; } }
    return 3;
  }
  return 0;
}`),
    ).toEqual({ ok: true, value: 4 });
  });

  it("nested if both-return in arm (no try)", () => {
    expect(
      val(`export function f() {
  const kind = 1;
  if (kind > 0) { if (kind > 0) { return 1; } else { return 2; } }
  return 0;
}`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("while loop + if-arm try-return", () => {
    expect(
      val(`export function f() {
  let i = 0;
  while (i < 3) {
    i += 1;
    if (i === 2) { try { return 7; } catch (e) { return 1; } }
  }
  return 0;
}`),
    ).toEqual({ ok: true, value: 7 });
  });

  it("for loop + if-arm try-return", () => {
    expect(
      val(`export function f() {
  for (let i = 0; i < 3; i++) {
    if (i === 2) { try { return 11; } catch (e) { return 1; } }
  }
  return 0;
}`),
    ).toEqual({ ok: true, value: 11 });
  });

  it("switch arm try-return", () => {
    expect(
      val(`export function f(k) {
  switch (k) {
    case 1: { try { return 12; } catch (e) { return 2; } }
    default: return 0;
  }
}`, [numLit(1)]),
    ).toEqual({ ok: true, value: 12 });
  });

  it("break inside try inside if-arm (loop-carried)", () => {
    expect(
      val(`export function f() {
  const kind = 1;
  for (let i = 0; i < 5; i++) {
    if (kind > 0) { try { break; } finally { } }
  }
  return 1;
}`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("continue inside try inside if-arm (loop-carried)", () => {
    // i=0,1,2 → continue 跳过累加；i=3,4 → s=7（与 native 对拍一致）
    expect(
      val(`export function f() {
  let s = 0;
  for (let i = 0; i < 5; i++) {
    if (i < 3) { try { continue; } finally { } }
    s += i;
  }
  return s;
}`),
    ).toEqual({ ok: true, value: 7 });
  });

  it("finally break cancels try return (finally-wins)", () => {
    expect(
      val(`export function f() {
  const kind = 1;
  for (let i = 0; i < 3; i++) {
    if (kind > 0) { try { return 5; } finally { break; } }
  }
  return 0;
}`),
    ).toEqual({ ok: true, value: 0 });
  });

  it("try-catch-finally: return in catch", () => {
    expect(
      val(`export function f() {
  const kind = 1;
  if (kind > 0) { try { throw 1; } catch (e) { return 20; } finally { } }
  return 0;
}`),
    ).toEqual({ ok: true, value: 20 });
  });

  it("uncaught throw in try inside if-arm: result never + throws face", () => {
    const r = call(`export function f() {
  const kind = 1;
  if (kind > 0) { try { throw 42; } finally { } }
  return 0;
}`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "Error")).toBe(false); // throws 面是 42 字面量，非 brand
    expect(formatShape(r.throws)).toBe("42");
  });
});

describe("fork-arm × try-region with abstract params", () => {
  it("definite throw → catch-return still folds under abstract fork test", () => {
    // kind 字面量折 definite-true；throw 字面量 definite → catch 必达 → 3；
    // 未用到的抽象参数 p 不扰动早退折定
    expect(
      val(`export function f(p) {
  const kind = 1;
  if (kind > 0) { try { throw [1, 2]; } catch (e) { return e[0] + e[1]; } }
  return 0;
}`, [anyAbs]),
    ).toEqual({ ok: true, value: 3 });
  });

  it("abstract fork: try-ret arm joins with fall-through", () => {
    const r = call(
      `export function f(x) {
  if (x) { try { return 1; } catch (e) { return 2; } }
  return 0;
}`,
      "f",
      [anyAbs],
    );
    const s = formatShape(r.result);
    expect(s).toContain("1");
    expect(s).toContain("0");
  });

  it("abstract fork: ret-arm value is no longer dropped (arrow apply boundary joins exits)", () => {
    // $fnVal apply → callAtFunctionBoundary：帧内 exits join（修复前
    // ret 臂被丢弃、错定 fall-through 2）
    const r = call(
      `export const f = (c) => { let s = 0; for (let i = 0; i < 2; i++) { if (c) { return 3; } s += 1; } return s; };`,
      "f",
      [anyAbs],
    );
    const s = formatShape(r.result);
    expect(s).toContain("2");
    expect(s).toContain("3");
  });
});

describe("compiled body ($call body-fn) keeps arm returns", () => {
  const fnOf = (body: string) => {
    const file = parseSource(`function f(x) { ${body} }`);
    const decl = file.program.body.find(
      (s): s is { type: "FunctionDeclaration"; params: Array<{ name?: string }>; body: never } =>
        s.type === "FunctionDeclaration",
    )!;
    return absFunction(
      decl.params.map((p, i) => p.name ?? `p${i}`),
      { body: decl.body },
    );
  };

  it("both-return if body via $call compiled path", () => {
    const f = fnOf("if (x > 0) { try { return x; } catch (e) { return 0; } } return -x;");
    expect(litValue($call(f, [numLit(5)]) as never)).toEqual({ ok: true, value: 5 });
    expect(litValue($call(f, [numLit(-3)]) as never)).toEqual({ ok: true, value: 3 });
  });

  it("loop-return body via $call compiled path (latent NudoReturn leak)", () => {
    const f = fnOf("while (x > 0) { return 5; } return 0;");
    expect(litValue($call(f, [numLit(1)]) as never)).toEqual({ ok: true, value: 5 });
  });
});
