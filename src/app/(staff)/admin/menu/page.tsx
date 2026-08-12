'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';

export default function AdminMenuPage() {
  const utils = trpc.useUtils();
  const items = trpc.menu.listAll.useQuery();
  const [categoryName, setCategoryName] = useState('');
  const createCategory = trpc.menu.createCategory.useMutation({ onSuccess: () => utils.menu.listAll.invalidate() });

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const createItem = trpc.menu.createItem.useMutation({
    onSuccess: () => { utils.menu.listAll.invalidate(); setName(''); setPrice(''); },
  });
  const toggleAvailable = trpc.menu.updateItem.useMutation({ onSuccess: () => utils.menu.listAll.invalidate() });

  const categories = Array.from(new Map(items.data?.map((i) => [i.category.id, i.category]) ?? []).values());

  return (
    <main>
      <h1>Menu Management</h1>

      <section>
        <h2>New Category</h2>
        <input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="Category name" />
        <button onClick={() => { createCategory.mutate({ name: categoryName }); setCategoryName(''); }}>Add Category</button>
      </section>

      <section>
        <h2>New Item</h2>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" />
        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price" type="number" />
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Select category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button
          disabled={!name || !price || !categoryId}
          onClick={() => createItem.mutate({ name, price: Number(price), categoryId, available: true })}
        >
          Add Item
        </button>
      </section>

      <section>
        <h2>Items</h2>
        {items.data?.map((item) => (
          <div key={item.id}>
            {item.name} — {String(item.price)} — {item.available ? 'available' : 'sold out'}
            <button onClick={() => toggleAvailable.mutate({ id: item.id, available: !item.available })}>
              {item.available ? 'Mark sold out' : 'Mark available'}
            </button>
          </div>
        ))}
      </section>
    </main>
  );
}
