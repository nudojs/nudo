/**
 * 评审修复：strict 不变性侧表必须随 $copy 迁移。
 * fork/switch/循环 pack 用 $copy 做快照——副本若丢失 frozen/sealed 标记，
 * 臂内写会假成功（本 PR strict-invariants 与引用语义的交互缺口）。
 * 分支语义：一臂 throw、一臂正常返回 → result 可能是正常值，
 * 但 throws 域必须含 TypeError，且写入值不得假成功。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";
import { abs } from "../abs.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function callFork(src: string) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, "f", [
    abs({ k: "prim", type: "number" }, undefined, undefined, "path"),
  ]);
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function throwsTypeError(t: unknown): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return (
    !!a &&
    typeof a === "object" &&
    a.shape?.k === "brand" &&
    a.shape.name === "TypeError"
  );
}

describe("strict invariants survive fork snapshots", () => {
  it("frozen object write in a branch records TypeError (no fake write)", () => {
    const r = callFork(
      `export function f(x) { const o = {a:1}; Object.freeze(o); if (x) { o.a = 2; } return o.a; }`,
    );
    expect(throwsTypeError(r.throws)).toBe(true);
    // 假成功会把写入值 2 折进结果；修复后另一臂仍是 1
    expect(litValue(r.result)).toBe(1);
  });

  it("frozen array push in a branch records TypeError", () => {
    const r = callFork(
      `export function f(x) { const a = [1,2]; Object.freeze(a); if (x) { a.push(3); } return a.length; }`,
    );
    expect(throwsTypeError(r.throws)).toBe(true);
    // 假成功会得到 3；修复后未写臂保持 2
    expect(litValue(r.result)).toBe(2);
  });

  it("sealed object new-slot write in a branch records TypeError", () => {
    const r = callFork(
      `export function f(x) { const o = {a:1}; Object.seal(o); if (x) { o.b = 2; } return 1; }`,
    );
    expect(throwsTypeError(r.throws)).toBe(true);
  });

  it("uncaught branch write on all paths is never + TypeError", () => {
    const r = call(
      `export function f(x) { const o = {a:1}; Object.freeze(o); o.a = 2; return o.a; }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
  });

  it("try/catch in a branch still absorbs frozen write", () => {
    const r = callFork(
      `export function f(x) { const o = {a:1}; Object.freeze(o); if (x) { try { o.a = 2; } catch(e) { return 'caught'; } } return 'ok'; }`,
    );
    const v = litValue(r.result);
    expect(["caught", "ok"]).toContain(v);
  });

  it("switch arm frozen write records TypeError", () => {
    const r = callFork(
      `export function f(x) { const a = [1,2]; Object.freeze(a); switch (x) { case 1: a[0] = 9; break; default: break; } return a[0]; }`,
    );
    expect(throwsTypeError(r.throws)).toBe(true);
    expect(litValue(r.result)).toBe(1);
  });

  it("non-frozen branch write stays allowed", () => {
    const r = callFork(
      `export function f(x) { const a = [1,2]; if (x) { a.push(3); } return a.length; }`,
    );
    expect(isNever(r.result)).toBe(false);
    expect(throwsTypeError(r.throws)).toBe(false);
  });
});
