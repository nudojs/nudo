/**
 * BUG-020 / BUG-180（泄漏半边）：`@nudo:mock` 是**函数级**指令，但未冲突时
 * 落进平表 ⇒ 文件内所有函数都能看到（假绿：真实 ReferenceError 被 mock 掩盖）。
 * 修复：core 的 `scopeSelectedInject` 按源码里的函数级声明再过滤一次。
 */
import { describe, it, expect } from "vitest";
import { anyAbs } from "../abs.ts";
import { parseSource } from "../parse-source.ts";
import { injectForFunctionScope } from "../generalize.ts";

const SRC = `
/**
 * @nudo:mock alpha = (u) => ({ from: "A" })
 */
export function fa() {
  return alpha("/x");
}

export function fb() {
  return alpha("/x");
}
`;

const file = parseSource(SRC);
const mocks = { alpha: anyAbs, manual: anyAbs };

describe("BUG-020 / BUG-180 function-scoped @nudo:mock", () => {
  it("the declaring function keeps its mock", () => {
    const inject = injectForFunctionScope({ mocks }, "fa", file);
    expect(inject?.mocks).toHaveProperty("alpha");
  });

  it("other functions do not see the mock (no file-level leak)", () => {
    const inject = injectForFunctionScope({ mocks }, "fb", file);
    expect(inject?.mocks).not.toHaveProperty("alpha");
  });

  it("injected mocks that no directive declares are kept as fallback", () => {
    const inject = injectForFunctionScope({ mocks }, "fb", file);
    expect(inject?.mocks).toHaveProperty("manual");
  });
});
