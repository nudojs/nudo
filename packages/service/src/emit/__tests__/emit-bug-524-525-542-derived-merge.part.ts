/**
 * 族 15 / 分片 S13 —— 派生契约面的三条缺陷回归钉：
 *
 * - Bug 524：同一 root 文件的**多个手写契约**（多个 root）指向同一个下游导出
 *   → 派生段被写进同一侧车**两次** → 侧车成非法 ESM（`SyntaxError: Duplicate
 *   export of 'add2'`）→ 契约面整体失效。修法：跨 root 按 (file, fn) 合并
 *   **一条**派生行（参数位取并集＝最宽者）。
 * - Bug 525：跨 root（不同 root 文件）写同一个下游导出 → **按名覆盖**、谁后写
 *   谁赢 → 快照只覆盖部分调用点，且**顺序相关**。修法：写盘时与既有段求并集
 *   （最宽者），标签取并集 ⇒ 顺序无关。
 * - Bug 542：源里已不存在的导出，其 `@generated` 段**不被清理** → 侧车里留下
 *   运行时不存在的导出，并永久占住那个名字。修法：派生路径按源清理死段。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSource } from "@nudojs/core";
import { deriveFromRoot, emitDerivedFromRoot } from "../interface-derivation.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-s13-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const STD = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;

const ADD_JS = `export function add2(x) {
  return x + 2;
}
`;

/** 侧车里出现的导出名（Babel 不报 duplicate export —— 自己数一遍） */
function exportNames(src: string): string[] {
  const ast = parseSource(src);
  const names: string[] = [];
  for (const stmt of ast.program.body) {
    if (stmt.type !== "ExportNamedDeclaration") continue;
    const d = stmt.declaration;
    if (d) {
      if (d.type === "VariableDeclaration") {
        for (const decl of d.declarations) {
          if (decl.id.type === "Identifier") names.push(decl.id.name);
        }
      } else if ((d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") && d.id) {
        names.push(d.id.name);
      }
    }
    if (!stmt.source) {
      for (const spec of stmt.specifiers) {
        names.push(spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value);
      }
    }
  }
  return names;
}

/** 重复导出的名字（空 = 侧车是合法 ESM） */
function duplicateExports(src: string): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const n of exportNames(src)) {
    if (seen.has(n)) dup.add(n);
    else seen.add(n);
  }
  return [...dup];
}

