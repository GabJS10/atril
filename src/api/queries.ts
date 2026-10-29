import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { checkForUpdate, getAppVersion, getSettings, updateSettings } from "./tauri";

export const settingsQueryKey = ["settings"] as const;
export const updateCheckQueryKey = ["update-check"] as const;
const appVersionQueryKey = ["app-version"] as const;

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

// Updates (docs/IPC.md, "Actualizaciones (v1.3)"). The check is one request per session: staleTime and gcTime are
// infinite, so focusing the window or coming back to a screen never asks GitHub again.
const updateCheckOptions = {
  queryKey: updateCheckQueryKey,
  queryFn: checkForUpdate,
  staleTime: Infinity,
  gcTime: Infinity,
  retry: false,
  refetchOnWindowFocus: false,
} as const;

/**
 * The check at startup, once settings are loaded and `checkUpdates` is on. Its errors stay silent: nothing is shown
 * unless the check finds a newer version (see `useUpdateCheckResult`).
 */
export function useStartupUpdateCheck() {
  const { data: settings } = useSettings();
  return useQuery({ ...updateCheckOptions, enabled: settings?.checkUpdates === true });
}

/** The last update check of this session, whoever asked for it. It only reads: it never starts a request. */
export function useUpdateCheckResult() {
  return useQuery({ ...updateCheckOptions, enabled: false });
}

/** "Comprobar ahora" in Settings: asks at once, whatever `checkUpdates` says. A result also feeds the notice. */
export function useCheckForUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: checkForUpdate,
    onSuccess: (result) => {
      queryClient.setQueryData(updateCheckQueryKey, result);
    },
  });
}

/** The running app's version. */
export function useAppVersion() {
  return useQuery({ queryKey: appVersionQueryKey, queryFn: getAppVersion, staleTime: Infinity });
}
