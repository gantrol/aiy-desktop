import { useState } from 'react';

export function useTablePreviewReadiness() {
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  function update(id: string, ready: boolean) {
    setLoaded((current) => {
      if (current.has(id) === ready) return current;
      const next = new Set(current);
      if (ready) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  return {
    update,
    ready: (input: { tableConversion?: { id: string } }) =>
      !input.tableConversion || loaded.has(input.tableConversion.id),
  };
}
