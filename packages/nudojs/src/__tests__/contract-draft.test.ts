/**
 * CLI 冒烟：`nudo contract --draft` 输出内联「可直接 uncomment 的建议行」
 * （service/emit/interface-draft.ts 的 formatDraftModule 变更在 CLI 面可见）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-draft-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("nudo contract --draft inline suggestion", () => {
  it("prints an uncommentable suggestion line above the empty binding", () => {
    const file = join(dir, "getName.js");
    writeFileSync(file, `export function getName(user) { return user.name; }\n`);
    const r = runCliTsx(["contract", "--draft", file]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain(
      "// suggested (uncomment to accept — body-read, not a contract):",
    );
    // 去 `// ` 即合法侧车绑定语句；绑定名与 export 行一致
    expect(r.stdout).toContain(
      "// export const getName = fn({ user: shape({ name: any() }) });",
    );
    expect(r.stdout).toContain("export const getName = fn({});");
  });

  it("no suggestion lines for bindings without body-read evidence", () => {
    const file = join(dir, "double.js");
    writeFileSync(file, `export function double(x) {\n  return x * 2;\n}\ndouble(21);\n`);
    const r = runCliTsx(["contract", "--draft", file]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export const double = fn({ x: number() }, number());");
    expect(r.stdout).not.toContain("// export const double = ");
    expect(r.stdout).not.toContain("uncomment to accept");
  });
});
