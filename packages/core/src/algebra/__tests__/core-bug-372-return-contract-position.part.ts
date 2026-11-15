/**
 * Bug 372 回归钉 —— L1 契约违约诊断（`nudo:constraint-violated`）不带行号
 * ⇒ **GitHub Actions 注解 / GitLab Code Quality / JSON 机器契约**三个面全部把
 * 错误定位到文件**第 1 行第 1 列**（实测函数在第 10 行）。
 *
 * 与 Bug 369 同根因（issue 构造处丢位置），但**验收面不同**：369 = LSP 单面；
 * 372 = **issue 字段 + CI 注解面**（GHA `::error …,line=…,col=…` / GitLab
 * `location.lines.begin` / `--json` 的 `line` / `column` 字段）。
 *
 * 钉：三个消费面都必须落在真实行（第 10 行），不得是第 1 行。
 */
import { describe, it, expect } from "vitest";
import {
  checkSource,
  formatGithubAnnotations,
  formatGitlabCodeQuality,
  pTrue,
  serializeCheckJson,
} from "../index.ts";

/** 前 9 行是注释 ⇒ 函数声明落在第 10 行 */
const SRC = `// line 1
// line 2
// line 3
// line 4
// line 5
// line 6
// line 7
// line 8
// line 9
export function deep(x) {
  return x - 1;
}
`;

const sidecar = `import { fn, number } from "@nudojs/core";
export const deep = fn({ x: number().gt(0) }, number().gt(0));
`;

const opts = {
  loadModule: (spec: string): string | undefined =>
    spec.endsWith(".nudo.js") ? sidecar : undefined,
  fromFile: "/proj/src/deep.js",
};

describe("Bug 372 — L1 违例诊断的 CI 注解面 / JSON 机器契约面落真实行", () => {
  it("issue 字段带 line / column（第 10 行）", () => {
    const r = checkSource("/proj/src/deep.js", SRC, pTrue, opts);
    const violated = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(violated).toBeDefined();
    expect(violated!.line).toBe(10);
    expect(violated!.column).toBe(7);
  });

  it("GHA 行内注解的 line/col 落在真实行（改前是 line=1,col=1）", () => {
    const r = checkSource("/proj/src/deep.js", SRC, pTrue, opts);
    const ann = formatGithubAnnotations(r, { workspaceRoot: "/proj" });
    expect(ann).toContain("line=10");
    expect(ann).toContain("col=8");
    expect(ann).not.toContain("line=1,");
  });

  it("GitLab Code Quality 的 lines.begin 落在真实行（改前是 1）", () => {
    const r = checkSource("/proj/src/deep.js", SRC, pTrue, opts);
    const rows = formatGitlabCodeQuality(r, { workspaceRoot: "/proj" });
    const row = rows.find((x) => x.check_name === "nudo:constraint-violated");
    expect(row).toBeDefined();
    expect(row!.location.lines.begin).toBe(10);
  });

  it("JSON 机器契约面的 line / column 不是 null", () => {
    const r = checkSource("/proj/src/deep.js", SRC, pTrue, opts);
    const json = serializeCheckJson(r);
    const violated = json.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(violated).toBeDefined();
    expect(violated!.line).toBe(10);
    expect(violated!.column).toBe(7);
  });
});
