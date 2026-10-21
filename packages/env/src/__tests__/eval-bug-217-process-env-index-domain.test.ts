/**
 * Bug 217 回归：`process.env` / `process.versions` 的**索引值域**必须在成员读
 * 时被使用（同一个对象不得在展示面（`Record<string, string | undefined>`）
 * 与读面（`unknown`）自相矛盾）。
 *
 * ES 语义：`process.env` 是开放键对象，值域 `string | undefined`（未设置的
 * 变量读出 undefined）；`process.versions` 值域 `string`。
 *
 * 修复前（core 侧）：开放对象的成员读无条件退 `unknown`（丢弃声明的
 * `shape.index` 值域）→ 与展示面矛盾，并触发**假** `nudo:unknown-inference`
 * （那不是「推断失败」，是引擎把自己的声明扔了）。
 *
 * 本文件钉住 **env 声明侧**（本仓 env 包：process.env / process.versions 的
 * 开放对象 + 索引值域）**与读面**（core 的开放对象读臂接 `openIndexValueOf`
 * 后，读面与展示面同源，不再退 `unknown`）。
 */
import { describe, it, expect } from "vitest";
import { defineEnv } from "../node.ts";
import { formatShape, $get, type Abs } from "@nudojs/core";

/** env 里的 process 全局 */
function processGlobal(): Abs {
  const env = defineEnv();
  const p = env.globals?.["process"];
  expect(p, "process global missing").toBeTruthy();
  return p!;
}

/** obj 槽位值（brand 承载 payload 的形状） */
function slotOf(o: Abs, key: string): Abs | undefined {
  const inner = o.shape.k === "brand" ? (o.shape.shape as Abs) : o;
  if (inner.shape.k !== "obj") return undefined;
  return inner.shape.slots[key]?.value;
}

/** 开放对象的索引值域（shape.index.value） */
function indexValueOf(o: Abs): Abs | undefined {
  const inner = o.shape.k === "brand" ? (o.shape.shape as Abs) : o;
  if (inner.shape.k !== "obj") return undefined;
  return inner.shape.index?.value;
}

describe("Bug 217 — process.env / process.versions 的索引值域声明", () => {
  it("process.env 是开放对象（open）且带索引值域", () => {
    const env = processGlobal();
    const penv = slotOf(env, "env");
    expect(penv, "process.env missing").toBeTruthy();
    const inner = penv!.shape.k === "brand" ? (penv!.shape.shape as Abs) : penv!;
    expect(inner.shape.k).toBe("obj");
    expect((inner.shape as { open?: boolean }).open).toBe(true);
    expect(indexValueOf(penv!), "process.env 索引值域缺失").toBeTruthy();
  });

  it("process.env 的索引值域是 string | undefined", () => {
    const env = processGlobal();
    const penv = slotOf(env, "env")!;
    const fmt = formatShape(indexValueOf(penv)!);
    expect(fmt).toContain("string");
    expect(fmt).toContain("undefined");
  });

  it("process.versions 是开放对象且索引值域是 string", () => {
    const env = processGlobal();
    const pver = slotOf(env, "versions");
    expect(pver, "process.versions missing").toBeTruthy();
    const inner = pver!.shape.k === "brand" ? (pver!.shape.shape as Abs) : pver!;
    expect((inner.shape as { open?: boolean }).open).toBe(true);
    const fmt = formatShape(indexValueOf(pver!)!);
    expect(fmt).toBe("string");
  });

  it("展示面：process.env 打印 Record<string, string | undefined>（与读面同源）", () => {
    const env = processGlobal();
    const penv = slotOf(env, "env")!;
    expect(formatShape(penv)).toContain("string | undefined");
  });

  it("读面：process.env.HOME → string | undefined（开放对象读臂接 openIndexValueOf）", () => {
    const penv = slotOf(processGlobal(), "env")!;
    // 读面必须与展示面同源：开放对象的成员读用声明的索引值域，不再退 unknown。
    expect(formatShape($get(penv, "HOME"))).toBe("string | undefined");
  });

  it("读面：process.versions.node → string（开放对象读臂接 openIndexValueOf）", () => {
    const pver = slotOf(processGlobal(), "versions")!;
    expect(formatShape($get(pver, "node"))).toBe("string");
  });
});
