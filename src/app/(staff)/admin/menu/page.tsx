'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MenuItemThumbnail } from '@/components/ui/MenuItemThumbnail';

export default function AdminMenuPage() {
  const utils = trpc.useUtils();
  const items = trpc.menu.listAll.useQuery();
  const categoriesQuery = trpc.menu.listCategories.useQuery();
  const [categoryName, setCategoryName] = useState('');
  const createCategory = trpc.menu.createCategory.useMutation({
    onSuccess: () => {
      utils.menu.listAll.invalidate();
      utils.menu.listCategories.invalidate();
    },
  });

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [image, setImage] = useState('');
  const createItem = trpc.menu.createItem.useMutation({
    onSuccess: () => { utils.menu.listAll.invalidate(); setName(''); setPrice(''); setImage(''); },
  });
  const toggleAvailable = trpc.menu.updateItem.useMutation({ onSuccess: () => utils.menu.listAll.invalidate() });

  const categories = categoriesQuery.data ?? [];

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl text-text mb-6">Menu Management</h1>

      <Card className="mb-5">
        <h2 className="font-bold text-text mb-3">New Category</h2>
        <div className="flex gap-2">
          <input
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            placeholder="Category name"
            className="flex-1 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Button variant="primary" onClick={() => { createCategory.mutate({ name: categoryName }); setCategoryName(''); }}>
            Add Category
          </Button>
        </div>
      </Card>

      <Card className="mb-5">
        <h2 className="font-bold text-text mb-3">New Item</h2>
        <div className="flex gap-2 flex-wrap">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Item name"
            className="flex-1 min-w-[160px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price"
            type="number"
            className="w-28 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Select category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="Image URL (optional)"
            className="flex-1 min-w-[200px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Button
            variant="dark"
            disabled={!name || !price || !categoryId}
            onClick={() => createItem.mutate({ name, price: Number(price), categoryId, available: true, image: image || undefined })}
          >
            Add Item
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="font-bold text-text mb-3">Items</h2>
        <div className="flex flex-col gap-2">
          {items.data?.map((item) => (
            <div key={item.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div className="flex items-center gap-3">
                <MenuItemThumbnail
                  image={item.image}
                  categoryName={item.category.name}
                  alt={item.name}
                  className="w-10 h-10 rounded-lg shrink-0"
                />
                <div>
                  <span className="font-bold text-sm text-text">{item.name}</span>
                  <span className="text-text-muted text-sm ml-2">Rp {String(item.price)}</span>
                  <span className={`text-xs font-bold ml-2 ${item.available ? 'text-success' : 'text-warning'}`}>
                    {item.available ? 'available' : 'sold out'}
                  </span>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleAvailable.mutate({ id: item.id, available: !item.available })}
              >
                {item.available ? 'Mark sold out' : 'Mark available'}
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
