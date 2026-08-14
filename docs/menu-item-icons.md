# Menu Item Icons

How every menu item gets a visual: a real photo when one exists, otherwise a generated icon based on its category. This is the reference for the pattern implemented in `src/components/ui/CategoryIcon.tsx` and `src/components/ui/MenuItemThumbnail.tsx`.

## How it works

`MenuItemThumbnail` is the single place that decides between a real image and a generated icon:

- `item.image` set (non-empty string) → renders `<img src={item.image}>`.
- `item.image` unset → renders `CategoryIcon` for the item's category.

Every page that lists menu items (`/pos`, `/order/[tableToken]`, `/admin/menu`) renders `MenuItemThumbnail`, never `CategoryIcon` or a raw `<img>` directly, so the fallback logic only exists in one place.

## Category → icon → color map

| Category | Icon | Gradient |
|---|---|---|
| Coffee | Mug with steam | `#efe3d6` → `#e4d3c0` |
| Tea | Teapot | `#e4ece1` → `#d3e0cf` |
| Food | Plate | `#f0e2cf` → `#e6d2b6` |
| Pastry | Croissant crescent | `#f2e6dc` → `#ead4c2` |
| Snacks | Fries basket | `#eee0d6` → `#e2ccbe` |
| *(unmapped)* | Generic dot | `#f3ede3` → `#e9e0d2` (neutral fallback) |

Gradients run `135deg`, from → to, applied as the background of a centered flex box that holds the icon.

## Icon style rules

- Inline SVG, `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={1.5}`, `strokeLinecap="round"`, `strokeLinejoin="round"`.
- Icon color is `text-text-muted-2` (inherits via `currentColor`) regardless of category — only the background gradient changes per category.
- Icons are simple 1-3 path line drawings — no fills, no photographic detail, no per-item variation. One icon per category, not per item.

## Sizing per surface

`CategoryIcon`/`MenuItemThumbnail` take a `className` for sizing — the box and the fallback `<img>` both size from it, so real photos and generated icons occupy identical space:

| Surface | Size classes |
|---|---|
| `/pos` item grid | `w-full h-20 rounded-xl` |
| `/order/[tableToken]` item list | `w-16 h-16 rounded-xl shrink-0` |
| `/admin/menu` item rows | `w-10 h-10 rounded-lg shrink-0` |

The inner SVG stays a fixed `w-6 h-6` at every size — on larger tiles it reads as a centered badge icon, not a stretched illustration.

## Adding a 6th category

1. Pick the next tint pair from the existing palette family (warm neutral, 2 hex values, `135deg` gradient — stay within roughly `#e0`-`#f3` lightness to match the existing set).
2. Add a `<NameIcon>` function following the same SVG prop pattern (viewBox, stroke, no fill) — keep it to 1-3 simple paths.
3. Add one row each to `CATEGORY_STYLES` and `CATEGORY_ICONS` in `src/components/ui/CategoryIcon.tsx`, keyed by the exact `Category.name` string used in the database.
4. Add a row to the table above.

No changes are needed anywhere else — `MenuItemThumbnail` and every page consuming it pick up the new category automatically.

## Adding a real photo to an item

Set `MenuItem.image` to an image URL — via the admin "Image URL" field on `/admin/menu`, or directly via `menu.updateItem`. Once set, `MenuItemThumbnail` shows it in place of the generated icon everywhere the item is listed. No code change required.
