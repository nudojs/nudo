/**
 * 族 15 / 分片 S14 —— Bug 984 回归钉。
 *
 * Bug 984：组合式返回位的**相对锚定只按 root 节点 id 匹配**、从不比较 shift 的
 * offset ⇒ 同一个上游变量派生出的多个形参**共用同一个 root id** ⇒ 相对锚定
 * 循环取到**第一个**候选 ⇒ 把**另一个形参的约束**写成返回约束 ⇒ 生成的契约
 * **unsound**（比实现能保证的更强）。
 *
 * 夹具：`helper(a, b) { return b; }` + `helper(x + 5, x + 1)`（x > 0）
 *   ⇒ 改前：返回位写成 `a`（gt(5)），实现真值只有 gt(1)
 *   ⇒ 改后：返回位写成 `b`（gt(1)）
 *
 * 负控制：不同 root 的两个形参（既有锚定不变）、返回位不是形参本身（相对
 * shift 形态不变）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatConstraint } from "@nudojs/core";
import { deriveFromRoot, emitDerivedFromRoot } from "../interface-derivation.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-s14-984-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const STD = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;

const LIB_NUDO = `import { fn, number } from "@nudojs/core";
import { positive } from "./std.nudo.js";
export const root = fn({ x: positive }, number());
`;

/** helper(a,b) { return b; }；root 传入 (x+5, x+1) 或 (x+1, x+5) */
function writeHelperFixture(call: string): void {
  writeFileSync(join(dir, "std.nudo.js"), STD);
  writeFileSync(join(dir, "helper.js"), `export function helper(a, b) { return b; }\n`);
  writeFileSync(
    join(dir, "lib.js"),
    `import { helper } from "./helper.js";
export function root(x) { return helper(${call}); }
`,
  );
  writeFileSync(join(dir, "lib.nudo.js"), LIB_NUDO);
}

describe("Bug 984 —— 同 root 的多个形参：返回位必须锚到**实现真正返回**的那个", () => {
  it("helper(x+5, x+1)：返回位是 b（gt(1)），不是 a（gt(5)）", () => {
    writeHelperFixture("x + 5, x + 1");
    const r = deriveFromRoot(join(dir, "lib.js"), { fnNames: ["helper"] });
    expect(r.hasRoot).toBe(true);
    const helper = r.derived.find((d) => d.fn === "helper");
    expect(helper).toBeDefined();
    expect(helper!.params.map((p) => p.name)).toEqual(["a", "b"]);
    // 两个形参**共用同一个 root id**（同 root ⇒ 只按 root id 无法区分）
    expect(helper!.params[0]!.rootNodeId).toBe(helper!.params[1]!.rootNodeId);
    // 返回位锚到 b
    expect(helper!.returns).toBeDefined();
    expect(helper!.returns!.dsl).toBe("b");
    // **契约不许比实现强**：返回约束 == 被返回形参的约束（gt(1)），不是 gt(5)
    expect(formatConstraint(helper!.returns!.constraint)).toBe(
      formatConstraint(helper!.params[1]!.constraint),
    );
    expect(formatConstraint(helper!.returns!.constraint)).not.toBe(
      formatConstraint(helper!.params[0]!.constraint),
    );
  });

  it("helper(x+1, x+5)：参数顺序反向时返回位仍是 b（gt(5)）", () => {
    writeHelperFixture("x + 1, x + 5");
    const r = deriveFromRoot(join(dir, "lib.js"), { fnNames: ["helper"] });
    const helper = r.derived.find((d) => d.fn === "helper")!;
    expect(helper.returns!.dsl).toBe("b");
    expect(formatConstraint(helper.returns!.constraint)).toBe(
      formatConstraint(helper.params[1]!.constraint),
    );
  });

  it("落盘侧车的返回位是 b（改前写的是 a）", () => {
    writeHelperFixture("x + 5, x + 1");
    const e = emitDerivedFromRoot(join(dir, "lib.js"), { mode: "update", fnNames: ["helper"] });
    expect(e.sidecars.length).toBe(1);
    expect(e.sidecars[0]!.issues.filter((i) => i.severity === "error")).toEqual([]);
    const sc = readFileSync(join(dir, "helper.nudo.js"), "utf-8");
    expect(sc).toContain("const a = positive.shift(5);");
    expect(sc).toContain("const b = positive.shift(1);");
    expect(sc).toContain("export const helper = fn({ a, b }, b);");
    expect(sc).not.toContain("fn({ a, b }, a)");
  });

  it("负控制：不同 root 的两个形参 —— 既有锚定不变（仍取实现返回的那个）", () => {
    writeFileSync(join(dir, "std.nudo.js"), STD);
    writeFileSync(join(dir, "helper.js"), `export function pick(a, b) { return a; }\n`);
    writeFileSync(
      join(dir, "lib.js"),
      `import { pick } from "./helper.js";
export function use(x, y) { return pick(x + 1, y + 10); }
`,
    );
    writeFileSync(
      join(dir, "lib.nudo.js"),
      `import { fn } from "@nudojs/core";
import { positive } from "./std.nudo.js";
export const use = fn({ x: positive, y: positive }, positive);
`,
    );
    const r = deriveFromRoot(join(dir, "lib.js"), { fnNames: ["pick"] });
    const pick = r.derived.find((d) => d.fn === "pick")!;
    expect(pick.returns!.dsl).toBe("a");
  });

  it("负控制：返回位不是形参本身 —— 保持相对 shift 形态（a.shift(1)）", () => {
    writeFileSync(join(dir, "std.nudo.js"), STD);
    writeFileSync(join(dir, "helper.js"), `export function bump(a) { return a + 1; }\n`);
    writeFileSync(
      join(dir, "lib.js"),
      `import { bump } from "./helper.js";
export function root(x) { return bump(x + 1); }
`,
    );
    writeFileSync(join(dir, "lib.nudo.js"), LIB_NUDO);
    const r = deriveFromRoot(join(dir, "lib.js"), { fnNames: ["bump"] });
    const bump = r.derived.find((d) => d.fn === "bump")!;
    expect(bump.returns!.dsl).toBe("a.shift(1)");
  });
});
