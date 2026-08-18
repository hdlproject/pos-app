'use client';
import { useEffect, useRef, useState } from 'react';
import { Input } from './Input';
import { Select } from './Select';
import { Popover } from './Popover';

type SortOrder = 'asc' | 'desc';
type Option = { value: string; label: string };

type SearchSortToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  sortOptions: Option[];
  sortField: string;
  onSortFieldChange: (value: string) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (value: SortOrder) => void;
  filter?: {
    label: string;
    options: Option[];
    value: string;
    onChange: (value: string) => void;
  };
};

// Shared search/filter/sort toolbar -- same icon-button + Popover pattern
// used on admin/menu and admin/ingredients, extracted so a third (and
// future) usage doesn't copy-paste the SVGs and Popover wiring again.
export function SearchSortToolbar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  sortOptions,
  sortField,
  onSortFieldChange,
  sortOrder,
  onSortOrderChange,
  filter,
}: SearchSortToolbarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  function toggleSearch() {
    if (searchOpen) {
      setSearchOpen(false);
      onSearchChange('');
    } else {
      setSearchOpen(true);
    }
  }

  return (
    <div className="flex items-center gap-2 mb-3">
      {searchOpen && (
        <Input
          ref={searchInputRef}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="flex-1 min-w-0 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      )}
      <div className="flex items-center gap-1 ml-auto">
        <button
          onClick={toggleSearch}
          aria-label={searchOpen ? 'Close search' : 'Search'}
          title={searchOpen ? 'Close search' : 'Search'}
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

        {filter && (
          <Popover
            trigger={({ open, toggle }) => (
              <button
                onClick={toggle}
                aria-label="Filter"
                title="Filter"
                className={`shrink-0 p-2 rounded-lg transition-colors ${
                  open || filter.value !== filter.options[0]?.value
                    ? 'bg-surface-input text-accent'
                    : 'text-text-muted-2 hover:bg-surface-input'
                }`}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" />
                </svg>
              </button>
            )}
          >
            <div>
              <label className="text-xs font-bold text-text-muted-2 block mb-1">{filter.label}</label>
              <Select
                value={filter.value}
                onChange={filter.onChange}
                options={filter.options}
                className="w-full px-3 py-2"
              />
            </div>
          </Popover>
        )}

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
                onChange={onSortFieldChange}
                options={sortOptions}
                className="w-full px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-text-muted-2 block mb-1">Order</label>
              <div className="flex gap-1 bg-bg p-1 rounded-lg">
                <button
                  onClick={() => onSortOrderChange('asc')}
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
                  onClick={() => onSortOrderChange('desc')}
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
  );
}
