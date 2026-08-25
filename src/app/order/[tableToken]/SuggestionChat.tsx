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

function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
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
  const [taste, setTaste] = useState<(typeof TASTE_OPTIONS)[number][]>([]);
  const [aroma, setAroma] = useState<(typeof AROMA_OPTIONS)[number][]>([]);
  const [texture, setTexture] = useState<(typeof TEXTURE_OPTIONS)[number][]>([]);
  const [type, setType] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [unavailableIds, setUnavailableIds] = useState<string[]>([]);

  const suggest = trpc.aiSuggestion.getSuggestion.useMutation();

  function submit() {
    setAddedIds([]);
    setUnavailableIds([]);
    suggest.mutate({ tableToken, taste, aroma, texture, type, notes: notes.trim() || undefined });
  }

  // Suggestions come from a snapshot taken when "Get suggestions" was
  // tapped -- by the time the customer taps Add, that item may have gone
  // unavailable (86'd, marked out of stock). availableMenuItemIds is the
  // page's live menu.listAvailable result, already in memory, so this is
  // a free re-check with no extra request -- same guarantee the spec asks
  // for, without inventing a new server round-trip nothing else here has.
  function handleAdd(menuItemId: string) {
    if (!availableMenuItemIds.includes(menuItemId)) {
      setUnavailableIds((ids) => [...ids, menuItemId]);
      return;
    }
    onAddToCart(menuItemId);
    setAddedIds((ids) => [...ids, menuItemId]);
  }

  const suggestions = (suggest.data as unknown as { suggestions: Suggestion[] } | undefined)?.suggestions ?? [];

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
                onClick={() => {
                  setOpen(false);
                  setTaste([]);
                  setAroma([]);
                  setTexture([]);
                  setType([]);
                  setNotes('');
                  setAddedIds([]);
                  setUnavailableIds([]);
                  suggest.reset();
                }}
                aria-label="Close"
                className="w-8 h-8 rounded-lg bg-surface-input text-accent-tint flex items-center justify-center shrink-0"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex flex-col gap-4">
              <div>
                <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">Taste</div>
                <div className="flex gap-2 flex-wrap">
                  {TASTE_OPTIONS.map((o) => (
                    <Chip key={o} active={taste.includes(o)} onClick={() => setTaste((t) => toggleValue(t, o))}>
                      {o}
                    </Chip>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">Aroma</div>
                <div className="flex gap-2 flex-wrap">
                  {AROMA_OPTIONS.map((o) => (
                    <Chip key={o} active={aroma.includes(o)} onClick={() => setAroma((a) => toggleValue(a, o))}>
                      {o}
                    </Chip>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">Texture</div>
                <div className="flex gap-2 flex-wrap">
                  {TEXTURE_OPTIONS.map((o) => (
                    <Chip key={o} active={texture.includes(o)} onClick={() => setTexture((t) => toggleValue(t, o))}>
                      {o}
                    </Chip>
                  ))}
                </div>
              </div>

              {categories.length > 0 && (
                <div>
                  <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">Type</div>
                  <div className="flex gap-2 flex-wrap">
                    {categories.map((o) => (
                      <Chip key={o} active={type.includes(o)} onClick={() => setType((t) => toggleValue(t, o))}>
                        {o}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">Anything else? (optional)</div>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. no nuts, something warm"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border-strong bg-surface-input text-text text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <Button variant="primary" className="w-full" disabled={suggest.isPending} onClick={submit}>
                {suggest.isPending ? 'Thinking…' : 'Get suggestions'}
              </Button>

              {suggest.isError && (
                <p className="text-warning text-xs font-semibold text-center">{suggest.error.message}</p>
              )}

              {suggestions.length > 0 && (
                <div className="flex flex-col gap-2.5 pt-1">
                  {suggestions.map((s) => (
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
                      {unavailableIds.includes(s.menuItemId) ? (
                        <span className="text-[10.5px] font-extrabold uppercase px-2.5 py-1.5 rounded-full bg-surface-input text-text-muted-2 shrink-0">
                          No longer available
                        </span>
                      ) : (
                        <Button
                          variant={addedIds.includes(s.menuItemId) ? 'success' : 'dark'}
                          size="sm"
                          onClick={() => handleAdd(s.menuItemId)}
                        >
                          {addedIds.includes(s.menuItemId) ? 'Added' : '+ Add'}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
