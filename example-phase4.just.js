/**
 * @just:case "concrete" (1, 2)
 * @just:case "symbolic" (T.number, T.number)
 */
function add(a, b) {
  return a + b;
}

/**
 * @just:case "concrete" ({ name: "Alice", age: 30 })
 * @just:case "symbolic" (T.object({ name: T.string, age: T.number }))
 */
function greet({ name, age }) {
  return `Hello, ${name}! You are ${age} years old.`;
}

/**
 * @just:case "valid" (10)
 * @just:case "negative" (-1)
 */
function safeSqrt(x) {
  if (x < 0) {
    throw new RangeError("negative input");
  }
  return x;
}

/**
 * @just:case "test" ()
 */
async function fetchData() {
  const data = await Promise.resolve(42);
  return data;
}
