import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective } from "@nudojs/parser";
import { typeValueToString, createEnvironment } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";

function runTest(source: string): { name: string; caseName: string; result: string }[] {
  const ast = parse(source);
  const directives = extractDirectives(ast);
  const env = createEnvironment();
  const results: { name: string; caseName: string; result: string }[] = [];

  for (const fn of directives) {
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

describe("Real-World Pattern Tests", () => {
  describe("Data Processing Pipelines", () => {
    it("user data transformation", () => {
      const results = runTest(`
// @nudo:case "transform-users" ([{ id: 1, firstName: "Alice", lastName: "Smith", active: true, isAdmin: false }, { id: 2, firstName: "Bob", lastName: "Jones", active: true, isAdmin: true }])
function transformUsers(users) {
  return users
    .filter(u => u.active)
    .map(u => ({
      id: u.id,
      displayName: u.firstName + " " + u.lastName,
      role: u.isAdmin ? "admin" : "user"
    }));
}
`);
      expect(results[0].result).toContain("[");
      expect(results[0].result).toContain("displayName");
      expect(results[0].result).toContain("role");
    });

    it("group by key", () => {
      const results = runTest(`
// @nudo:case "group-by" ([{ type: "a", value: 1 }, { type: "b", value: 2 }, { type: "a", value: 3 }])
function groupByType(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.type)) {
      groups.set(item.type, []);
    }
    groups.get(item.type).push(item.value);
  }
  return groups;
}
`);
      expect(results[0].result).toContain("Map");
    });

    it("flatten and deduplicate", () => {
      const results = runTest(`
// @nudo:case "flatten-dedup" ([[1, 2], [2, 3], [3, 4]])
function flattenDedup(arrays) {
  const flat = arrays.reduce((acc, arr) => acc.concat(arr), []);
  return Array.from(new Set(flat));
}
`);
      expect(results[0].result).toContain("[");
    });
  });

  describe("Error Handling Patterns", () => {
    it("Result type pattern", () => {
      const results = runTest(`
// @nudo:case "result-type" (10, 2)
function safeDivide(a, b) {
  try {
    if (b === 0) throw new Error("Division by zero");
    return { ok: true, value: a / b };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
`);
      expect(results[0].result).toContain("ok");
      expect(results[0].result).toContain("value");
    });

    it("retry pattern", () => {
      const results = runTest(`
// @nudo:case "retry" ()
async function withRetry(fn, maxRetries) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return { success: true, data: await fn() };
    } catch (e) {
      lastError = e;
    }
  }
  return { success: false, error: "max retries exceeded" };
}
`);
      // Async function returns Promise
      expect(results[0].result).toContain("Promise");
    });

    it("validation pattern", () => {
      const results = runTest(`
// @nudo:case "validate" ({ email: "test@example.com", age: 25 })
function validateUser(user) {
  const errors = [];
  if (!user.email || !user.email.includes("@")) {
    errors.push("Invalid email");
  }
  if (user.age < 0 || user.age > 150) {
    errors.push("Invalid age");
  }
  return {
    valid: errors.length === 0,
    errors,
    user: errors.length === 0 ? user : undefined
  };
}
`);
      expect(results[0].result).toContain("valid");
      expect(results[0].result).toContain("errors");
    });
  });

  describe("Event Emitter Pattern", () => {
    it("basic event emitter", () => {
      const results = runTest(`
// @nudo:case "emitter" ()
function createEmitter() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event).push(fn);
    },
    off(event, fn) {
      const fns = listeners.get(event);
      if (fns) {
        const idx = fns.indexOf(fn);
        if (idx >= 0) fns.splice(idx, 1);
      }
    },
    emit(event, ...args) {
      const fns = listeners.get(event);
      if (fns) {
        for (const fn of fns) fn(...args);
      }
    }
  };
}
`);
      expect(results[0].result).toContain("on");
      expect(results[0].result).toContain("off");
      expect(results[0].result).toContain("emit");
    });
  });

  describe("Configuration Patterns", () => {
    it("config with defaults", () => {
      const results = runTest(`
// @nudo:case "config" ({ host: "localhost" })
function createConfig(userConfig) {
  const defaults = {
    port: 3000,
    debug: false,
    logLevel: "info"
  };
  return { ...defaults, ...userConfig };
}
`);
      expect(results[0].result).toContain("host");
      expect(results[0].result).toContain("port");
      expect(results[0].result).toContain("debug");
    });

    it("config validation", () => {
      const results = runTest(`
// @nudo:case "validate-config" ({ host: "localhost", port: 3000 })
function validateConfig(config) {
  const errors = [];
  if (!config.host) errors.push("host is required");
  if (config.port < 1 || config.port > 65535) errors.push("port must be 1-65535");
  return {
    valid: errors.length === 0,
    errors,
    config: errors.length === 0 ? config : undefined
  };
}
`);
      expect(results[0].result).toContain("valid");
      expect(results[0].result).toContain("config");
    });
  });

  describe("API Response Patterns", () => {
    it("API response handler", () => {
      const results = runTest(`
// @nudo:case "api-response" ({ statusCode: 200, body: { data: "test" }, headers: { "x-request-id": "123" } })
function handleResponse(response) {
  if (!response) {
    return { status: "error", message: "No response" };
  }
  if (response.statusCode >= 200 && response.statusCode < 300) {
    return {
      status: "success",
      data: response.body,
      meta: { requestId: response.headers["x-request-id"] }
    };
  }
  if (response.statusCode >= 400) {
    return {
      status: "error",
      code: response.statusCode,
      message: response.body?.error || "Unknown error"
    };
  }
  return { status: "unknown", code: response.statusCode };
}
`);
      expect(results[0].result).toContain("success");
      expect(results[0].result).toContain("data");
    });

    it("paginated response", () => {
      const results = runTest(`
// @nudo:case "paginate" ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 1, 3)
function paginate(items, page, pageSize) {
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pageItems = items.slice(start, end);
  return {
    items: pageItems,
    page,
    pageSize,
    total: items.length,
    totalPages: Math.ceil(items.length / pageSize)
  };
}
`);
      expect(results[0].result).toContain("items");
      expect(results[0].result).toContain("page");
      expect(results[0].result).toContain("total");
    });
  });

  describe("State Management Patterns", () => {
    it("counter with actions", () => {
      const results = runTest(`
// @nudo:case "counter" ()
function createCounter(initial = 0) {
  let count = initial;
  return {
    increment() { return ++count; },
    decrement() { return --count; },
    reset() { count = initial; return count; },
    get() { return count; }
  };
}
`);
      expect(results[0].result).toContain("increment");
      expect(results[0].result).toContain("decrement");
      expect(results[0].result).toContain("reset");
      expect(results[0].result).toContain("get");
    });

    it("todo list", () => {
      const results = runTest(`
// @nudo:case "todo-list" ()
function createTodoList() {
  const todos = [];
  let nextId = 1;
  return {
    add(text) {
      const todo = { id: nextId++, text, completed: false };
      todos.push(todo);
      return todo;
    },
    complete(id) {
      const todo = todos.find(t => t.id === id);
      if (todo) todo.completed = true;
      return todo;
    },
    getAll() { return todos; },
    getActive() { return todos.filter(t => !t.completed); }
  };
}
`);
      expect(results[0].result).toContain("add");
      expect(results[0].result).toContain("complete");
      expect(results[0].result).toContain("getAll");
      expect(results[0].result).toContain("getActive");
    });
  });

  describe("Utility Functions", () => {
    it("deep clone", () => {
      const results = runTest(`
// @nudo:case "deep-clone" ({ a: { b: { c: 1 } }, d: [1, 2, 3] })
function deepClone(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const clone = {};
  for (const key in obj) {
    clone[key] = deepClone(obj[key]);
  }
  return clone;
}
`);
      expect(results[0].result).toContain("a");
      expect(results[0].result).toContain("b");
      expect(results[0].result).toContain("d");
    });

    it("debounce", () => {
      const results = runTest(`
// @nudo:case "debounce" ()
function createDebounce(fn, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}
`);
      // Functions are displayed as arrow function syntax
      expect(results[0].result).toContain("=>");
    });

    it("memoize", () => {
      const results = runTest(`
// @nudo:case "memoize" ()
function memoize(fn) {
  const cache = new Map();
  return function(...args) {
    const key = JSON.stringify(args);
    if (cache.has(key)) return cache.get(key);
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
}
`);
      // Functions are displayed as arrow function syntax
      expect(results[0].result).toContain("=>");
    });
  });
});