describe("Bug 524 —— 多个 root 命中同一下游导出：只写一段（侧车必须是合法 ESM）", () => {
  it("derives ONE row for the same downstream export hit by two roots", () => {
    writeFileSync(join(dir, "std.nudo.js"), STD);
    writeFileSync(join(dir, "add.js"), ADD_JS);
    writeFileSync(
      join(dir, "lib.js"),
      `import { add2 } from "./add.js";
export function add4(x) { return add2(x + 1) + 1; }
export function add6(x) { return add2(x + 5) + 1; }
`,
    );
    writeFileSync(
      join(dir, "lib.nudo.js"),
      `import { fn } from "@nudojs/core";
import { positive } from "./std.nudo.js";
export const add4 = fn({ x: positive }, positive);
export const add6 = fn({ x: positive }, positive);
`,
    );

    const r = deriveFromRoot(join(dir, "lib.js"), { fnNames: ["add2"] });
    expect(r.hasRoot).toBe(true);
    // 两个 root → 一条派生行（合并前是两条 → 同一导出名写两段）
    expect(r.derived.length).toBe(1);
    const add2 = r.derived[0]!;
    expect(add2.fn).toBe("add2");
    expect(add2.params.length).toBe(1);
    // 并集 = 最宽者（x+1>1 ∪ x+5>5 → x>1）
    expect(add2.params[0]!.prelude).toEqual(["const x = positive.shift(1);"]);
    expect(add2.params[0]!.dsl).toBe("x");
    expect(add2.returns!.dsl).toBe("x.shift(2)");
    // 两个 root 都记在标签里（排序 → 顺序无关）
    expect(add2.derivedFrom).toContain("add4");
    expect(add2.derivedFrom).toContain("add6");
  });

  it("writes ONE section — the sidecar has no duplicate export", () => {
    writeFileSync(join(dir, "std.nudo.js"), STD);
    writeFileSync(join(dir, "add.js"), ADD_JS);
    writeFileSync(
      join(dir, "lib.js"),
      `import { add2 } from "./add.js";
export function add4(x) { return add2(x + 1) + 1; }
export function add6(x) { return add2(x + 5) + 1; }
`,
    );
    writeFileSync(
      join(dir, "lib.nudo.js"),
      `import { fn } from "@nudojs/core";
import { positive } from "./std.nudo.js";
export const add4 = fn({ x: positive }, positive);
export const add6 = fn({ x: positive }, positive);
`,
    );

    const e = emitDerivedFromRoot(join(dir, "lib.js"), { mode: "update", fnNames: ["add2"] });
    expect(e.sidecars.length).toBe(1);
    expect(e.sidecars[0]!.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(e.sidecars[0]!.written).toBe(true);

    const sc = readFileSync(join(dir, "add.nudo.js"), "utf-8");
    // 同一导出名只出现一次 —— 否则侧车是非法 ESM（Duplicate export）
    expect(duplicateExports(sc)).toEqual([]);
    expect(sc.match(/export const add2/g)?.length).toBe(1);
    expect(sc).toContain("const x = positive.shift(1);");

    // 幂等：第二次不写盘
    const e2 = emitDerivedFromRoot(join(dir, "lib.js"), { mode: "update", fnNames: ["add2"] });
    expect(e2.sidecars[0]!.changed).toBe(false);
    expect(e2.sidecars[0]!.skipped).toBe("no-change");
    expect(readFileSync(join(dir, "add.nudo.js"), "utf-8")).toBe(sc);
  });

  it("refuses to write a sidecar that would carry a duplicate export", () => {
    writeFileSync(join(dir, "std.nudo.js"), STD);
    writeFileSync(
      join(dir, "add.js"),
      `export function add2(x) {
  return x + 2;
}
export function add3(x) {
  return x + 3;
}
`,
    );
    writeFileSync(
      join(dir, "lib.js"),
      `import { add3 } from "./add.js";
export function add4(x) { return add3(x + 1); }
`,
    );
    writeFileSync(
      join(dir, "lib.nudo.js"),
      `import { fn } from "@nudojs/core";
import { positive } from "./std.nudo.js";
export const add4 = fn({ x: positive }, positive);
`,
    );
    // 预置一个**重名**的生成段（历史坏盘）：两段都导出 add2。
    // 形态取 Bug 524 的真实坏盘（`export const add2` + 别名段）——两段的
    // **const 名不同**，侧车执行（const 重声明会报错）抓不到，只有导出名
    // 唯一性检查能抓到 ⇒ 拼出来的是非法 ESM（Duplicate export）。
    writeFileSync(
      join(dir, "add.nudo.js"),
      `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: add.js:add2
export const add2 = fn({ x: number() });

// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: add.js:add2
const _nudo_1 = fn({ x: number() });
export { _nudo_1 as add2 };
`,
    );

    const e = emitDerivedFromRoot(join(dir, "lib.js"), { mode: "update", fnNames: ["add3"] });
    expect(e.sidecars.length).toBe(1);
    // 重名侧车不得写盘（否则整份侧车装载失败 → 项目契约面塌掉）
    expect(e.sidecars[0]!.changed).toBe(false);
    expect(e.sidecars[0]!.skipped).toBe("not-projectable");
    expect(
      e.sidecars[0]!.issues.some((i) => i.code === "nudo:interface-not-projectable"),
    ).toBe(true);
    // 盘上内容未被改动
    expect(readFileSync(join(dir, "add.nudo.js"), "utf-8")).toContain("export const add2");
  });
});

describe("Bug 525 —— 跨 root 写同一下游导出：快照顺序无关", () => {
  /** lib.js → add2(x+1)；lib2.js → add2(x+5) */
  function writeCrossRootFixture(): void {
    writeFileSync(join(dir, "std.nudo.js"), STD);
    writeFileSync(join(dir, "add.js"), ADD_JS);
    writeFileSync(
      join(dir, "lib.js"),
      `import { add2 } from "./add.js";
export function add4(x) { return add2(x + 1) + 1; }
`,
    );
    writeFileSync(
      join(dir, "lib.nudo.js"),
      `import { fn } from "@nudojs/core";
import { positive } from "./std.nudo.js";
export const add4 = fn({ x: positive }, positive);
`,
    );
    writeFileSync(
      join(dir, "lib2.js"),
      `import { add2 } from "./add.js";
export function add5(x) { return add2(x + 5) + 1; }
`,
    );
    writeFileSync(
      join(dir, "lib2.nudo.js"),
      `import { fn } from "@nudojs/core";
import { positive } from "./std.nudo.js";
export const add5 = fn({ x: positive }, positive);
`,
    );
  }

  it("merges the two roots' domains — order-independent snapshot", () => {
    writeCrossRootFixture();

    // 顺序 A：先 lib.js（宽域 x>1），再 lib2.js（窄域 x>5）
    emitDerivedFromRoot(join(dir, "lib.js"), { mode: "update", fnNames: ["add2"] });
    emitDerivedFromRoot(join(dir, "lib2.js"), { mode: "update", fnNames: ["add2"] });
    const snapA = readFileSync(join(dir, "add.nudo.js"), "utf-8");

    // 顺序 B：先 lib2.js，再 lib.js
    rmSync(join(dir, "add.nudo.js"));
    emitDerivedFromRoot(join(dir, "lib2.js"), { mode: "update", fnNames: ["add2"] });
    emitDerivedFromRoot(join(dir, "lib.js"), { mode: "update", fnNames: ["add2"] });
    const snapB = readFileSync(join(dir, "add.nudo.js"), "utf-8");

    // 两次顺序产出**同一份**快照
    expect(snapA).toBe(snapB);
    // 快照是**并集**（最宽者：x>1 ⊇ x>5）——不是"谁后写谁赢"
    expect(snapA).toContain("const x = positive.shift(1);");
    expect(snapA).not.toContain("positive.shift(5)");
    // 两个 root 都记在标签里
    expect(snapA).toContain("add4");
    expect(snapA).toContain("add5");
    expect(duplicateExports(snapA)).toEqual([]);
  });

  it("is idempotent after the merge (second emit: no change)", () => {
    writeCrossRootFixture();
    emitDerivedFromRoot(join(dir, "lib.js"), { mode: "update", fnNames: ["add2"] });
    emitDerivedFromRoot(join(dir, "lib2.js"), { mode: "update", fnNames: ["add2"] });
    const snap = readFileSync(join(dir, "add.nudo.js"), "utf-8");

    const e = emitDerivedFromRoot(join(dir, "lib.js"), { mode: "update", fnNames: ["add2"] });
    expect(e.sidecars[0]!.changed).toBe(false);
    expect(e.sidecars[0]!.skipped).toBe("no-change");
    expect(readFileSync(join(dir, "add.nudo.js"), "utf-8")).toBe(snap);
  });
});

describe("Bug 542 —— 源里已不存在的导出：其生成段必须被删掉", () => {
  it("drops the stale section of an export the target no longer has", () => {
    writeFileSync(join(dir, "std.nudo.js"), STD);
    writeFileSync(
      join(dir, "add.js"),
      `export function add2(x) {
  return x + 2;
}
export function add3(x) {
  return x + 3;
}
`,
    );
    writeFileSync(
      join(dir, "lib.js"),
      `import { add2, add3 } from "./add.js";
export function add4(x) { return add2(x + 1) + add3(x + 1); }
`,
    );
    writeFileSync(
      join(dir, "lib.nudo.js"),
      `import { fn } from "@nudojs/core";
import { positive } from "./std.nudo.js";
export const add4 = fn({ x: positive }, positive);
`,
    );

    const e = emitDerivedFromRoot(join(dir, "lib.js"), {
      mode: "update",
      fnNames: ["add2", "add3"],
    });
    expect(e.sidecars[0]!.written).toBe(true);
    const first = readFileSync(join(dir, "add.nudo.js"), "utf-8");
    expect(first).toContain("export const add2");
    expect(first).toContain("export const add3");

    // 源里删掉 add2（只留 add3）
    writeFileSync(
      join(dir, "add.js"),
      `export function add3(x) {
  return x + 3;
}
`,
    );

    const e2 = emitDerivedFromRoot(join(dir, "lib.js"), {
      mode: "update",
      fnNames: ["add2", "add3"],
    });
    expect(e2.sidecars.length).toBe(1);
    const sc = readFileSync(join(dir, "add.nudo.js"), "utf-8");
    // 死段被删掉（否则侧车里留下运行时不存在的导出，并永久占住那个名字）
    expect(sc).not.toContain("export const add2");
    expect(sc).toContain("export const add3");
    expect(duplicateExports(sc)).toEqual([]);
    // 死段被报告出来（不是静默删除）
    expect(
      e2.sidecars[0]!.issues.some(
        (i) => i.code === "nudo:interface-not-projectable" && i.message.includes("add2"),
      ),
    ).toBe(true);

    // 幂等：再跑一次不写盘
    const e3 = emitDerivedFromRoot(join(dir, "lib.js"), {
      mode: "update",
      fnNames: ["add2", "add3"],
    });
    expect(e3.sidecars[0]!.changed).toBe(false);
    expect(readFileSync(join(dir, "add.nudo.js"), "utf-8")).toBe(sc);
  });
});
