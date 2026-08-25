# POS App — v2 Customer AI Integration Design

**Date**: 2026-08-25
**Status**: Approved (design), pending implementation plan
**Depends on**: v1 (`prd/v1_basic_app.md`) — this extends the QR customer order page (`/order/[tableToken]`); no changes to staff POS, KDS, or inventory.

## Overview

An AI-powered menu suggestion feature for the customer-facing QR order page. A chat panel, hidden by default, lets a customer select preferences (taste, aroma, texture, food/beverage type, plus free-text notes) in one screen and get back AI-suggested menu items with a reason each, addable to their cart directly from the panel. First AI/LLM integration in the codebase.

## Scope (v2)

**In scope:**
- A floating chat-panel toggle on `/order/[tableToken]`, available in both One-time Order and Open Table modes
- Single-screen preference capture: tappable multi-select chips (taste profile, aroma, texture, food/beverage type) plus one optional free-text field
- One OpenAI API call per suggestion request, given the structured preferences + the current available menu, returning N recommended items with a one-line reason each
- Suggestion cards rendered in the panel, each with "Add to cart" wired into the existing cart state
- Rate-limiting/abuse guard on the suggestion endpoint (public, unauthenticated, hits a paid API)

**Out of scope (v2):**
- Any use of this feature from the staff POS or KDS surfaces
- Multi-turn/free-form conversational AI (this is one-shot: submit preferences once, get suggestions once; "Get suggestions" can be tapped again with changed chips for a new call)
- Persisting chat history, preferences, or suggestions anywhere (fully ephemeral, client-side only, cleared when the panel closes)
- Remembering preferences across visits or across an Open Table session's multiple rounds
- Any admin UI for AI configuration (API key/model are env vars, like the existing S3/Ably config)
- Streaming responses (a single suggestion call is short enough for a normal request/response)

## Architecture

- **New tRPC router**: `aiSuggestion`, one `publicProcedure` mutation — `getSuggestion({ tableToken, preferences })`. Server-side only; the OpenAI API key never reaches the browser.
- **Prompt construction**: server takes the structured preference selections + optional free-text note, and the current `menu.listAvailable` result (id, name, category, price, short description) — the same available-only set customers already order from. Nothing unavailable is ever eligible for suggestion.
- **OpenAI call**: one call per request (no multi-turn), using structured output (JSON mode/function-calling) so the model returns `{ menuItemId, reason }[]` directly rather than prose that needs parsing. Model instructed to always return its best-effort N suggestions from what's available — never a refusal or empty response.
- **Response validation**: server maps returned `menuItemId`s back to real, currently-available menu items; any id that doesn't resolve (hallucinated, or went unavailable between the menu snapshot and the response) is silently dropped rather than surfaced to the customer.
- **Abuse/cost guard**: a per-table-token cooldown in Redis (reusing the existing Redis instance) — e.g. one suggestion request per 30 seconds per table token — plus a hard cap on preferences payload size (chip selections are a fixed small set; free-text note capped to a short max length). Exceeding the cooldown returns a distinct "try again shortly" error rather than a generic failure.
- **Config**: `OPENAI_API_KEY` and model name as env vars, following the existing `S3_*`/Ably config pattern — no admin UI in v2.
- **No customer PII**: the QR flow has no login and collects no identity — nothing personal is ever included in the prompt, only the anonymous preference selections and the menu.

## Data Model

No new persisted tables. Preferences, chat panel state, and suggestions live entirely in client component state for the duration of the panel being open — nothing is written to Postgres. The only server-side state touched is the Redis cooldown key (`ai-suggest-cooldown:<tableToken>`, short TTL).

## UX Flow

1. Customer opens `/order/[tableToken]` as usual (mode choice, then menu). A floating chat-panel button sits alongside the existing mobile cart button, collapsed/hidden by default.
2. Tapping it opens the panel as an overlay (same modal style as the cart-review and finish-table modals) directly over the menu — not a separate route.
3. Panel shows chip groups for taste profile, aroma, texture, and food/beverage type (multi-select, tap to toggle) and one optional free-text field below ("no nuts", "something warm today"). No step/wizard navigation — everything is visible and selectable on one screen.
4. Customer taps "Get suggestions" → `aiSuggestion.getSuggestion` call → panel shows a loading state, then renders suggestion cards (photo, name, price, one-line AI reason) reusing the existing menu-card look.
5. Each card has "Add to cart" — tapping it validates availability server-side (same check every order path already uses via `buildOrderItems`) and adds it to the same cart state the menu grid uses, so it's immediately reflected in the cart bar/review modal.
6. Customer can close the panel and keep browsing/ordering normally, or adjust chips and tap "Get suggestions" again for a new set.
7. Closing the panel clears all chip/free-text state — reopening starts fresh, matching the fully-ephemeral, no-persistence design.

## Error Handling & Edge Cases

- **OpenAI call fails or times out**: inline error in the panel ("Couldn't get suggestions, try again") with a retry button; chip/free-text selections are preserved, nothing is lost, and ordering elsewhere on the page is never blocked by this feature failing.
- **Cooldown exceeded**: distinct "try again in a moment" message, not a generic error.
- **Suggested item went unavailable before Add to cart**: re-validated server-side at add time; that specific card shows an inline "no longer available" state instead of silently adding a stale item.
- **Menu has very few/no available items**: model is instructed to still return its best-effort suggestions from whatever is available rather than refusing; an empty available-menu edge case (no items at all) simply skips the AI call and shows "nothing available to suggest right now."
- **Malformed/unparseable AI response**: treated the same as a call failure (inline retry state) — never passed through to the customer as raw/broken output.

## Testing

- **Unit**: prompt-building function (preferences + menu → prompt payload), response-parsing/validation (AI JSON → real menu items, invalid/hallucinated `menuItemId`s dropped, unavailable items filtered). The OpenAI call itself is mocked — no real API calls in the automated test suite.
- **Unit**: Redis cooldown check (allows first request, blocks a second within the window, allows again after TTL).
- **Manual**: full chip-select → suggest → add-to-cart flow on a real mobile viewport, in both One-time Order and Open Table modes; retry behavior on a simulated API failure.
