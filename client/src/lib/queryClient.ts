import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/**
 * Supports two calling styles so existing call sites keep working:
 *   apiRequest(url, { method, body, headers })          <- new style
 *   apiRequest(method, url, data)                       <- old style
 */
export async function apiRequest(
  urlOrMethod: string,
  optionsOrUrl?: RequestInit | string,
  maybeData?: unknown,
): Promise<any> {
  let url: string;
  let options: RequestInit;

  const looksLikeOldStyle =
    typeof optionsOrUrl === "string" &&
    HTTP_METHODS.includes(urlOrMethod.toUpperCase());

  if (looksLikeOldStyle) {
    // Old-style call: apiRequest(method, url, data)
    url = optionsOrUrl as string;
    options = {
      method: urlOrMethod.toUpperCase(),
      ...(maybeData !== undefined
        ? { body: JSON.stringify(maybeData) }
        : {}),
    };
  } else {
    // New-style call: apiRequest(url, options)
    url = urlOrMethod;
    options = (optionsOrUrl as RequestInit) ?? {};
  }

  const res = await fetch(`${API_BASE}${url}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    ...options,
  });
  await throwIfResNotOk(res);
  return res.json();
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey.filter((part) => part !== undefined && part !== null).join("/");
    const res = await fetch(`${API_BASE}${url}`, {
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
      // Use returnNull for 401 so protected pages gracefully handle unauthenticated state
      queryFn: getQueryFn({ on401: "returnNull" }),
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
