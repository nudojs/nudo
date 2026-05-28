import { describe, it, expect, beforeAll } from "vitest";
import { parse, extractDirectives, type CaseDirective, parseTypeValueExpr } from "@nudojs/parser";
import { typeValueToString, createEnvironment, T } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";

function runNudoTest(source: string): { name: string; caseName: string; result: string }[] {
  const ast = parse(source);
  const directives = extractDirectives(ast);
  const env = createEnvironment();
  const results: { name: string; caseName: string; result: string }[] = [];

  for (const fn of directives) {
    for (const d of fn.directives) {
      if (d.kind === "mock") {
        if (d.arrowFn) {
          const fnType = T.fn(d.arrowFn.params, d.arrowFn.body, env);
          (fnType as any)._paramPatterns = d.arrowFn.paramPatterns;
          env.bind(d.name, fnType);
        } else if (d.expression) {
          env.bind(d.name, parseTypeValueExpr(d.expression));
        }
      }
    }

    const caseDirectives = fn.directives.filter((d): d is CaseDirective => d.kind === "case");
    for (const dir of caseDirectives) {
      const result = evaluateFunctionFull(fn.node, dir.args, env);
      results.push({
        name: fn.name,
        caseName: dir.name,
        result: typeValueToString(result.value),
      });
    }
  }
  return results;
}

describe("Nudo vs TypeScript 对比测试", () => {
  const source = `
// 1. 数组处理管道
// @nudo:mock validateItem = (item) => item !== null && item !== undefined
// @nudo:mock transformItem = (item) => ({ ...item, processed: true })
// @nudo:case "pipeline" ([{ id: 1 }, null, { id: 2 }, undefined, { id: 3 }])
function processItems(items) {
  return items
    .filter(validateItem)
    .map(transformItem);
}

// 2. 事件处理器
// @nudo:mock handler = (event) => ({ type: event.type, handled: true })
// @nudo:case "event" ({ type: "click", target: "button" })
function dispatchEvent(event) {
  const result = handler(event);
  return { ...result, timestamp: Date.now() };
}

// 3. API 客户端
// @nudo:mock httpClient = (url, options) => ({ status: 200, data: { success: true } })
// @nudo:case "api" ("/api/users", { method: "GET" })
function fetchUsers(url, options) {
  const response = httpClient(url, options);
  if (response.status === 200) {
    return response.data;
  }
  return null;
}

// 4. 验证器组合
// @nudo:mock isString = (v) => typeof v === "string"
// @nudo:mock isNotEmpty = (v) => v.length > 0
// @nudo:mock isEmail = (v) => v.includes("@")
// @nudo:case "valid-email" ("user@example.com")
// @nudo:case "empty" ("")
// @nudo:case "number" (42)
function validateEmail(value) {
  if (!isString(value)) return { valid: false, error: "not a string" };
  if (!isNotEmpty(value)) return { valid: false, error: "empty" };
  if (!isEmail(value)) return { valid: false, error: "invalid format" };
  return { valid: true, value };
}

// 5. 中间件链
// @nudo:mock authMiddleware = (req) => ({ ...req, user: { id: 1 } })
// @nudo:mock logMiddleware = (req) => req
// @nudo:case "request" ({ path: "/api", method: "GET" })
function applyMiddleware(req) {
  let result = req;
  result = authMiddleware(result);
  result = logMiddleware(result);
  return result;
}

// 6. 数据库查询构建器
// @nudo:mock where = (field, op, value) => ({ field, op, value })
// @nudo:mock orderBy = (field, dir) => ({ field, dir })
// @nudo:case "query" ("age", ">", 18)
function buildQuery(field, op, value) {
  const condition = where(field, op, value);
  const sort = orderBy("name", "asc");
  return { conditions: [condition], sort };
}

// 7. 缓存装饰器
// @nudo:mock fetchFromDB = (id) => ({ id, name: "User " + id, cached: false })
// @nudo:case "user" (42)
function getUserWithCache(id) {
  const user = fetchFromDB(id);
  return { ...user, cached: true };
}

// 8. 策略模式
// @nudo:mock pricingStrategy = (base, quantity) => base * quantity * 0.9
// @nudo:case "order" (100, 5)
function calculatePrice(basePrice, quantity) {
  return pricingStrategy(basePrice, quantity);
}

// 9. 异步操作
// @nudo:mock asyncOperation = (data) => ({ result: data * 2 })
// @nudo:case "async" (21)
function processData(data) {
  const result = asyncOperation(data);
  return result;
}

// 10. 复杂嵌套
// @nudo:mock outerFn = (x) => (y) => x + y
// @nudo:case "curried" (10)
function createAdder(x) {
  const adder = outerFn(x);
  return adder(5);
}
`;

  let results: { name: string; caseName: string; result: string }[];

  beforeAll(() => {
    results = runNudoTest(source);
  });

  it("1. processItems - 数组处理管道", () => {
    const r = results.find(r => r.caseName === "pipeline")!;
    console.log("pipeline:", r.result);
    expect(r.result).toContain("processed: true");
  });

  it("2. dispatchEvent - 事件处理", () => {
    const r = results.find(r => r.caseName === "event")!;
    console.log("event:", r.result);
    expect(r.result).toContain("handled: true");
  });

  it("3. fetchUsers - API 调用", () => {
    const r = results.find(r => r.caseName === "api")!;
    console.log("api:", r.result);
    expect(r.result).toContain("success: true");
  });

  it("4a. validateEmail - valid", () => {
    const r = results.find(r => r.caseName === "valid-email")!;
    console.log("valid-email:", r.result);
    expect(r.result).toContain("valid: true");
  });

  it("4b. validateEmail - empty", () => {
    const r = results.find(r => r.caseName === "empty")!;
    console.log("empty:", r.result);
    expect(r.result).toContain("valid: false");
  });

  it("4c. validateEmail - number", () => {
    const r = results.find(r => r.caseName === "number")!;
    console.log("number:", r.result);
    expect(r.result).toContain("not a string");
  });

  it("5. applyMiddleware - 中间件", () => {
    const r = results.find(r => r.caseName === "request")!;
    console.log("request:", r.result);
    expect(r.result).toContain("user:");
  });

  it("6. buildQuery - 查询构建", () => {
    const r = results.find(r => r.caseName === "query")!;
    console.log("query:", r.result);
    expect(r.result).toContain("conditions:");
  });

  it("7. getUserWithCache - 缓存", () => {
    const r = results.find(r => r.caseName === "user")!;
    console.log("user:", r.result);
    expect(r.result).toContain("cached: true");
  });

  it("8. calculatePrice - 策略", () => {
    const r = results.find(r => r.caseName === "order")!;
    console.log("order:", r.result);
    expect(r.result).toBe("450");
  });

  it("9. processData - 数据处理", () => {
    const r = results.find(r => r.caseName === "async")!;
    console.log("async:", r.result);
    expect(r.result).toContain("result: 42");
  });

  it("10. createAdder - 柯里化", () => {
    const r = results.find(r => r.caseName === "curried")!;
    console.log("curried:", r.result);
    expect(r.result).toBe("15");
  });

  it("输出完整结果", () => {
    console.log("\n=== Nudo @nudo:mock 测试结果 ===\n");
    for (const r of results) {
      console.log(`${r.name} - ${r.caseName}: ${r.result}`);
    }
    console.log(`\n总计: ${results.length} 个测试用例`);
  });
});
