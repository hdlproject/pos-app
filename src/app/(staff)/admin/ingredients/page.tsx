'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Popover } from '@/components/ui/Popover';
import { normalizeForSearch } from '@/lib/normalizeForSearch';

type StockSortField = 'name' | 'stock';
type SortOrder = 'asc' | 'desc';
type StockFilter = 'all' | 'in' | 'out';

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
  const hasPending = lineCount > 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-bold text-text-muted-2">
        {hasPending ? `${lineCount} pending change${lineCount === 1 ? '' : 's'}` : 'No pending changes'}
      </span>
      {hasPending && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={cancelling} onClick={onCancel}>
            Cancel Changes
          </Button>
          <Button variant="primary" size="sm" onClick={onReview}>
            Review Changes
          </Button>
        </div>
      )}
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
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg p-6 my-8">
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') setNoteMutation.mutate({ batchId: batch.id, note });
              }}
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
  const [open, setOpen] = useState(false);

  useEffect(() => setText(String(pendingDelta)), [pendingDelta]);

  const commit = (next: number, closeAfter = false) => {
    setText(String(next));
    if (next === 0) {
      if (pendingLineId) onRemove(pendingLineId);
    } else {
      onStage(next);
    }
    if (closeAfter) setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
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
            if (e.key === 'Enter') commit(Number(text) || 0, true);
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
  function handleNewIngredientKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && name && unit) {
      create.mutate({ name, unit, stockQty: Number(initialStock) || 0 });
    }
  }

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

  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [sortField, setSortField] = useState<StockSortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  function toggleSearch() {
    if (searchOpen) {
      setSearchOpen(false);
      setSearch('');
    } else {
      setSearchOpen(true);
    }
  }

  const normalizedSearch = normalizeForSearch(search);
  const filteredIngredients = (ingredients.data ?? [])
    .filter((ing) => normalizeForSearch(ing.name).includes(normalizedSearch))
    .filter((ing) => {
      if (stockFilter === 'all') return true;
      const out = Number(ing.stockQty) <= 0;
      return stockFilter === 'out' ? out : !out;
    });

  const sortedIngredients = [...filteredIngredients].sort((a, b) => {
    const diff = sortField === 'name' ? a.name.localeCompare(b.name) : Number(a.stockQty) - Number(b.stockQty);
    return sortOrder === 'asc' ? diff : -diff;
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
              onKeyDown={handleNewIngredientKeyDown}
              placeholder="Name"
              className="w-full sm:flex-1 sm:min-w-[140px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              onKeyDown={handleNewIngredientKeyDown}
              placeholder="Unit (g, ml, pcs)"
              className="w-full sm:w-32 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Input
              value={initialStock}
              onChange={(e) => setInitialStock(e.target.value)}
              onKeyDown={handleNewIngredientKeyDown}
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
        <div className="flex items-center gap-2 mb-3">
          <PendingBatchControls
            lineCount={pending.data?.lines.length ?? 0}
            onCancel={() => { if (pending.data) cancelBatch.mutate({ batchId: pending.data.id }); }}
            onReview={() => setReviewOpen(true)}
            cancelling={cancelBatch.isPending}
          />
          {searchOpen && (
            <Input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ingredients…"
              className="flex-1 min-w-0 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          )}
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={toggleSearch}
              aria-label={searchOpen ? 'Close search' : 'Search ingredients'}
              title={searchOpen ? 'Close search' : 'Search ingredients'}
              className="shrink-0 p-2 rounded-lg text-text-muted-2 hover:bg-surface-input transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {searchOpen ? <path d="M6 6l12 12M18 6L6 18" /> : (
                  <>
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.3-4.3" />
                  </>
                )}
              </svg>
            </button>

            <Popover
              trigger={({ open, toggle }) => (
                <button
                  onClick={toggle}
                  aria-label="Filter"
                  title="Filter"
                  className={`shrink-0 p-2 rounded-lg transition-colors ${
                    open || stockFilter !== 'all' ? 'bg-surface-input text-accent' : 'text-text-muted-2 hover:bg-surface-input'
                  }`}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" />
                  </svg>
                </button>
              )}
            >
              <div>
                <label className="text-xs font-bold text-text-muted-2 block mb-1">Status</label>
                <Select
                  value={stockFilter}
                  onChange={(v) => setStockFilter(v as StockFilter)}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'in', label: 'In stock' },
                    { value: 'out', label: 'Out of stock' },
                  ]}
                  className="w-full px-3 py-2"
                />
              </div>
            </Popover>

            <Popover
              trigger={({ open, toggle }) => (
                <button
                  onClick={toggle}
                  aria-label="Sort"
                  title="Sort"
                  className={`shrink-0 p-2 rounded-lg transition-colors ${
                    open ? 'bg-surface-input text-accent' : 'text-text-muted-2 hover:bg-surface-input'
                  }`}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 6v12M8 6l-3 3M8 6l3 3M16 18V6M16 18l-3-3M16 18l3-3" />
                  </svg>
                </button>
              )}
            >
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-xs font-bold text-text-muted-2 block mb-1">Sort by</label>
                  <Select
                    value={sortField}
                    onChange={(v) => setSortField(v as StockSortField)}
                    options={[
                      { value: 'name', label: 'Name' },
                      { value: 'stock', label: 'Stock' },
                    ]}
                    className="w-full px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-text-muted-2 block mb-1">Order</label>
                  <div className="flex gap-1 bg-bg p-1 rounded-lg">
                    <button
                      onClick={() => setSortOrder('asc')}
                      aria-label="Ascending"
                      title="Ascending"
                      className={`flex-1 flex items-center justify-center py-1.5 rounded-md transition-colors ${
                        sortOrder === 'asc' ? 'bg-surface text-accent shadow-sm' : 'text-text-muted-2'
                      }`}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 19V5M5 12l7-7 7 7" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setSortOrder('desc')}
                      aria-label="Descending"
                      title="Descending"
                      className={`flex-1 flex items-center justify-center py-1.5 rounded-md transition-colors ${
                        sortOrder === 'desc' ? 'bg-surface text-accent shadow-sm' : 'text-text-muted-2'
                      }`}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 5v14M19 12l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </Popover>
          </div>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-6 bg-surface-input -mx-4 px-4 py-2 mb-1 text-xs font-bold text-text-muted-2 uppercase">
            <span className="flex-1">Name</span>
            <span className="w-28 text-right">Stock</span>
            <span className="w-10" />
          </div>
          {sortedIngredients.map((ing) => {
            const out = Number(ing.stockQty) <= 0;
            const line = pending.data?.lines.find((l) => l.ingredientId === ing.id);
            return (
              <div key={ing.id} className="flex items-center gap-6 px-3 py-2 border-b border-border last:border-0">
                <span className="flex-1 font-bold text-sm text-text">{ing.name}</span>
                <span className={`w-28 text-right text-sm ${out ? 'text-warning' : 'text-text'}`}>
                  {String(ing.stockQty)} {ing.unit}
                </span>
                <span className="w-10 flex justify-center">
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

        {sortedIngredients.length === 0 && (
          <p className="text-text-muted text-sm text-center py-6">No ingredients match your filters.</p>
        )}
      </Card>

      {reviewOpen && <ReviewModal onClose={() => setReviewOpen(false)} />}
    </div>
  );
}
