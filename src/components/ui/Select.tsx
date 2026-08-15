'use client';
import { useEffect, useRef, useState } from 'react';

type SelectOption = { value: string; label: string };

type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  onAddNew?: (name: string) => void;
  addNewLabel?: string;
  addNewPlaceholder?: string;
};

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  className = '',
  onAddNew,
  addNewLabel = '+ Add new…',
  addNewPlaceholder = 'New name',
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const selectedOption = options.find((o) => o.value === value);
  const selectedLabel = selectedOption?.label ?? placeholder;

  function handleSelect(optionValue: string) {
    onChange(optionValue);
    setOpen(false);
  }

  function submitNew() {
    if (!newValue.trim() || !onAddNew) return;
    onAddNew(newValue.trim());
    setNewValue('');
    setAdding(false);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center justify-between gap-2 text-left border border-border-strong rounded-lg bg-surface-input text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent ${className}`}
      >
        <span className={`truncate ${selectedOption ? 'text-text' : 'text-text-muted'}`}>{selectedLabel}</span>
        <svg
          className="w-3.5 h-3.5 text-text-muted-2 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-20 top-full mt-1 left-0 min-w-full w-max max-w-[280px] bg-surface border border-border rounded-xl shadow-lg py-1 max-h-64 overflow-y-auto">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleSelect(opt.value)}
              className={`block w-full text-left px-3 py-2 text-sm transition-colors hover:bg-surface-input ${
                opt.value === value ? 'text-accent font-bold' : 'text-text'
              }`}
            >
              {opt.label}
            </button>
          ))}

          {onAddNew && (
            <div className="border-t border-border mt-1 pt-1">
              {adding ? (
                <div className="flex gap-1.5 px-2 py-1.5">
                  <input
                    ref={inputRef}
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitNew();
                      if (e.key === 'Escape') setAdding(false);
                    }}
                    placeholder={addNewPlaceholder}
                    className="flex-1 min-w-0 px-2 py-1 text-sm border border-border-strong rounded-md bg-surface-input text-text outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  <button
                    type="button"
                    onClick={submitNew}
                    disabled={!newValue.trim()}
                    className="px-2 py-1 text-xs font-bold rounded-md bg-accent text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="block w-full text-left px-3 py-2 text-sm font-semibold text-accent hover:bg-surface-input transition-colors"
                >
                  {addNewLabel}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
