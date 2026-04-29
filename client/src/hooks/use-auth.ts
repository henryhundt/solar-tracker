import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { apiRequest, throwIfResNotOk } from "@/lib/queryClient";

export const authSessionQueryKey = [api.auth.session.path] as const;

export function useAuthSession() {
  return useQuery({
    queryKey: authSessionQueryKey,
    queryFn: async () => {
      const res = await fetch(api.auth.session.path, {
        credentials: "include",
      });
      await throwIfResNotOk(res);
      return api.auth.session.responses[200].parse(await res.json());
    },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (credentials: { username: string; password: string }) => {
      const res = await apiRequest("POST", api.auth.login.path, credentials);
      return api.auth.login.responses[200].parse(await res.json());
    },
    onSuccess: (session) => {
      queryClient.setQueryData(authSessionQueryKey, session);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", api.auth.logout.path);
      return api.auth.logout.responses[200].parse(await res.json());
    },
    onSuccess: (session) => {
      queryClient.clear();
      queryClient.setQueryData(authSessionQueryKey, session);
    },
  });
}
