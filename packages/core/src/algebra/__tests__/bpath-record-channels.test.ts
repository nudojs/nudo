/**
 * B-path 记录通道插桩（迁移件 2 基建）：
 * - __nudoRecordBinding：顶层绑定表（checkSource varAbs 通道）；
 * - __nudoRecordAssign：结构赋值记录（assign-mismatch gold 通道）——
 *   prev 读在写前、conditional = 分支/循环体内（与 ast-eval assignFlowDepth
 *   同口径；structuralAssignIssues 跳过 conditional）。
 * checkSource 三通道（assign/绑定/call 记录）共享一次求值——call 记录
 * 受 emit 双端同源约束暂留 Abs，绑定/赋值通道的切换与 call 通道一并
 * 落地（避免双引擎同跑无净收益）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, litValue } from "@nudojs/core";
import { bindingsOf } from "../exec/run.ts";
import { setBAssignCollector, type BAbsAssignRecord } from "../exec/calls.ts";

function run(src: string) {
  return runTranspiled(src, { mode: "analyze" });
}

describe("B-path binding table (varAbs channel)", () => {
  it("collects top-level bindings (final values)", () => {
    const r = run(`const a = 1; let b = 'x'; const c = a + 1; export const d = 9;`);
    const binds = bindingsOf(r);
    expect(binds).toBeDefined();
    expect(litValue(binds!.get("a") as never)).toBe(1);
    expect(litValue(binds!.get("b") as never)).toBe("x");
    expect(litValue(binds!.get("c") as never)).toBe(2);
    expect(litValue(binds!.get("d") as never)).toBe(9);
  });

  it("reassigned binding keeps final value", () => {
    const r = run(`let n = 1; n = 2;`);
    expect(litValue(bindingsOf(r)!.get("n") as never)).toBe(2);
  });

  it("nested declarations are not top-level bindings", () => {
    const r = run(`if (true) { const inner = 5; } const top = 1;`);
    const binds = bindingsOf(r)!;
    expect(binds.has("inner")).toBe(false);
    expect(binds.has("top")).toBe(true);
  });
});

describe("B-path assign records (assign-mismatch channel)", () => {
  it("top-level plain assignment records prev/next", () => {
    const records: BAbsAssignRecord[] = [];
    setBAssignCollector((r) => records.push(r));
    try {
      run(`let n = 1; n = "str";`);
    } finally {
      setBAssignCollector(null);
    }
    expect(records.length).toBe(1);
    expect(records[0]!.name).toBe("n");
    expect(litValue(records[0]!.prev as never)).toBe(1);
    expect(litValue(records[0]!.next as never)).toBe("str");
    expect(records[0]!.conditional).toBe(false);
  });

  it("branch assignments are conditional (analyze strips top-level loops)", () => {
    const records: BAbsAssignRecord[] = [];
    setBAssignCollector((r) => records.push(r));
    try {
      // analyze 模式 strip 顶层控制流：$for/$fork 调用整条跳过（副作用隔离）
      // ——if 臂经 $fork 仍执行（返回值用）；for 体不执行，故只有 if 臂记录。
      // 与 ast-eval 口径的产品差为零：structuralAssignIssues 跳过 conditional。
      run(`let n = 1; if (n > 0) { n = 2; }`);
    } finally {
      setBAssignCollector(null);
    }
    expect(records.map((r) => r.conditional)).toEqual([true]);
  });

  it("loop-body assigns record under exec mode", () => {
    const records: BAbsAssignRecord[] = [];
    setBAssignCollector((r) => records.push(r));
    try {
      runTranspiled(`let n = 1; for (let i = 0; i < 1; i++) { n = i; }`, { mode: "exec" });
    } finally {
      setBAssignCollector(null);
    }
    expect(records.map((r) => r.conditional)).toEqual([true]);
  });

  it("compound assignment records op result", () => {
    const records: BAbsAssignRecord[] = [];
    setBAssignCollector((r) => records.push(r));
    try {
      run(`let n = 7; n >>= 1;`);
    } finally {
      setBAssignCollector(null);
    }
    expect(litValue(records[0]!.prev as never)).toBe(7);
    expect(litValue(records[0]!.next as never)).toBe(3);
  });

  it("no collector → no crash (no-op channel)", () => {
    const r = run(`export let n = 1; n = 2;`);
    expect(litValue(r.n as never)).toBe(2);
  });
});
