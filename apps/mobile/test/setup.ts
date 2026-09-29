jest.mock(
  "expo-secure-store",
  () => {
    const store = new Map<string, string>();
    return {
      getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
      setItemAsync: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      deleteItemAsync: jest.fn(async (k: string) => {
        store.delete(k);
      }),
      __store: store,
    };
  },
  { virtual: true },
);

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));
