/**
 * Test exported functions
 */

/**
 * @nudo:case "add" (1, 2)
 * @nudo:returns 3
 */
export function add(a, b) {
  return a + b;
}

/**
 * @nudo:case "greet" ("Alice")
 * @nudo:returns "Hello, Alice"
 */
export function greet(name) {
  return "Hello, " + name;
}
