/**
 * BUG-068 —— `nudo check --fix` 的 nullish 回填在**TS 侧车**（`*.nudo.ts`）里注入
 * `nullable(…)` 却不补 builder import ⇒ 落盘的侧车过不了 `tsc --noEmit --strict`
 * （TS2304: Cannot find name 'nullable'），而 `nudo check` 自己复检仍报 OK
 * （引擎运行时注入 DSL ⇒ import 缺失对它不可见）。
 *
 * 判据（工具自己写下的纪律，`quickfix-edits.ts` 的 TS 侧车注释，Bug 546）：
 * TS 侧车必须**自带**它用到的全部 builder import；`.nudo.js` 侧车维持「裸注入」。
 */
import { describe, it, expect } from "vitest";
import { DIAG } from "@nudojs/core/internal";
import { materializeAction } from "../quickfix-edits.ts";
import type { MaterializeInput } from "../quickfix-edits.ts";

const SRC = `export function f(x) {
  if (x > 0) {
    return null;
  }
  return 1;
}
`;

const TS_SIDECAR = `import { fn, number } from "@nudojs/core";
export const f = fn({ x: number() }, number());
`;

/** 侧车里出现的构建器调用名（去掉 import 行再扫） */
const BUILDER_NAMES = [
  "fn",
  "number",
  "string",
  "boolean",
  "any",
  "shape",
  "array",
  "lit",
  "union",
  "nullable",
] as const;

function usedBuilders(text: string): string[] {
  const dsl = text.replace(/^import[^;]*;\s*$/gm, "");
  return BUILDER_NAMES.filter((b) => new RegExp(`(?<![\\w$])${b}\\s*\\(`).test(dsl));
}

/** `@nudojs/core` import 覆盖到的**本地名** */
function importedLocals(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@nudojs\/core["']/g)) {
    for (const part of m[1]!.split(",")) {
      const spec = part.trim();
      if (!spec) continue;
      const as = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(spec);
      out.add(as ? as[2]! : spec);
    }
  }
  return out;
}

function nullishFix(over: Partial<MaterializeInput> = {}): ReturnType<typeof materializeAction> {
  return materializeAction({
    code: DIAG.constraintViolated,
    action: { kind: "relax", label: "relax" },
    fn: "f",
    file: "/t/q2.ts",
    source: SRC,
    sidecarText: TS_SIDECAR,
    sidecarPath: "/t/q2.nudo.ts",
    expected: "number()",
    suggestion: "use nullable(number()) or union(..., lit(null)) to allow nullish returns",
    ...over,
  });
}

describe("BUG-068 —— TS 侧车的 nullish 回填必须自带 builder import", () => {
  it("注入 `nullable(…)` 的同一次改写里补上 import（TS2304 的根因）", () => {
    const plan = nullishFix();
    const next = plan?.sidecar?.newText;
    expect(next).toBeDefined();
    expect(next).toContain("nullable(number())");
    expect(next).toContain('import { fn, number, nullable } from "@nudojs/core";');
  });

  it("不变式：侧车用到的每个 builder 都被 import 覆盖（tsc --noEmit --strict 可编译）", () => {
    const next = nullishFix()!.sidecar!.newText;
    const imported = importedLocals(next);
    for (const b of usedBuilders(next)) {
      expect(imported.has(b), `missing import for ${b} in:\n${next}`).toBe(true);
    }
  });

  it("已有 `nullable` import ⇒ 不重复追加", () => {
    const plan = nullishFix({
      sidecarText: `import { fn, number, nullable } from "@nudojs/core";
export const f = fn({ x: number() }, number());
`,
    });
    const next = plan!.sidecar!.newText;
    expect(next.match(/nullable/g)?.length).toBe(2); // import 一次 + 调用一次
    expect(next).toContain('import { fn, number, nullable } from "@nudojs/core";');
  });

  it("`nullable` 被改名导入（`nullable as nb`）⇒ 新包装按本地名写", () => {
    const plan = nullishFix({
      sidecarText: `import { fn, number, nullable as nb } from "@nudojs/core";
export const f = fn({ x: number() }, number());
`,
    });
    const next = plan!.sidecar!.newText;
    expect(next).toContain("nb(number())");
    expect(next).not.toContain("nullable(number())");
    expect(importedLocals(next).has("nb")).toBe(true);
  });

  // ── 负控制：JS 侧车维持「裸注入」纪律（不得凭空长 import）────────
  it("负控制：`.nudo.js` 侧车不加 import 行（引擎运行时注入 builder）", () => {
    const plan = nullishFix({
      sidecarPath: "/t/q2.nudo.js",
      file: "/t/q2.js",
      sidecarText: `export const f = fn({ x: number() }, number());
`,
    });
    const next = plan?.sidecar?.newText;
    expect(next).toBeDefined();
    expect(next).toContain("nullable(number())");
    expect(next).not.toContain("@nudojs/core");
  });

  // ── 负控制：已包过 nullable ⇒ 不改写（幂等）────────────────────
  it("负控制：return 位已经是 `nullable(…)` ⇒ 无改写（不重复包装）", () => {
    const plan = nullishFix({
      sidecarText: `import { fn, number, nullable } from "@nudojs/core";
export const f = fn({ x: number() }, nullable(number()));
`,
    });
    expect(plan).toBeUndefined();
  });
});
