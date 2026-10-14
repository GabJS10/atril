import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSettings, updateSettings } from "./tauri";

export const settingsQueryKey = ["settings"] as const;

export function createQueryClient(): QueryClient {
  // The backend is local: a failed command is not a flaky network. One quick retry, then the screen says so
  // (the default three retries with backoff would leave a screen blank for seven seconds).
  return new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 300 } } });
}

export function useSettings() {
  return useQuery({ queryKey: settingsQueryKey, queryFn: getSettings });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsQueryKey, settings);
    },
  });
}
