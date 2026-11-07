/**
 * Bug 548 — `nudo contract --emit` 写出的侧车是**非法 JavaScript**：生成段的
 * `export const <name>` 与侧车里已有的 **import 局部绑定**同名 ⇒ 整份侧车装载
 * 失败 ⇒ **该文件所有契约一起丢失**（工具却 exit 0 自称成功）。
 *
 * 根因：`topLevelDeclaredNames` 负责收集侧车顶层已占用的名字，但它只处理
 * 变量/函数/类与 export 列表 —— **ImportDeclaration 落到 else 分支后三个 if
 * 都不匹配，import 的局部名被整体漏掉** ⇒ 绑定分配以为 `positive` 可用 ⇒
 * 直发 `export const positive = …` ⇒ 与 import 局部绑定重名。
 *
 * 负控制：侧车里没有同名 import 局部名时，仍走直发形态（不无谓地别名化）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitInterface } from "../interface-emitter.ts";
import { execNudoModule, effectiveInterface } from "@nudojs/core";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-548-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// BUG-035：`@nudo:case` 的**纯点观测见证**（实参全是字面量、无断言）不是契约
// 产物 ⇒ 夹具的 case 改为**带断言的域声明**（`=> 期望值`），生成段形态
// （`export const positive = fn(…)`）与 import 局部绑定语义不变。
const SRC = `/** @nudo:case "default" (1, 2) => 3 */
export function positive(a, b) { return a + b; }
export function other(n) { return n > 0; }
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

describe("Bug 548 — 生成段不与 import 局部绑定重名", () => {
  it("uses an alias binding when an import local shadows the target name", async () => {
    const file = join(dir, "c.js");
    writeFileSync(file, SRC);
    writeFileSync(
      join(dir, "std.nudo.js"),
      `import { fn, number } from "@nudojs/core";\nexport const positive = fn({ n: number().gt(0) });\n`,
    );
    const sidecar = join(dir, "c.nudo.js");
    writeFileSync(
      sidecar,
      `import { positive } from "./std.nudo.js";
import { fn, number, boolean } from "@nudojs/core";

export const other = fn({ n: number().gt(0) }, boolean());
`,
    );

    const r = await emitInterface(file, { fnNames: ["positive"], mode: "update" });
    expect(r.written).toEqual(["positive"]);
    const after = readFileSync(sidecar, "utf-8");
    // 不得出现与 import 局部绑定重名的直发声明
    expect(after).not.toContain("export const positive = fn(");
    // 走别名形态（身份仍是导出名 positive）
    expect(after).toMatch(/const _nudo_1 = fn\(/);
    expect(after).toContain("export { _nudo_1 as positive };");
    // 整份侧车必须仍可装载（修前：Identifier 'positive' has already been declared）
    expect(() => execNudoModule(after)).not.toThrow();
  });

  it("the whole file's contracts survive (handwritten binding still binds)", async () => {
    const file = join(dir, "c.js");
    writeFileSync(file, SRC);
    writeFileSync(
      join(dir, "std.nudo.js"),
      `import { fn, number } from "@nudojs/core";\nexport const positive = fn({ n: number().gt(0) });\n`,
    );
    const sidecar = join(dir, "c.nudo.js");
    writeFileSync(
      sidecar,
      `import { positive } from "./std.nudo.js";
import { fn, number, boolean } from "@nudojs/core";

export const other = fn({ n: number().gt(0) }, boolean());
`,
    );
    await emitInterface(file, { fnNames: ["positive"], mode: "update" });
    // 手写契约仍在（other 的签名带 n: number().gt(0) ⇒ number）
    const eff = effectiveInterface(SRC, "other", { loadModule, fromFile: file });
    expect(eff).toBeDefined();
    expect(eff!.params.map((p) => p.param)).toEqual(["n"]);
  });

  it("is idempotent (second emit reports no change)", async () => {
    const file = join(dir, "c.js");
    writeFileSync(file, SRC);
    writeFileSync(
      join(dir, "std.nudo.js"),
      `import { fn, number } from "@nudojs/core";\nexport const positive = fn({ n: number().gt(0) });\n`,
    );
    const sidecar = join(dir, "c.nudo.js");
    writeFileSync(
      sidecar,
      `import { positive } from "./std.nudo.js";
import { fn, number, boolean } from "@nudojs/core";

export const other = fn({ n: number().gt(0) }, boolean());
`,
    );
    await emitInterface(file, { fnNames: ["positive"], mode: "update" });
    const after = readFileSync(sidecar, "utf-8");
    const second = await emitInterface(file, { fnNames: ["positive"], mode: "update" });
    expect(second.changed).toBe(false);
    expect(readFileSync(sidecar, "utf-8")).toBe(after);
  });

  it("negative control: no import local shadow ⇒ the direct binding is used", async () => {
    const file = join(dir, "c.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "c.nudo.js");
    writeFileSync(
      sidecar,
      `import { fn, number, boolean } from "@nudojs/core";

export const other = fn({ n: number().gt(0) }, boolean());
`,
    );
    const r = await emitInterface(file, { fnNames: ["positive"], mode: "update" });
    expect(r.written).toEqual(["positive"]);
    const after = readFileSync(sidecar, "utf-8");
    expect(after).toContain("export const positive = fn(");
    expect(after).not.toContain("_nudo_1");
  });
});
