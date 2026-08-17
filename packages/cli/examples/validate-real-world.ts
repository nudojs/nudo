/**
 * Real-world scenario validation script
 * Tests all new features against realistic JavaScript patterns
 */
import { parse, extractDirectives, type CaseDirective } from "@nudojs/parser";
import { typeValueToString, createEnvironment } from "@nudojs/core";
import { evaluateFunctionFull } from "../src/evaluator.js";

const realWorldCode = `
/**
 * @nudo:case "success" ({ status: 200, data: { name: "Alice", email: "alice@example.com" } })
 * @nudo:case "not-found" ({ status: 404, error: "User not found" })
 * @nudo:case "symbolic" (T.object)
 */
function handleUserResponse(response) {
  if (response.status === 200) {
    const user = response.data;
    return { success: true, name: user.name, email: user.email };
  }
  if (response.status === 404) {
    return { success: false, error: response.error };
  }
  return { success: false, error: "Unknown error" };
}

/**
 * @nudo:case "admin" ({ role: "admin", permissions: ["read", "write", "delete"] })
 * @nudo:case "user" ({ role: "user", permissions: ["read"] })
 * @nudo:case "guest" ({ role: "guest" })
 */
function checkAccess(user) {
  switch (user.role) {
    case "admin":
      return { allowed: true, level: "full" };
    case "user":
      return { allowed: true, level: "limited" };
    case "guest":
      return { allowed: false, level: "none" };
  }
}

/**
 * @nudo:case "complete" ({ name: "Task 1", dueDate: "2025-01-01", priority: "high" })
 * @nudo:case "no-date" ({ name: "Task 2", priority: "low" })
 * @nudo:case "symbolic" (T.object)
 */
function formatTask(task) {
  const name = task.name ?? "Untitled";
  const date = task.dueDate?.slice(0, 10) ?? "No due date";
  const priority = task.priority || "medium";
  return \`\${name} (\${priority}) - \${date}\`;
}

/**
 * @nudo:case "string-array" (["hello", "world"])
 * @nudo:case "number-array" ([1, 2, 3])
 * @nudo:case "mixed" ([1, "two", true])
 */
function firstElement(arr) {
  if (!Array.isArray(arr)) return null;
  if (arr.length === 0) return null;
  return arr[0];
}

/**
 * @nudo:case "http" ({ protocol: "http", host: "example.com", port: 80 })
 * @nudo:case "https" ({ protocol: "https", host: "secure.com", port: 443 })
 */
function buildUrl(config) {
  if ("protocol" in config && "host" in config) {
    const port = config.port ? \`:\${config.port}\` : "";
    return \`\${config.protocol}://\${config.host}\${port}\`;
  }
  return null;
}
`;

console.log("=== Real-World Scenario Validation ===\n");

// Test 1: Full inference pipeline
console.log("1. Full Inference Pipeline");
console.log("-".repeat(40));
const ast = parse(realWorldCode);
const directives = extractDirectives(ast);
const env = createEnvironment();

console.log(`Functions found: ${directives.length}`);
for (const fn of directives) {
  const caseDirectives = fn.directives.filter((d): d is CaseDirective => d.kind === "case");
  console.log(`\n  ${fn.name}:`);
  for (const dir of caseDirectives) {
    const r = evaluateFunctionFull(fn.node, dir.args, env);
    const argsStr = dir.args.map(typeValueToString).join(", ");
    console.log(`    Case "${dir.name}": (${argsStr}) => ${typeValueToString(r.value)}`);
  }
}

// Test 2: Discriminated union narrowing
console.log("\n2. Discriminated Union Narrowing (response.status)");
console.log("-".repeat(40));
const handleResponseFn = directives.find(d => d.name === "handleUserResponse");
if (handleResponseFn) {
  const caseDir = handleResponseFn.directives.find((d): d is CaseDirective => d.kind === "case" && d.name === "success");
  if (caseDir) {
    const r = evaluateFunctionFull(handleResponseFn.node, caseDir.args, env);
    console.log(`handleUserResponse("success") => ${typeValueToString(r.value)}`);
    const hasNarrowing = typeValueToString(r.value).includes("success") && typeValueToString(r.value).includes("name");
    console.log(`  Narrowing works: ${hasNarrowing ? "YES" : "NO"}`);
  }
}

// Test 3: Switch statement narrowing
console.log("\n3. Switch Statement Narrowing (user.role)");
console.log("-".repeat(40));
const checkAccessFn = directives.find(d => d.name === "checkAccess");
if (checkAccessFn) {
  const caseDirectives = checkAccessFn.directives.filter((d): d is CaseDirective => d.kind === "case");
  for (const dir of caseDirectives) {
    const r = evaluateFunctionFull(checkAccessFn.node, dir.args, env);
    console.log(`checkAccess("${dir.name}") => ${typeValueToString(r.value)}`);
  }
}

// Test 4: Optional chaining + nullish coalescing
console.log("\n4. Optional Chaining + Nullish Coalescing");
console.log("-".repeat(40));
const formatTaskFn = directives.find(d => d.name === "formatTask");
if (formatTaskFn) {
  const caseDirectives = formatTaskFn.directives.filter((d): d is CaseDirective => d.kind === "case");
  for (const dir of caseDirectives) {
    const r = evaluateFunctionFull(formatTaskFn.node, dir.args, env);
    console.log(`formatTask("${dir.name}") => ${typeValueToString(r.value)}`);
  }
}

// Test 5: Array.isArray narrowing
console.log("\n5. Array.isArray Narrowing");
console.log("-".repeat(40));
const firstElementFn = directives.find(d => d.name === "firstElement");
if (firstElementFn) {
  const caseDirectives = firstElementFn.directives.filter((d): d is CaseDirective => d.kind === "case");
  for (const dir of caseDirectives) {
    const r = evaluateFunctionFull(firstElementFn.node, dir.args, env);
    console.log(`firstElement("${dir.name}") => ${typeValueToString(r.value)}`);
  }
}

// Test 6: in operator narrowing
console.log("\n6. 'in' Operator Narrowing");
console.log("-".repeat(40));
const buildUrlFn = directives.find(d => d.name === "buildUrl");
if (buildUrlFn) {
  const caseDirectives = buildUrlFn.directives.filter((d): d is CaseDirective => d.kind === "case");
  for (const dir of caseDirectives) {
    const r = evaluateFunctionFull(buildUrlFn.node, dir.args, env);
    console.log(`buildUrl("${dir.name}") => ${typeValueToString(r.value)}`);
  }
}

console.log("\n=== Validation Complete ===");
