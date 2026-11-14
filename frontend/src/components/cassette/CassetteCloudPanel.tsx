import { cassetteStore, useCassetteSync } from '@/hooks/useCassettes';

/** Only show library recovery and pagination when needed. */
export function CassetteCloudPanel() {
  const sync = useCassetteSync();
  if (sync.status === 'hidden') return null;
  return <div>
    {sync.listError && <p role="alert">{sync.listError} <button type="button" className="studio-btn" disabled={sync.loading} onClick={() => void cassetteStore.refresh()}>Retry loading</button></p>}
    {sync.storageError && <p role="alert">{sync.storageError}</p>}
    {sync.nextCursor && <button type="button" className="studio-btn" disabled={sync.loading} onClick={() => void cassetteStore.loadMore()}>Load more tapes</button>}
  </div>;
}
