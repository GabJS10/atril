import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import type { AppRouter } from "./router";

type AppProps = {
  router: AppRouter;
  queryClient: QueryClient;
};

export function App({ router, queryClient }: AppProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
