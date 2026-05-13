export async function collectAsync<T>(iterable: AsyncIterable<T> | Iterable<T>): Promise<T[]> {
  const values: T[] = [];

  for await (const value of iterable) {
    values.push(value);
  }

  return values;
}
