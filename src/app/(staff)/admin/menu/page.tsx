'use client';
import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MenuItemThumbnailUpload } from '@/components/ui/MenuItemThumbnailUpload';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Popover } from '@/components/ui/Popover';
import { normalizeForSearch } from '@/lib/normalizeForSearch';

const PAGE_SIZE = 10;

type SortField = 'name' | 'price';
type SortOrder = 'asc' | 'desc';
type AvailabilityFilter = 'all' | 'available' | 'soldout';

// Availability is two independent signals: the manual toggle (`available`)
// and the ingredient-depletion auto-signal (`outOfStockReason`). Either one
// being "off" makes the item effectively sold out -- this combines both
// into a single label + reason string for display, since the raw
// `available` flag alone doesn't reflect that.
function describeAvailability(item: { available: boolean; outOfStockReason: string | null }) {
  const effectivelyAvailable = item.available && !item.outOfStockReason;
  const reasonParts: string[] = [];
  if (!item.available) reasonParts.push('Marked as sold out');
  if (item.outOfStockReason) reasonParts.push(item.outOfStockReason);
  return { effectivelyAvailable, reasonParts };
}

function AvailabilityReason({ parts }: { parts: string[] }) {
  if (parts.length === 0) return null;
  return (
    <div className="text-warning text-xs font-semibold mt-0.5">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span className="text-text-muted-2 font-normal mx-1">|</span>}
          {part}
        </span>
      ))}
    </div>
  );
}
type ViewMode = 'row' | 'thumbnail';

