/**
 * Remove undefined object properties before passing Firestore payloads to
 * arrayUnion(). Firestore rejects undefined values, including nested values.
 * Null is preserved intentionally. Undefined array entries are rejected
 * rather than silently changing the recorded sequence.
 */
export function omitUndefinedFirestoreFields(value, path = "value") {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (entry === undefined) {
        throw new TypeError(`Undefined array entry at ${path}[${index}]`);
      }
      return omitUndefinedFirestoreFields(entry, `${path}[${index}]`);
    });
  }

  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, entry]) => entry !== undefined)
          .map(([key, entry]) => [
            key,
            omitUndefinedFirestoreFields(entry, `${path}.${key}`)
          ])
      );
    }
  }

  return value;
}
