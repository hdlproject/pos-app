'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';

export default function AdminTablesPage() {
  const utils = trpc.useUtils();
  const tables = trpc.table.list.useQuery();
  const [label, setLabel] = useState('');
  const create = trpc.table.create.useMutation({ onSuccess: () => { utils.table.list.invalidate(); setLabel(''); } });
  const rotate = trpc.table.rotateToken.useMutation({ onSuccess: () => utils.table.list.invalidate() });

  return (
    <main>
      <h1>Tables</h1>
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Table label (e.g. T5)" />
      <button disabled={!label} onClick={() => create.mutate({ label })}>Add Table</button>

      {tables.data?.map((t) => (
        <div key={t.id}>
          {t.label} — /order/{t.qrToken}
          <button onClick={() => rotate.mutate({ id: t.id })}>Rotate QR Token</button>
        </div>
      ))}
    </main>
  );
}
