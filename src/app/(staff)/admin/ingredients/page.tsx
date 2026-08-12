'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';

export default function AdminIngredientsPage() {
  const utils = trpc.useUtils();
  const ingredients = trpc.ingredient.list.useQuery();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [threshold, setThreshold] = useState('');
  const create = trpc.ingredient.create.useMutation({ onSuccess: () => { utils.ingredient.list.invalidate(); setName(''); setUnit(''); setThreshold(''); } });
  const adjust = trpc.ingredient.adjustStock.useMutation({ onSuccess: () => utils.ingredient.list.invalidate() });

  return (
    <main>
      <h1>Ingredients</h1>

      <section>
        <h2>New Ingredient</h2>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit (g, ml, pcs)" />
        <input value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="Low-stock threshold" type="number" />
        <button
          disabled={!name || !unit || !threshold}
          onClick={() => create.mutate({ name, unit, lowStockThreshold: Number(threshold), stockQty: 0 })}
        >
          Add Ingredient
        </button>
      </section>

      <section>
        <h2>Stock</h2>
        {ingredients.data?.map((ing) => {
          const low = Number(ing.stockQty) < Number(ing.lowStockThreshold);
          return (
            <div key={ing.id} style={{ color: low ? 'red' : undefined }}>
              {ing.name}: {String(ing.stockQty)} {ing.unit} {low && '(LOW STOCK)'}
              <button onClick={() => adjust.mutate({ ingredientId: ing.id, delta: 100, reason: 'RESTOCK' })}>+100 Restock</button>
            </div>
          );
        })}
      </section>
    </main>
  );
}
