import { afterEach, describe, expect, test } from "bun:test";
import { readSidebarCollapsed, SIDEBAR_COLLAPSED_STORAGE_KEY, writeSidebarCollapsed } from "./sidebarPreference";
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
describe("desktop sidebar preference", () => {
  test.each([null, "", "true", "false", "{}", "0", " 1 "])("defaults expanded for %s", value => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: () => value } } });
    expect(readSidebarCollapsed()).toBe(false);
  });
  test("round trips both choices using durable local storage", () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
      getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value),
    } } });
    writeSidebarCollapsed(true);
    expect(values.get(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe("1");
    expect(readSidebarCollapsed()).toBe(true);
    writeSidebarCollapsed(false);
    expect(readSidebarCollapsed()).toBe(false);
  });
  test("handles absent window and blocked storage access", () => {
    Reflect.deleteProperty(globalThis, "window");
    expect(readSidebarCollapsed()).toBe(false);
    expect(() => writeSidebarCollapsed(true)).not.toThrow();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { get localStorage() { throw new Error("Blocked"); } } });
    expect(readSidebarCollapsed()).toBe(false);
    expect(() => writeSidebarCollapsed(true)).not.toThrow();
  });
});
