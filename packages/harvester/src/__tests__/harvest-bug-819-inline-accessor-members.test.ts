/**
 * Bug 819 回归（harvester 收割面）：**内联类型字面量**丢 `get` / `set`
 * 访问器 ⇒ 成员从**闭合对象**上读出 **exact `undefined`**（真值是 number）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h1b/oracle/u819.ts，tsc exit=0）：
 *   `inline: { get value(): number; plain: string }` ⇒ `inline.value` 是
 *   **number**、`inline.plain` 是 string；`vi: I`（interface 形态）同口径。
 *
 * 改前（tmp/probe/fix-r27/h1b/before.ts，before-h1 快照 = git HEAD）：
 *   inline slots: [ 'plain' ]        ← 访问器 `value` 整条被丢掉
 *   iface  slots: [ 'value', 'plain' ]  ← interface 路径是好的（instanceFor）
 * 改后（tmp/probe/fix-r27/h1b/probe.ts）：
 *   inline slots: [ 'plain', 'value' ]   inline.value: number
 *
 * 根因：`mapTypeMembers`（内联类型字面量路径）只处理 `isPropertySignature` /
 * `isMethodSignature`，**没有访问器分支** ⇒ 访问器成员被静默跳过 ⇒ 对象面
 * **闭合** ⇒ 未建模成员的读取语义是 **exact undefined**（一个**具体的错值**）。
 *
 * 契约：
 *   1. 内联类型字面量与 interface 两条路径的**成员集合必须一致**；
 *   2. 读面来自 **getter**（TS 的 `getTypeOfSymbol` 对 get/set 对取 getter
 *      的返回类型），且**与声明顺序无关**（set 在前 / get 在后也取 getter）；
 *   3. 写面（setter 的形参类型）与读面**分开建模**。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug819-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand / obj 形状的成员面（成员名 → 类型显示串） */
function memberSlots(a: unknown): Record<string, string> {
  const s = (a as {
    shape: { k: string; slots?: Record<string, { value: unknown }>; shape?: unknown };
  }).shape;
  if (s.k === "brand") return memberSlots(s.shape);
  if (s.k === "obj") {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.slots ?? {})) out[k] = formatShape(v.value as never);
    return out;
  }
  return {};
}

describe("Bug 819 —— 内联类型字面量的访问器成员不再被丢掉", () => {
  it("内联字面量与 interface 两条路径的成员集合**一致**", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const inline: { get value(): number; plain: string };
export interface I { get value(): number; plain: string }
export declare const vi: I;
`,
    );
    const env = harvestDts([p]);
    const inline = memberSlots(env.globals["inline"]!);
    const iface = memberSlots(env.globals["vi"]!);
    expect(Object.keys(inline).sort()).toEqual(["plain", "value"]);
    expect(Object.keys(inline).sort()).toEqual(Object.keys(iface).sort());
  });

  it("访问器的读面是 getter 的返回类型（不是 exact undefined）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const inline: { get value(): number; plain: string };
`,
    );
    const env = harvestDts([p]);
    const inline = memberSlots(env.globals["inline"]!);
    expect(inline["value"]).toBe("number");
    expect(inline["plain"]).toBe("string");
    // 反向钉：不能折成 exact undefined
    expect(inline["value"]).not.toBe("undefined");
  });

  it("get / set 对的读面**与声明顺序无关**（set 在前也取 getter）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const setFirst: { set value(v: number); get value(): number };
export declare const getFirst: { get value(): number; set value(v: number); };
`,
    );
    const env = harvestDts([p]);
    expect(memberSlots(env.globals["setFirst"]!)["value"]).toBe("number");
    expect(memberSlots(env.globals["getFirst"]!)["value"]).toBe("number");
    expect(memberSlots(env.globals["setFirst"]!)).toEqual(
      memberSlots(env.globals["getFirst"]!),
    );
  });

  it("只有 setter 时读面不折 exact undefined（写面单独建模）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const onlySet: { set value(v: number); };
`,
    );
    const env = harvestDts([p]);
    const v = memberSlots(env.globals["onlySet"]!)["value"]!;
    expect(v).not.toBe("undefined");
    expect(v).toContain("number");
  });

  it("无访问器的普通字面量不受影响", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const plain: { a: number; b: string };
`,
    );
    const env = harvestDts([p]);
    expect(memberSlots(env.globals["plain"]!)).toEqual({ a: "number", b: "string" });
  });
});
