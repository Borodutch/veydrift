export const SIDEBAR_COLLAPSED_STORAGE_KEY = "veydrift.sidebar.collapsed.v1";

export function readSidebarCollapsed(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Privacy-restricted hosts still allow the in-session preference to work.
  }
}
