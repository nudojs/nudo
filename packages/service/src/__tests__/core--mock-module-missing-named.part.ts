/**
 * Bug 963 —— `@nudo:mock-module` 的**局部（点名）形态**：被**点名**但 mock 文件
 * **没有导出**的名字被 `pickNamed` **静默跳过** ⇒ `{ ...orig.named, ...overlay.named }`
 * 让**原模块的同名导出原封不动活下来** ⇒ 分析跑在「**一半 mock、一半原模块**」的
 * **混合程序**上；该分支**无条件 `applied = true`、零 error** ⇒ 违反本模块自陈的
 * fail-closed 不变式（"missing mock file / eval failure / empty binding → error,
 * not a silent drop"）。
 *
 * 修法（`packages/service/src/mock-module.ts`）：
 * - `pickNamed` 报出 **missing**（被点名但 mock 没有导出的名字）；
 * - `applyMockModuleDirectives` 的局部分支：missing 非空 ⇒ **走错误出口**
 *   （`nudo:module-missing` / error，见 `check-issues.ts` 的既有 errors 通道）
 *   ⇒ 该条指令**不生效**（`applied` 不置 true、原模块保持原样）。
 *
 * ⇒ 断言非永真：HEAD 上「点名缺失」既不报错也不 applied（见反向闸）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { applyMockModuleDirectivesFromSource } from "../mock-module.ts";
import { collectCheckSupplementIssues } from "../check-issues.ts";
import type { AbsModuleExports } from "@nudojs/core";
import { tmpProject, writeTmpFile } from "./tmp-project.ts";

let dir: string;

beforeEach(() => {
  dir = tmpProject("nudo-bug-963-");
});

/** 原模块导出槽（哨兵值：与 mock 的值刻意不同 ⇒ 能看出「谁活下来了」）。 */
function origLit(v: string): AbsModuleExports["named"][string] {
  return { shape: { k: "str", v }, term: { op: "lit", value: v }, conf: "exact" } as never;
}

/** 原模块（被 mock 覆盖的那个说明符）的导出表。 */
function baseModules(): Record<string, AbsModuleExports> {
  return {
    "./dep.js": {
      named: {
        depFn: origLit("ORIGINAL-depFn"),
        otherFn: origLit("ORIGINAL-otherFn"),
      },
    },
  };
}

/** mock 文件（只导出 depFn）。 */
function writeMock(): void {
  writeTmpFile(dir, "mock.js", `export function depFn() { return "MOCK"; }\n`);
}

describe("Bug 963 — mock-module 点名缺失（fail-closed，不静默回落原模块）", () => {
  it("a named export the mock does not provide is a fail-closed error, not a silent fall-through", () => {
    writeMock();
    const src = `/// @nudo:mock-module "./dep.js" { depFn, otherFn } from "./mock.js"\nimport { depFn, otherFn } from "./dep.js";\nexport function run() { return depFn() + "/" + otherFn(); }\n`;
    const base = baseModules();
    const r = applyMockModuleDirectivesFromSource(src, base, { fromFile: join(dir, "app.js") });

    // 走错误出口：nudo:module-missing（code 缺省 ⇒ check-issues 映射成该码）
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toContain('does not export "otherFn"');
    expect(r.errors[0]!.code).toBeUndefined();
    expect(r.errors[0]!.fromPath).toBe("./mock.js");

    // 该条指令**不生效** ⇒ applied 不置 true
    expect(r.applied).toBe(false);

    // 原模块保持原样（**不是**「一半 mock、一半原模块」的混合程序）
    expect(r.modules["./dep.js"]).toBe(base["./dep.js"]);
    expect(r.modules["./dep.js"]!.named.depFn).toBe(base["./dep.js"]!.named.depFn);
    expect(r.modules["./dep.js"]!.named.otherFn).toBe(base["./dep.js"]!.named.otherFn);
  });

  it("names the mock does provide still overlay, unnamed exports still fall through (regression guard)", () => {
    writeMock();
    const src = `/// @nudo:mock-module "./dep.js" { depFn } from "./mock.js"\nimport { depFn, otherFn } from "./dep.js";\nexport function run() { return depFn() + "/" + otherFn(); }\n`;
    const base = baseModules();
    const r = applyMockModuleDirectivesFromSource(src, base, { fromFile: join(dir, "app.js") });

    expect(r.applied).toBe(true);
    expect(r.errors).toHaveLength(0);
    // depFn 来自 mock（不是原模块的哨兵）
    expect(r.modules["./dep.js"]!.named.depFn).not.toBe(base["./dep.js"]!.named.depFn);
    // 未点名 ⇒ 回落原模块（文档口径：Unspecified exports fall through）
    expect(r.modules["./dep.js"]!.named.otherFn).toBe(base["./dep.js"]!.named.otherFn);
  });

  it("reports every missing named export", () => {
    writeMock();
    const src = `/// @nudo:mock-module "./dep.js" { depFn, otherFn, third } from "./mock.js"\nimport { depFn, otherFn } from "./dep.js";\nexport function run() { return depFn() + "/" + otherFn(); }\n`;
    const r = applyMockModuleDirectivesFromSource(src, baseModules(), {
      fromFile: join(dir, "app.js"),
    });
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]!.message).toContain('does not export "otherFn"');
    expect(r.errors[1]!.message).toContain('does not export "third"');
    expect(r.applied).toBe(false);
  });

  it("a missing `default` named export is reported the same way", () => {
    // mock 没有任何导出 ⇒ 既无 named 也无 default
    writeTmpFile(dir, "mock-empty.js", `const unused = 1;\nvoid unused;\n`);
    const src = `/// @nudo:mock-module "./dep.js" { default } from "./mock-empty.js"\nimport { depFn } from "./dep.js";\nexport function run() { return depFn(); }\n`;
    const r = applyMockModuleDirectivesFromSource(src, baseModules(), {
      fromFile: join(dir, "app.js"),
    });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toContain('does not export "default"');
    expect(r.applied).toBe(false);
  });

  it("surfaces on the check face as nudo:module-missing (error)", () => {
    writeMock();
    writeTmpFile(
      dir,
      "dep.js",
      `export function depFn() { return "REAL-dep"; }\nexport function otherFn() { return "ORIGINAL"; }\n`,
    );
    const file = join(dir, "app.js");
    const src = `/// @nudo:mock-module "./dep.js" { depFn, otherFn } from "./mock.js"\nimport { depFn, otherFn } from "./dep.js";\nexport function run() { return depFn() + "/" + otherFn(); }\n`;
    writeTmpFile(dir, "app.js", src);
    const issues = collectCheckSupplementIssues(file, src);
    const missing = issues.filter((i) => i.code === "nudo:module-missing");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.severity).toBe("error");
    expect(missing[0]!.message).toContain('does not export "otherFn"');
  });

  it("full replacement (no names list) is unaffected", () => {
    writeMock();
    const src = `/// @nudo:mock-module "./dep.js" from "./mock.js"\nimport { depFn } from "./dep.js";\nexport function run() { return depFn(); }\n`;
    const r = applyMockModuleDirectivesFromSource(src, baseModules(), {
      fromFile: join(dir, "app.js"),
    });
    expect(r.applied).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(Object.keys(r.modules["./dep.js"]!.named)).toEqual(["depFn"]);
  });
});
