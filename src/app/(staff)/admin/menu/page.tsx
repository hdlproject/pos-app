'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MenuItemThumbnail } from '@/components/ui/MenuItemThumbnail';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

export default function AdminMenuPage() {
  const utils = trpc.useUtils();
  const items = trpc.menu.listAll.useQuery();
  const categoriesQuery = trpc.menu.listCategories.useQuery();

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [image, setImage] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const createCategory = trpc.menu.createCategory.useMutation({
    onSuccess: (data) => {
      utils.menu.listAll.invalidate();
      utils.menu.listCategories.invalidate();
      setCategoryId(data.id);
      setAddingCategory(false);
      setNewCategoryName('');
    },
  });
  const createItem = trpc.menu.createItem.useMutation({
    onSuccess: () => { utils.menu.listAll.invalidate(); setName(''); setPrice(''); setImage(''); },
  });
  const toggleAvailable = trpc.menu.updateItem.useMutation({ onSuccess: () => utils.menu.listAll.invalidate() });

  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [editImageValue, setEditImageValue] = useState('');
  const updateImage = trpc.menu.updateItem.useMutation({
    onSuccess: () => { utils.menu.listAll.invalidate(); setEditingImageId(null); },
  });

  const categories = categoriesQuery.data ?? [];

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl text-text mb-6">Menu Management</h1>

      <Card className="mb-5">
        <h2 className="font-bold text-text mb-3">New Item</h2>
        <div className="flex gap-2 flex-wrap">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Item name"
            className="flex-1 min-w-[160px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price"
            type="number"
            min="1"
            step="1"
            className="w-28 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Select
            value={addingCategory ? '__new__' : categoryId}
            onChange={(e) => {
              if (e.target.value === '__new__') {
                setAddingCategory(true);
              } else {
                setAddingCategory(false);
                setCategoryId(e.target.value);
              }
            }}
            className="min-w-[180px] pl-3 pr-9 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Select category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="__new__">+ Add new category…</option>
          </Select>
          <Input
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="Image URL (optional)"
            className="flex-1 min-w-[200px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Button
            variant="dark"
            disabled={!name || !(Number(price) > 0) || !categoryId}
            onClick={() => createItem.mutate({ name, price: Number(price), categoryId, available: true, image: image || undefined })}
          >
            Add Item
          </Button>
        </div>
        {addingCategory && (
          <div className="flex gap-2 mt-2.5">
            <Input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="New category name"
              autoFocus
              className="flex-1 min-w-[160px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!newCategoryName}
              onClick={() => createCategory.mutate({ name: newCategoryName })}
            >
              Add
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setAddingCategory(false); setNewCategoryName(''); }}
            >
              Cancel
            </Button>
          </div>
        )}
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
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (editingImageId === item.id) {
                        setEditingImageId(null);
                      } else {
                        setEditingImageId(item.id);
                        setEditImageValue(item.image ?? '');
                      }
                    }}
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
                <div className="flex gap-2 pl-[52px]">
                  <Input
                    value={editImageValue}
                    onChange={(e) => setEditImageValue(e.target.value)}
                    placeholder="Image URL"
                    className="flex-1 min-w-[200px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateImage.mutate({ id: item.id, image: editImageValue || undefined })}
                  >
                    Save
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
