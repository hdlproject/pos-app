'use client';
import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Popover } from '@/components/ui/Popover';

type StageReason = 'MANUAL_ADJUST' | 'RESTOCK';

function StageChangePopover({
  ingredientId,
  onStage,
}: {
  ingredientId: string;
  onStage: (input: { ingredientId: string; delta: number; reason: StageReason }) => void;
}) {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState<StageReason>('RESTOCK');

  return (
    <Popover
      trigger={({ toggle }) => (
        <Button variant="outline" size="sm" onClick={toggle}>
          Stage Change
        </Button>
      )}
    >
      <div className="flex flex-col gap-3">
        <div>
          <label className="text-xs font-bold text-text-muted-2 block mb-1">Amount</label>
          <Input
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="e.g. 100 or -20"
            type="number"
            className="w-full px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-text-muted-2 block mb-1">Reason</label>
          <Select
            value={reason}
            onChange={(v) => setReason(v as StageReason)}
            options={[
              { value: 'RESTOCK', label: 'Restock' },
              { value: 'MANUAL_ADJUST', label: 'Manual Adjust' },
            ]}
            className="w-full px-3 py-2"
          />
        </div>
        <Button
          variant="dark"
          size="sm"
          disabled={!delta || Number(delta) === 0}
          onClick={() => {
            onStage({ ingredientId, delta: Number(delta), reason });
            setDelta('');
          }}
        >
          Stage
        </Button>
      </div>
    </Popover>
  );
}

export default function AdminIngredientsPage() {
  const utils = trpc.useUtils();
  const ingredients = trpc.ingredient.list.useQuery();
  const pending = trpc.stockBatch.getPending.useQuery();

  const [showNewIngredientForm, setShowNewIngredientForm] = useState(false);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [initialStock, setInitialStock] = useState('');
  const [threshold, setThreshold] = useState('');
  const create = trpc.ingredient.create.useMutation({
    onSuccess: () => {
      utils.ingredient.list.invalidate();
      setName('');
      setUnit('');
      setInitialStock('');
      setThreshold('');
      setShowNewIngredientForm(false);
    },
  });

  const stageChange = trpc.stockBatch.stageChange.useMutation({
    onSuccess: () => utils.stockBatch.getPending.invalidate(),
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

      {pending.data && (
        <Card className="mb-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm font-bold text-text">
              {pending.data.lines.length} pending change{pending.data.lines.length === 1 ? '' : 's'} awaiting confirmation
            </span>
            <Link href="/admin/ingredients/review">
              <Button variant="primary" size="sm">Review Changes</Button>
            </Link>
          </div>
        </Card>
      )}

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
            <Input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="Low-stock threshold"
              type="number"
              className="w-full sm:w-44 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Button
              variant="dark"
              className="w-full sm:w-auto"
              disabled={!name || !unit || !threshold}
              onClick={() =>
                create.mutate({
                  name,
                  unit,
                  stockQty: Number(initialStock) || 0,
                  lowStockThreshold: Number(threshold),
                })
              }
            >
              Add Ingredient
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="font-bold text-text mb-3">Stock</h2>
        <div className="flex flex-col gap-2">
          {ingredients.data?.map((ing) => {
            const low = Number(ing.stockQty) < Number(ing.lowStockThreshold);
            return (
              <div key={ing.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className={low ? 'text-warning' : 'text-text'}>
                  <span className="font-bold text-sm">{ing.name}</span>
                  <span className="text-sm ml-2">{String(ing.stockQty)} {ing.unit}</span>
                  {low && <span className="text-xs font-extrabold ml-2">LOW STOCK</span>}
                </div>
                <StageChangePopover
                  ingredientId={ing.id}
                  onStage={(input) => stageChange.mutate(input)}
                />
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
