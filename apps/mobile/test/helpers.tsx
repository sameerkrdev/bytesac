import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";

/** Renders with a fresh query client that never retries and drops its cache right away (no timers left behind). */
export const renderWithClient = (ui: ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })}>{ui}</QueryClientProvider>);

/** A mocked `@/lib/api` object: every method is a jest.fn, so tests set what they need. */
export const apiMock = () => new Proxy({} as Record<string, jest.Mock>, { get: (t, k: string) => (t[k] ??= jest.fn()) });

/** Resets the mocked api methods only (jest.resetAllMocks would also wipe jest-expo's own component mocks, such as Switch). */
export const resetApi = (api: Record<string, jest.Mock>) => { for (const fn of Object.values(api)) fn.mockReset(); };
