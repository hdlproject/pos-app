'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Popover } from '@/components/ui/Popover';

function PendingBatchControls({
  lineCount,
  onCancel,
  onReview,
  cancelling,
}: {
  lineCount: number;
  onCancel: () => void;
  onReview: () => void;
  cancelling: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-bold text-text-muted-2">
        {lineCount} pending change{lineCount === 1 ? '' : 's'}
      </span>
      <Button variant="outline" size="sm" disabled={cancelling} onClick={onCancel}>
        Cancel Changes
      </Button>
      <Button variant="primary" size="sm" onClick={onReview}>
        Review Changes
      </Button>
    </div>
  );
}

function ReviewModal({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const pending = trpc.stockBatch.getPending.useQuery();
  const [note, setNote] = useState('');

  useEffect(() => {
    if (pending.data?.note) setNote(pending.data.note);
  }, [pending.data?.note]);

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
      onClose();
    },
  });
  const cancel = trpc.stockBatch.cancel.useMutation({
    onSuccess: () => {
      utils.stockBatch.getPending.invalidate();
      utils.stockBatch.listHistory.invalidate();
      onClose();
    },
  });

  useEffect(() => {
    if (!pending.isLoading && !pending.data) onClose();
  }, [pending.isLoading, pending.data, onClose]);

  if (!pending.data) return null;
  const batch = pending.data;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl text-text">Review Stock Changes</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-lg text-text-muted-2 hover:bg-surface-input transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-2 mb-4">
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
                <Button variant="outline" size="sm" onClick={() => removeLine.mutate({ lineId: line.id })}>
                  Remove
                </Button>
              </div>
            );
          })}
        </div>

        <div className="mb-4">
          <label className="text-xs font-bold text-text-muted-2 block mb-1">Note (optional)</label>
          <div className="flex gap-2">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Weekly restock from supplier X"
              className="flex-1 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Button variant="outline" size="sm" onClick={() => setNoteMutation.mutate({ batchId: batch.id, note })}>
              Save Note
            </Button>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="primary" disabled={confirm.isPending} onClick={() => confirm.mutate({ batchId: batch.id })}>
            Confirm
          </Button>
          <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate({ batchId: batch.id })}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function StockStepper({
  unit,
  pendingDelta,
  pendingLineId,
  onStage,
  onRemove,
}: {
  unit: string;
  pendingDelta: number;
  pendingLineId: string | undefined;
  onStage: (delta: number) => void;
  onRemove: (lineId: string) => void;
}) {
  const [text, setText] = useState(String(pendingDelta));

  useEffect(() => setText(String(pendingDelta)), [pendingDelta]);

  const commit = (next: number) => {
    setText(String(next));
    if (next === 0) {
      if (pendingLineId) onRemove(pendingLineId);
    } else {
      onStage(next);
    }
  };

  return (
    <Popover
      trigger={({ open, toggle }) => (
        <button
          onClick={toggle}
          aria-label="Adjust stock"
          title="Adjust stock"
          className={`shrink-0 p-2 rounded-lg transition-colors ${
            open || pendingDelta !== 0 ? 'bg-surface-input text-accent' : 'text-text-muted-2 hover:bg-surface-input'
          }`}
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      )}
    >
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" onClick={() => commit((Number(text) || 0) - 1)}>
          −
        </Button>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => commit(Number(text) || 0)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(Number(text) || 0);
          }}
          type="number"
          className="w-20 px-2 py-1 border border-border-strong rounded-lg bg-surface-input text-sm text-center outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <Button variant="outline" size="sm" onClick={() => commit((Number(text) || 0) + 1)}>
          +
        </Button>
        <span className="text-xs text-text-muted-2">{unit}</span>
      </div>
    </Popover>
  );
}

export default function AdminIngredientsPage() {
  const utils = trpc.useUtils();
  const ingredients = trpc.ingredient.list.useQuery();
  const pending = trpc.stockBatch.getPending.useQuery();

  const [showNewIngredientForm, setShowNewIngredientForm] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [initialStock, setInitialStock] = useState('');
  const create = trpc.ingredient.create.useMutation({
    onSuccess: () => {
      utils.ingredient.list.invalidate();
      setName('');
      setUnit('');
      setInitialStock('');
      setShowNewIngredientForm(false);
    },
  });

  const stageChange = trpc.stockBatch.stageChange.useMutation({
    onSuccess: () => utils.stockBatch.getPending.invalidate(),
  });
  const removeLine = trpc.stockBatch.removeLine.useMutation({
    onSuccess: () => utils.stockBatch.getPending.invalidate(),
  });
  const cancelBatch = trpc.stockBatch.cancel.useMutation({
    onSuccess: () => {
      utils.stockBatch.getPending.invalidate();
      utils.stockBatch.listHistory.invalidate();
    },
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="font-display text-2xl text-text">Ingredients</h1>
        <div className="flex items-center gap-2">
          <Link href="/admin/ingredients/history">
            <Button variant="outline" size="sm">History</Button>
          </Link>
          {!showNewIngredientForm && (
            <Button variant="primary" onClick={() => setShowNewIngredientForm(true)}>
              + New Ingredient
            </Button>
          )}
        </div>
      </div>

      {showNewIngredientForm && (
        <Card className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-text">New Ingredient</h2>
            <Button variant="outline" size="sm" onClick={() => setShowNewIngredientForm(false)}>
              Cancel
            </Button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:flex-wrap">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="w-full sm:flex-1 sm:min-w-[140px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="Unit (g, ml, pcs)"
              className="w-full sm:w-32 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Input
              value={initialStock}
              onChange={(e) => setInitialStock(e.target.value)}
              placeholder="Initial stock"
              type="number"
              min="0"
              className="w-full sm:w-36 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Button
              variant="dark"
              className="w-full sm:w-auto"
              disabled={!name || !unit}
              onClick={() =>
                create.mutate({
                  name,
                  unit,
                  stockQty: Number(initialStock) || 0,
                })
              }
            >
              Add Ingredient
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-bold text-text">Stock</h2>
          {pending.data && (
            <PendingBatchControls
              lineCount={pending.data.lines.length}
              onCancel={() => cancelBatch.mutate({ batchId: pending.data!.id })}
              onReview={() => setReviewOpen(true)}
              cancelling={cancelBatch.isPending}
            />
          )}
        </div>
        <div className="grid grid-cols-[1fr_120px_auto] items-center gap-x-6 gap-y-1">
          <span className="text-xs font-bold text-text-muted-2 uppercase pb-2">Name</span>
          <span className="text-xs font-bold text-text-muted-2 uppercase pb-2 text-right">Stock</span>
          <span className="pb-2" />
          {ingredients.data?.map((ing) => {
            const out = Number(ing.stockQty) <= 0;
            const line = pending.data?.lines.find((l) => l.ingredientId === ing.id);
            return (
              <div key={ing.id} className="contents">
                <span className="font-bold text-sm text-text py-2">{ing.name}</span>
                <span className={`text-sm text-right py-2 ${out ? 'text-warning' : 'text-text'}`}>
                  {String(ing.stockQty)} {ing.unit}
                </span>
                <span className="py-2">
                  <StockStepper
                    unit={ing.unit}
                    pendingDelta={line ? Number(line.delta) : 0}
                    pendingLineId={line?.id}
                    onStage={(delta) => stageChange.mutate({ ingredientId: ing.id, delta, reason: 'MANUAL_ADJUST' })}
                    onRemove={(lineId) => removeLine.mutate({ lineId })}
                  />
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {reviewOpen && <ReviewModal onClose={() => setReviewOpen(false)} />}
    </div>
  );
}
