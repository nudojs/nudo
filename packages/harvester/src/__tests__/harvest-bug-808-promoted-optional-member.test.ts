/**
 * Bug 808 回归（harvester 收割面）：接口成员被**提升**成模块级全局时丢掉 `?`
 * 可选标记（brand 面 `number | undefined` vs 提升面 `number`）。
 *
 * 根因：提升路径把成员**降级成一条 `var` 声明**（`{t:"var", typeNode: member.type}`），
 * 只保留了 `type`，**丢掉了 `questionToken`** ⇒ 同一个成员在两条收割路径上两个类型。
 *
 * 改前（tmp/probe/fix-r27/h3/probe-h3.ts，BEFORE 行）：`global a: number`
 * 改后：`global a: number | undefined`（与 brand 面同口径）
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h3/oracle/o808.ts）：
 *   `const bad: number = opt.a` ⇒ TS2322 "Type 'number | undefined' is not
 *   assignable to type 'number'" ⇒ TS 侧 `opt.a` 就是 `number | undefined`。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape, type Abs } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug808-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand → inner obj → 槽位（值） */
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

describe("Bug 808 —— 提升成模块级全局时保留 `?` 可选标记", () => {
  it("提升出的可选属性是 `number | undefined`（不是 `number`）", () => {
    const p = writeTemp(
      "optmem.d.ts",
      `export interface Opt { a?: number; }
export declare const opt: Opt;
`,
    );
    const env = harvestDts([p]);
    const promoted = env.globals.a!;
    expect(promoted).toBeDefined();
    expect(formatShape(promoted)).toBe("number | undefined");
    expect(formatShape(promoted)).not.toBe("number");
  });

  it("brand 面与提升面同口径（同一成员两个类型 ⇒ 不得出现）", () => {
    const p = writeTemp(
      "optmem.d.ts",
      `export interface Opt { a?: number; }
export declare const opt: Opt;
`,
    );
    const env = harvestDts([p]);
    const member = slots(env.globals.opt!).a!;
    expect(formatShape(member)).toBe(formatShape(env.globals.a!));
  });

  it("对照：必选属性不被加上 undefined", () => {
    const p = writeTemp(
      "reqmem.d.ts",
      `export interface Req { b: number; }
export declare const req: Req;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals.b!)).toBe("number");
  });

  it("对照：brand 面本来就保留 `?`（既有口径不被破坏）", () => {
    const p = writeTemp(
      "optmem.d.ts",
      `export interface Opt { a?: number; }
export declare const opt: Opt;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(slots(env.globals.opt!).a!)).toBe("number | undefined");
  });
});
