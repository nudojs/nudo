/**
 * Simple test to debug Nudo inference
 */

/**
 * @nudo:case "add" (1, 2)
 * @nudo:returns 3
 */
function add(a, b) {
  return a + b;
}

/**
 * @nudo:case "greet" ("Alice")
 * @nudo:returns "Hello, Alice"
 */
function greet(name) {
  return "Hello, " + name;
}

/**
 * @nudo:case "make-pair" (1, "two")
 * @nudo:returns { first: 1, second: "two" }
 */
function makePair(first, second) {
  return { first, second };
}
