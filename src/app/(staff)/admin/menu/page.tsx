'use client';
import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MenuItemThumbnail } from '@/components/ui/MenuItemThumbnail';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { Popover } from '@/components/ui/Popover';

const PAGE_SIZE = 10;

type SortField = 'name' | 'price';
type SortOrder = 'asc' | 'desc';
type AvailabilityFilter = 'all' | 'available' | 'soldout';
type ViewMode = 'row' | 'thumbnail';

// Strips diacritics (é, è, ñ, etc.) so search matches regardless of accents --
// "caffe" should find "Caffè Latte" even without the grave accent typed.
function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

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
  const [showNewItemForm, setShowNewItemForm] = useState(false);
  const createItem = trpc.menu.createItem.useMutation({
    onSuccess: () => {
      utils.menu.listAll.invalidate();
      setName('');
      setPrice('');
      setImage(null);
      setShowNewItemForm(false);
    },
  });
  const toggleAvailable = trpc.menu.updateItem.useMutation({ onSuccess: () => utils.menu.listAll.invalidate() });

  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const updateImage = trpc.menu.updateItem.useMutation({
    onSuccess: () => utils.menu.listAll.invalidate(),
  });

  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [viewMode, setViewMode] = useState<ViewMode>('row');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const categories = categoriesQuery.data ?? [];
  const usedCategoryIds = new Set((items.data ?? []).map((item) => item.categoryId));

  function resetToFirstPage() {
    setPage(1);
  }

  function toggleSearch() {
    if (searchOpen) {
      setSearchOpen(false);
      setSearch('');
      resetToFirstPage();
    } else {
      setSearchOpen(true);
    }
  }

  const normalizedSearch = normalizeForSearch(search);
  const filteredItems = (items.data ?? [])
    .filter((item) => normalizeForSearch(item.name).includes(normalizedSearch))
    .filter((item) => !categoryFilter || item.categoryId === categoryFilter)
    .filter((item) => {
      if (availabilityFilter === 'all') return true;
      const effectivelyAvailable = item.available && !item.outOfStockReason;
      return availabilityFilter === 'available' ? effectivelyAvailable : !effectivelyAvailable;
    });

  const sortedItems = [...filteredItems].sort((a, b) => {
    const diff = sortField === 'name' ? a.name.localeCompare(b.name) : Number(a.price) - Number(b.price);
    return sortOrder === 'asc' ? diff : -diff;
  });

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedItems = sortedItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl text-text">Menu Management</h1>
        {!showNewItemForm && (
          <Button variant="primary" onClick={() => setShowNewItemForm(true)}>
            + New Item
          </Button>
        )}
      </div>

      {showNewItemForm && (
        <Card className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-text">New Item</h2>
            <Button variant="outline" size="sm" onClick={() => setShowNewItemForm(false)}>
              Cancel
            </Button>
          </div>
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
      )}

      <Card>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-bold text-text">Items</h2>
          <div className="flex gap-1 bg-bg p-1 rounded-lg">
            <button
              onClick={() => setViewMode('row')}
              aria-label="Row view"
              title="Row view"
              className={`p-2 rounded-md transition-colors ${
                viewMode === 'row' ? 'bg-surface text-accent shadow-sm' : 'text-text-muted-2'
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
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode('thumbnail')}
              aria-label="Thumbnail view"
              title="Thumbnail view"
              className={`p-2 rounded-md transition-colors ${
                viewMode === 'thumbnail' ? 'bg-surface text-accent shadow-sm' : 'text-text-muted-2'
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
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          {searchOpen && (
            <Input
              ref={searchInputRef}
              value={search}
              onChange={(e) => { setSearch(e.target.value); resetToFirstPage(); }}
              placeholder="Search items…"
              className="flex-1 min-w-0 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          )}
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={toggleSearch}
              aria-label={searchOpen ? 'Close search' : 'Search items'}
              title={searchOpen ? 'Close search' : 'Search items'}
              className="shrink-0 p-2 rounded-lg text-text-muted-2 hover:bg-surface-input transition-colors"
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
                    open || categoryFilter || availabilityFilter !== 'all'
                      ? 'bg-surface-input text-accent'
                      : 'text-text-muted-2 hover:bg-surface-input'
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
                    <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" />
                  </svg>
                </button>
              )}
            >
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-xs font-bold text-text-muted-2 block mb-1">Category</label>
                  <Select
                    value={categoryFilter}
                    onChange={(v) => { setCategoryFilter(v); resetToFirstPage(); }}
                    options={[{ value: '', label: 'All categories' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
                    className="w-full px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-text-muted-2 block mb-1">Status</label>
                  <Select
                    value={availabilityFilter}
                    onChange={(v) => { setAvailabilityFilter(v as AvailabilityFilter); resetToFirstPage(); }}
                    options={[
                      { value: 'all', label: 'All status' },
                      { value: 'available', label: 'Available' },
                      { value: 'soldout', label: 'Sold out' },
                    ]}
                    className="w-full px-3 py-2"
                  />
                </div>
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
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
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
                    onChange={(v) => { setSortField(v as SortField); resetToFirstPage(); }}
                    options={[
                      { value: 'name', label: 'Name' },
                      { value: 'price', label: 'Price' },
                    ]}
                    className="w-full px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-text-muted-2 block mb-1">Order</label>
                  <div className="flex gap-1 bg-bg p-1 rounded-lg">
                    <button
                      onClick={() => { setSortOrder('asc'); resetToFirstPage(); }}
                      aria-label="Ascending"
                      title="Ascending"
                      className={`flex-1 flex items-center justify-center py-1.5 rounded-md transition-colors ${
                        sortOrder === 'asc' ? 'bg-surface text-accent shadow-sm' : 'text-text-muted-2'
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
                        <path d="M12 19V5M5 12l7-7 7 7" />
                      </svg>
                    </button>
                    <button
                      onClick={() => { setSortOrder('desc'); resetToFirstPage(); }}
                      aria-label="Descending"
                      title="Descending"
                      className={`flex-1 flex items-center justify-center py-1.5 rounded-md transition-colors ${
                        sortOrder === 'desc' ? 'bg-surface text-accent shadow-sm' : 'text-text-muted-2'
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
                        <path d="M12 5v14M19 12l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </Popover>
          </div>
        </div>

        {viewMode === 'row' ? (
          <div className="flex flex-col gap-2">
            {paginatedItems.map((item) => (
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
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
            {paginatedItems.map((item) => (
              <div key={item.id} className="flex flex-col gap-2 p-3 border border-border rounded-xl">
                <MenuItemThumbnail
                  image={item.image}
                  categoryName={item.category.name}
                  alt={item.name}
                  className="w-full h-24 rounded-lg"
                />
                <div>
                  <div className="font-bold text-sm text-text truncate">{item.name}</div>
                  <div className="text-text-muted text-xs">Rp {Number(item.price).toLocaleString('id-ID')}</div>
                  <div className={`text-xs font-bold ${item.available ? 'text-success' : 'text-warning'}`}>
                    {item.available ? 'available' : 'sold out'}
                  </div>
                  {item.outOfStockReason && (
                    <div className="text-warning text-xs font-semibold mt-0.5">{item.outOfStockReason}</div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setEditingImageId(editingImageId === item.id ? null : item.id)}
                  >
                    {editingImageId === item.id ? 'Cancel' : 'Edit image'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => toggleAvailable.mutate({ id: item.id, available: !item.available })}
                  >
                    {item.available ? 'Mark sold out' : 'Mark available'}
                  </Button>
                </div>
                {editingImageId === item.id && (
                  <ImageUpload
                    value={item.image}
                    onChange={(url) => updateImage.mutate({ id: item.id, image: url })}
                    categoryName={item.category.name}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {sortedItems.length === 0 && (
          <p className="text-text-muted text-sm text-center py-6">No items match your filters.</p>
        )}

        {sortedItems.length > 0 && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
            <span className="text-xs text-text-muted">
              Page {currentPage} of {totalPages} ({sortedItems.length} item{sortedItems.length === 1 ? '' : 's'})
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
