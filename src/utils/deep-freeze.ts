/** Recursively freezes configuration/data values while tolerating cyclic object graphs. */
export function deepFreeze<T>(value: T): Readonly<T> {
  return freeze(value, new WeakSet<object>());
}

function freeze<T>(value: T, seen: WeakSet<object>): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value as Readonly<T>;
  }
  if (seen.has(value)) {
    return value as Readonly<T>;
  }

  seen.add(value);
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    freeze(nested, seen);
  }

  return value as Readonly<T>;
}
