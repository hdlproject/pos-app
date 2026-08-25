'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { MenuItemThumbnail } from '@/components/ui/MenuItemThumbnail';
import { TASTE_OPTIONS, AROMA_OPTIONS, TEXTURE_OPTIONS } from '@/lib/suggestionOptions';

// Explicit flat type for the mutation result -- same TS2589 workaround
// used throughout this page for tRPC results.
type Suggestion = {
  menuItemId: string;
  name: string;
  price: string;
  image: string | null;
  categoryName: string;
  reason: string;
};

// Each "page" is one self-contained suggestion request/response, scoped to
// exactly one type -- suggestions are generated separately per type rather
// than one mixed call spanning several. "Add new" appends a page (a fresh
// request for a different type) instead of mutating the current one, so
// earlier results stay browsable via Prev/Next.
type PageState = {
  id: string;
  type: string | null;
  taste: (typeof TASTE_OPTIONS)[number][];
  aroma: (typeof AROMA_OPTIONS)[number][];
  texture: (typeof TEXTURE_OPTIONS)[number][];
  notes: string;
  suggestions: Suggestion[] | null;
  errorMessage: string | null;
  addedIds: string[];
  unavailableIds: string[];
};

function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function makePage(): PageState {
  return {
    id: crypto.randomUUID(),
    type: null,
    taste: [],
    aroma: [],
    texture: [],
    notes: '',
    suggestions: null,
    errorMessage: null,
    addedIds: [],
    unavailableIds: [],
  };
}

