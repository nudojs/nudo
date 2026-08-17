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
  return `${name} (${priority}) - ${date}`;
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
    const port = config.port ? `:${config.port}` : "";
    return `${config.protocol}://${config.host}${port}`;
  }
  return null;
}
