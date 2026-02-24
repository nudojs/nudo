/**
 * @nudo:case "concrete" ([1, 2, 3])
 * @nudo:case "symbolic" (T.tuple([T.number, T.number, T.number]))
 */
function sumArray(arr) {
  return arr.reduce((acc, x) => acc + x, 0);
}

/**
 * @nudo:case "concrete" ({ name: "Alice", age: 30 })
 * @nudo:case "symbolic" (T.object({ name: T.string, age: T.number }))
 */
function greet({ name, age }) {
  return name;
}

/**
 * @nudo:case "concrete" ([1, 2, 3])
 */
function doubleAll(arr) {
  return arr.map((x) => x * 2);
}

/**
 * @nudo:case "concrete" ({ a: 1, b: 2, c: 3 })
 */
function getKeys(obj) {
  return Object.keys(obj);
}

/**
 * @nudo:case "concrete" ({ x: 1 }, { y: 2 })
 */
function merge(a, b) {
  return { ...a, ...b };
}
