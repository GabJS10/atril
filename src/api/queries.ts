import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSettings, updateSettings } from "./tauri";

export const settingsQueryKey = ["settings"] as const;

export function createQueryClient(): QueryClient {
  return new QueryClient();
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
