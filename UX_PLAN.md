# Podblock — UX Polish Plan

How the app looks and feels. No changes to how ads are found or skipped, auth rules or the provider APIs.
The one server-side addition is a loudness envelope computed from audio the analyzer already decodes, for the
audio-reactive background (Phase 10); it adds no provider calls.

Written 2026-09-26 against branch `production-hardening` @ `cf20fa0`. Based on reading every UI file and on
screenshots of each screen (desktop 1440×900 light and dark, phone 390×844) taken from a throwaway copy
running against `scripts/fake-providers.mjs`. Revised 2026-09-27 with your answers and the
physicsofbeauty.art direction. No code was changed.

## Decisions (answered 2026-09-27)

| Q | Answer | Consequence |
|---|---|---|
| Play burst | On every play of an episode that isn't already in the player | Keep the stick animation at full length for new episodes; never run it for resume/toggle of the current one (today's behaviour, now a rule). 1.5 changes accordingly. In Phase 10 the sticks become the background field instead of vanishing. |
| Home hero | No big headline for returning listeners | 3.1 as written. |
| Full-screen player on desktop | "Find the ideal version" | Build it for both. With the audio-reactive field (Phase 10) the full-screen view is where the field is at its best, so it becomes the **Stage**: a full-window listening view on desktop and phones (1.7). |
| New API routes | No, too many calls | 3.4 (category browse) and 5.2 (type-ahead) are dropped. Categories link to the existing search instead (4.5). |
| End of episode | Auto-start | 1.11 auto-plays the next episode after a 5 s countdown you can cancel. |
| Reference site | Mimic physicsofbeauty.art; visuals in the page background, reacting to the episode audio | New Phase 10. |
| Stage look (round 2) | Copy the physics site | The Stage reproduces the reference's layout and type exactly, in Space Grotesk (10.10). It is rebuilt from scratch: the site's scripts and styles aren't licensed for reuse, so nothing is taken from its files, only the look and the techniques. Space Grotesk itself is open source (SIL OFL) and loads through `next/font/google`. |
| Interface sounds | None | No clicks, whooshes or ticks anywhere. |
| Nothing playing | A faint nature sound loop | When no episode is loaded, a quiet nature ambience plays and the faint field reacts to it (10.14). |
| Field defaults | Everywhere on desktop, Stage only on phones | As written in 10.9. |

---

## 1. Where it stands

The foundations are good and should be kept:

- **A clear visual identity.** Warm off-white ground, tone-separated white cards, Newsreader serif for titles
  over Geist, one accent color (ad orange) that always means "ad". Dark mode is a full token flip, not an afterthought.
- **The core idea is visible.** Ads are on the seek bar, in the transcript (orange rows), in an "Ad breaks" list,
  and every skip comes with an Undo.
- **Care already taken:** reduced-motion handling, a skip link, `aria-live` on the skip toast, a real slider role on
  the seek bar, media-session controls, keyboard shortcuts, memoized transcript lines, a loading skeleton.

What holds it back is mostly **finish and flow**, in four groups:

1. **The player is the product, but it's a toolbar.** A 4 px seek bar with a hidden thumb, secondary controls that
   crowd the bar, no full-screen "now playing" view on phones, nothing at the end of an episode, and a 1.2 s wait
   between pressing play and seeing the bar.
2. **Returning listeners get a first-visit page.** The home page always leads with the marketing hero, and
   "Continue listening" sits under it. There is no way to remove, mark played or reorder anything.
3. **Loose ends between screens.** The nav has no active state, error and not-found pages use a different type style,
   menus and panels vanish without an exit animation, route changes give no feedback.
4. **Phone-specific bugs and gaps.** The "15"/"30" labels fall below the skip icons, the "Ad breaks" tab wraps onto
   two lines, the scan status truncates to "10 min analyze", and there's no safe-area padding for the iOS home bar.

### Issues seen in the screenshots

| # | Screen | What's wrong | Where |
|---|---|---|---|
| V1 | Player, phone | "15" and "30" render *under* the skip icons, not inside them. `IconButton`'s default `className="grid"` is replaced by `"sm:hidden"`, so the button is no longer a grid and the absolutely positioned number has no centering box. | `Player.tsx:431,436,568` |
| V2 | Now-playing panel, phone | "Ad breaks 2" wraps onto two lines; "10 min analyzed" truncates to "10 min analyze"; the panel's tabs, status and close button compete for 358 px. | `NowPlayingPanel.tsx:25-44` |
| V3 | Transcript | The active line and a hovered line look identical (both `bg-surface-2`); with the pointer resting on the list there are two "current" rows. | `NowPlayingPanel.tsx:184` |
| V4 | Transcript | An active line inside an ad loses its "active" treatment entirely (the ad style wins), so while an ad plays you can't see where you are. | `NowPlayingPanel.tsx:185` |
| V5 | Seek bar | 4 px track, thumb hidden unless hovered; scanned windows (`bg-border` on `bg-surface-2`) are nearly invisible, especially in dark mode; a 30-second ad in an hour-long episode is under 2 px wide on a phone. | `Timeline.tsx:103-135` |
| V6 | Header | "Discover" is always bold, including on Settings, Users and podcast pages. No active state. | `(app)/layout.tsx:31` |
| V7 | Home, returning user | Hero + two big CTAs + stats come before "Continue listening"; on a phone the first recent episode starts ~650 px down, below the fold and half behind the player bar. | `(app)/page.tsx` |
| V8 | Home | "Resume Episode one: sponsored" repeats the first Continue-listening card and can be very long. | `ContinueListening.tsx:26-31` |
| V9 | Error / not-found | Sans `text-2xl font-semibold` headings; every other page uses the serif display style. | `not-found.tsx:6`, `podcast/[id]/not-found.tsx:6`, `ErrorMessage.tsx:11` |
| V10 | Volume | Native range input with `accent-color`: a different look from the seek bar, and a different look per browser. | `Player.tsx:551-559` |
| V11 | Player bar | Episode artwork is 48 px and the title truncates hard on phones ("Episode one: sponsor…"); the bar has no expanded state. | `Player.tsx:367-377` |
| V12 | Phone layout | Bottom padding is 8 px; on iPhones the bar sits on top of the home indicator. `viewport-fit=cover` isn't set, so `env(safe-area-inset-*)` is 0. | `Player.tsx:352`, `layout.tsx:15` |
| V13 | Search | Empty-results and "no query" states are fine, but there's no result count, no recent searches, no loading feedback between pressing Enter and the page changing. | `search/page.tsx`, `SearchBox.tsx` |

