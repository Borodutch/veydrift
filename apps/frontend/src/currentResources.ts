/** Undefined supports legacy payloads; explicit null is authoritative unknown, never zero or a raw fallback. */
export function currentResources<T>(snapshot: { resourcesAsOfNow?: T | null | undefined; resources?: T | null | undefined } | null | undefined): T | null | undefined {
  return snapshot?.resourcesAsOfNow === undefined ? snapshot?.resources : snapshot.resourcesAsOfNow;
}

export const RESOURCES_UNAVAILABLE = "Current resources are unavailable. Please try again shortly.";
