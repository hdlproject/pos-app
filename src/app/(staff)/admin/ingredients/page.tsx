'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export default function AdminIngredientsPage() {
  const utils = trpc.useUtils();
  const ingredients = trpc.ingredient.list.useQuery();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [threshold, setThreshold] = useState('');
  const create = trpc.ingredient.create.useMutation({
    onSuccess: () => { utils.ingredient.list.invalidate(); setName(''); setUnit(''); setThreshold(''); },
  });
  const adjust = trpc.ingredient.adjustStock.useMutation({ onSuccess: () => utils.ingredient.list.invalidate() });

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl text-text mb-6">Ingredients</h1>

      <Card className="mb-5">
        <h2 className="font-bold text-text mb-3">New Ingredient</h2>
        <div className="flex gap-2 flex-wrap">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="flex-1 min-w-[140px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none"
          />
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="Unit (g, ml, pcs)"
            className="w-40 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none"
          />
          <input
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="Low-stock threshold"
            type="number"
            className="w-44 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none"
          />
          <Button
            variant="dark"
            disabled={!name || !unit || !threshold}
            onClick={() => create.mutate({ name, unit, lowStockThreshold: Number(threshold), stockQty: 0 })}
          >
            Add Ingredient
          </Button>
        </div>
      </Card>

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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => adjust.mutate({ ingredientId: ing.id, delta: 100, reason: 'RESTOCK' })}
                >
                  +100 Restock
                </Button>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