---

## 2. Principles for the work

These keep the polish coherent and are the yardstick for each item:

1. **Listening first.** Anything that makes it faster to get back to an episode, or clearer what the player is doing,
   beats anything decorative.
2. **Orange means ad.** Keep the one-accent rule. New states (active, selected, focus) use ink, weight and tone.
3. **One motion vocabulary.** Every surface that appears also disappears, with the same easing family.
   Durations: 120 ms (press), 180 ms (small surfaces), 260 ms (panels/sheets). Springs only for press/hover feedback.
4. **Phones are a first-class target.** Every item is checked at 390 px wide, with touch, before it's done.
5. **No regressions in accessibility.** Keyboard and screen-reader behaviour is part of each item's acceptance, not a
   later pass.
6. **Small, reviewable commits.** One item per commit, like `PRODUCTION_PLAN.md`; unit/Playwright tests where the
   behaviour is testable.

---

## 3. Work items

Effort: **S** = under an hour, **M** = a few hours, **L** = a day or more.
Priority: **P1** = obvious to every user, do first. **P2** = clearly better. **P3** = delight / nice to have.

### Phase 0 — Groundwork (do first; everything else leans on it)

| ID | P | Effort | Item |
|---|---|---|---|
| 0.1 | P1 | S | **Screenshot harness.** Commit the throwaway screenshot script as `scripts/ux-shots.mjs`: runs against the fake providers, signs up, and captures every screen at phone/desktop × light/dark into `.ux-shots/` (git-ignored). Used before/after each phase. |
| 0.2 | P1 | M | **Design tokens for motion, radius, type scale.** Add `--ease-out`, `--ease-in-out`, `--dur-press/small/panel`, a radius scale (`--r-sm 10`, `--r-md 14`, `--r-lg 22`, `--r-xl 28`) and named type sizes (`display`, `title`, `heading`, `body`, `meta`) to `globals.css` `@theme`. Today there are ~15 one-off sizes (`text-[34px]`, `text-[23px]`, `text-[15px]`, `text-[13px]`, `text-[11px]`…) and radii (`rounded-[22px]`, `rounded-[14px]`, `rounded-3xl`, `rounded-2xl`, `rounded-xl`). Replace them. No visual change intended; the screenshots should match. |
| 0.3 | P1 | M | **Shared primitives.** Extract `Button` (primary / secondary / ghost / danger, sizes sm/md/lg, `loading` prop), `IconButton` (fixing V1 by merging classes instead of replacing them), `Field`/`Input` (from `AuthForm`, reused by Settings and Admin, which currently duplicate the input class string three times) and `Pill`/`Badge`. |
| 0.4 | P2 | M | **One overlay primitive** for menus, popovers, dialogs and sheets: open/close animation, focus trap for dialogs, return focus to trigger, Escape and outside-click, `inert` background for modals, arrow-key roving focus for menus. `Popover.tsx` and `UserMenu.tsx` both hand-roll outside-click and Escape and declare `role="menu"` without menu keyboard behaviour. |
| 0.5 | P2 | S | **Exit animations.** A tiny `usePresence(open, ms)` hook so surfaces can play `*-out` keyframes before unmounting. Applied in later items to the panel, menus, toast and sheets. |

### Phase 1 — The player (the biggest win)

