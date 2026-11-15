/**
 * BUG-246（CLI e2e）：可选槽吸收 `undefined` —— TS 默认
 * `exactOptionalPropertyTypes: false` 下 `{ a?: string }` 的槽类型是
 * `string | undefined` ⇒ `f({ a: undefined })` 合法。
 *
 * 修前三道门各自判红（`leqAbs` 槽规则 / L1 调用点通道
 * `scan/literal-shapes.ts` / `@nudo:case` 见证通道 `check-case-scan.ts`），
 * 且 `nudo check` 的诊断（`typeof o.a = "string"`）与签名面（`a?: string`）
 * 自相矛盾，而 tsc 判绿。
 *
 * 这里走**真子进程**（`runCliTsx` + 绝对路径，`cwd` 保持 repo 根——CLI 的
 * `@nudojs/service/emit` 解析依赖 cwd，指向夹具目录会落进陈旧 dist）。
 * required 对照必须仍然 exit 1。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dir = mkdtempSync(join(tmpdir(), "nudo-bug-246-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const OPTIONAL_SIDECAR = `import { fn, shape, string } from "@nudojs/core";

export const f = fn({ o: shape({ a: string().optional() }) });
`;

/** required 对照侧车（函数名参与导出名，逐个夹具显式给）。 */
function requiredSidecar(name: string): string {
  return `import { fn, shape, string } from "@nudojs/core";

export const ${name} = fn({ o: shape({ a: string() }) });
`;
}

/** 落一对 `<name>.js` + `<name>.nudo.js` 侧车，返回主文件的**绝对路径**。 */
function fixture(name: string, sidecar: string, calls: string): string {
  writeFileSync(
    join(dir, `${name}.js`),
    `export function ${name}(o) {\n  return o.a;\n}\n\n${calls}\n`,
    "utf-8",
  );
  writeFileSync(join(dir, `${name}.nudo.js`), sidecar, "utf-8");
  return join(dir, `${name}.js`);
}

interface CliIssue {
  code: string;
  expected?: string;
}

describe("BUG-246 CLI：可选槽吸收 undefined", () => {
  it("optional 契约 + `{ a: undefined }` / `{}` / `{ a: 'x' }` ⇒ exit 0、无 constraint-violated", () => {
    const file = fixture(
      "f",
      OPTIONAL_SIDECAR,
      `f({ a: undefined });\nf({});\nf({ a: "x" });`,
    );
    const r = runCliTsx(["check", file, "--json"]);
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout) as {
      ok: boolean;
      issues: CliIssue[];
      signatures: { name: string; paramTypes?: string[] }[];
    };
    expect(json.ok).toBe(true);
    expect(json.issues.filter((i) => i.code === "nudo:constraint-violated")).toHaveLength(0);
    // 签名面同样是可选位（引擎内部不再两面矛盾）
    expect(json.signatures[0]?.paramTypes).toEqual(["{ a?: string }"]);
  });

  it("required 对照 + `{ a: undefined }` ⇒ exit 1 且报 nudo:constraint-violated", () => {
    const file = fixture("g", requiredSidecar("g"), `g({ a: undefined });`);
    const r = runCliTsx(["check", file, "--json"]);
    expect(r.status).toBe(1);
    const json = JSON.parse(r.stdout) as { ok: boolean; issues: CliIssue[] };
    expect(json.ok).toBe(false);
    const vs = json.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(vs).toHaveLength(1);
    expect(vs[0]!.expected).toBe('typeof o.a = "string"');
  });

  it("required 对照 + `{ a: 'x' }` ⇒ exit 0（对照组正例）", () => {
    const file = fixture("g2", requiredSidecar("g2"), `g2({ a: "x" });`);
    const r = runCliTsx(["check", file, "--json"]);
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout) as { issues: CliIssue[] };
    expect(json.issues.filter((i) => i.code === "nudo:constraint-violated")).toHaveLength(0);
  });
});
