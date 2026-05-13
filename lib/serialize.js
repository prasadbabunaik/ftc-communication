// Converts Prisma Decimal → number and Date → ISO string, recursively.
// Must be called in Server Components before passing data to Client Components.
export function serialize(val) {
  if (val === null || val === undefined) return val;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object' && typeof val.toNumber === 'function') return val.toNumber();
  if (Array.isArray(val)) return val.map(serialize);
  if (typeof val === 'object') {
    return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, serialize(v)]));
  }
  return val;
}
