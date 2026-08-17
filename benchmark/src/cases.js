/**
 * Benchmark Test Cases - Real-world JavaScript patterns
 * Each case has: source code, expected runtime result, complexity level
 */

export const cases = [
  // Level 1: Basic Operations
  {
    id: "basic-01",
    name: "String concatenation",
    complexity: 1,
    code: `
function greet(name) {
  return "Hello, " + name + "!";
}
`,
    args: ["World"],
    expected: "Hello, World!",
    category: "string"
  },
  {
    id: "basic-02",
    name: "Array literal",
    complexity: 1,
    code: `
function makeArray(a, b, c) {
  return [a, b, c];
}
`,
    args: [1, 2, 3],
    expected: [1, 2, 3],
    category: "array"
  },
  {
    id: "basic-03",
    name: "Object literal",
    complexity: 1,
    code: `
function makeUser(name, age) {
  return { name, age, active: true };
}
`,
    args: ["Alice", 30],
    expected: { name: "Alice", age: 30, active: true },
    category: "object"
  },

  // Level 2: Control Flow
  {
    id: "flow-01",
    name: "Conditional return",
    complexity: 2,
    code: `
function classify(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  return "F";
}
`,
    args: [85],
    expected: "B",
    category: "conditional"
  },
  {
    id: "flow-02",
    name: "Loop accumulation",
    complexity: 2,
    code: `
function sum(arr) {
  let total = 0;
  for (const n of arr) {
    total += n;
  }
  return total;
}
`,
    args: [[1, 2, 3, 4, 5]],
    expected: 15,
    category: "loop"
  },
  {
    id: "flow-03",
    name: "Switch statement",
    complexity: 2,
    code: `
function getDayName(day) {
  switch (day) {
    case 0: return "Sunday";
    case 1: return "Monday";
    case 2: return "Tuesday";
    case 3: return "Wednesday";
    case 4: return "Thursday";
    case 5: return "Friday";
    case 6: return "Saturday";
    default: return "Unknown";
  }
}
`,
    args: [3],
    expected: "Wednesday",
    category: "switch"
  },

  // Level 3: Array Methods
  {
    id: "array-01",
    name: "Array.map",
    complexity: 3,
    code: `
function doubleAll(arr) {
  return arr.map(n => n * 2);
}
`,
    args: [[1, 2, 3]],
    expected: [2, 4, 6],
    category: "array-method"
  },
  {
    id: "array-02",
    name: "Array.filter",
    complexity: 3,
    code: `
function filterEvens(arr) {
  return arr.filter(n => n % 2 === 0);
}
`,
    args: [[1, 2, 3, 4, 5]],
    expected: [2, 4],
    category: "array-method"
  },
  {
    id: "array-03",
    name: "Array.reduce",
    complexity: 3,
    code: `
function flatten(arrays) {
  return arrays.reduce((acc, arr) => acc.concat(arr), []);
}
`,
    args: [[[1, 2], [3, 4], [5]]],
    expected: [1, 2, 3, 4, 5],
    category: "array-method"
  },
  {
    id: "array-04",
    name: "Array chaining",
    complexity: 3,
    code: `
function processNumbers(arr) {
  return arr
    .filter(n => n > 0)
    .map(n => n * n)
    .reduce((sum, n) => sum + n, 0);
}
`,
    args: [[-2, 3, -1, 4, 2]],
    expected: 29,
    category: "array-method"
  },

  // Level 4: Object Operations
  {
    id: "obj-01",
    name: "Object spread",
    complexity: 4,
    code: `
function updateUser(user, updates) {
  return { ...user, ...updates, updatedAt: Date.now() };
}
`,
    args: [{ id: 1, name: "Alice" }, { name: "Bob" }],
    expected: { id: 1, name: "Bob", updatedAt: 1000 },
    category: "object"
  },
  {
    id: "obj-02",
    name: "Destructuring",
    complexity: 4,
    code: `
function getFullName({ first, last, middle }) {
  if (middle) return first + " " + middle + " " + last;
  return first + " " + last;
}
`,
    args: [{ first: "John", last: "Doe", middle: "M" }],
    expected: "John M Doe",
    category: "destructuring"
  },
  {
    id: "obj-03",
    name: "Nested access",
    complexity: 4,
    code: `
function getDeepValue(obj) {
  return obj.a.b.c;
}
`,
    args: [{ a: { b: { c: 42 } } }],
    expected: 42,
    category: "object"
  },

  // Level 5: Async/Promise
  {
    id: "async-01",
    name: "Promise.resolve",
    complexity: 5,
    code: `
async function getValue(x) {
  return Promise.resolve(x);
}
`,
    args: [42],
    expected: 42,
    category: "promise"
  },
  {
    id: "async-02",
    name: "Promise.all",
    complexity: 5,
    code: `
async function fetchAll() {
  const [a, b] = await Promise.all([
    Promise.resolve(1),
    Promise.resolve(2)
  ]);
  return [a, b];
}
`,
    args: [],
    expected: [1, 2],
    category: "promise"
  },
  {
    id: "async-03",
    name: "Try/catch",
    complexity: 5,
    code: `
function safeDivide(a, b) {
  try {
    if (b === 0) throw new Error("Division by zero");
    return { success: true, value: a / b };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
`,
    args: [10, 2],
    expected: { success: true, value: 5 },
    category: "error-handling"
  },

  // Level 6: Map/Set
  {
    id: "map-01",
    name: "Map operations",
    complexity: 6,
    code: `
function createLookup(items) {
  const map = new Map();
  for (const item of items) {
    map.set(item.id, item);
  }
  return {
    found: map.get("a"),
    missing: map.get("z"),
    size: map.size
  };
}
`,
    args: [[{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }]],
    expected: { found: { id: "a", name: "Alice" }, missing: undefined, size: 2 },
    category: "map"
  },
  {
    id: "set-01",
    name: "Set operations",
    complexity: 6,
    code: `
function uniqueValues(arr) {
  const set = new Set(arr);
  return Array.from(set);
}
`,
    args: [[1, 2, 2, 3, 3, 3]],
    expected: [1, 2, 3],
    category: "set"
  },

  // Level 7: Complex Patterns
  {
    id: "complex-01",
    name: "Data transformation pipeline",
    complexity: 7,
    code: `
function processUsers(users) {
  return users
    .filter(u => u.active)
    .map(u => ({
      id: u.id,
      displayName: u.firstName + " " + u.lastName,
      role: u.isAdmin ? "admin" : "user"
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
`,
    args: [[
      { id: 1, firstName: "Bob", lastName: "Smith", active: true, isAdmin: false },
      { id: 2, firstName: "Alice", lastName: "Jones", active: true, isAdmin: true },
      { id: 3, firstName: "Charlie", lastName: "Brown", active: false, isAdmin: false }
    ]],
    expected: [
      { id: 2, displayName: "Alice Jones", role: "admin" },
      { id: 1, displayName: "Bob Smith", role: "user" }
    ],
    category: "pipeline"
  },
  {
    id: "complex-02",
    name: "Error handling with retries",
    complexity: 7,
    code: `
async function fetchWithRetry(url, maxRetries) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await Promise.resolve({ ok: true, data: "success" });
      if (response.ok) return { success: true, data: response.data };
    } catch (e) {
      lastError = e;
    }
  }
  return { success: false, error: "max retries exceeded" };
}
`,
    args: ["https://api.example.com", 3],
    expected: { success: true, data: "success" },
    category: "async"
  },
  {
    id: "complex-03",
    name: "Generic data processor",
    complexity: 7,
    code: `
function processItems(items, transform, filter) {
  const result = [];
  for (const item of items) {
    if (filter(item)) {
      result.push(transform(item));
    }
  }
  return result;
}
`,
    args: [[1, 2, 3, 4, 5], x => x * 2, x => x > 2],
    expected: [6, 8, 10],
    category: "higher-order"
  },

  // Level 8: Real-world patterns
  {
    id: "real-01",
    name: "API response handler",
    complexity: 8,
    code: `
function handleApiResponse(response) {
  if (!response) {
    return { status: "error", message: "No response" };
  }

  if (response.statusCode >= 200 && response.statusCode < 300) {
    return {
      status: "success",
      data: response.body,
      meta: {
        timestamp: Date.now(),
        requestId: response.headers["x-request-id"]
      }
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
`,
    args: [{ statusCode: 200, body: { id: 1 }, headers: { "x-request-id": "req-123" } }],
    expected: {
      status: "success",
      data: { id: 1 },
      meta: { timestamp: 1000, requestId: "req-123" }
    },
    category: "real-world"
  },
  {
    id: "real-02",
    name: "Configuration validator",
    complexity: 8,
    code: `
function validateConfig(config) {
  const errors = [];

  if (!config.host || typeof config.host !== "string") {
    errors.push("host is required and must be a string");
  }

  if (config.port !== undefined) {
    if (typeof config.port !== "number" || config.port < 1 || config.port > 65535) {
      errors.push("port must be a number between 1 and 65535");
    }
  }

  if (config.debug !== undefined && typeof config.debug !== "boolean") {
    errors.push("debug must be a boolean");
  }

  return {
    valid: errors.length === 0,
    errors,
    config: errors.length === 0 ? config : undefined
  };
}
`,
    args: [{ host: "localhost", port: 3000, debug: true }],
    expected: {
      valid: true,
      errors: [],
      config: { host: "localhost", port: 3000, debug: true }
    },
    category: "validation"
  },
  {
    id: "real-03",
    name: "Event emitter pattern",
    complexity: 8,
    code: `
function createEventEmitter() {
  const listeners = new Map();

  return {
    on(event, fn) {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event).push(fn);
      return () => this.off(event, fn);
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
`,
    args: [],
    expected: "function",
    category: "pattern"
  }
];
