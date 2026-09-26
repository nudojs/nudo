import { translate } from '@docusaurus/Translate';
import type { Preset } from './types';

export const GROUP_CONTRACTS = 'Contracts & Observe';
export const GROUP_BASIC = 'Basic Examples';
export const GROUP_CALLSITE = 'Call-Site Discovery';
export const GROUP_SEMANTICS = 'Language Semantics';

// 预设分组名 → 翻译 id（optgroup label 用）
const GROUP_LABEL_IDS: Record<string, string> = {
  [GROUP_CONTRACTS]: 'playground.group.contracts',
  [GROUP_BASIC]: 'playground.group.basic',
  [GROUP_CALLSITE]: 'playground.group.callsite',
  [GROUP_SEMANTICS]: 'playground.group.semantics',
};
export function tGroup(group: string): string {
  const id = GROUP_LABEL_IDS[group];
  return id
    ? translate({ id, message: group })
    : group;
}

export const presets: Preset[] = [
  {
    mode: 'single',
    group: GROUP_CONTRACTS,
    id: 'refine-positive',
    name: 'Refine — @nudo:contract positive',
    code: `/// @nudo:import { positive } from "./shapes.nudo.js"
// virtual template: positive = number().gt(0)

/**
 * @nudo:contract x positive
 */
export function needsPositive(x) {
  return x;
}

needsPositive(3);
needsPositive(-1);
// Hover x: contract is x > 0; -1 is call-site evidence that violates check`,
  },
  {
    mode: 'single',
    group: GROUP_CONTRACTS,
    id: 'observe-scale',
    name: 'Observe — scale intermediate algebra',
    code: `export function scale(x) {
  return x + 1;
}

scale(5);
scale(0);`,
  },
  {
    mode: 'single',
    group: GROUP_CONTRACTS,
    id: 'debug-case',
    name: 'Debug case — concrete witness only',
    code: `/**
 * @nudo:case "double digits" (10)
 * @nudo:case "zero" (0)
 */
export function scale(x) {
  return x + 1;
}`,
  },
  { mode: 'single', group: GROUP_BASIC, id: 'basic-subtract', name: 'Call-site subtraction', code: `export function subtract(a, b) {
  return a - b;
}

subtract(5, 3);
subtract(1, 10);` },
  { mode: 'single', group: GROUP_BASIC, id: 'string-transform', name: 'String Transform', code: `export function transform(x) {
  if (typeof x === "string") return x.toUpperCase();
  if (typeof x === "number") return x + 1;
  return null;
}

transform("hi");
transform(41);
transform(null);` },
  { mode: 'single', group: GROUP_BASIC, id: 'array-map', name: 'Array Map', code: `export function double(arr) {
  return arr.map(x => x * 2);
}

double([]);
double([1]);
double([1, 2, 3]);` },
  { mode: 'single', group: GROUP_BASIC, id: 'object-property', name: 'Object Property', code: `export function getName(obj) {
  return obj.name;
}

getName({ name: "test" });
getName({ name: "john", age: 30 });` },
  { mode: 'single', group: GROUP_BASIC, id: 'conditional-return', name: 'Conditional Return', code: `export function getValue(flag) {
  if (flag) return "yes";
  return "no";
}

getValue(true);
getValue(false);` },
  { mode: 'single', group: GROUP_BASIC, id: 'function-compose', name: 'Function Composition', code: `function addOne(x) { return x + 1; }
function double(x) { return x * 2; }

export function composed(n) {
  return double(addOne(n));
}

composed(5);` },
  { mode: 'single', group: GROUP_BASIC, id: 'null-handling', name: 'Null Handling', code: `export function greet(name) {
  return "Hello, " + (name || "World");
}

greet("hello");
greet(null);` },
  { mode: 'single', group: GROUP_BASIC, id: 'type-guard', name: 'Type Guard', code: `export function isString(value) {
  return typeof value === "string";
}

isString("test");
isString(42);` },
  { mode: 'single', group: GROUP_BASIC, id: 'recursion', name: 'Recursion', code: `export function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

factorial(5);
factorial(0);` },
  { mode: 'single', group: GROUP_BASIC, id: 'spread-operator', name: 'Spread Operator', code: `export function merge(a, b) {
  return [...a, ...b];
}

merge([1, 2], [3, 4]);` },
  { mode: 'single', group: GROUP_BASIC, id: 'ternary-operator', name: 'Ternary Operator', code: `export function classify(n) {
  return n > 0 ? "positive" : n < 0 ? "negative" : "zero";
}

classify(5);
classify(-3);
classify(0);` },
  { mode: 'single', group: GROUP_BASIC, id: 'default-param', name: 'Default Parameter', code: `export function greet(name = "World") {
  return "Hello, " + name + "!";
}

greet("world");
greet();` },
  { mode: 'single', group: GROUP_BASIC, id: 'discriminated-union', name: 'Discriminated Union', code: `export function area(shape) {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2;
    case "rect":
      return shape.width * shape.height;
  }
}

area({ kind: "circle", radius: 5 });
area({ kind: "rect", width: 10, height: 20 });` },
  { mode: 'single', group: GROUP_BASIC, id: 'optional-chaining', name: 'Optional Chaining', code: `export function getName(config) {
  return config.user?.profile?.name ?? "Anonymous";
}

getName({ user: { profile: { name: "Alice" } } });
getName({});` },
  { mode: 'single', group: GROUP_BASIC, id: 'truthiness-narrowing', name: 'Truthiness Narrowing', code: `export function process(val) {
  if (!val) return "empty";
  return val.toUpperCase();
}

process("hello");
process(null);
process(0);` },
  { mode: 'single', group: GROUP_BASIC, id: 'isarray-narrowing', name: 'Array.isArray Narrowing', code: `export function first(x) {
  if (Array.isArray(x)) return x[0];
  return x;
}

first([1, 2, 3]);
first("hello");` },
  { mode: 'single', group: GROUP_BASIC, id: 'in-operator', name: 'in Operator Narrowing', code: `export function sound(animal) {
  if ("bark" in animal) return "Woof!";
  if ("purr" in animal) return "Purr~";
  return "...";
}

sound({ name: "Rex", bark: true });
sound({ name: "Whiskers", purr: true });` },

  {
    mode: 'callsite',
    group: GROUP_CALLSITE,
    id: 'cs-formatname',
    name: 'formatName — first precise signature',
    libFile: 'util.js',
    libCode: `export function formatName(first, last) {
  return first + ' ' + last;
}`,
    testFile: 'test.js',
    testCode: `import { formatName } from './util';

const full = formatName('Ada', 'Lovelace');`,
    exportName: 'formatName',
    paramCount: 2,
  },
  {
    mode: 'callsite',
    group: GROUP_CALLSITE,
    id: 'cs-wait',
    name: 'wait — Promise resolve scan',
    libFile: 'util.js',
    libCode: `export function wait(fn, timeout = 0) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fn()), timeout);
  });
}`,
    testFile: 'test.js',
    testCode: `import { wait } from './util';

const p = wait(() => 'done', 100);`,
    exportName: 'wait',
    paramCount: 2,
  },
  {
    mode: 'callsite',
    group: GROUP_CALLSITE,
    id: 'cs-uniq',
    name: 'uniq — Set iteration',
    libFile: 'util.js',
    libCode: `export function uniq(arr) {
  const s = new Set(arr);
  const out = [];
  for (const v of s) out.push(v);
  return out;
}`,
    testFile: 'test.js',
    testCode: `import { uniq } from './util';

const u = uniq([1, 2, 2, 3]);`,
    exportName: 'uniq',
    paramCount: 1,
  },
  {
    mode: 'callsite',
    group: GROUP_CALLSITE,
    id: 'cs-flat',
    name: 'flat — recursive calls + self-calls',
    libFile: 'util.js',
    libCode: `export function flat(a, t) {
  const r = t || [];
  for (const e of a) {
    if (Array.isArray(e)) flat(e, r);
    else r.push(e);
  }
  return r;
}`,
    testFile: 'test.js',
    testCode: `import { flat } from './util';

const f = flat([1, [2, [3, 4]]]);`,
    exportName: 'flat',
    paramCount: 2,
  },

  { mode: 'single', group: GROUP_SEMANTICS, id: 'promise-resolve-scan', name: 'Promise Resolve Scan', code: `export function wait(fn, timeout = 0) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fn()), timeout);
  });
}

wait(() => "done", 100);
wait(() => 42);` },
  { mode: 'single', group: GROUP_SEMANTICS, id: 'set-iteration', name: 'Set Iteration (for-of)', code: `export function uniq(arr) {
  const s = new Set(arr);
  const out = [];
  for (const v of s) out.push(v);
  return out;
}

uniq([1, 2, 2, 3]);
uniq(["a", "a", "b"]);` },
  { mode: 'single', group: GROUP_SEMANTICS, id: 'recursive-flatten', name: 'Recursive Flatten', code: `export function flat(a, t) {
  const r = t || [];
  for (const e of a) {
    if (Array.isArray(e)) flat(e, r);
    else r.push(e);
  }
  return r;
}

flat([1, [2, [3, 4]]]);
flat([5, 6]);` },
  { mode: 'single', group: GROUP_SEMANTICS, id: 'in-brand-check', name: 'in-operator Brand Check', code: `export function check(x) {
  if ("__nudo" in x) return x.__nudo;
  return "unbranded";
}

check({ __nudo: "real", value: 1 });
check({ value: 2 });` },
];
