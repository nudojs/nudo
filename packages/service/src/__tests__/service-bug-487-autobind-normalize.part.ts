/**
 * Bug 487 —— `nudo.contract.autoBind` 写成**非布尔值**时，check 与
 * contract / export **三面分裂**（一边说「绑侧车」、一边说「不绑」），
 * 且磁盘缓存会把结论**投毒**到另一种取值上。
 *
 * 根因（config.ts interfaceConfig）：`autoBind: config?.contract?.autoBind ?? true`
 * **不校验类型**、原样透传 ⇒ check 面（`=== false` 判「关」）与 contract/export
 * 面（core `sidecarAutoBindAllowed` 把非 true/非函数读成「关」）结论相反。
 *
 * 修法：在**唯一归一点**（interfaceConfig）把 autoBind 归一成布尔：
 * 非法值按 config.md「invalid values fall back to the default」回落默认
 * `true` + 一条 stderr 提示 ⇒ 三面读同一个归一值，缓存键也分得清取值。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  interfaceConfig,
  findProjectConfig,
  evictProjectConfigMemo,
} from "../evaluator/config.ts";
import { interfaceSurface } from "../emit/interface-surface.ts";
import { tmpProject } from "./tmp-project.ts";

function captureStderr(fn: () => void): string {
  const writes: string[] = [];
  const orig = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return writes.join("");
}

const LIB_JS = `export function needsPositive(x) { return x > 0 ? x : 0; }\n`;
const LIB_NUDO_JS = `import { fn, number } from "@nudojs/core";
export const needsPositive = fn({ x: number().gt(0) }, number());
`;

function projectWithAutoBind(autoBind: unknown): string {
  const root = tmpProject("nudo-bug487-", {
    "package.json": JSON.stringify({ name: "t", type: "module", nudo: { contract: { autoBind } } }),
    "lib.js": LIB_JS,
    "lib.nudo.js": LIB_NUDO_JS,
  });
  return root;
}

describe("Bug 487 — autoBind 归一成布尔（三面同口径）", () => {
  beforeEach(() => {
    evictProjectConfigMemo();
  });

  it("非布尔 autoBind（\"false\" / 0 / 对象）→ 回落默认 true + stderr 提示", () => {
    for (const raw of ["false", 0, { a: 1 }]) {
      evictProjectConfigMemo();
      let out = "";
      let value: boolean | undefined;
      out += captureStderr(() => {
        value = interfaceConfig({ contract: { autoBind: raw } as never }).autoBind;
      });
      // 旧实现：原样透传（"false" ⇒ 非 false ⇒ check 读「开」，
      // core 读「关」⇒ 三面分裂）
      expect(value, String(raw)).toBe(true);
      expect(out, String(raw)).toContain("nudo.contract.autoBind: invalid value");
      expect(out, String(raw)).toContain("using true");
    }
  });

  it("归一后是**严格布尔**：check 面（=== false）与 core 面（!== true）同口径", () => {
    const cfg = interfaceConfig({ contract: { autoBind: "false" } as never });
    expect(typeof cfg.autoBind).toBe("boolean");
    // check / health / test 面的判据：=== false ⇒ 「关」
    expect(cfg.autoBind === false).toBe(false);
    // contract / export 面（core sidecarAutoBindAllowed）：非 true/非函数 ⇒ 「关」
    expect(cfg.autoBind !== true).toBe(false);
  });

  it("contract 面（interfaceSurface）：非法 autoBind 仍绑侧车（= 默认 true）", async () => {
    const root = projectWithAutoBind("false");
    const entries = await interfaceSurface(join(root, "lib.js"));
    const fn = entries.find((e) => e.fn === "needsPositive");
    expect(fn).toBeDefined();
    // 归一后 = true ⇒ 侧车绑定 ⇒ handwritten（改前是 implicit）
    expect(fn!.source).toBe("handwritten");
  });

  it("contract 面：合法 autoBind:false 仍不绑侧车（负控制）", async () => {
    const root = projectWithAutoBind(false);
    const entries = await interfaceSurface(join(root, "lib.js"));
    const fn = entries.find((e) => e.fn === "needsPositive");
    expect(fn).toBeDefined();
    expect(fn!.source).toBe("implicit");
  });

  // ── 负控制：合法布尔值不得被本修复波及 ──────────────────────────
  it("合法 true / false / 缺席：语义不变且不告警", () => {
    let out = "";
    out += captureStderr(() => {
      expect(interfaceConfig({ contract: { autoBind: true } }).autoBind).toBe(true);
    });
    out += captureStderr(() => {
      expect(interfaceConfig({ contract: { autoBind: false } }).autoBind).toBe(false);
    });
    out += captureStderr(() => {
      expect(interfaceConfig({ contract: {} }).autoBind).toBe(true);
    });
    out += captureStderr(() => {
      expect(interfaceConfig(undefined).autoBind).toBe(true);
    });
    expect(out).toBe("");
  });

  it("项目配置读到的 autoBind 也是归一后的布尔（findProjectConfig → interfaceConfig）", () => {
    const root = projectWithAutoBind("false");
    const proj = findProjectConfig(root);
    const cfg = interfaceConfig(proj?.config);
    expect(cfg.autoBind).toBe(true);
    expect(typeof cfg.autoBind).toBe("boolean");
  });
});
