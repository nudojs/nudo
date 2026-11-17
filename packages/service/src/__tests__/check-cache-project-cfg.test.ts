import { describe, it, expect } from "vitest";
import { checkCacheKey } from "../disk-cache.ts";

describe("checkCacheKey project config dimensions", () => {
  const src = "export function f() { return 1; }\n";
  const base = { autoBind: true, projectDir: "/p" as const };

  it("project env name list flips the key", () => {
    const a = checkCacheKey("/p/a.js", src, { ...base, projectEnvNames: [] });
    const b = checkCacheKey("/p/a.js", src, { ...base, projectEnvNames: ["es"] });
    const c = checkCacheKey("/p/a.js", src, { ...base, projectEnvNames: ["es", "node"] });
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
  });

  it("analysis knobs flip the key", () => {
    const a = checkCacheKey("/p/a.js", src, {
      ...base,
      analysisCfg: { mode: "directives", evalMissingSlot: "off", callSiteBudget: 3 },
    });
    const b = checkCacheKey("/p/a.js", src, {
      ...base,
      analysisCfg: { mode: "all", evalMissingSlot: "off", callSiteBudget: 3 },
    });
    const c = checkCacheKey("/p/a.js", src, {
      ...base,
      analysisCfg: { mode: "directives", evalMissingSlot: "warning", callSiteBudget: 3 },
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("maxForks flips the key (fork-budget change must not stale-cache)", () => {
    const a = checkCacheKey("/p/a.js", src, {
      ...base,
      analysisCfg: { mode: "directives", evalMissingSlot: "off", callSiteBudget: 3, maxForks: 5000 },
    });
    const b = checkCacheKey("/p/a.js", src, {
      ...base,
      analysisCfg: { mode: "directives", evalMissingSlot: "off", callSiteBudget: 3, maxForks: 20000 },
    });
    const c = checkCacheKey("/p/a.js", src, {
      ...base,
      analysisCfg: { mode: "directives", evalMissingSlot: "off", callSiteBudget: 3, maxForks: 7 },
    });
    const same = checkCacheKey("/p/a.js", src, {
      ...base,
      analysisCfg: { mode: "directives", evalMissingSlot: "off", callSiteBudget: 3, maxForks: 5000 },
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
    expect(a).toBe(same);
  });
});

// ---------------------------------------------------------------------------
// 能力档（--capabilities / NUDO_CAPABILITIES）也是缓存键维度
// ---------------------------------------------------------------------------
describe("checkCacheKey 能力档维度", () => {
  const src = "export function f() { return fetch('x'); }\n";
  const base = { autoBind: true, projectDir: "/p" as const };

  it("strict / trusted 两档的键必须不同（旧实现共用同一键 ⇒ 跨进程命中对方的报告：strict 独有的 nudo:capability-denied 与 summary.warnings 静默消失，反向也串味）；默认档恢复后键也恢复（维度是值，不是单调计数器）", async () => {
    const { setCapabilityMode } = await import("@nudojs/core/internal");
    const prev = process.env.NUDO_CAPABILITIES;
    delete process.env.NUDO_CAPABILITIES;
    try {
      setCapabilityMode(undefined);
      const strictKey = checkCacheKey("/p/a.js", src, base);
      setCapabilityMode("trusted");
      const trustedKey = checkCacheKey("/p/a.js", src, base);
      expect(strictKey).not.toBe(trustedKey);
      setCapabilityMode(undefined);
      expect(checkCacheKey("/p/a.js", src, base)).toBe(strictKey);
      // env 形态同口径
      process.env.NUDO_CAPABILITIES = "trusted";
      expect(checkCacheKey("/p/a.js", src, base)).toBe(trustedKey);
    } finally {
      setCapabilityMode(undefined);
      if (prev === undefined) delete process.env.NUDO_CAPABILITIES;
      else process.env.NUDO_CAPABILITIES = prev;
    }
  });
});
