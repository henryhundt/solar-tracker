const activeTasks = new Set<Promise<unknown>>();

export function trackBackgroundTask<T>(task: Promise<T>, label: string): Promise<T> {
  activeTasks.add(task);

  task
    .catch((error) => {
      console.error(`${label} crashed:`, error);
    })
    .finally(() => {
      activeTasks.delete(task);
    });

  return task;
}

export function getActiveTaskCount(): number {
  return activeTasks.size;
}

export async function waitForBackgroundTasks(timeoutMs: number): Promise<boolean> {
  if (activeTasks.size === 0) {
    return true;
  }

  let timeout: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timeout = setTimeout(() => resolve(false), timeoutMs);
    timeout.unref();
  });
  const completed = Promise.allSettled(Array.from(activeTasks)).then(() => true as const);
  const result = await Promise.race([completed, timedOut]);

  if (timeout) {
    clearTimeout(timeout);
  }

  return result;
}