export default function SuggestionChat({
  tableToken,
  categories,
  availableMenuItemIds,
  onAddToCart,
}: {
  tableToken: string;
  categories: string[];
  availableMenuItemIds: string[];
  onAddToCart: (menuItemId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<PageState[]>(() => [makePage()]);
  const [activeIndex, setActiveIndex] = useState(0);

  const suggest = trpc.aiSuggestion.getSuggestion.useMutation();
  const page = pages[activeIndex];

  function updatePage(id: string, patch: Partial<PageState>) {
    setPages((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function submit() {
    if (!page.type) return;
    const pageId = page.id;
    updatePage(pageId, { suggestions: null, errorMessage: null, addedIds: [], unavailableIds: [] });
    suggest.mutate(
      {
        tableToken,
        taste: page.taste,
        aroma: page.aroma,
        texture: page.texture,
        type: [page.type],
        notes: page.notes.trim() || undefined,
      },
      {
        onSuccess: (data) => {
          const result = (data as unknown as { suggestions: Suggestion[] }).suggestions;
          updatePage(pageId, { suggestions: result });
        },
        onError: (err) => {
          updatePage(pageId, { errorMessage: err.message });
        },
      }
    );
  }

  function addNewPage() {
    const newPage = makePage();
    const newIndex = pages.length;
    setPages((ps) => [...ps, newPage]);
    setActiveIndex(newIndex);
  }

  function closePanel() {
    setOpen(false);
    setPages([makePage()]);
    setActiveIndex(0);
    suggest.reset();
  }

  // Suggestions come from a snapshot taken when "Get suggestions" was
  // tapped -- by the time the customer taps Add, that item may have gone
  // unavailable (86'd, marked out of stock). availableMenuItemIds is the
  // page's live menu.listAvailable result, already in memory, so this is
  // a free re-check with no extra request -- same guarantee the spec asks
  // for, without inventing a new server round-trip nothing else here has.
  function handleAdd(pageId: string, menuItemId: string) {
    if (!availableMenuItemIds.includes(menuItemId)) {
      setPages((ps) => ps.map((p) => (p.id === pageId ? { ...p, unavailableIds: [...p.unavailableIds, menuItemId] } : p)));
      return;
    }
    onAddToCart(menuItemId);
    setPages((ps) => ps.map((p) => (p.id === pageId ? { ...p, addedIds: [...p.addedIds, menuItemId] } : p)));
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Get menu suggestions"
        className="fixed bottom-20 right-4 md:bottom-6 md:right-[25rem] z-30 flex items-center gap-2 bg-accent text-white font-extrabold text-sm px-4 py-2.5 rounded-full shadow-2xl"
      >
        ✨ Suggest for me
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-dark-ui/60 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-[420px] max-h-[85vh] bg-surface rounded-3xl overflow-hidden shadow-2xl flex flex-col">
            <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-border shrink-0">
              <div className="font-display text-xl text-text">What are you in the mood for?</div>
              <button
                onClick={closePanel}
                aria-label="Close"
                className="w-8 h-8 rounded-lg bg-surface-input text-accent-tint flex items-center justify-center shrink-0"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 px-5 pt-4 shrink-0">
              <div className="flex items-center gap-2">
                {pages.length > 1 && (
                  <>
                    <button
                      onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                      disabled={activeIndex === 0}
                      aria-label="Previous suggestion"
                      className="w-7 h-7 rounded-lg bg-surface-input text-accent-tint flex items-center justify-center disabled:opacity-30"
                    >
                      ‹
                    </button>
                    <span className="text-xs font-extrabold text-text-muted-2">
                      {activeIndex + 1} / {pages.length}
                    </span>
                    <button
                      onClick={() => setActiveIndex((i) => Math.min(pages.length - 1, i + 1))}
                      disabled={activeIndex === pages.length - 1}
                      aria-label="Next suggestion"
                      className="w-7 h-7 rounded-lg bg-surface-input text-accent-tint flex items-center justify-center disabled:opacity-30"
                    >
                      ›
                    </button>
                  </>
                )}
              </div>
              <button
                onClick={addNewPage}
                disabled={suggest.isPending}
                className="text-xs font-bold text-accent-tint px-3 py-1.5 rounded-lg hover:bg-surface-input transition-colors disabled:opacity-50"
              >
                + Add new
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex flex-col gap-4">
              {categories.length > 0 && (
                <div>
                  <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">Type</div>
                  <div className="flex gap-2 flex-wrap">
                    {categories.map((c) => (
                      <Chip
                        key={c}
                        active={page.type === c}
                        onClick={() => updatePage(page.id, { type: page.type === c ? null : c })}
                      >
                        {c}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">Taste</div>
                <div className="flex gap-2 flex-wrap">
                  {TASTE_OPTIONS.map((o) => (
                    <Chip
                      key={o}
                      active={page.taste.includes(o)}
                      onClick={() => updatePage(page.id, { taste: toggleValue(page.taste, o) })}
                    >
                      {o}
                    </Chip>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">Aroma</div>
                <div className="flex gap-2 flex-wrap">
                  {AROMA_OPTIONS.map((o) => (
                    <Chip
                      key={o}
                      active={page.aroma.includes(o)}
                      onClick={() => updatePage(page.id, { aroma: toggleValue(page.aroma, o) })}
                    >
                      {o}
                    </Chip>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">Texture</div>
                <div className="flex gap-2 flex-wrap">
                  {TEXTURE_OPTIONS.map((o) => (
                    <Chip
                      key={o}
                      active={page.texture.includes(o)}
                      onClick={() => updatePage(page.id, { texture: toggleValue(page.texture, o) })}
                    >
                      {o}
                    </Chip>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">Anything else? (optional)</div>
                <input
                  value={page.notes}
                  onChange={(e) => updatePage(page.id, { notes: e.target.value })}
                  maxLength={200}
                  placeholder="e.g. no nuts, something warm"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border-strong bg-surface-input text-text text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <Button variant="primary" className="w-full" disabled={!page.type || suggest.isPending} onClick={submit}>
                {suggest.isPending ? 'Thinking…' : 'Get suggestions'}
              </Button>
              {!page.type && (
                <p className="text-text-muted text-xs font-semibold text-center -mt-2">Pick a type to get suggestions.</p>
              )}

              {page.errorMessage && (
                <p className="text-warning text-xs font-semibold text-center">{page.errorMessage}</p>
              )}

              {page.suggestions && page.suggestions.length > 0 && (
                <div className="flex flex-col gap-2.5 pt-1">
                  {page.suggestions.map((s) => (
                    <div key={s.menuItemId} className="flex items-center gap-3 bg-surface-input rounded-2xl p-2.5">
                      <MenuItemThumbnail
                        image={s.image}
                        categoryName={s.categoryName}
                        alt={s.name}
                        className="w-14 h-14 rounded-xl shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm text-text truncate">{s.name}</div>
                        <div className="text-xs text-text-muted">{s.reason}</div>
                        <div className="text-xs font-extrabold text-accent-tint mt-0.5">
                          Rp {Number(s.price).toLocaleString('id-ID')}
                        </div>
                      </div>
                      {page.unavailableIds.includes(s.menuItemId) ? (
                        <span className="text-[10.5px] font-extrabold uppercase px-2.5 py-1.5 rounded-full bg-surface-input text-text-muted-2 shrink-0">
                          No longer available
                        </span>
                      ) : (
                        <Button
                          variant={page.addedIds.includes(s.menuItemId) ? 'success' : 'dark'}
                          size="sm"
                          onClick={() => handleAdd(page.id, s.menuItemId)}
                        >
                          {page.addedIds.includes(s.menuItemId) ? 'Added' : '+ Add'}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {page.suggestions && page.suggestions.length === 0 && (
                <p className="text-text-muted text-xs font-semibold text-center">
                  Nothing available to suggest right now.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
