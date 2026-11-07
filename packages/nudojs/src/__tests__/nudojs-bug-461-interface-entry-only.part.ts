/**
 * Bug 461：`nudo:interface-entry-only` 在 `nudo check` 面被**丢弃**（白名单只留
 * interface-domain-exceeds 一条）⇒ 分析器产出的 entry-only info 在 check 面不可达，
 * 而 `nudo health` 走另一条统计路径仍报「N entry-only」⇒ 同一事实两 verb 口径分裂。
 *
 * 本文件锁两件事：
 * 1. 单元面：interface 家族白名单纳入 `nudo:interface-entry-only`（severity=info，
 *    不挡门禁），且既有 domain-exceeds 映射与其余码的过滤行为**不变**（负控制）。
 * 2. 产品面：`nudo check --from <usage>` 真实报出这条 info（改前 infos: 0）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";
import { domainIssuesFromDiagnostics } from "../check-json-map.ts";

/** 无契约根、无调用点域的导出（entry-only） */
const LIB_SRC = `export function f() {
  return 1;
}
`;
/** 现场文件：产生调用记录（⇒ check 的分析器链真的跑了），但不打 call f */
const DEP_SRC = `export function add(a, b) {
  return a + b;
}
`;
const USAGE_SRC = `import { add } from "./dep.js";
const r = add(1, 2);
`;

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-461-"));
  writeFileSync(join(dir, "lib.js"), LIB_SRC, "utf-8");
  writeFileSync(join(dir, "dep.js"), DEP_SRC, "utf-8");
  writeFileSync(join(dir, "usage.js"), USAGE_SRC, "utf-8");
  return dir;
}

describe("Bug 461: domainIssuesFromDiagnostics —— interface 家族白名单", () => {
  const base = {
    severity: "info",
    message: "export 'f' has no contract root and no call-site domain (entry-only)",
    range: { start: { line: 1, column: 7 } },
  };

  it("interface-entry-only 不再被丢弃（info，不挡门禁）", () => {
    const issues = domainIssuesFromDiagnostics([
      { ...base, code: "nudo:interface-entry-only" },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("info");
    expect(issues[0]!.code).toBe("nudo:interface-entry-only");
    expect(issues[0]!.line).toBe(1);
    expect(issues[0]!.column).toBe(7);
  });

  it("负控制：interface-domain-exceeds 的既有映射不变（error → error）", () => {
    const issues = domainIssuesFromDiagnostics([
      {
        ...base,
        code: "nudo:interface-domain-exceeds",
        severity: "error",
        data: { actual: "string", expected: "number" },
      },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.code).toBe("nudo:interface-domain-exceeds");
    expect(issues[0]!.actual).toBe("string");
    expect(issues[0]!.expected).toBe("number");
  });

  it("负控制：白名单外的码仍被过滤（不放大诊断面）", () => {
    expect(
      domainIssuesFromDiagnostics([{ ...base, code: "nudo:other" }]),
    ).toEqual([]);
  });
});

describe("Bug 461: nudo check --from 产品面报出 entry-only", () => {
  it("check --from 打印 nudo:interface-entry-only（改前 infos: 0 / 静默丢弃）", () => {
    const dir = fixture();
    try {
      const r = runCli(["check", "lib.js", "--from", "usage.js"], { cwd: dir });
      expect(r.status).toBe(0); // info 不挡门禁
      expect(r.stdout).toContain("nudo:interface-entry-only");
      expect(r.stdout).toContain("1 info");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("check --json：summary.infos 计入 entry-only，ok 仍为 true", () => {
    const dir = fixture();
    try {
      const r = runCli(["check", "--json", "lib.js", "--from", "usage.js"], { cwd: dir });
      expect(r.status).toBe(0);
      const json = JSON.parse(r.stdout) as {
        ok: boolean;
        summary: { infos: number };
        issues: { code: string; severity: string }[];
      };
      expect(json.summary.infos).toBe(1);
      expect(json.ok).toBe(true);
      const entryOnly = json.issues.filter((i) => i.code === "nudo:interface-entry-only");
      expect(entryOnly).toHaveLength(1);
      expect(entryOnly[0]!.severity).toBe("info");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
