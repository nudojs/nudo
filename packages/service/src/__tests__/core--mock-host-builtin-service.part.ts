/**
 * Bug 274 —— service 侧剩余半边：mock 与 env 必须**分表传**。
 *
 * 根因（core 侧已由片 C 修好，service 侧此前还差半边）：
 * - core 的注入面把 env 全局与 mock 分**两张表**过滤：「不遮蔽宿主内建」
 *   跳过表（ENV_SHADOW_SKIP）**只作用于 env 全局**，mock 键集不过滤
 *   （mock 的值本身就是一个 Abs，没有宿主对象身份需要保全——遮蔽宿主全局
 *   正是 mock 的意图）。
 * - 但 service 侧两处把 mock **并进** `envGlobals` 一张表传给 core ⇒ core
 *   收到时**分不清哪些是 mock** ⇒ 名单内的 mock（`Math` / `JSON` / `Date` …）
 *   在注入前就被跳过表丢弃 ⇒ `@nudo:mock Math` 静默 no-op（跑的是宿主内建）。
 *   - 合并点 ①：`eval-run.ts` 的 `tryRunEval`（调用值面 / case 求值通道）
 *   - 合并点 ②：`abs-modules-graph.ts` 的 `collectAbsBindingsFromGraph`
 *
 * 修法：两处都**分表传**（`mocks` 走独立形参，`envGlobals` 只装 env 全局）。
 * **优先级不变**：core 的 `__nudoEnv` 读面 = `{ ...envGlobals, ...mocks }`
 * ⇒ 同名时 **mock 覆盖 env**（与此前「合并表里 mock 在后」逐字等价）。
 *
 * 钉：
 * - 宿主内建名的 mock 在**调用值面**生效（`tryEvalCallFull`，与 `nudo test`
 *   的 case 值同通道）；产品面（`analyzeFileAsync`）同值。
 * - 负控制：普通名 mock 逐字不变；mock 覆盖 env 的优先级不变；env 全局仍受
 *   跳过表约束（env 的 `Math` 不遮蔽宿主 `Math`）；无 mock 时宿主应答不变。
 * - 第二合并点：模块图绑定面（`collectAbsBindingsFromGraph`）同样尊重
 *   宿主内建名的 mock。
 */
import { describe, it, expect } from "vitest";
import { parse, extractDirectivesQuiet } from "@nudojs/parser";
import { litValue } from "@nudojs/core";
import { mockSeedsToAbsMocks, mockDirectivesToAbsSeeds } from "../mock-abs.ts";
import { tryEvalCallFull } from "../eval-run.ts";
import { collectAbsBindingsFromGraph } from "../abs-modules-graph.ts";
import { analyzeFileAsync } from "../analyzer.ts";

/** mock 种子表（与生产管线同源：指令 → Abs 种子 → 注入表） */
function mocksOf(source: string, fromFile: string): Record<string, never> {
  const seeds = mockDirectivesToAbsSeeds(extractDirectivesQuiet(parse(source)), { fromFile });
  return mockSeedsToAbsMocks(seeds) as Record<string, never>;
}

/**
 * 调用值面：求值引擎按 mock 表求值被调导出，返回字面量值。
 * 与 `nudo test` 的 case 值 / `nudo export` 的 dts 面同通道。
 */
function callValue(
  source: string,
  file: string,
  opts: { envNames?: string[] } = {},
): { value: unknown; isLiteral: boolean; display: string } {
  const mocks = mocksOf(source, file);
  const full = tryEvalCallFull(source, file, "run", [], {
    mocks: Object.keys(mocks).length ? (mocks as never) : undefined,
    envNames: opts.envNames,
  });
  expect(full, `调用值面未产出结果：${file}`).toBeDefined();
  const lit = litValue(full!.result);
  return {
    value: lit.ok ? lit.value : undefined,
    isLiteral: lit.ok,
    display: lit.ok ? String(lit.value) : "(non-literal)",
  };
}

const MOCK_NUMBER = `/**
 * @nudo:mock Number = stub().returns(42)
 */
export function run() {
  return Number("7");
}
`;

const MOCK_MATH = `/**
 * @nudo:mock Math = stub().returns(42)
 */
export function run() {
  return Math.floor(1.5);
}
`;

const MOCK_JSON = `/**
 * @nudo:mock JSON = stub().returns("MOCKED")
 */
export function run() {
  return JSON.stringify({ a: 1 });
}
`;

const MOCK_DATE = `/**
 * @nudo:mock Date = stub().returns("MOCKED")
 */
export function run() {
  return Date.now();
}
`;

