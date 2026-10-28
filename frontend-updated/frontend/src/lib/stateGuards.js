// src/lib/stateGuards.js
// Small helpers so polling hooks do not re-render their owner when nothing changed.
//
// A React state setter with a NEW object always re-renders, even if the content is the
// same. Hooks that poll many times per second must return the OLD object instead.

/** Returns `prev` when `next` has exactly the same keys/values (shallow), else `next`. */
export function keepIfSame(prev, next) {
  if (prev === next) return prev;
  const a = Object.keys(prev || {});
  const b = Object.keys(next || {});
  if (a.length !== b.length) return next;
  for (const k of b) {
    if (!Object.is((prev || {})[k], next[k])) return next;
  }
  return prev;
}
