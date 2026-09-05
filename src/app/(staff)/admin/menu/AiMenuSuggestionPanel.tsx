'use client';
import { useRef, useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { TASTE_OPTIONS, AROMA_OPTIONS, TEXTURE_OPTIONS } from '@/lib/suggestionOptions';

const CUISINE_OPTIONS = ['Indonesian', 'Italian', 'Korean', 'Japanese', 'Western', 'Fusion'] as const;

type DraftIngredient = { name: string; unit: string; qtyPerUnit: number; existingIngredientId: string | null };
type Draft = {
  name: string;
  price: number;
  category: string;
  description: string;
  instructions: string;
  ingredients: DraftIngredient[];
  reasoning: string;
};
type SuggestResult = { ok: true; candidates: Draft[] } | { ok: false; reason: string };

type FormState = {
  name: string;
  price: string;
  categoryId: string;
  newCategoryName: string;
  description: string;
  instructions: string;
  ingredients: DraftIngredient[];
  reasoning: string;
};

function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// Grows a textarea to fit its content so the full description/instructions
// text is always visible with no inner scrollbar, instead of a fixed
// row count that clips longer AI-generated text.
function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export default function AiMenuSuggestionPanel({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const categoriesQuery = trpc.menu.listCategories.useQuery();
  const categories = categoriesQuery.data ?? [];

  const [cuisine, setCuisine] = useState<(typeof CUISINE_OPTIONS)[number][]>([]);
  const [taste, setTaste] = useState<(typeof TASTE_OPTIONS)[number][]>([]);
  const [aroma, setAroma] = useState<(typeof AROMA_OPTIONS)[number][]>([]);
  const [texture, setTexture] = useState<(typeof TEXTURE_OPTIONS)[number][]>([]);
  const [categoryHint, setCategoryHint] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [noSuggestionReason, setNoSuggestionReason] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Draft[] | null>(null);
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  // Drives a brief background flash on the freshly-populated candidate
  // picker, plus the scroll-into-view -- the panel gets tall once results
  // appear, so both cues point the admin straight at what just showed up.
  const [justSuggested, setJustSuggested] = useState(false);
  const candidatesRef = useRef<HTMLDivElement>(null);
  const nameFieldRef = useRef<HTMLDivElement>(null);

  const suggest = trpc.aiMenuSuggestion.suggestNewItem.useMutation({
    onSuccess: (data) => {
      const result = data as unknown as SuggestResult;
      if (!result.ok) {
        setNoSuggestionReason(result.reason);
        setCandidates(null);
        setForm(null);
        return;
      }
      setNoSuggestionReason(null);
      setCandidates(result.candidates);
      setChosenIndex(null);
      setForm(null);
      setJustSuggested(true);
      setTimeout(() => candidatesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      setTimeout(() => setJustSuggested(false), 1300);
    },
  });

  function chooseCandidate(draft: Draft, index: number) {
    const matched = categories.find((c) => c.name.toLowerCase() === draft.category.trim().toLowerCase());
    setChosenIndex(index);
    setForm({
      name: draft.name,
      price: String(draft.price),
      categoryId: matched?.id ?? '',
      newCategoryName: matched ? '' : draft.category,
      description: draft.description,
      instructions: draft.instructions,
      ingredients: draft.ingredients,
      reasoning: draft.reasoning,
    });
    setTimeout(() => nameFieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  const create = trpc.aiMenuSuggestion.createFromSuggestion.useMutation({
    onSuccess: () => {
      utils.menu.listAll.invalidate();
      utils.menu.listCategories.invalidate();
      onClose();
    },
  });

  function requestSuggestion() {
    setNoSuggestionReason(null);
    suggest.mutate({
      cuisine,
      taste,
      aroma,
      texture,
      categoryHint: categoryHint ?? undefined,
      notes: notes.trim() || undefined,
    });
  }

  function updateIngredientQty(index: number, qtyPerUnit: number) {
    setForm((f) => (f ? { ...f, ingredients: f.ingredients.map((ing, i) => (i === index ? { ...ing, qtyPerUnit } : ing)) } : f));
  }

  function approve() {
    if (!form) return;
    create.mutate({
      name: form.name,
      price: Number(form.price),
      categoryId: form.categoryId || undefined,
      newCategoryName: form.categoryId ? undefined : form.newCategoryName,
      description: form.description,
      instructions: form.instructions,
      ingredients: form.ingredients.map((ing) => ({
        existingIngredientId: ing.existingIngredientId ?? undefined,
        name: ing.name,
        unit: ing.unit,
        qtyPerUnit: ing.qtyPerUnit,
      })),
    });
  }

  function reject() {
    setCandidates(null);
    setChosenIndex(null);
    setForm(null);
    setNoSuggestionReason(null);
    suggest.reset();
    create.reset();
  }

  const formValid =
    !!form &&
    form.name.trim().length > 0 &&
    Number(form.price) > 0 &&
    (!!form.categoryId || form.newCategoryName.trim().length > 0) &&
    form.ingredients.length > 0;

  // Type/Taste/Aroma/Texture are mandatory, same as the customer-facing AI
  // suggestion chat -- Cuisine and Notes stay optional refinements on top.
  const typeSatisfied = categories.length === 0 || categoryHint !== null;
  const canSuggest = typeSatisfied && taste.length > 0 && aroma.length > 0 && texture.length > 0;

  return (
    <div className="fixed inset-0 z-50 bg-dark-ui/60 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-[520px] max-h-[85vh] bg-surface rounded-3xl overflow-hidden shadow-2xl flex flex-col">
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-border shrink-0">
          <div className="font-display text-xl text-text">Suggest a new menu item</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-lg bg-surface-input text-accent-tint flex items-center justify-center shrink-0"
          >
            ✕
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex flex-col gap-4">
          {categories.length > 0 && (
            <div>
              <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">
                Type <span className="normal-case font-semibold text-text-muted">· pick one</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {categories.map((c) => (
                  <Chip
                    key={c.id}
                    active={categoryHint === c.name}
                    disabled={!!candidates}
                    onClick={() => setCategoryHint((current) => (current === c.name ? null : c.name))}
                  >
                    {c.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">
              Taste <span className="normal-case font-semibold text-text-muted">· pick any</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {TASTE_OPTIONS.map((o) => (
                <Chip key={o} active={taste.includes(o)} disabled={!!candidates} onClick={() => setTaste((t) => toggleValue(t, o))}>
                  {o}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">
              Aroma <span className="normal-case font-semibold text-text-muted">· pick any</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {AROMA_OPTIONS.map((o) => (
                <Chip key={o} active={aroma.includes(o)} disabled={!!candidates} onClick={() => setAroma((a) => toggleValue(a, o))}>
                  {o}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">
              Texture <span className="normal-case font-semibold text-text-muted">· pick any</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {TEXTURE_OPTIONS.map((o) => (
                <Chip key={o} active={texture.includes(o)} disabled={!!candidates} onClick={() => setTexture((t) => toggleValue(t, o))}>
                  {o}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">
              Cuisine <span className="normal-case font-semibold text-text-muted">· pick any (optional)</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {CUISINE_OPTIONS.map((o) => (
                <Chip key={o} active={cuisine.includes(o)} disabled={!!candidates} onClick={() => setCuisine((c) => toggleValue(c, o))}>
                  {o}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">Notes (optional)</div>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={200}
              disabled={!!candidates}
              placeholder="e.g. something using up the chicken"
              className="w-full px-3.5 py-2.5 rounded-xl border border-border-strong bg-surface-input text-text text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            />
          </div>

          <Button
            variant="primary"
            className="w-full"
            disabled={!canSuggest || suggest.isPending || !!candidates}
            onClick={requestSuggestion}
          >
            {suggest.isPending ? 'Thinking…' : candidates ? 'Suggested' : 'Suggest'}
          </Button>
          {!canSuggest && !candidates && (
            <p className="text-text-muted text-xs font-semibold text-center -mt-2">
              Pick a type and at least one taste, aroma, and texture option before suggesting.
            </p>
          )}
          {candidates && !form && (
            <p className="text-text-muted text-xs font-semibold text-center -mt-2">
              Reject to change your picks and suggest again.
            </p>
          )}
          {form && (
            <p className="text-text-muted text-xs font-semibold text-center -mt-2">
              Pick a different suggestion above, or Reject to start over.
            </p>
          )}

          {suggest.isError && <p className="text-warning text-xs font-semibold text-center">{suggest.error.message}</p>}
          {noSuggestionReason && <p className="text-text-muted text-xs font-semibold text-center">{noSuggestionReason}</p>}

          {candidates && (
            <div
              ref={candidatesRef}
              className={`flex flex-col gap-2.5 pt-2 border-t border-border p-3 rounded-2xl transition-colors duration-1000 scroll-mt-4 ${
                justSuggested ? 'bg-success/15' : 'bg-transparent'
              }`}
            >
              <div className="text-xs font-extrabold text-text-muted-2 uppercase">
                Pick one to develop <span className="normal-case font-semibold text-text-muted">· {candidates.length} option{candidates.length === 1 ? '' : 's'}</span>
              </div>
              {candidates.map((c, i) => (
                <button
                  key={i}
                  onClick={() => chooseCandidate(c, i)}
                  className={`text-left transition-colors rounded-2xl p-3 flex flex-col gap-1 border ${
                    chosenIndex === i
                      ? 'bg-accent/10 border-accent'
                      : 'bg-surface-input hover:bg-surface-input/70 border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm text-text">{c.name}</span>
                    <span className="text-xs font-extrabold text-accent-tint shrink-0">Rp {c.price.toLocaleString('id-ID')}</span>
                  </div>
                  <div className="text-xs text-text-muted-2">{c.category}</div>
                  <div className="text-xs text-text-muted">{c.description}</div>
                  <div className="text-[11px] text-text-muted italic">{c.reasoning}</div>
                </button>
              ))}
            </div>
          )}

          {form && (
            <div className="flex flex-col gap-3 pt-2 border-t border-border p-3 rounded-2xl">
              <div ref={nameFieldRef} className="scroll-mt-4">
                <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-1">Name</div>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border-strong bg-surface-input text-text text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-1">Price</div>
                  <Input
                    value={form.price}
                    onChange={(e) => setForm((f) => (f ? { ...f, price: e.target.value } : f))}
                    type="number"
                    min="1"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border-strong bg-surface-input text-text text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                </div>
                <div className="flex-1">
                  <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-1">Category</div>
                  <Select
                    value={form.categoryId}
                    onChange={(v) => setForm((f) => (f ? { ...f, categoryId: v, newCategoryName: '' } : f))}
                    options={categories.map((c) => ({ value: c.id, label: c.name }))}
                    placeholder={form.newCategoryName || 'Select category'}
                    onAddNew={(newName) => setForm((f) => (f ? { ...f, categoryId: '', newCategoryName: newName } : f))}
                    addNewLabel="+ Use new category…"
                    addNewPlaceholder="New category name"
                    className="w-full px-3.5 py-2.5"
                  />
                </div>
              </div>

              <div>
                <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-1">Description</div>
                <textarea
                  ref={(el) => { if (el) autoGrow(el); }}
                  value={form.description}
                  onChange={(e) => { setForm((f) => (f ? { ...f, description: e.target.value } : f)); autoGrow(e.target); }}
                  rows={2}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border-strong bg-surface-input text-text text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent resize-none overflow-hidden"
                />
              </div>

              <div>
                <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-1">Instructions</div>
                <textarea
                  ref={(el) => { if (el) autoGrow(el); }}
                  value={form.instructions}
                  onChange={(e) => { setForm((f) => (f ? { ...f, instructions: e.target.value } : f)); autoGrow(e.target); }}
                  rows={3}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border-strong bg-surface-input text-text text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent resize-none overflow-hidden"
                />
              </div>

              <div>
                <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-1">Ingredients</div>
                <div className="flex flex-col gap-1.5">
                  {form.ingredients.map((ing, i) => (
                    <div key={i} className="flex items-center gap-2 bg-surface-input rounded-lg px-2.5 py-2">
                      <span className="flex-1 text-sm font-bold text-text truncate">{ing.name}</span>
                      {!ing.existingIngredientId && (
                        <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-full bg-warning/15 text-warning shrink-0">
                          New
                        </span>
                      )}
                      <Input
                        value={ing.qtyPerUnit}
                        onChange={(e) => updateIngredientQty(i, Number(e.target.value))}
                        type="number"
                        min="0"
                        step="any"
                        className="w-16 px-2 py-1 border border-border-strong rounded-md bg-surface text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      />
                      <span className="text-xs text-text-muted-2 w-10 shrink-0">{ing.unit}</span>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-text-muted text-xs italic">{form.reasoning}</p>

              <div className="flex gap-2 pt-1">
                <Button variant="warning" className="flex-1" disabled={create.isPending} onClick={reject}>
                  Reject
                </Button>
                <Button variant="success" className="flex-1" disabled={!formValid || create.isPending} onClick={approve}>
                  {create.isPending ? 'Creating…' : 'Approve'}
                </Button>
              </div>

              {create.isError && <p className="text-warning text-xs font-semibold text-center">{create.error.message}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
