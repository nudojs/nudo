/**
 * BUG-008 调用边界异常语义回归（三面）：
 * 1. 原生异常不得折成 result=unknown, throws=never（假「保证不抛」）
 * 2. 抛出载荷必须进 CallRecord（$callNamed 与 class.ts 同约定）
 * 3. compiled-body NudoThrow 与 apply 同径 rethrow，record 不得落成
 *    never+never 被 isLeakedCallRecord 丢弃
 */
import { describe, it, expect } from "vitest";
import { parse } from "@babel/parser";
import {
  runTranspiled,
  callTranspiledExportFull,
  setEvalCallCollector,
  absFunction,
  num,
  numLit,
  type Abs,
  type EvalCallRecord,
} from "../index.ts";
import { errorTypeAbs } from "../exec/may-throw.ts";
import { $call } from "../exec/call.ts";
import { isNudoThrow } from "../exec/nudo-throw.ts";

function bodyFn(src: string): Abs {
  const ast = parse(src, { sourceType: "script" });
  const decl = ast.program.body[0]!;
  if (decl.type !== "FunctionDeclaration") throw new Error("bad fixture");
  return absFunction(["x"], { body: decl.body });
}

describe("BUG-008 face 1: native error → throws, never throws=never", () => {
  it("host mock throwing TypeError yields throws=TypeError brand, not never", () => {
    const exports = {
      boom: () => {
        throw new TypeError("native boom");
      },
    };
    const r = callTranspiledExportFull(exports as never, "boom", []);
    // 关键：throws 绝不能是 never（假「保证不抛」）
    expect(r.throws.shape.k).not.toBe("never");
    expect(r.throws.shape.k).toBe("brand");
    if (r.throws.shape.k === "brand") {
      expect(r.throws.shape.name).toBe("TypeError");
    }
    // result 保持 fail-closed（unknown 或 never 均可，不得假装是具体值）
    expect(["unknown", "never"]).toContain(r.result.shape.k);
  });

  it("host mock throwing RangeError surfaces as throws too", () => {
    const exports = {
      boom: () => {
        throw new RangeError("depth");
      },
    };
    const r = callTranspiledExportFull(exports as never, "boom", []);
    expect(r.throws.shape.k).not.toBe("never");
    if (r.throws.shape.k === "brand") {
      expect(r.throws.shape.name).toBe("RangeError");
    }
  });

  it("throws=never is only for true control-flow (no throw → never)", () => {
    const exports = { ok: () => 1 };
    const r = callTranspiledExportFull(exports as never, "ok", []);
    // 未抛：throws 仍是 never（不误报）
    expect(r.throws.shape.k).toBe("never");
  });
});

describe("BUG-008 face 2: throw payload lands in CallRecord", () => {
  it("$callNamed record keeps custom throw payload (not unknown)", () => {
    const src = `
      export function f() { throw "custom-payload"; }
      export function g() { return f(); }
    `;
    const records: EvalCallRecord[] = [];
    const prev = setEvalCallCollector((r) => records.push(r));
    try {
      const run = runTranspiled(src, { mode: "analyze" });
      callTranspiledExportFull(run, "g", []);
    } finally {
      setEvalCallCollector(prev);
    }
    const fRec = records.find((r) => r.fnName === "f");
    expect(fRec).toBeDefined();
    expect(fRec!.threw).toBe(true);
    // threw 时 result 位 = 抛出 Abs（与 class.ts 同约定）：不得是无 term 的 unknown
    expect(fRec!.result.shape.k).not.toBe("unknown");
    expect(fRec!.result.shape.k).not.toBe("never");
  });

  it("native TypeError payload becomes error brand in record", () => {
    const src = `
      function boom() { throw new TypeError("t"); }
      export function g() { return boom(); }
    `;
    const records: EvalCallRecord[] = [];
    const prev = setEvalCallCollector((r) => records.push(r));
    try {
      const run = runTranspiled(src, { mode: "analyze" });
      callTranspiledExportFull(run, "g", []);
    } finally {
      setEvalCallCollector(prev);
    }
    const boomRec = records.find((r) => r.fnName === "boom");
    expect(boomRec).toBeDefined();
    expect(boomRec!.threw).toBe(true);
    expect(boomRec!.result.shape.k).not.toBe("never");
    expect(boomRec!.result.shape.k).not.toBe("unknown");
  });
});

describe("BUG-008 face 3: compiled-body throw is not a leaked record", () => {
  it("$call on compiled body rethrows NudoThrow (align with apply)", () => {
    const f = bodyFn("function boom(x) { throw 'cb-payload'; }");
    let caught: unknown;
    try {
      $call(f, [num()]);
    } catch (e) {
      caught = e;
    }
    expect(isNudoThrow(caught)).toBe(true);
  });

  it("compiled-body throw keeps a call record with real throwsAbs", () => {
    const src = `
      function boom(x) { throw "cb-payload"; }
      export function g(x) { return boom(x); }
    `;
    const records: EvalCallRecord[] = [];
    const prev = setEvalCallCollector((r) => records.push(r));
    let r: { result: Abs; throws: Abs } | undefined;
    try {
      const run = runTranspiled(src, { mode: "analyze" });
      r = callTranspiledExportFull(run, "g", [numLit(1)]);
    } finally {
      setEvalCallCollector(prev);
    }
    const boomRec = records.find((x) => x.fnName === "boom");
    expect(boomRec).toBeDefined();
    expect(boomRec!.threw).toBe(true);
    // 关键：record 不得是 never+never（isLeakedCallRecord 会整条丢弃）
    expect(boomRec!.result.shape.k).not.toBe("never");
    // 入口边界吸收：result=never，throws 携带载荷
    expect(r!.result.shape.k).toBe("never");
    expect(r!.throws.shape.k).not.toBe("never");
  });
});

describe("BUG-008: errorTypeAbs helper sanity", () => {
  it("errorTypeAbs produces brand Error shape", () => {
    const t = errorTypeAbs("TypeError");
    expect(t.shape.k).toBe("brand");
    if (t.shape.k === "brand") expect(t.shape.name).toBe("TypeError");
  });
});
