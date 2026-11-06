/**
 * Bug 501 —— 项目级 path env 的**文件内容**是缓存键的维度。
 *
 * 改前：分析缓存键（analysisFileCacheKey 的 envSeg）与 evaluator memo 键
 * （tryRunEval 的 envKey）只编码 env **名字** ⇒ 同一个 env 名指向的文件
 * 内容改了，缓存照样命中 → 类型面停在旧值。
 *
 * 原生真值：env 文件是普通模块——内容改了，import 它的一方看到的就是新值。
 * 文件级 `/// @nudo:env` 的同款维度已由 dep 指纹覆盖（本就正确）——负控制。
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatShape } from "@nudojs/core";
import { analyzeFileAsync, clearEvalCache } from "@nudojs/service";
import { tmpProject } from "./tmp-project.ts";

function envFile(fn: string, value: string): string {
  return `import { ${fn} } from "@nudojs/core";
export function defineEnv() {
  return { globals: { MAGIC: ${value} } };
}
`;
}

async function magicShape(file: string, source: string): Promise<string> {
  const result = await analyzeFileAsync(file, source);
  const fn = result.functions.find((f) => f.name === "getMagic");
  return fn ? formatShape(fn.cases[0].abs) : "<no-fn>";
}

describe("Bug 501 — 项目级 path env 的内容进缓存键", () => {
  it("同进程内改 env 文件内容，类型面跟着变", async () => {
    clearEvalCache();
    const dir = tmpProject("nudo-bug501-", {
      "package.json": JSON.stringify({
        name: "b501",
        type: "module",
        nudo: { env: ["./env.ts"] },
      }),
      "env.ts": envFile("numLit", "numLit(1)"),
      "main.js": `export function getMagic() {\n  return MAGIC;\n}\n`,
    });
    const main = join(dir, "main.js");
    expect(await magicShape(main, `export function getMagic() {\n  return MAGIC;\n}\n`)).toBe("1");
    // 改 env 文件内容（名字不变）——缓存必须 miss
    writeFileSync(join(dir, "env.ts"), envFile("strLit", 'strLit("hello")'), "utf-8");
    expect(await magicShape(main, `export function getMagic() {\n  return MAGIC;\n}\n`)).toBe(
      '"hello"',
    );
  });
});

/** 负控制：不该被这条修复波及的邻近形态 */
describe("Bug 501 — 负控制", () => {
  it("文件级 /// @nudo:env 的同款行为保持正确（本就由 dep 指纹覆盖）", async () => {
    clearEvalCache();
    const dir = tmpProject("nudo-bug501-file-", {
      "env.ts": envFile("numLit", "numLit(1)"),
      "main.js": `/// @nudo:env ./env.ts\n\nexport function getMagic() {\n  return MAGIC;\n}\n`,
    });
    const main = join(dir, "main.js");
    const source = `/// @nudo:env ./env.ts\n\nexport function getMagic() {\n  return MAGIC;\n}\n`;
    expect(await magicShape(main, source)).toBe("1");
    writeFileSync(join(dir, "env.ts"), envFile("strLit", 'strLit("hello")'), "utf-8");
    expect(await magicShape(main, source)).toBe('"hello"');
  });

  it("env 内容不变时，结果稳定（不因缓存维度变化而漂移）", async () => {
    clearEvalCache();
    const dir = tmpProject("nudo-bug501-stable-", {
      "package.json": JSON.stringify({
        name: "b501-stable",
        type: "module",
        nudo: { env: ["./env.ts"] },
      }),
      "env.ts": envFile("numLit", "numLit(1)"),
      "main.js": `export function getMagic() {\n  return MAGIC;\n}\n`,
    });
    const main = join(dir, "main.js");
    const source = `export function getMagic() {\n  return MAGIC;\n}\n`;
    expect(await magicShape(main, source)).toBe("1");
    expect(await magicShape(main, source)).toBe("1");
  });
});
