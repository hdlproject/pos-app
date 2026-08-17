// Strips diacritics (é, è, ñ, etc.) so search matches regardless of accents --
// "caffe" should find "Caffè Latte" even without the grave accent typed.
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
