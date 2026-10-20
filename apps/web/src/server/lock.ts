// One state transition at a time per record (a sequence, a job), so concurrent polls
// cannot start a step twice. Shared by every route bundle of this process: Next
// bundles routes separately, globalThis is what they have in common.
const holder = globalThis as typeof globalThis & { __montagioLocks?: Map<string, Promise<unknown>> };
const locks = (holder.__montagioLocks ??= new Map());

export function withLock<T>(id: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  const settled = next.catch(() => undefined);
  locks.set(id, settled);
  void settled.then(() => {
    if (locks.get(id) === settled) locks.delete(id);
  });
  return next;
}