/** 负控制：普通名 mock（不在跳过名单上）——改前就生效，改后必须逐字不变 */
const MOCK_PLAIN = `/**
 * @nudo:mock myFn = stub().returns("MOCKED")
 */
export function run() {
  return myFn();
}
`;

/** 负控制：env（node）与 mock **同名** ⇒ mock 必须赢（既有优先级语义） */
const MOCK_OVER_ENV = `/**
 * @nudo:mock process = stub().returns("MOCKED")
 */
export function run() {
  return process();
}
`;

/** 负控制：没有 mock ⇒ 宿主应答 */
const NO_MOCK = `export function run() {
  return Number("7");
}
`;

describe("Bug 274（service 侧）—— 宿主内建名的 mock 不再被 env 跳过表吞掉", () => {
  it("@nudo:mock Number 生效（宿主 Number 不再应答）", () => {
    const got = callValue(MOCK_NUMBER, "/tmp/bug274-service-number.js");
    expect(got.isLiteral).toBe(true);
    expect(got.value).toBe(42);
  });

  it("@nudo:mock Math 生效（宿主 Math.floor 不再应答）", () => {
    const got = callValue(MOCK_MATH, "/tmp/bug274-service-math.js");
    // 宿主应答 = 1（Math.floor(1.5)）⇒ mock 生效后不再是 1
    expect(got.value).not.toBe(1);
  });

  it("@nudo:mock JSON 生效（宿主 JSON.stringify 不再应答）", () => {
    const got = callValue(MOCK_JSON, "/tmp/bug274-service-json.js");
    // 宿主应答 = '{"a":1}'
    expect(got.value).not.toBe('{"a":1}');
  });

  it("@nudo:mock Date 生效（宿主 Date.now 不再应答）", () => {
    const got = callValue(MOCK_DATE, "/tmp/bug274-service-date.js");
    // 宿主应答 = number（Date.now() 的非字面量 number）
    expect(got.isLiteral).toBe(false);
  });

  it("产品面（analyzeFileAsync / nudo test 的 case 值）同值", async () => {
    const res = await analyzeFileAsync("/tmp/bug274-service-product.js", MOCK_NUMBER);
    const fn = res.functions.find((f) => f.name === "run");
    expect(fn, "function run missing").toBeDefined();
    const lit = litValue(fn!.combinedAbs!);
    expect(lit.ok).toBe(true);
    expect(lit.ok ? lit.value : undefined).toBe(42);
  });
});

describe("Bug 274（service 侧）负控制 —— 既有语义逐字不变", () => {
  it("普通名 mock 仍生效（改前就生效，不得回退）", () => {
    const got = callValue(MOCK_PLAIN, "/tmp/bug274-service-plain.js");
    expect(got.value).toBe("MOCKED");
  });

  it("mock 覆盖 env 的优先级不变（同名时 mock 赢）", () => {
    const got = callValue(MOCK_OVER_ENV, "/tmp/bug274-service-priority.js", {
      envNames: ["node"],
    });
    // env（node）里也有 `process`；mock 赢 ⇒ "MOCKED"（env 的 object 不可调用）
    expect(got.value).toBe("MOCKED");
  });

  it("env 全局仍受跳过表约束（env 的 Math 不遮蔽宿主 Math）", () => {
    const got = callValue(NO_MOCK, "/tmp/bug274-service-envskip.js", { envNames: ["node"] });
    expect(got.value).toBe(7);
  });

  it("没有 mock 时宿主应答不变", () => {
    const got = callValue(NO_MOCK, "/tmp/bug274-service-nomock.js");
    expect(got.value).toBe(7);
  });
});

describe("Bug 274（service 侧）第二合并点 —— 模块图绑定面也分表传", () => {
  it("collectAbsBindingsFromGraph：宿主内建名的 mock 生效（顶层 const 求值面）", () => {
    const src = `/**
 * @nudo:mock Number = stub().returns(42)
 */
export function run() {
  return Number("7");
}
const x = Number("7");
`;
    const file = "/tmp/bug274-service-bindings.js";
    const mocks = mocksOf(src, file);
    const binds = collectAbsBindingsFromGraph(src, file, { seedVars: mocks as never });
    expect(binds.has("x")).toBe(true);
    const lit = litValue(binds.get("x")!);
    expect(lit.ok).toBe(true);
    // 宿主应答 = 7；mock 生效 ⇒ 42
    expect(lit.ok ? lit.value : undefined).toBe(42);
  });
});
