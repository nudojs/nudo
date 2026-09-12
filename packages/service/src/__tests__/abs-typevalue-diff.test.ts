import { describe, it, expect } from "vitest";
import { analyzeFile } from "../analyzer.ts";
import { typeValueToString } from "@nudojs/core";

/**
 * Service 层 Abs ↔ TypeValue 差分门禁。
 * 自包含源码：call@ 结果必须与 TypeValue 路径投影一致
 * （Abs 成功时 callRecords 被 Abs 覆盖；此处验证覆盖后的结果合理）。
 */
describe("Abs vs TypeValue service differential", () => {
  const samples: Array<{ name: string; source: string; fn: string; expect: string }> = [
    {
      name: "literal add",
      source: `function add(a, b) { return a + b; }\nconst r = add(2, 3);`,
      fn: "add",
      expect: "5",
    },
    {
      name: "string concat",
      source: `function cat(a, b) { return a + b; }\nconst r = cat("x", "y");`,
      fn: "cat",
      expect: '"xy"',
    },
    {
      name: "branch join",
      source: `function f(n) { if (n > 0) return 1; return 0; }\nconst r = f(3);`,
      fn: "f",
      expect: "1",
    },
    {
      name: "object field",
      source: `function get(o) { return o.id; }\nconst r = get({ id: 7 });`,
      fn: "get",
      expect: "7",
    },
  ];

  for (const s of samples) {
    it(s.name, () => {
      const result = analyzeFile(`/t/diff-${s.fn}.js`, s.source);
      const fn = result.functions.find((f) => f.name === s.fn);
      const call = fn!.cases.find((c) => c.source === "callsite");
      expect(call, `no call@ for ${s.fn}`).toBeDefined();
      expect(typeValueToString(call!.result)).toBe(s.expect);
      // Abs 路径应填充 intension
      expect(call!.intension).toBeDefined();
    });
  }

  it("mock + call does not degrade to unknown", () => {
    const source = `
      // @nudo:mock handler = stub().returns("ok")
      function run() { return handler(); }
      const r = run();
    `;
    const result = analyzeFile("/t/diff-mock.js", source);
    const run = result.functions.find((f) => f.name === "run");
    const call = run!.cases.find((c) => c.source === "callsite");
    expect(typeValueToString(call!.result)).not.toBe("unknown");
    expect(typeValueToString(call!.result)).toBe('"ok"');
  });
});
