/**
 * Bug 226：对象 **rest 解构**不触发 getter → getter 的副作用丢失。
 *
 * 原生语义：对象 rest 是 CopyDataProperties —— 对每个**保留**键发一次 Get，
 * 访问器被调用（副作用发生），rest 里落的是 getter 的**返回值**。
 * 引擎此前按结构搬槽（直接取 slots[k]）→ getter 从未被调用。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string): unknown {
  const r = litValue(call(`export function f() { ${src} }`, "f").result);
  expect(r.ok).toBe(true);
  return r.ok ? r.value : undefined;
}

describe("Bug 226 — 对象 rest 解构触发 getter", () => {
  it("rest 解构调用 getter（副作用可见，改前为 0）", () => {
    expect(
      v(`let n=0; const o={get g(){n++;return 1;}, a:2}; const {a, ...r}=o; return String(n);`),
    ).toBe("1");
  });

  it("rest 槽落 getter 的返回值（改前为 undefined）", () => {
    expect(v(`const o={get g(){return 42;}, a:2}; const {a, ...r}=o; return String(r.g);`)).toBe(
      "42",
    );
  });

  it("负控制：对象展开仍触发 getter（同族路径不受影响）", () => {
    expect(v(`let n=0; const o={get g(){n++;return 1;}}; const r2={...o}; return String(n);`)).toBe(
      "1",
    );
  });

  it("负控制：Object.assign 源仍触发 getter", () => {
    expect(
      v(`let n=0; const o={get g(){n++;return 1;}}; Object.assign({}, o); return String(n);`),
    ).toBe("1");
  });

  it("负控制：被具名解构排除的键，其 getter 只由具名绑定触发一次", () => {
    expect(
      v(`let n=0; const o={get g(){n++;return 1;}}; const {g, ...r}=o; return String(n);`),
    ).toBe("1");
  });

  it("负控制：无 getter 的普通 rest 内容不变", () => {
    expect(v(`const o={a:2,b:3}; const {a, ...r}=o; return JSON.stringify(r);`)).toBe('{"b":3}');
  });
});
