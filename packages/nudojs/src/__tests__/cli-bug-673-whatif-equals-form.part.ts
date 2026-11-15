/**
 * Bug 673：`--what-if` 只认冒号 ⇒ 文档给的可复制命令（等号形态）原样跑不通。
 *
 * 症状：整串被当成绑定名 ⇒ 「Bindings not applied」+ exit 0（假设静默不生效，
 * 用户以为假设生效了）。修复：解析器**两种分隔符都认**（`:` 与 `=`），
 * 文档保持等号形态（ai-native-dx.md / reference/agents.md 的命令示例不变）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseWhatIfBindings } from "../check-gate-config.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const SRC = `const raw = 1;

export function len() {
  return raw;
}
`;

function makeProject(): { cwd: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-673-whatif-"));
  const file = join(dir, "c.js");
  writeFileSync(file, SRC, "utf-8");
  return { cwd: dir, file };
}

describe("Bug 673 — --what-if 等号 / 冒号两种写法等价", () => {
  it("解析器：等号形态切出 name/type（不是整串当绑定名）", () => {
    expect(parseWhatIfBindings(["raw=string"])).toEqual([
      { name: "raw", type: "string" },
    ]);
  });

  it("解析器：冒号形态不变（旧口径不回归）", () => {
    expect(parseWhatIfBindings(["raw:string"])).toEqual([
      { name: "raw", type: "string" },
    ]);
  });

  it("解析器：分隔符取最先出现的那个；无分隔符仍是 name=整串 / type=any", () => {
    expect(parseWhatIfBindings(["a=b:c"])).toEqual([{ name: "a", type: "b:c" }]);
    expect(parseWhatIfBindings(["m:a:b"])).toEqual([{ name: "m", type: "a:b" }]);
    expect(parseWhatIfBindings(["plain"])).toEqual([{ name: "plain", type: "any" }]);
  });

  it("CLI：等号形态的假设真的生效（绑定被应用，类型按假设打印）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCliTsx(["check", file, "--what-if", "raw=string", "--target", "raw"], {
        cwd,
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Type of "raw": string');
      expect(r.stdout).toContain("Bindings applied: raw: string");
      // 旧症状：整串被当成绑定名 ⇒ 「not applied」
      expect(r.stdout).not.toContain("Bindings not applied");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：冒号形态仍然生效（两种写法同结果）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCliTsx(["check", file, "--what-if", "raw:string", "--target", "raw"], {
        cwd,
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Type of "raw": string');
      expect(r.stdout).toContain("Bindings applied: raw: string");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
