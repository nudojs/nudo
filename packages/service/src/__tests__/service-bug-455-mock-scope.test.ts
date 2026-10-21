/**
 * Bug 455 —— 两个函数声明**同名** `@nudo:mock`：后者全文件胜出，
 * 先声明的函数被改写成**错误的类型**（并进入发布的 d.ts）。
 *
 * 修法（族 14 · 分片 I）：
 * - mock 种子表按**函数作用域**组织（`mock-abs.ts` 的 `scoped` + 覆盖表）
 * - 按**被求值的函数**取作用域覆盖（core `generalize.ts` 的按函数求值边界）
 *
 * 负控制：未冲突的 mock 仍是文件级可见（不被本条波及）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, litValue } from "@nudojs/core";
import { parse, extractDirectivesQuiet } from "@nudojs/parser";
import {
  mockDirectivesToAbsSeeds,
  mockSeedsToAbsMocks,
  mockScopeOverridesOf,
  mockScopeSelected,
} from "../mock-abs.ts";
import { analyzeFileAsync } from "../analyzer.ts";

/** 两个函数各自声明同名 mock（先声明的在前） */
const TWO_MOCKS = `/**
 * @nudo:mock getPort = stub().returns(8080)
 */
export function readA() {
  return getPort();
}

/**
 * @nudo:mock getPort = stub().returns("closed")
 */
export function readB() {
  return getPort();
}
`;

/** 声明顺序互换（胜出者不应随源序漂移） */
const TWO_MOCKS_REVERSED = `/**
 * @nudo:mock getPort = stub().returns("closed")
 */
export function readB() {
  return getPort();
}

/**
 * @nudo:mock getPort = stub().returns(8080)
 */
export function readA() {
  return getPort();
}
`;

/** 负控制：只有一个 mock 名（无冲突）⇒ 文件级可见 */
const ONE_MOCK = `/**
 * @nudo:mock getPort = stub().returns(8080)
 */
export function readA() {
  return getPort();
}

export function readB() {
  return getPort();
}
`;

function seedsOf(source: string, fromFile: string) {
  return mockDirectivesToAbsSeeds(extractDirectivesQuiet(parse(source)), { fromFile });
}

/** check 签名面（与 `nudo check` 同一管线：core checkSource + service 种子） */
function sigValue(source: string, fromFile: string, name: string): unknown {
  const seeds = seedsOf(source, fromFile);
  const mocks = mockSeedsToAbsMocks(seeds);
  const report = checkSource(fromFile, source, undefined, {
    inject: { mocks },
    fromFile,
  });
  const sig = report.signatures.find((s) => s.name === name);
  expect(sig, `signature ${name} missing`).toBeDefined();
  const lit = litValue(sig!.abs);
  return lit.ok ? lit.value : sig!.display;
}

describe("Bug 455 — 同名 @nudo:mock 按函数作用域各生效", () => {
  it("先声明的函数不再被后声明的同名 mock 改写成错类型", () => {
    expect(sigValue(TWO_MOCKS, "/tmp/bug455-a.js", "readA")).toBe(8080);
    expect(sigValue(TWO_MOCKS, "/tmp/bug455-b.js", "readB")).toBe("closed");
  });

  it("声明顺序互换不改变各自的取值（不再纯源序 last-wins）", () => {
    expect(sigValue(TWO_MOCKS_REVERSED, "/tmp/bug455-c.js", "readA")).toBe(8080);
    expect(sigValue(TWO_MOCKS_REVERSED, "/tmp/bug455-d.js", "readB")).toBe("closed");
  });

  it("种子表保留每个作用域各自的那一份（scoped + 覆盖表）", () => {
    const seeds = seedsOf(TWO_MOCKS, "/tmp/bug455-e.js");
    expect(seeds.scoped?.map((s) => s.scope)).toEqual(["readA", "readB"]);
    const mocks = mockSeedsToAbsMocks(seeds);
    const overrides = mockScopeOverridesOf(mocks);
    expect(overrides && Object.keys(overrides).sort()).toEqual(["readA", "readB"]);
    // 作用域选择面：各自取各自的 mock（两个 mock 是不同的 Abs）
    const a = mockScopeSelected(mocks, "readA");
    const b = mockScopeSelected(mocks, "readB");
    expect(a.getPort).toBeDefined();
    expect(b.getPort).toBeDefined();
    expect(a.getPort).not.toBe(b.getPort);
    expect(a.getPort).not.toBe(mocks.getPort);
  });
});

describe("Bug 455 负控制 —— 未冲突的 mock 仍是文件级可见", () => {
  it("单个 mock 被两个函数共用时两边取值一致", () => {
    expect(sigValue(ONE_MOCK, "/tmp/bug455-f.js", "readA")).toBe(8080);
    expect(sigValue(ONE_MOCK, "/tmp/bug455-g.js", "readB")).toBe(8080);
  });

  it("无冲突时不产生作用域覆盖表（不留冗余状态）", () => {
    const mocks = mockSeedsToAbsMocks(seedsOf(ONE_MOCK, "/tmp/bug455-h.js"));
    expect(mockScopeOverridesOf(mocks)).toBeUndefined();
  });
});

describe("Bug 455 产物面 —— service analyzer 逐函数求值按作用域取 mock", () => {
  it("readA / readB 各自取各自的 mock（接线前：先声明的也被后声明的改写）", async () => {
    // 产物面（`nudo export --format dts` / `nudo test` 的 case 值 / LSP hover）
    // 走 service analyzer 的**按函数求值**路径（tryEvalCallFull / tryEvalAbsFull），
    // 不经过 core 的 generalizeFromAst ⇒ 作用域选择必须在这两个入口接上。
    const res = await analyzeFileAsync("/tmp/bug455-product.js", TWO_MOCKS);
    const valueOf = (name: string): unknown => {
      const fn = res.functions.find((f) => f.name === name);
      expect(fn, `function ${name} missing`).toBeDefined();
      const lit = litValue(fn!.combinedAbs!);
      return lit.ok ? lit.value : undefined;
    };
    expect(valueOf("readA")).toBe(8080);
    expect(valueOf("readB")).toBe("closed");
  });
});
