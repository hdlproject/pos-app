'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

export default function IngredientReviewPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const pending = trpc.stockBatch.getPending.useQuery();
  const [note, setNote] = useState('');

  useEffect(() => {
    if (pending.data?.note) setNote(pending.data.note);
  }, [pending.data?.note]);

  useEffect(() => {
    if (!pending.isLoading && !pending.data) {
      router.replace('/admin/ingredients');
    }
  }, [pending.isLoading, pending.data, router]);

  const removeLine = trpc.stockBatch.removeLine.useMutation({
    onSuccess: () => utils.stockBatch.getPending.invalidate(),
  });
  const setNoteMutation = trpc.stockBatch.setNote.useMutation({
    onSuccess: () => utils.stockBatch.getPending.invalidate(),
  });
  const confirm = trpc.stockBatch.confirm.useMutation({
    onSuccess: () => {
      utils.stockBatch.getPending.invalidate();
      utils.stockBatch.listHistory.invalidate();
      utils.ingredient.list.invalidate();
      router.push('/admin/ingredients');
    },
  });
  const cancel = trpc.stockBatch.cancel.useMutation({
    onSuccess: () => {
      utils.stockBatch.getPending.invalidate();
      utils.stockBatch.listHistory.invalidate();
      router.push('/admin/ingredients');
    },
  });

  if (pending.isLoading) {
    return <div className="p-6 text-text-muted text-sm">Loading…</div>;
  }

  if (!pending.data) {
    // No pending batch — redirect handled by the effect above.
    return null;
  }

  const batch = pending.data;

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl text-text mb-6">Review Stock Changes</h1>

      <Card className="mb-5">
        <div className="flex flex-col gap-2">
          {batch.lines.map((line) => {
            const current = Number(line.ingredient.stockQty);
            const delta = Number(line.delta);
            return (
              <div key={line.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <span className="font-bold text-sm text-text">{line.ingredient.name}</span>
                  <span className="text-text-muted text-sm ml-2">
                    {current} → {current + delta} {line.ingredient.unit}
                  </span>
                  <span className={`text-xs font-bold ml-2 ${delta >= 0 ? 'text-success' : 'text-warning'}`}>
                    {delta >= 0 ? '+' : ''}{delta} ({line.reason === 'RESTOCK' ? 'Restock' : 'Manual Adjust'})
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => removeLine.mutate({ lineId: line.id })}
                >
                  Remove
                </Button>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="mb-5">
        <label className="text-xs font-bold text-text-muted-2 block mb-1">Note (optional)</label>
        <div className="flex gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Weekly restock from supplier X"
            className="flex-1 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNoteMutation.mutate({ batchId: batch.id, note })}
          >
            Save Note
          </Button>
        </div>
      </Card>

      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={confirm.isPending}
          onClick={() => confirm.mutate({ batchId: batch.id })}
        >
          Confirm
        </Button>
        <Button
          variant="outline"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate({ batchId: batch.id })}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