| ID | P | Effort | Item |
|---|---|---|---|
| 1.1 | P1 | S | **Fix V1**: skip-button numbers inside the icons on phones (via 0.3's `IconButton`). |
| 1.2 | P1 | M | **A seek bar you can see and grab.** Track 6 px (8 px on touch), thumb always visible while playing (smaller at rest, grows on hover/drag), a 32 px-tall invisible hit area. Scanned windows get a clearly different tone (e.g. `color-mix(in srgb, var(--text) 18%, transparent)`) so "how far ahead Podblock has listened" is legible in both themes (V5). Ad markers get a minimum rendered width of 3 px so short ads are still visible on phones. |
| 1.3 | P1 | M | **Scrub preview.** While hovering or dragging, the tooltip shows the time *and* the transcript line at that point (it's already in the store), and "Ad · Acme" when over an ad. On touch, show it above the thumb during a drag. Dragging across an ad snaps a haptic-like visual tick (thumb pulses) so it's obvious you're landing in one. |
| 1.4 | P1 | S | **Consistent seeking.** The bar's arrow keys step 5 s while the global arrows step 15/30 s. Make the bar match the global shortcuts (←/→ 15/30 s; Shift+←/→ 5 s for fine control) and document it. |
| 1.5 | P1 | M | **Feedback on play, without losing the burst.** The burst stays at full length and runs on every play of an episode that isn't already in the player (decision above). What changes: (a) the pressed play button turns into a spinner the moment it's clicked, so there's feedback before the sticks land; (b) when a bar is already on screen (switching episodes), the sticks rebuild it in place instead of hiding it for 1.2 s; (c) resolving the audio starts at click time, in parallel with the animation, so playback usually begins as the bar appears. In Phase 10 the sticks don't fade out: they scatter into the background field (10.7). |
| 1.6 | P1 | M | **Clear player states in the bar**, one line under the title instead of only the podcast name: *Loading…*, *Buffering…*, *Waiting for the rest of this ad break…* (the "hold" state, which today is only a spinner on the play button), *Couldn't load audio · Retry* (with a real retry button, not just red text), *Finished*. |
| 1.7 | P1 | L | **The Stage: a full-window Now Playing, on phones and desktop.** Opened by tapping/clicking the bar's artwork or title, or pressing `F`; closed by swipe-down (phones), the close button or Escape. Modelled on physicsofbeauty.art's track view: the audio-reactive field (Phase 10) fills the window; the layout, type and controls copy the reference's track view (10.10): show name vertical on the left edge, the title bar at the bottom left doubling as the progress bar with ad notches, word controls at the bottom right, CLOSE at the top right. The middle shows the **current transcript line, large**, with the previous line fading above it (click to open the full transcript as a side panel on desktop, a sheet on phones). Speed, sleep, ad-skip and volume sit in a compact row. The compact bar on phones keeps only artwork, title, play/pause and a thin progress line; it currently packs 9 controls into two rows. On desktop the compact bar stays as it is (1.8) and the Stage is optional. |
| 1.8 | P2 | M | **Tidier desktop bar.** Group the secondary controls (ad-skip, speed, sleep, transcript, volume) into a right-hand cluster with consistent 36 px targets; make the ad-skip toggle read as a switch (on: "Ad skip on · 2 found", off: "Ad skip off"), instead of "Skipping ads" / "Ads on" which are easy to misread. Bigger artwork (56 px) and a two-line title on wide screens (V11). |
| 1.9 | P2 | S | **Custom volume slider** styled like the seek bar (V10), with the scroll wheel adjusting it when hovered. |
| 1.10 | P2 | M | **Better skip toast.** Name the advertiser ("Skipped Acme · 30 sec"), a larger Undo target (≥ 32 px tall), a thin countdown line showing when it will disappear, pause the countdown on hover/focus, and an exit animation. Stack or merge consecutive skips instead of replacing. |
| 1.11 | P1 | M | **End of episode: auto-start the next one.** `onEnded` only saves the position today. Instead: mark the episode played, show "Up next: <title> in 5… · Cancel" in the bar (and on the Stage), then play the next episode from the same show (the next-newer one if you're catching up in order, otherwise the next-older one; the direction is the one you've been listening in). Cancel leaves a "Finished" state with *Replay* and "Podblock skipped 3 ads · 2 min 10 sec in this episode". The next episode comes from the show's episode list the page already loaded, or the last one seen for that show (kept with the recent list), so no extra request is needed. A setting turns auto-start off (7.3). |
| 1.12 | P2 | S | **Speed control.** Show the current speed as a pill ("1.2×"), add 0.9× and 1.1×, allow per-show speed memory ("Remember for this show" checkbox in the popover). Display "−9:07 at 1.5×" remaining time adjusted for speed (toggleable). |
| 1.13 | P2 | S | **Sleep timer.** Add "End of episode"; show the countdown in the pill (already done) and a gentle 10 s volume fade before pausing instead of a hard stop. |
| 1.14 | — | — | ~~Artwork-tinted player.~~ Dropped: the reference's strength is its strict monochrome, and orange must stay the one color (it means "ad"). The Stage gets its character from the field instead. |
| 1.15 | P3 | S | **Tab title while playing**: "▶ Episode title · Podblock", restoring the page title on pause/stop. |

### Phase 2 — Transcript and Ad breaks panel

| ID | P | Effort | Item |
|---|---|---|---|
| 2.1 | P1 | S | **Distinct active line (V3, V4).** Active line gets a left ink bar (3 px) + medium weight; hover gets a lighter tint only. Inside an ad the active line keeps the ad tint *and* the ink bar, so you can always see where you are. |
| 2.2 | P1 | S | **Phone header fix (V2).** Tabs as a segmented control that fits 358 px ("Transcript" / "Ads 2"); scan status moves under the tabs as a small line; close button stays at the top right. |
| 2.3 | P1 | M | **Ad blocks, not ad lines.** Group consecutive ad lines into one bordered block with a header row: "Ad · Acme · 0:20–0:50 · skipped" (or "will be skipped" / "playing, you chose to hear it"), collapsed by default to one line with an expand chevron. Keeps the transcript readable and makes ad handling visible. |
| 2.4 | P2 | S | **"Jump to now" that respects the listener.** Show it only when the active line is off-screen (IntersectionObserver), not on any wheel/touch; label with direction ("↓ Back to now"); auto-resume following after 10 s of no scrolling if the active line is visible again. |
| 2.5 | P2 | M | **Transcript search.** A search field in the panel header (Ctrl/Cmd+F while the panel is focused) filtering/highlighting matching lines with next/previous. |
| 2.6 | P2 | S | **Upcoming-region hint.** Below the last transcribed line, a placeholder row: "Listening ahead… (transcribed up to 10:00)" with the scanning shimmer, so the end of the transcript doesn't look like the end of the episode. |
| 2.7 | P2 | S | **Tab semantics.** `aria-controls`/`id` pairs, arrow-key switching, `role="tabpanel"`. Remember the last tab per session. |
| 2.8 | P2 | S | **Fewer tab stops.** Transcript lines are all buttons (hundreds of Tab presses to get past). Make the list one roving-tabindex group: Tab enters at the active line, ↑/↓ move, Enter seeks. |
| 2.9 | P2 | S | **Ad breaks list.** Status as a pill with an icon (Upcoming / Playing / Skipped / Heard) instead of orange text; show "why flagged" (`reason`) when it's more than the advertiser name; per-ad "Don't skip this one" toggle (uses the existing `ignored` list). |
| 2.10 | P3 | S | **Resizable panel on desktop** (drag the top edge; height remembered), and open it docked at the side on very wide screens (≥ 1536 px) so it doesn't cover the page. |
| 2.11 | P3 | S | **Scan error that explains itself.** "Ad detection paused: <raw error>" becomes a friendly sentence ("Couldn't reach the transcription service. Retrying in 30 s.") with the raw error in a `title`/details disclosure. |

### Phase 3 — Home and "Continue listening"

| ID | P | Effort | Item |
|---|---|---|---|
| 3.1 | P1 | M | **Two home layouts.** First visit (no history): the hero as today. Returning listener: no big headline (decision above); a compact greeting line ("Good evening. 14 ads skipped · 7 min saved this week") and **Continue listening first**, then Trending. The hero's "Resume …" button goes away (V7, V8). |
| 3.2 | P1 | M | **Continue listening cards that do more.** Play/pause toggles when the card is the current episode (it only plays today), shows a live progress bar, "Up next"/"New" badges, and an overflow menu: *Mark as played*, *Remove from list*, *Go to show*. On phones, a horizontal scroller of compact cards instead of a tall stack. |
| 3.3 | P2 | S | **Lifetime stats worth looking at.** Move the stats into a small card: ads skipped, time saved, "most-skipped sponsor" (from local history). Count up on first view (respecting reduced motion). |
| 3.4 | — | — | ~~Browse by category.~~ Dropped: it needed a new API route (decision above). Category chips on podcast pages link to the existing search instead (4.5). |
| 3.5 | P2 | S | **Trending error state.** "Couldn't load trending podcasts. Check your Podcast Index API keys" is shown to every user; show the key hint only to the admin (like `SetupNotice`), and give everyone a Retry button. |
| 3.6 | P3 | S | **Card polish.** Podcast cards: lift artwork on hover with a soft shadow instead of the sheen sweep; show episode count; 2-line title with consistent height so rows align. |

### Phase 4 — Podcast page and episode list

| ID | P | Effort | Item |
|---|---|---|---|
| 4.1 | P1 | S | **Primary action in the header.** "Play latest" (or "Resume <episode>" if one is in progress) as a primary button next to the artwork. |
| 4.2 | P1 | M | **Episode detail.** Clicking an episode's title currently starts playback; there's no way to read full show notes. Make the row expand (or open a sheet on phones) with the full description (links made clickable, safely), publish date, duration, season/episode number, and a play button. The round play button stays the one-tap play. |
| 4.3 | P1 | S | **Row states you can read at a glance.** Unplayed dot, in-progress ring (exists, keep), "Played" check with the title dimmed (exists as text), current episode highlighted with an equalizer-bars icon while playing. |
| 4.4 | P2 | M | **Filter and sort.** Segmented control: All / Unplayed / In progress; sort Newest / Oldest (for serialized shows). Search within episodes for long feeds. Remember the choice per show. |
| 4.5 | P3 | S | **Clickable categories** that run a normal search for the category name (`/search?q=Technology`): the same single request as typing it, no new route. |
| 4.6 | P2 | S | **Long feeds.** Render the first 30 episodes and a "Show more" button (the page fetches 100); keeps the page short and fast on phones. |
| 4.7 | P2 | S | **Mark all as played / unplayed** in a show-level overflow menu. |
| 4.8 | P3 | S | **Compact sticky header** (artwork + title + Play latest) that appears once the big header scrolls away. |

### Phase 5 — Search

| ID | P | Effort | Item |
|---|---|---|---|
| 5.1 | P1 | S | **Pending feedback.** Use `useTransition` for the push so the search icon becomes a spinner and results dim while the next page loads (V13). |
| 5.2 | — | — | ~~Type-ahead.~~ Dropped: a request per few keystrokes is the kind of API use you want to avoid (decision above). 5.1 and 5.3 cover most of the benefit. |
| 5.3 | P2 | S | **Recent searches** (localStorage, per user) shown when the box is focused and empty, with a clear button. |
| 5.4 | P2 | S | **Results header.** "12 shows for "history"" with the count; the muted "Results for" reads as disabled at 48 px. |
| 5.5 | P3 | S | **Empty search page** shows recent searches (5.3) as chips under the big box. |

### Phase 6 — Navigation, layout and cross-cutting feel

| ID | P | Effort | Item |
|---|---|---|---|
| 6.1 | P1 | S | **Active nav state (V6).** `usePathname` to mark Discover/Users active (`aria-current="page"`, ink weight + underline dot); the rest muted. |
| 6.2 | P1 | S | **Safe areas (V12).** `viewportFit: "cover"` in `viewport`; player wrapper uses `pb-[max(0.5rem,env(safe-area-inset-bottom))]`; main content's bottom padding follows the real bar height (CSS variable set by a ResizeObserver) rather than a fixed `pb-48`, so the last item is never hidden or followed by a large gap. |
| 6.3 | P1 | S | **Consistent error and not-found pages (V9).** Serif display headings, the logo mark or a small illustration, and two actions (Back / Home). The podcast not-found also offers a search for the id's title if known. |
| 6.4 | P2 | S | **Route-change progress.** A thin top progress line during navigations (App Router `useLinkStatus` / transition), since server pages (podcast, search) can take a moment. |
| 6.5 | P2 | S | **Theme choice.** System / Light / Dark in Settings and the account menu, stored per browser; `themeColor` follows it. Tokens already exist, so this is a `data-theme` attribute and a duplicate of the dark block. Avoid a flash by setting the attribute in a tiny inline script before paint. |
| 6.6 | P2 | M | **Tone down hover motion.** The infinite "breathe" on hover draws the eye to whatever the pointer happens to rest on (every button uses it). Keep the spring on press and a single settle on hover; drop the infinite loop. Replace the sheen sweep on rows/cards with a plain tint change, which reads calmer on long lists. |
| 6.7 | P2 | S | **Keyboard shortcut sheet.** `?` opens a dialog listing shortcuts (Space/K, J/L, ←/→, M, T, S, /). Mention it in the account menu. |
| 6.8 | P2 | S | **Focus styles.** The focus ring is `--accent` (ink) at 2 px, which disappears on ink buttons. Use a two-tone ring (`outline` + `box-shadow` in `--bg`) so it's visible on every surface. |
| 6.9 | P2 | S | **Toasts for background actions** (reuse the skip-toast style): "Marked as played · Undo", "Removed from Continue listening · Undo", "Password changed". One `useToast` for the app. |
| 6.10 | P3 | S | **Scroll restoration** when going back from a podcast page to search results or home (check what Next 16 does by default; fix only if it jumps). |
| 6.11 | P3 | S | **Phone nav.** Logo + search + avatar is fine; add "Discover" and "Search" as a bottom-sheet in the avatar menu only if 3.x makes home harder to reach. Revisit after Phase 3 rather than build now. |

### Phase 7 — Account, sign-in, settings, admin

| ID | P | Effort | Item |
|---|---|---|---|
| 7.1 | P1 | S | **Password fields.** Show/hide toggle, Caps Lock warning, and on sign-in a "Forgot your password? Ask the person who runs this server to reset it." line (there's no email reset, so say so instead of leaving people stuck). |
| 7.2 | P1 | S | **Pending page polls.** Check approval every 20 s while the tab is visible and move on automatically; keep "Check again". Add "We'll let you in as soon as <admin name> approves you." |
| 7.3 | P2 | M | **Settings with sections.** Account (as today); **Playback** (default speed, skip back/forward intervals 10/15/30 · 15/30/45/60, auto-skip on by default, remember speed per show, auto-start the next episode on/off); **Appearance** (theme from 6.5, background field Off / Stage only / Everywhere from 10.9, nature ambience sound and volume from 10.14); **Your data** (listening history count, "Clear listening history", "Reset stats"). All stored in the existing per-user localStorage store. |
| 7.4 | P2 | S | **Admin: a real confirm dialog** instead of `window.confirm` (`AdminPanel.tsx:21`), using 0.4. Show pending users in their own section at the top, with Approve as a primary button. |
| 7.5 | P2 | S | **Admin: usage at a glance.** The Users page already has usage per person; show it as small bars (minutes transcribed this month) so the heavy users stand out. |
| 7.6 | P3 | S | **Sign-up form.** Inline validation (password length as you type, email format on blur); name the admin in the pending copy. |

### Phase 8 — Install and system integration

| ID | P | Effort | Item |
|---|---|---|---|
| 8.1 | P2 | S | **Installable app.** `app/manifest.ts` (name, icons, `display: "standalone"`, theme/background colors), `apple-icon.png`, maskable icon. On a phone, "Add to Home Screen" then feels like an app, and the player bar isn't under browser chrome. *Metadata files only; no service worker.* |
| 8.2 | P2 | S | **Media session artwork sizes.** Provide 96/192/512 entries (same URL is fine) and `setPositionState` on time updates so the lock-screen scrubber is accurate; add `previoustrack`/`nexttrack` mapped to −15/+30 (many headphones only send those). |
| 8.3 | P3 | S | **Open Graph image** for podcast pages (artwork + title), so shared links look right. |

### Phase 9 — Accessibility pass (runs alongside, finishes here)

| ID | P | Effort | Item |
|---|---|---|---|
| 9.1 | P1 | S | **Contrast audit** of `--faint` on `--surface-2`, `--ad-text` on `--ad-soft`, the scanned-window tone, and all dark-mode pairs (script with a WCAG checker over the token pairs actually used). Fix below 4.5:1 for text, 3:1 for UI parts. |
| 9.2 | P1 | S | **Target sizes.** Every tap target ≥ 44 × 44 px on touch (several icon buttons are 32–36 px: popover triggers, panel close, clear-search). |
| 9.3 | P2 | S | **Announcements.** Live region for player state changes ("Paused", "Skipped Acme ad, 30 seconds"), not only the toast; `aria-busy` on lists while loading. |
| 9.4 | P2 | S | **Reduced motion** check for everything new (sheet, toasts, progress line, count-ups). |
| 9.5 | P2 | S | **Axe in Playwright.** Add `@axe-core/playwright` checks to the E2E journeys (home, podcast, playing with panel open) so regressions fail CI. *New dev dependency; justification: catches the class of issues above automatically.* |

### Phase 10 — The Field: an audio-reactive background, after physicsofbeauty.art

#### What the reference actually does

I pulled the site apart (HTML, CSS, `script.js`, `shapes.js`, `timelines.js`, the per-track JSON) and recorded it
playing. The points that matter for copying it:

- **One full-window canvas** (paper.js) drawn **on top of the page** with `mix-blend-mode: difference` over a
  `#efefef` ground. Strokes invert whatever they cross, so black text turns light where a line passes through it.
  That inversion is most of its look.
- **Four drawing "principles"**, each a few hundred lines of maths, not assets:
  - *matrix*: a grid of short strokes that rotate and drift, like iron filings in a field ("strange attractor");
  - *circles*: concentric rings that grow by a power law from the center and drift toward the pointer ("ghostsss", "sudoka");
  - *lines*: loose sticks oscillating or chained end to end;
  - *connections*: links between neighbouring sticks that blink on and off ("RFBongos").
- **Every track has its own settings** (stroke weight, speed, counts, angle, blend mode), with random ranges, so each
  track looks like itself but never the same twice.
- **"Reacting to the music" is choreography, not listening.** There is no Web Audio code at all: no analyser, no FFT.
  `timelines.js` holds hand-written cues ("at 0:11 set stroke width to 150", "at 1:00 speed up") timed to each track.
  The pointer steers the drawing, and if you leave it alone for 10 s the site moves the "pointer" itself.
- **No sound effects.** The only audio is the music. "The sound effects" are really these sound-driven drawings,
  and that's what this phase builds.
- **The type and motion around it:** Space Grotesk in uppercase; the title and controls sit on solid black bars;
  controls are words ("PREV | PLAY | NEXT", "CLOSE"); text appears by a solid block wiping across it and leaving the
  letters behind (1 s); list items reveal 100 ms apart; changing track dissolves the drawing over about a second.

Podblock can go further than the reference: it can make the drawing **really follow the episode's audio**, and it
knows things the reference doesn't: where the speech is, where the ads are, and when it's skipping.

#### Where the audio signal comes from (the deciding constraint)

The obvious approach, a Web Audio `AnalyserNode` on the `<audio>` element, doesn't work for a podcast player:

- **CORS.** The browser only lets the page read audio samples if the host allows cross-origin reads. I tested the
  audio of 18 real feeds: Megaphone, Buzzsprout, Transistor, Blubrry, `content.libsyn.com` and Omny/Triton allow it;
  **Simplecast (NYT, NPR and many others), Libsyn's `delivery-edge` CDN and the BBC don't.** On those the analyser
  reads silence, and setting `crossOrigin` on the element would stop them *playing* at all.
- **iOS.** Once an element is routed through an `AudioContext`, iOS Safari can stop the audio when the screen locks
  or the tab is in the background. A podcast player can't risk that.

So the plan is to **measure the loudness on the server, where the audio is already decoded.** `analyzeWindow`
already has each 5-minute window as 16 kHz mono audio (`audio.ts`, ffmpeg). Computing a small envelope from it costs
milliseconds, makes **no provider calls and no extra requests** (it rides on the `/api/analyze` responses the player
already makes), and works for every host and on iOS. The player keeps the current window and the next one analyzed,
so the envelope is always ready where you're listening.

#### Work items

| ID | P | Effort | Item |
|---|---|---|---|
| 10.1 | P1 | M | **Loudness envelope on the server.** In `analyzeWindow`, after ffmpeg produces the window's audio, decode it to PCM (a second, local ffmpeg pass over the buffer already in memory, or a second output of the same pass) and compute, per 50 ms frame: **level** (RMS in dB, −60…0 dBFS scaled to 0–255), **low** (energy under ~250 Hz: voice body and music bass), **high** (energy over ~2 kHz: sibilance and brightness) and **onset** (a jump in energy: a new phrase or a stressed syllable). That's 6,000 frames × 3 bytes ≈ 18 KB per window (≈ 24 KB base64). Store it in a new `analysis_window.envelope` column (schema migration 3, same pattern as `migrations.ts`) and include it in the POST and GET `/api/analyze` responses (`AnalyzeResponse`, `CachedAnalysis`). Windows cached before this ship without one (they expire within 30 days), and the client falls back (10.2). Unit tests with generated fixtures: silence, a tone, a tone burst (onset), noise (high band). |
| 10.2 | P1 | M | **The signal (`lib/field/signal.ts`).** One function, called every animation frame, returns `{ level, low, high, onset, speaking, inAd, skipping, paused }` for the exact playback position: `audio.currentTime` interpolated between `timeupdate` events with `performance.now()` and the playback rate, then smoothed (fast attack ~30 ms, slow release ~250 ms) so strokes move like a VU meter, not a strobe. Sources in order: **the envelope**; else **the transcript** (inside a segment = speaking, with energy from words per second; gaps = silence); else **idle breathing** (a slow sine). Paused: everything eases to rest over 1.5 s but keeps drifting slowly, never frozen dead. Pure and unit-tested. |
| 10.3 | P1 | M | **Renderer (`components/field/Field.tsx`).** One fixed full-window `<canvas>`, Canvas 2D, with its own `requestAnimationFrame` loop outside React: it reads the stores with `getState()` and never sets React state per frame (the same discipline as the transcript's memoized lines). Device pixel ratio capped at 2 (1.5 on phones); resizes with a `ResizeObserver`; stops when the tab is hidden, the field is off, or reduced motion is on. Strokes are batched into a few paths per frame by weight. Budget: ≤ 4 ms of main-thread time per frame; about 1,500 strokes on desktop, 500 on phones. **No paper.js** (≈ 230 KB): only lines and circles are needed. |
| 10.4 | P1 | L | **Four principles, ported and made to listen.** Each is a module with `create(seed, size)` and `step(state, signal, dt)`. **Grain** (the "strange attractor" grid): short strokes follow a slowly turning flow field; *level* sets stroke length and weight, *high* adds jitter, the pointer bends the field around it. **Rings**: each *onset* sends out a ring from a center point, rings grow by the reference's power law, stroke width follows *level*, the center drifts toward the pointer. **Ledger** (from "leerstelle"): columns of horizontal dashes scrolling upward, each new dash as heavy as the current *level*, so the page shows the last minute of speech as a script; a long pause starts a new column. The most podcast-like of the four. **Sticks**: loose sticks swaying with *low*, joined by links that blink on *onsets* (the reference's "intermittence"). |
| 10.5 | P1 | S | **Each show looks like itself.** The principle and its settings are picked from the podcast id with a seeded random generator, within tuned ranges (the reference's per-track JSON, generated instead of hand-written). The episode id varies the seed a little, so episodes of one show are related but not identical. |
| 10.6 | P1 | M | **Cues from the episode (the reference's timelines, generated).** Podblock knows the content, so the choreography writes itself: **approaching an ad**, the field slows over 3 s; **inside an ad you're hearing** (skip off, or after Undo) strokes turn ad-orange, the only color; **a skip** makes everything streak along its direction for ~400 ms and snap to the post-ad state, with the skip toast appearing out of that motion; **silence** over 1.5 s lets the field settle, and speech coming back fires an onset; **pause** freezes the field into a still print, **play** releases it; **a seek** sends a ripple out from the seek bar's position; **a new episode** dissolves the old drawing over ~1 s (the reference's track change) and builds the new show's principle. |
| 10.7 | P2 | M | **Burst → field handoff.** Today the play burst's sticks build a scaffold of the player bar and fade out. Instead, once the bar appears, they peel off and settle into the field's first frame. One canvas and one loop for both (fold `PlayBurst.tsx` into the field renderer), so pressing play visibly starts the background. Runs whenever the burst runs (decision above). |
| 10.8 | P1 | M | **Layering: loud on the Stage, quiet everywhere else.** **On the Stage** (1.7) the field runs at full strength above the Stage's ground with `mix-blend-mode: difference`, exactly like the reference: strokes invert the ink title bars and the large transcript line as they cross them. Artwork is either hidden there or sits in a solid box, so no photos get inverted. **On other pages while something plays**, the canvas sits *behind* the content at low contrast (strokes at ~12–20 % ink) and shows only in the page ground; cards stay opaque, so text is never drawn over strokes, and the header's existing blur softens it. **Nothing playing:** the field stays on, faint, driven by the nature ambience (10.14). **Dark mode** is the reference's inverted version: light strokes on near-black. |
| 10.9 | P1 | S | **Controls.** Settings (7.3): Background *Off / Stage only / Everywhere*, plus an intensity slider. Defaults: *Everywhere* on desktop, *Stage only* on phones (battery). `V` toggles it. With `prefers-reduced-motion` the field doesn't animate: it shows a still drawing of the current principle that crossfades to a new one every ~10 s. On touch there's no pointer to follow, so a tap sends out a ripple instead, and the drawing wanders on its own like the reference does after 10 s idle. Frame rate capped at 30 fps in *Everywhere* mode and 60 on the Stage. |
| 10.10 | P1 | M | **The Stage copies the reference.** Layout: the show name set **vertically along the left edge** (rotated −90°, like the reference's album title; click it to go to the show); **CLOSE** in words at the top right; the **title bar at the bottom left doubles as the progress bar**, as on the reference: a solid ink fill grows behind the uppercase title as the episode plays, with remaining time beside it, ad breaks as orange notches under the bar and the scanned-ahead range as a faint line, and clicking or dragging the bar seeks; **controls as words at the bottom right**, "−15 \| PLAY \| +30", then a **VOLUME** word whose ink fill is the level, as on the reference. Type: **Space Grotesk**, uppercase, the reference's sizes (≈30 px desktop, ≈20 px phone). Keyboard as on the reference: Space play/pause, ←/→ seek, Escape closes. Motion: **block-wipe reveal**, a solid block sweeps across and leaves the text behind (1 s; the colour flips at the midpoint), for the title on every episode change and each transcript line as it arrives; exits run it in reverse; staggered 100 ms when several appear at once; instant with reduced motion. **Line-through on hover** for text links. Outside the Stage, the browse pages keep Newsreader and the warm palette, and borrow only the block-wipe for page headings and Continue-listening titles. |
| 10.11 | P2 | S | **Performance and battery checks.** Chrome performance traces at 1440p and on a phone profile (4× CPU throttle): under 4 ms of main-thread time per frame, no long tasks, no layout thrash; the loop provably stops when the tab is hidden and when the field is off. A small in-dev FPS/time overlay behind a query flag. |
| 10.12 | P2 | M | **Tests.** Server: envelope values for the generated fixtures (10.1). Client: signal interpolation, smoothing, fallback order and pause decay (10.2); seeded principles produce identical frames for the same seed and signal. Playwright: the Stage with the field on, against the fake providers (their fixture episode has sponsor reads at 0:20 and 5:20, so the ad cue and skip streak can be exercised), with a pixel-diff tolerance, plus a check that no canvas runs with the field off or reduced motion on. Ambience (10.14): starts only after a first interaction, fades out when an episode starts, stays off after being muted, and never plays while an episode is loaded. |
| 10.13 | P3 | M | **Optional live spectrum, later.** `/api/resolve` already fetches the audio URL; it can record whether the final host sends `Access-Control-Allow-Origin` at no extra cost. When it does, and the browser isn't iOS Safari, the player could set `crossOrigin="anonymous"` and add an `AnalyserNode` for a 32-band spectrum at full frame rate, feeding the same signal (10.2). Only worth it if the 50 ms envelope feels too coarse on the Stage; everything above works without it. |
| 10.14 | P1 | M | **Nature ambience when nothing is playing.** **Generated in the browser with Web Audio**, not recordings: filtered noise and a few oscillators make convincing rain, wind, a stream, surf and a night chorus, with nothing to license or download, and because the page makes the sound itself the field can read it directly through an `AnalyserNode` (no CORS issue, since it's not a podcast host's audio). Each sound pairs with a principle: **rain → Rings** (every drop sends out a ring), **wind → Grain**, **stream → Ledger**, **surf → Sticks**; the night chorus goes with whichever principle the last show used. **Faint:** around 10 % volume by default, with its own level control, independent of episode volume. **When it plays:** only while no episode is loaded (on first visit, after closing the player, or after the auto-start countdown is cancelled). A paused episode means you want quiet, so pausing doesn't start it. It **fades out over 1.5 s the moment an episode starts** and fades back in 3 s after the player closes. **Browser rules:** audio can't start before the first click or tap on the page, so it begins on that first interaction; a small "AMBIENCE ON/OFF" word in the corner (in the reference's style) mutes it and remembers the choice. **Phones:** Safari's audio-session API is set to `ambient` where available, so it mixes with other apps' audio instead of stopping it, respects the silent switch and never takes over the lock screen; where that API isn't available it stays off unless turned on. **No interface sounds:** the ambience is the only sound Podblock makes besides episodes. Settings (7.3): sound (Rain / Wind / Stream / Surf / Night / Off) and volume. |

---

## 4. Suggested order

1. **Phase 0** (0.1–0.3) — harness, tokens, primitives. ~1 day. Makes everything else faster and consistent.
2. **Quick P1 fixes** that are visible to every user and small: 1.1, 1.4, 2.1, 2.2, 6.1, 6.2, 6.3, 7.1, 9.2. ~1 day.
3. **Player core**: 1.2, 1.3, 1.5, 1.6, 1.11 (auto-start next). ~3 days.
4. **Field, part 1**: 10.1 (envelope), 10.2 (signal), 10.3 (renderer) with one principle (Grain), shown behind the
   pages (10.8, quiet mode) and with 10.9's controls. ~3–4 days. This is the first point where you can *see* it
   react to an episode; worth a check-in before going further.
5. **The Stage + field, part 2**: 1.7 with the difference-blend layer (10.8), the other three principles (10.4),
   per-show seeding (10.5), content cues (10.6), burst handoff (10.7), type and motion (10.10). ~5–6 days.
6. **Home for returning listeners**: 3.1, 3.2. ~1 day.
7. **Transcript**: 2.3, 2.4, 2.6–2.9. ~1–2 days.
8. **Podcast page**: 4.1–4.4. ~1–2 days.
9. **Overlay primitive + motion** (0.4, 0.5, 6.6, 1.10) and toasts (6.9). ~1 day.
10. **Settings, search, remaining P2s**, performance and test passes for the field (10.11, 10.12), then P3s.

Roughly **four to five weeks** for all P1 and P2 items, about half of it the Field and the Stage; P3 items are
independent and can be picked off later.

## 5. How each item is checked

- **Before/after screenshots** from 0.1 at 390 px and 1440 px, light and dark, attached to the commit or PR.
- **Keyboard walk-through** of the changed screen (Tab order, Escape, arrows) and a VoiceOver/TalkBack spot check for
  the player, panel and sheets.
- **Tests:** component tests (Vitest + Testing Library, as in `Player.test.tsx` / `NowPlayingPanel.test.tsx`) for
  new states and keyboard behaviour; the three Playwright journeys stay green, plus new ones for the Stage,
  end-of-episode auto-start and Continue-listening actions.
- **Performance guard:** the transcript still re-renders only changed lines (keep the `memo` + active-index
  selector), and no new per-tick state updates outside the playback store. The field's frame loop never touches
  React state (10.3, 10.11).
- **Watch it with real episodes**, not just the fixture: a talk show, an interview, a music-heavy show and one from
  a host without CORS (e.g. Simplecast), to make sure the field reads well on all of them.

## 6. Out of scope

- Subscriptions / a library of followed shows, a play queue, downloads/offline playback, cross-device sync of
  history (history is per browser by design today). These are features with server work; worth a separate plan if
  wanted. Items above (3.2 "Up next", 1.11 "Play next episode") are deliberately limited to the same show and
  local state.
- Any change to how ads are detected or skipped (timing, thresholds, hold logic).
- A wholesale restyle of the browse pages to the reference's look. The Stage adopts it fully (Phase 10); the rest of
  the app keeps its warm palette and Newsreader titles, and borrows only the motion and ink text bars.

## 7. Open questions

None outstanding. Every question so far is answered in *Decisions* at the top.
