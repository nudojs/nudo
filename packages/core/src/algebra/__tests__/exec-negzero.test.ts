/**
 * B-path -0 语义差分回归。
 * 回归背景：term.ts lit() 把 -0 归一化为 +0——JS 中 -0 虽 === 0，
 * 但在除法（1/-0=-Infinity）、Math.sign/min/round/ceil/atan2 与 Object.is
 * 上有可观察语义，折叠丢失负零产生假精确。
 * 每条断言与 Node 真实执行结果对齐（vm 复核）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
} from "@nudojs/core";

function call(src: string, fnName: string) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function isNegZero(v: unknown): boolean {
  return typeof v === "number" && Object.is(v, -0);
}

describe("B-path negative zero", () => {
  it("unary minus on zero keeps -0", () => {
    const r = call(`export function run() { return -0; }`, "run");
    expect(isNegZero(litValue(r.result))).toBe(true);
  });

  it("0 * -1 folds to -0", () => {
    const r = call(`export function run() { return 0 * -1; }`, "run");
    expect(isNegZero(litValue(r.result))).toBe(true);
  });

  it("0 / -1 folds to -0", () => {
    const r = call(`export function run() { return 0 / -1; }`, "run");
    expect(isNegZero(litValue(r.result))).toBe(true);
  });

  it("1 / -0 folds to -Infinity", () => {
    const r = call(`export function run() { return 1 / -0; }`, "run");
    expect(litValue(r.result)).toBe(-Infinity);
  });

  it("1 / 0 stays +Infinity", () => {
    const r = call(`export function run() { return 1 / 0; }`, "run");
    expect(litValue(r.result)).toBe(Infinity);
  });

  it("Math.sign(-0) is -0", () => {
    const r = call(`export function run() { return Math.sign(-0); }`, "run");
    expect(isNegZero(litValue(r.result))).toBe(true);
  });

  it("Math.min(-0, 0) is -0", () => {
    const r = call(`export function run() { return Math.min(-0, 0); }`, "run");
    expect(isNegZero(litValue(r.result))).toBe(true);
  });

  it("Math.min(0, -0) is -0", () => {
    const r = call(`export function run() { return Math.min(0, -0); }`, "run");
    expect(isNegZero(litValue(r.result))).toBe(true);
  });

  it("Math.round(-0.5) is -0", () => {
    const r = call(`export function run() { return Math.round(-0.5); }`, "run");
    expect(isNegZero(litValue(r.result))).toBe(true);
  });

  it("Math.ceil(-0.1) is -0", () => {
    const r = call(`export function run() { return Math.ceil(-0.1); }`, "run");
    expect(isNegZero(litValue(r.result))).toBe(true);
  });

  it("Math.atan2(-0, 1) is -0", () => {
    const r = call(`export function run() { return Math.atan2(-0, 1); }`, "run");
    expect(isNegZero(litValue(r.result))).toBe(true);
  });

  it("Math.atan2(0, -1) is +PI (0 stays +0)", () => {
    const r = call(`export function run() { return Math.atan2(0, -1); }`, "run");
    expect(litValue(r.result)).toBe(Math.PI);
  });

  it("-0 === 0 is true (equality unaffected)", () => {
    const r = call(`export function run() { return -0 === 0; }`, "run");
    expect(litValue(r.result)).toBe(true);
  });

  it("Object.is(-0, 0) is false", () => {
    const r = call(`export function run() { return Object.is(-0, 0); }`, "run");
    expect(litValue(r.result)).toBe(false);
  });

  it("String(-0) is \"0\" (display unaffected)", () => {
    const r = call(`export function run() { return String(-0); }`, "run");
    expect(litValue(r.result)).toBe("0");
  });
});
