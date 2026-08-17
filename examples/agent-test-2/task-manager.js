/**
 * Task Manager - Real-world test for Nudo type inference
 * Tests: complex objects, arrays, Map, Set, Promise, error handling, unions
 */

/**
 * @nudo:case "create-task" ("Build feature", "Implement login", 1)
 * @nudo:returns { id: string, title: string, description: string, priority: 1, status: "todo", createdAt: number, tags: [] }
 */
export function createNewTask(title, description, priority) {
  const task = {
    id: "task-001",
    title,
    description,
    priority,
    status: "todo",
    createdAt: 1000,
    tags: [],
  };
  return task;
}

/**
 * @nudo:case "valid-task" ({ id: "t1", title: "Test", priority: 1, status: "todo" })
 * @nudo:returns { valid: true, task: { id: string, title: string, priority: 1, status: "todo" } }
 *
 * @nudo:case "invalid-task" ({ id: "", title: "", priority: 5, status: "done" })
 * @nudo:returns { valid: false, errors: string[] }
 */
export function validateAndProcessTask(task) {
  const errors = [];

  if (!task.id || task.id.length === 0) {
    errors.push("Task ID is required");
  }
  if (!task.title || task.title.length === 0) {
    errors.push("Task title is required");
  }
  if (task.priority < 1 || task.priority > 3) {
    errors.push("Priority must be 1-3");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, task };
}

/**
 * @nudo:case "batch-create" (["Task A", "Task B", "Task C"])
 * @nudo:returns { created: [{ id: string, title: "Task A" | "Task B" | "Task C", status: "todo" }], count: 3 }
 */
export function batchCreateTasks(titles) {
  const created = titles.map(title => ({
    id: "task-" + title,
    title,
    status: "todo",
    priority: 2,
    createdAt: 1000,
  }));

  return { created, count: created.length };
}

/**
 * @nudo:case "priority-queue" ()
 * @nudo:returns { high: string[], medium: string[], low: string[], total: number }
 */
export function organizeByPriority(tasks) {
  const high = [];
  const medium = [];
  const low = [];

  for (const task of tasks) {
    if (task.priority === 1) {
      high.push(task.title);
    } else if (task.priority === 2) {
      medium.push(task.title);
    } else {
      low.push(task.title);
    }
  }

  return {
    high,
    medium,
    low,
    total: tasks.length,
  };
}

/**
 * @nudo:case "task-lookup" ()
 * @nudo:returns { found: { id: string, title: string } | undefined, missing: undefined }
 */
export function setupTaskLookup(tasks) {
  const taskMap = new Map();

  for (const task of tasks) {
    taskMap.set(task.id, task);
  }

  return {
    found: taskMap.get("task-001"),
    missing: taskMap.get("nonexistent"),
  };
}

/**
 * @nudo:case "tag-stats" ()
 * @nudo:returns { uniqueTags: string[], tagCount: number }
 */
export function collectTagStats(tasks) {
  const tagSet = new Set();

  for (const task of tasks) {
    for (const tag of task.tags) {
      tagSet.add(tag);
    }
  }

  return {
    uniqueTags: Array.from(tagSet),
    tagCount: tagSet.size,
  };
}

/**
 * @nudo:case "fetch-tasks" ()
 * @nudo:returns Promise<{ success: true, tasks: [{ id: string, title: string }] } | { success: false, error: string }>
 */
export async function fetchTasksFromAPI() {
  try {
    const response = {
      ok: true,
      data: [{ id: "t1", title: "Task 1" }, { id: "t2", title: "Task 2" }],
    };

    if (response.ok) {
      return { success: true, tasks: response.data };
    }

    return { success: false, error: "Request failed" };
  } catch (err) {
    return { success: false, error: "Network error" };
  }
}

/**
 * @nudo:case "parallel-fetch" ()
 * @nudo:returns Promise<[{ id: string, title: string }[], { count: number }, { active: number }]>
 */
export async function fetchDashboardData() {
  const [tasks, stats, activity] = await Promise.all([
    Promise.resolve([{ id: "t1", title: "Task 1" }]),
    Promise.resolve({ count: 42 }),
    Promise.resolve({ active: 5 }),
  ]);

  return [tasks, stats, activity];
}

/**
 * @nudo:case "transform-task" ({ id: "t1", title: "hello world", priority: 1, status: "todo" })
 * @nudo:returns { id: string, displayTitle: "HELLO WORLD", priorityLabel: "critical", isComplete: false }
 */
export function transformTask(task) {
  return {
    id: task.id,
    displayTitle: task.title.toUpperCase(),
    priorityLabel: task.priority === 1 ? "critical" : task.priority === 2 ? "normal" : "low",
    isComplete: task.status === "done",
  };
}

/**
 * @nudo:case "safe-update" ({ id: "t1", title: "Old", status: "todo" }, { title: "New" })
 * @nudo:returns { success: true, task: { id: string, title: "New", status: "todo" } }
 *
 * @nudo:case "safe-update-invalid" ({ id: "t1", title: "Old", status: "done" }, { status: "todo" })
 * @nudo:returns { success: false, error: string }
 */
export function safeUpdateTask(task, updates) {
  try {
    if (task.status === "done" && updates.status !== "done") {
      throw new Error("Cannot reopen completed task");
    }

    const updated = { ...task, ...updates };
    return { success: true, task: updated };
  } catch (err) {
    return { success: false, error: "Update failed" };
  }
}

/**
 * @nudo:case "search-tasks" ([{ id: "t1", title: "Fix bug", tags: ["bugfix"] }, { id: "t2", title: "Add feature", tags: ["feature"] }], "bug")
 * @nudo:returns [{ id: string, title: "Fix bug", tags: ["bugfix"] }]
 */
export function searchTasks(tasks, query) {
  const lowerQuery = query.toLowerCase();

  return tasks.filter(task =>
    task.title.toLowerCase().includes(lowerQuery) ||
    task.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
  );
}

/**
 * @nudo:case "task-summary" ()
 * @nudo:returns { total: number, byStatus: { todo: number, inProgress: number, done: number }, completionRate: number | string }
 */
export function generateSummary(tasks) {
  const byStatus = { todo: 0, inProgress: 0, done: 0 };

  for (const task of tasks) {
    if (task.status === "todo") byStatus.todo++;
    else if (task.status === "inProgress") byStatus.inProgress++;
    else if (task.status === "done") byStatus.done++;
  }

  const completionRate = tasks.length > 0
    ? (byStatus.done / tasks.length * 100).toFixed(1) + "%"
    : "N/A";

  return {
    total: tasks.length,
    byStatus,
    completionRate,
  };
}
