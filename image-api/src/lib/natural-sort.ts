/** Channel order: Ch 1, Ch 2, Ch 10 rather than Ch 1, Ch 10, Ch 2, which is how a database sorts text. */
export function sortByName<T extends { name?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { numeric: true }));
}
