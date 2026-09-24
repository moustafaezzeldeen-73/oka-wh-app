import { useEffect, useMemo, useState } from 'react';

import type { Order } from '../api/model';
import { fileUrls } from '../api/shopify';
import { orderPhotos, type OrderPhoto } from './selectors';

/**
 * The order's photos, with links filled in for any Shopify was still
 * processing when they were logged. A photo whose link can't be read yet
 * stays in the list with `url: null`, so the screen can show a placeholder.
 */
export function usePhotos(order: Order): OrderPhoto[] {
  const base = useMemo(() => orderPhotos(order), [order]);
  const [resolved, setResolved] = useState<Record<string, string>>({});

  const missing = base
    .filter((p) => !p.url && p.fileId && !resolved[p.fileId])
    .map((p) => p.fileId as string);
  const key = missing.join(',');

  useEffect(() => {
    if (!key) return;
    let alive = true;
    fileUrls(key.split(','))
      .then((urls) => {
        if (alive) setResolved((cur) => ({ ...cur, ...urls }));
      })
      // Needs read_files; without it the photo keeps its placeholder.
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key]);

  return base.map((p) => (p.url || !p.fileId ? p : { ...p, url: resolved[p.fileId] ?? null }));
}
