import type { createCassetteStore } from './store';

/** Serialize editor saves and include edits made while a request is in flight. */
export function createEditorSaver(store: ReturnType<typeof createCassetteStore>, id: string, context: number) {
  let pending: Promise<boolean> | undefined;
  async function flush(): Promise<boolean> {
    while (store.getSync().context === context) {
      const sync = store.getSync();
      const tape = sync.tapes[id];
      if (!tape || sync.status === 'hidden') return false;
      if (sync.status === 'guest') return !sync.storageError;
      if (tape.conflict || tape.cloudMissing || tape.deleting || tape.reloading) return false;
      if (tape.saving) {
        await new Promise<void>((resolve) => {
          const unsubscribe = store.subscribe(() => {
            if (store.getSync().context !== context || !store.getSync().tapes[id]?.saving) {
              unsubscribe(); resolve();
            }
          });
        });
        if (store.getSync().tapes[id]?.error) return false;
        continue;
      }
      if (!tape.dirty) return true;
      if (!await store.save(id)) return false;
    }
    return false;
  }
  return () => {
    pending ??= flush().finally(() => { pending = undefined; });
    return pending;
  };
}
