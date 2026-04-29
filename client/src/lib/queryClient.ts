import { QueryClient, QueryFunction } from "@tanstack/react-query";

export async function throwIfResNotOk(res: Response) {
  if (res.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("app:unauthorized"));
  }

  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let parsedMessage: string | null = null;

    try {
      const parsed = JSON.parse(text) as { message?: string };
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        parsedMessage = parsed.message.trim();
      }
    } catch (_error) {
      // Fall back to the raw response body when the server didn't send JSON.
    }

    if (parsedMessage) {
      throw new Error(parsedMessage);
    }

    throw new Error(text);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
