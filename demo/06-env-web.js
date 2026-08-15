/// @nudo:env web

/**
 * @nudo:case "get user" (1)
 * @nudo:case "symbolic" (T.number)
 */
async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = await res.json();
  return data;
}

/**
 * @nudo:case "save" ("theme", "dark")
 * @nudo:case "symbolic" (T.string, T.string)
 */
function savePreference(key, value) {
  localStorage.setItem(key, value);
  // @nudo:replace localStorage.getItem(key) 'x'
  return localStorage.getItem(key);
}

/**
 * @nudo:case "parse" ("https://example.com/path?q=hello#hash")
 */
function parseUrl(raw) {
  const url = new URL(raw);
  return {
    host: url.hostname,
    path: url.pathname,
    query: url.search,
    hash: url.hash,
  };
}

/**
 * @nudo:case "uuid" ()
 */
function generateId() {
  return crypto.randomUUID();
}

/**
 * @nudo:case "measure" ()
 */
function measureTime() {
  const start = performance.now();
  const elapsed = performance.now() - start;
  return elapsed;
}
