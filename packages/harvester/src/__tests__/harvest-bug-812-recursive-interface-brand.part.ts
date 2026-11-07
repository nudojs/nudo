/**
 * Bug 812 回归（harvester 收割面）：递归 interface 的自引用被铸成**空 brand**
 * （`absBrand(name, {})` ⇒ 闭合空对象）⇒ 成员读走「槽位缺失 ⇒ exact undefined」
 * ⇒ 合法代码被判「定抛 TypeError」（L2 门禁假红）；且三条收割路径给出三种类型。
 *
 * 改前（tmp/probe/fix-r27/h2/before-after.ts，BEFORE 行）：
 *   next.inner = {  }            （闭合空对象）
 *   $get(next).value = undefined  conf=exact   ← 假红的成因
 * 改后：
 *   next.inner = unknown         （形状待定）
 *   $get(next).value = unknown    conf=partial  ← 不再折成 exact undefined
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h2/oracle/）：
 * - `o812-use.ts`（`node.next.value` 赋给 `number`，再 `.toFixed(2)`）⇒ tsc exit=0
 *   ⇒ TS 侧递归 interface 的成员读完全合法。
 *
 * 契约：
 *   1. 递归引用点 = 按名 brand + **形状待定**（不是闭合空对象）；
 *   2. 成员读不得折成 exact undefined（否则 L2 门禁假红）；
 *   3. 三条收割路径（收割面 / 磁盘往返面 / 落盘发射面）给出**同一个**类型。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape, $get, type Abs } from "@nudojs/core";
import { harvestDts, emitEnvModule } from "../harvest-dts.ts";
import { absToHarvestSig, harvestSigToAbs } from "../harvest-json.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug812-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand 的成员面（brand → inner obj → slots） */
function slots(a: Abs): Record<string, Abs> {
  const s = a.shape;
  if (s.k === "obj") {
    const out: Record<string, Abs> = {};
    for (const [k, slot] of Object.entries(s.slots)) out[k] = slot.value;
    return out;
  }
  if (s.k === "brand") return slots(s.shape);
  return {};
}

/** brand 的内层形状（brand → inner Abs） */
function brandInner(a: Abs): Abs | undefined {
  return a.shape.k === "brand" ? a.shape.shape : undefined;
}

const RECURSE_DTS =
  `export interface Node { value: number; next: Node; }\n` +
  `export declare const node: Node;\n`;

describe("Bug 812 —— 递归 interface 的自引用 = 形状待定（不是闭合空 brand）", () => {
  it("自引用点是 brand 且内层「形状待定」", () => {
    const p = writeTemp("node.d.ts", RECURSE_DTS);
    const env = harvestDts([p]);
    const next = slots(env.globals.node!).next!;
    expect(next.shape.k).toBe("brand");
    if (next.shape.k !== "brand") return;
    expect(next.shape.name).toBe("Node");
    // 改前：闭合空对象（=「确定没有成员」）⇒ 成员读折 exact undefined ⇒ 假红
    expect(next.shape.shape.shape.k).toBe("unknown");
  });

  it("非递归成员仍然精确（value: number 不受影响）", () => {
    const p = writeTemp("node.d.ts", RECURSE_DTS);
    const env = harvestDts([p]);
    expect(formatShape(slots(env.globals.node!).value!)).toBe("number");
  });

  it("成员读不折成 exact undefined（L2 假红的成因消失）", () => {
    const p = writeTemp("node.d.ts", RECURSE_DTS);
    const env = harvestDts([p]);
    const node = env.globals.node!;
    const next = $get(node, "next");
    expect(formatShape(next)).toBe("Node");
    const value = $get(next, "value");
    expect(formatShape(value)).toBe("unknown");
    // 关键断言：不是「确定为 undefined」（闭合空对象会折成这个）
    expect(value.conf).not.toBe("exact");
    expect(value.term?.op === "lit" && (value.term as { value?: unknown }).value === undefined).toBe(false);
  });

  it("三条收割路径给出同一个类型（收割面 / 磁盘往返面 / 落盘发射面）", () => {
    const p = writeTemp("node.d.ts", RECURSE_DTS);
    const env = harvestDts([p]);
    const inMemory = slots(env.globals.node!).next!;

    // 磁盘往返面：harvest-json 的投影 → 反序列化
    const roundTrip = harvestSigToAbs(absToHarvestSig(env.globals.node!));
    const onDisk = slots(roundTrip).next!;

    expect(formatShape(onDisk)).toBe(formatShape(inMemory));
    expect(formatShape(brandInner(onDisk)!)).toBe(formatShape(brandInner(inMemory)!));
    expect(brandInner(onDisk)!.shape.k).toBe("unknown");

    // 落盘发射面：env 模块里递归引用同样是「形状待定」
    const emitted = emitEnvModule(env, "node");
    expect(emitted).toContain('name: "Node", shape: absUnknown');
  });
});