function RecipeModal({ menuItemId, menuItemName, onClose }: { menuItemId: string; menuItemName: string; onClose: () => void }) {
  const utils = trpc.useUtils();
  const recipes = trpc.ingredient.listRecipes.useQuery({ menuItemId });
  const ingredients = trpc.ingredient.list.useQuery();

  const [ingredientId, setIngredientId] = useState('');
  const [qty, setQty] = useState('');

  const setRecipe = trpc.ingredient.setRecipe.useMutation({
    onSuccess: () => {
      utils.ingredient.listRecipes.invalidate({ menuItemId });
      utils.menu.listAll.invalidate();
      setIngredientId('');
      setQty('');
    },
  });
  const removeRecipe = trpc.ingredient.removeRecipe.useMutation({
    onSuccess: () => {
      utils.ingredient.listRecipes.invalidate({ menuItemId });
      utils.menu.listAll.invalidate();
    },
  });

  const selectedUnit = ingredients.data?.find((i) => i.id === ingredientId)?.unit;
  const isEditingExisting = recipes.data?.some((r) => r.ingredientId === ingredientId) ?? false;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-6 my-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl text-text">Recipe: {menuItemName}</h2>
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
          {recipes.data?.map((r) => (
            <div key={r.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <span className="text-sm text-text">
                <span className="font-bold">{r.ingredient.name}</span>
                <span className="text-text-muted ml-2">{String(r.qtyPerUnit)} {r.ingredient.unit} / unit</span>
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setIngredientId(r.ingredientId); setQty(String(r.qtyPerUnit)); }}
                >
                  Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => removeRecipe.mutate({ recipeId: r.id })}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
          {recipes.data?.length === 0 && (
            <p className="text-text-muted text-sm py-2">No ingredients linked yet.</p>
          )}
        </div>

        <div className="flex gap-2 items-center">
          <Select
            value={ingredientId}
            onChange={setIngredientId}
            options={(ingredients.data ?? []).map((i) => ({ value: i.id, label: i.name }))}
            placeholder="Ingredient"
            className="flex-1 px-3 py-2"
          />
          <Input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && ingredientId && Number(qty) > 0) {
                setRecipe.mutate({ menuItemId, ingredientId, qtyPerUnit: Number(qty) });
              }
            }}
            placeholder="Qty"
            type="number"
            min="0"
            step="any"
            className="w-20 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {selectedUnit && <span className="text-xs text-text-muted-2 shrink-0">{selectedUnit}</span>}
          <Button
            variant="dark"
            size="sm"
            disabled={!ingredientId || !(Number(qty) > 0)}
            onClick={() => setRecipe.mutate({ menuItemId, ingredientId, qtyPerUnit: Number(qty) })}
          >
            {isEditingExisting ? 'Update' : 'Add'}
          </Button>
        </div>
      </div>
    </div>
  );
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
  function handleNewItemKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && name && Number(price) > 0 && categoryId) {
      createItem.mutate({ name, price: Number(price), categoryId, available: true, image: image ?? undefined });
    }
  }
  const toggleAvailable = trpc.menu.updateItem.useMutation({ onSuccess: () => utils.menu.listAll.invalidate() });

  const updateImage = trpc.menu.updateItem.useMutation({
    onSuccess: () => utils.menu.listAll.invalidate(),
  });

  const [recipeItemId, setRecipeItemId] = useState<string | null>(null);

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
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="font-display text-2xl text-text">Menu Management</h1>
        <div className="flex items-center gap-2">
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
          {!showNewItemForm && (
            <Button variant="primary" onClick={() => setShowNewItemForm(true)}>
              + New Item
            </Button>
          )}
        </div>
      </div>

      {showNewItemForm && (
        <Card className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-text">New Item</h2>
            <Button variant="outline" size="sm" onClick={() => setShowNewItemForm(false)}>
              Cancel
            </Button>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <MenuItemThumbnailUpload
              image={image}
              categoryName={categories.find((c) => c.id === categoryId)?.name ?? ''}
              alt="New item"
              onChange={setImage}
              className="w-12 h-12 rounded-lg"
            />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleNewItemKeyDown}
              placeholder="Item name"
              className="w-full sm:flex-1 sm:min-w-[160px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onKeyDown={handleNewItemKeyDown}
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
        </Card>
      )}

      <Card>
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
            <div className="flex items-center justify-between bg-surface-input rounded-lg px-3 py-2 text-xs font-bold text-text-muted-2 uppercase">
              <span>Item</span>
              <span className="w-52 text-right">Actions</span>
            </div>
            {paginatedItems.map((item) => {
              const { effectivelyAvailable, reasonParts } = describeAvailability(item);
              return (
              <div
                key={item.id}
                className={`flex items-center justify-between py-2 px-2 rounded-lg border-b border-border last:border-b-0 ${
                  effectivelyAvailable ? 'bg-success/5' : 'bg-warning/5'
                }`}
              >
                <div className="flex items-center gap-3">
                  <MenuItemThumbnailUpload
                    image={item.image}
                    categoryName={item.category.name}
                    alt={item.name}
                    onChange={(url) => updateImage.mutate({ id: item.id, image: url })}
                    className="w-10 h-10 rounded-lg"
                  />
                  <div>
                    <span className="font-bold text-sm text-text">{item.name}</span>
                    <span className="text-text-muted text-sm ml-2">Rp {Number(item.price).toLocaleString('id-ID')}</span>
                    <span className={`text-xs font-bold ml-2 ${effectivelyAvailable ? 'text-success' : 'text-warning'}`}>
                      {effectivelyAvailable ? 'available' : 'sold out'}
                    </span>
                    <AvailabilityReason parts={reasonParts} />
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:w-52 items-stretch sm:items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setRecipeItemId(item.id)}>
                    Recipe
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleAvailable.mutate({ id: item.id, available: !item.available })}
                  >
                    {item.available ? 'Sold out' : 'Available'}
                  </Button>
                </div>
              </div>
              );
            })}
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
            {paginatedItems.map((item) => {
              const { effectivelyAvailable, reasonParts } = describeAvailability(item);
              return (
              <div
                key={item.id}
                className={`flex flex-col gap-2 p-3 border rounded-xl ${
                  effectivelyAvailable ? 'bg-success/5 border-success/25' : 'bg-warning/5 border-warning/25'
                }`}
              >
                <MenuItemThumbnailUpload
                  image={item.image}
                  categoryName={item.category.name}
                  alt={item.name}
                  onChange={(url) => updateImage.mutate({ id: item.id, image: url })}
                  className="w-full h-36 rounded-lg"
                />
                <div>
                  <div className="font-bold text-sm text-text truncate">{item.name}</div>
                  <div className="text-text-muted text-xs">Rp {Number(item.price).toLocaleString('id-ID')}</div>
                  <div className={`text-xs font-bold ${effectivelyAvailable ? 'text-success' : 'text-warning'}`}>
                    {effectivelyAvailable ? 'available' : 'sold out'}
                  </div>
                  <AvailabilityReason parts={reasonParts} />
                </div>
                <div className="flex flex-col gap-1.5 mt-auto">
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setRecipeItemId(item.id)}>
                    Recipe
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => toggleAvailable.mutate({ id: item.id, available: !item.available })}
                  >
                    {item.available ? 'Sold out' : 'Available'}
                  </Button>
                </div>
              </div>
              );
            })}
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

      {recipeItemId && (
        <RecipeModal
          menuItemId={recipeItemId}
          menuItemName={items.data?.find((i) => i.id === recipeItemId)?.name ?? ''}
          onClose={() => setRecipeItemId(null)}
        />
      )}
    </div>
  );
}
