import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
  MutationCache,
} from "@tanstack/react-query";
import superjson from "superjson";
import { toast } from "sonner";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";

export const trpc = createTRPCReact<AppRouter>();

const queryClient = new QueryClient({
  // Global error handlers: a network failure or a non-JSON error response
  // must never crash the UI with "Unable to transform response from server".
  queryCache: new QueryCache({
    onError: (error) => {
      console.error("[query error]", error);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      console.error("[mutation error]", error);
      // Mutations used to fail silently (dead buttons) — surface them.
      toast.error(error.message || "Действие не выполнено. Попробуйте ещё раз.");
    },
  }),
  defaultOptions: {
    queries: {
      // 4xx responses (401/403/404/429) are not transient — never retry them.
      retry: (failureCount, error) => {
        const status = (error as { data?: { httpStatus?: number } })?.data
          ?.httpStatus;
        if (typeof status === "number" && status >= 400 && status < 500) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
