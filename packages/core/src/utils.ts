// Shared utility: remove keys with undefined values.
// Used to satisfy exactOptionalPropertyTypes when building option objects.

export function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined) result[key] = obj[key];
  }
  return result as Partial<T>;
}
