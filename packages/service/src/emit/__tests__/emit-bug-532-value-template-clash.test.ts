/**
 * Bug 532 — LSP codeLens 的契约档位与**它自己那条命令**的结果互相矛盾：
 * `● contract / imp` + `⚡ persist interface`，点下去却是
 * 「handwritten wins — skipping」（**值级 template** 被当成手写**函数**绑定）。
 *
 * 根因：两条通道对「侧车里这个名字算不算手写**函数**绑定」用了两套口径——
 * 档位面（core 的 effectiveInterface）只认 **fn(...) 形态**的导出为契约；
 * 发射器面把侧车顶层**一切**声明名都收进冲突集 ⇒ 值级 template（number() 等）
 * 被报成「已有手写绑定」。
 *
 * 本文件的钉：
 * - 值级 template 占着导出名 → **不是** name-clash（文案与判定都要真）；
 *   生成段就地替换它（同名不能并存：重复 export = 非法 ESM）⇒ 侧车可用、
 *   契约生效、且第二次 emit 报「无改动」。
 * - 负控制：真 `fn(...)` 绑定仍报 name-clash（手写优先，既有钉不许回归）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitInterface } from "../interface-emitter.ts";
import { execNudoModule, effectiveInterface } from "@nudojs/core";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-532-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// BUG-035：`@nudo:case` 的**纯点观测见证**（实参全是字面量、无断言）不是契约
// 产物 ⇒ 夹具的 case 改为**带断言的域声明**（`=> 期望值`），生成段内容
// （`export const classify = fn(…)`）与 name-clash 语义不变。
const SRC = `/**
 * @nudo:case "c" (1) => true
 */
export function classify(x) { return x > 0; }
`;

const loadModule = (spec: string, from: string): string | undefined => {
  if (!spec.startsWith(".")) return undefined;
  const parts = from.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  try {
    return readFileSync(parts.join("/"), "utf-8");
  } catch {
    return undefined;
  }
};

describe("Bug 532 — 值级 template 不是手写函数契约", () => {
  it("does not report name-clash for a value-level template and persists the contract", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "lib.nudo.js");
    writeFileSync(sidecar, `import { number } from "@nudojs/core";\n\nexport const classify = number();\n`);

    const r = await emitInterface(file, { fnNames: ["classify"], mode: "update" });
    // 值级 template 不是契约 → 不报 name-clash
    expect(r.skipped).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:interface-name-clash")).toEqual([]);
    expect(r.written).toEqual(["classify"]);

    const after = readFileSync(sidecar, "utf-8");
    // 生成段取代了值级绑定（同名不能并存：重复 export = 非法 ESM）
    expect(after).toContain("export const classify = fn(");
    expect(after).not.toContain("export const classify = number()");
    // 侧车必须仍可装载（否则该文件所有契约一起丢）
    expect(() => execNudoModule(after)).not.toThrow();
    const exports = execNudoModule(after);
    expect(Object.keys(exports)).toContain("classify");
  });

  it("the persisted contract is effective (effectiveInterface reads it back)", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "lib.nudo.js");
    writeFileSync(sidecar, `import { number } from "@nudojs/core";\n\nexport const classify = number();\n`);
    await emitInterface(file, { fnNames: ["classify"], mode: "update" });
    const eff = effectiveInterface(SRC, "classify", { loadModule, fromFile: file });
    expect(eff).toBeDefined();
    // 档位与命令结果一致：不再是「implicit + 手写优先」的矛盾组合
    expect(eff!.source).toBe("generated");
    expect(eff!.params.map((p) => p.param)).toEqual(["x"]);
  });

  it("is idempotent: the second emit reports no change", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "lib.nudo.js");
    writeFileSync(sidecar, `import { number } from "@nudojs/core";\n\nexport const classify = number();\n`);
    await emitInterface(file, { fnNames: ["classify"], mode: "update" });
    const after = readFileSync(sidecar, "utf-8");
    const second = await emitInterface(file, { fnNames: ["classify"], mode: "update" });
    expect(second.changed).toBe(false);
    expect(readFileSync(sidecar, "utf-8")).toBe(after);
  });

  it("negative control: a real fn(...) binding is still name-clash (handwritten wins)", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "lib.nudo.js");
    writeFileSync(sidecar, `import { fn, number } from "@nudojs/core";\n\nexport const classify = fn({ x: number() });\n`);
    const r = await emitInterface(file, { fnNames: ["classify"], mode: "update" });
    expect(r.skipped).toEqual([{ fn: "classify", reason: "name-clash" }]);
    expect(r.issues.some((i) => i.code === "nudo:interface-name-clash" && i.severity === "error")).toBe(
      true,
    );
    expect(r.changed).toBe(false);
    // 手写契约原样保留
    expect(readFileSync(sidecar, "utf-8")).toContain("export const classify = fn({ x: number() });");
  });

  it("add mode also replaces the conflicting binding (LSP persist lens path)", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "lib.nudo.js");
    writeFileSync(sidecar, `import { number } from "@nudojs/core";\n\nexport const classify = number();\n`);
    const r = await emitInterface(file, { fnNames: ["classify"], mode: "add" });
    expect(r.written).toEqual(["classify"]);
    const after = readFileSync(sidecar, "utf-8");
    expect(after).toContain("export const classify = fn(");
    expect(after).not.toContain("export const classify = number()");
    expect(() => execNudoModule(after)).not.toThrow();
  });
});
