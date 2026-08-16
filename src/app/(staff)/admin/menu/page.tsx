'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MenuItemThumbnail } from '@/components/ui/MenuItemThumbnail';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ImageUpload } from '@/components/ui/ImageUpload';

export default function AdminMenuPage() {
  const utils = trpc.useUtils();
  const items = trpc.menu.listAll.useQuery();
  const categoriesQuery = trpc.menu.listCategories.useQuery();

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const createCategory = trpc.menu.createCategory.useMutation({
    onSuccess: (data) => {
      utils.menu.listAll.invalidate();
      utils.menu.listCategories.invalidate();
      setCategoryId(data.id);
    },
  });
  const deleteCategory = trpc.menu.deleteCategory.useMutation({
    onSuccess: (_data, variables) => {
      utils.menu.listAll.invalidate();
      utils.menu.listCategories.invalidate();
      setCategoryId((current) => (current === variables.id ? '' : current));
    },
  });
  const createItem = trpc.menu.createItem.useMutation({
    onSuccess: () => { utils.menu.listAll.invalidate(); setName(''); setPrice(''); setImage(null); },
  });
  const toggleAvailable = trpc.menu.updateItem.useMutation({ onSuccess: () => utils.menu.listAll.invalidate() });

  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const updateImage = trpc.menu.updateItem.useMutation({
    onSuccess: () => utils.menu.listAll.invalidate(),
  });

  const categories = categoriesQuery.data ?? [];
  const usedCategoryIds = new Set((items.data ?? []).map((item) => item.categoryId));

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl text-text mb-6">Menu Management</h1>

      <Card className="mb-5">
        <h2 className="font-bold text-text mb-3">New Item</h2>
        <div className="flex flex-col sm:flex-row gap-2 sm:flex-wrap">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Item name"
            className="w-full sm:flex-1 sm:min-w-[160px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price"
            type="number"
            min="1"
            step="1"
            className="w-full sm:w-28 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Select
            value={categoryId}
            onChange={setCategoryId}
            options={categories.map((c) => ({ value: c.id, label: c.name, removable: !usedCategoryIds.has(c.id) }))}
            placeholder="Select category"
            onAddNew={(newName) => createCategory.mutate({ name: newName })}
            addNewLabel="+ Add new category…"
            addNewPlaceholder="New category name"
            onRemove={(id) => deleteCategory.mutate({ id })}
            className="w-full sm:w-auto sm:min-w-[180px] px-3 py-2"
          />
          <Button
            variant="dark"
            className="w-full sm:w-auto"
            disabled={!name || !(Number(price) > 0) || !categoryId}
            onClick={() => createItem.mutate({ name, price: Number(price), categoryId, available: true, image: image ?? undefined })}
          >
            Add Item
          </Button>
        </div>
        <div className="mt-3">
          <ImageUpload
            value={image}
            onChange={setImage}
            categoryName={categories.find((c) => c.id === categoryId)?.name ?? ''}
          />
        </div>
      </Card>

      <Card>
        <h2 className="font-bold text-text mb-3">Items</h2>
        <div className="flex flex-col gap-2">
          {items.data?.map((item) => (
            <div key={item.id} className="flex flex-col gap-2 py-2 border-b border-border last:border-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <MenuItemThumbnail
                    image={item.image}
                    categoryName={item.category.name}
                    alt={item.name}
                    className="w-10 h-10 rounded-lg shrink-0"
                  />
                  <div>
                    <span className="font-bold text-sm text-text">{item.name}</span>
                    <span className="text-text-muted text-sm ml-2">Rp {Number(item.price).toLocaleString('id-ID')}</span>
                    <span className={`text-xs font-bold ml-2 ${item.available ? 'text-success' : 'text-warning'}`}>
                      {item.available ? 'available' : 'sold out'}
                    </span>
                    {item.outOfStockReason && (
                      <div className="text-warning text-xs font-semibold mt-0.5">{item.outOfStockReason}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingImageId(editingImageId === item.id ? null : item.id)}
                  >
                    {editingImageId === item.id ? 'Cancel' : 'Edit image'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleAvailable.mutate({ id: item.id, available: !item.available })}
                  >
                    {item.available ? 'Mark sold out' : 'Mark available'}
                  </Button>
                </div>
              </div>
              {editingImageId === item.id && (
                <div className="pl-[52px]">
                  <ImageUpload
                    value={item.image}
                    onChange={(url) => updateImage.mutate({ id: item.id, image: url })}
                    categoryName={item.category.name}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
