'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export default function AdminTablesPage() {
  const utils = trpc.useUtils();
  const tables = trpc.table.list.useQuery();
  const [label, setLabel] = useState('');
  const create = trpc.table.create.useMutation({ onSuccess: () => { utils.table.list.invalidate(); setLabel(''); } });
  const rotate = trpc.table.rotateToken.useMutation({ onSuccess: () => utils.table.list.invalidate() });

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl text-text mb-6">Tables</h1>

      <Card className="mb-5">
        <div className="flex gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Table label (e.g. T5)"
            className="flex-1 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Button variant="dark" disabled={!label} onClick={() => create.mutate({ label })}>
            Add Table
          </Button>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-2">
          {tables.data?.map((t) => (
            <div key={t.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div>
                <span className="font-bold text-sm text-text">{t.label}</span>
                <span className="text-text-muted text-xs ml-2">/order/{t.qrToken}</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => rotate.mutate({ id: t.id })}>
                Rotate QR Token
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
