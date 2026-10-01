# Framify Floating Text - design record (2026-09-27)

## Goal

Tasteful, editorial decorative words for Elementor Containers and legacy Sections: lines from a list appear one at a time in quiet, non-overlapping spots, hold and leave. Decorative words must feel intentional and never compete with the real content.

## Approved architecture

- New module `framify-elementor-text.php` (`Framify_Elementor_Text`), loaded from `framify.php` after the Floating Shapes require (same `file_exists` guard). Inert without Elementor / `Framify_Elementor`.
- Hooks: `elementor/element/{container,section}/_section_responsive/after_section_end`, priority 30, so section `framify_ft_section` ("Floating Text", tab `framify`) follows Floating Shapes.
- Assets `assets/framify-text.js` / `.css` on `elementor/frontend/after_enqueue_scripts`, filemtime versions, both depending on the `framify-shapes` handles. Handler `FramifyFloatingText` on `container` and `section`, null skin.

## Controls (prefix `framify_ft_`, all live except Typography)

enable (off); words (TEXTAREA, 6 rows, AI off); layer background|overlay; area full|left|right + area_width 10-90% (35); count responsive 1-20 (5); typography group (selector `{{WRAPPER}} > .framify-ft .framify-ft__word`, 28px / 600, tablet 24, mobile 20); size_var 0-60% (25); style solid|outline|mix (solid) + stroke 0.5-4 px (1, not for solid); color_mode palette|random, color_1..5 (#F69216, #263238, empty x3, Global Colour disabled), saturation 70 / lightness 60; opacity 0.1-1 (0.35); tilt none|slight|vertical (none); animation random + 10 (fade); direction up|down|left|right|random (drift and random only); hold 0.5-10 s (2.5); speed slow|normal|fast|custom (1.8 / 1.2 / 0.7 s) + duration responsive 0.3-10 s (1.2, custom only); gap 0-5 s (0.6).

## Decisions

1. **Shared helper instead of copy-paste.** framify-shapes.js now publishes `window.FramifyFx` (settings readers, palette/random colour, responsive reader, host claim, layer insertion, visibility observer, editor mixin). Floating Shapes was refactored onto the same helpers with unchanged behaviour; Floating Text depends on the shapes handle. Host setup became reference-counted so either layer can be removed without stripping the other's positioning context.
2. **Stacking with Floating Shapes.** Background: both layers z-index 0; text is inserted after the shapes layer, so it paints above shapes by tree order while staying under widgets (a z-index of 1 would lift it over the content). Overlay: text 6, shapes 5.
3. **Never the same line twice at once**, as the control description promises: with fewer free lines than slots, a slot waits rather than repeating. Recently shown lines are avoided when possible.
4. **Motion via the Web Animations API** plus a pausable timer list, so off-screen pause freezes everything mid-flight and resumes exactly. `will-change` only during IN / OUT.
5. **Placement:** measured unseen after `document.fonts.ready`; the word box is then fixed in px; rotated bounding box (stretched along the drift path for Drift) is rejection-sampled up to 12 times inside the band, clear of visible words plus a margin; no spot = retry later.
6. (Superseded by 20-21: MIN/MAX range.) **Size variation in em** on an inner span, so Typography stays pure CSS and edits apply live without a rebuild; the editor sync ignores `framify_ft_typography*` keys.
7. **Tilt "vertical"** turns about half the words -90 degrees (labelled "Some vertical"); "slight" is 2-6 degrees either way.
8. **Outline** = `-webkit-text-fill-color: transparent` + `-webkit-text-stroke` in the word colour, only when `CSS.supports` confirms it; otherwise solid.
9. **Reduced motion:** fade only, no letter effects, hold x1.6; a `matchMedia` change rebuilds.
10. **Security:** words only via `textContent` (letters via `createElement`), colours via style properties, no `innerHTML` (the CLI test checks).
11. **Tuning after the visual pass:** default font size 32px -> 28px (tablet 26 -> 24, mobile 22 -> 20) so the words stay below typical H2 sizes; opacity 0.35, count 5 and hold 2.5 s kept.
12. Typography selector scoped to the element's own layer (`{{WRAPPER}} > .framify-ft ...`) instead of `{{WRAPPER}} .framify-ft__word`, so a nested container's Floating Text keeps its own typography.

## Verification

CLI test section 5b (`dev/tests/elementor-shapes-test.php`): ids/prefix, tab, live flags, defaults, typography group, responsive count max 20, conditions, colour globals off, PHP animation list equals the JS `ANIMATIONS` literal, no `innerHTML`. Browser checks on page 145 (fo-ft-fade / mix / type / scramble / drift): visible count, overlap, band, word source, overlay pass-through, all 10 animations, reduced motion, off-screen pause, typography, editor conditions, live words, undo.

## Word Style (chips) - added 2026-09-27

Controls (heading `framify_ft_word_style`, directly after Typography): `max_size` responsive px 8-200, empty = no cap; `bg_mode` none|fixed|palette (default none, live, JS-read); `bg_color` (fixed only, default #FFFFFF, CSS-only); `bg_opacity` 0-1 step 0.05 (default 1, fixed + palette, CSS-only); Border group `framify_ft_border` + responsive `radius` DIMENSIONS (px/%/em) on the chip; Text Shadow group `framify_ft_text_shadow` on the text span; responsive `padding` DIMENSIONS (px/em/%) on the chip. CSS-only controls are `render_type ui` + `selectors`. Defaults write nothing: existing elements are unchanged.

13. **Chip = the word element.** It carries background, border, radius, padding and typography, and is the box that is measured (border-box, so padding + border count in placement) and positioned; Tilt and Drift move it whole. The word is `display: flex` so its height is the mask line alone (no strut of the uncapped Typography size). Mask = size + cap + text opacity + Rise clip; text = animations + text shadow.
14. (Superseded by 20-21: MIN/MAX range.) **Max size in CSS, no JS:** `--ft-scale` per word on the mask, `font-size: min( calc( var(--ft-scale) * 1em ), var(--ft-max, 9999px) )`, `--ft-max` written by the responsive control's selectors on the layer (live, per breakpoint). It caps the final rendered size, the base size included.
15. **Opacity:** without a chip, Max opacity stays on the text (now the mask). With a chip (Background mode, or a visible border), Max opacity fades the WHOLE chip (text + background + border, on the word element, also the chip fade's target) and the mask is 1, so the text is full strength inside it. Background opacity (`color-mix()` with transparent, opaque fallback without color-mix) is relative to the chip background only. Whether a word is a chip is decided once when it enters.
16. **bg_color keeps the Global Colour picker:** it is CSS-only (a custom property Elementor writes, globals resolve to a CSS var), the JS never reads it. The JS-read palette slots keep the picker disabled.
17. **Contrast rule (From palette):** parse the picked hex / rgb / hsl (random hues are hsl) to rgb; text = whichever of #1E1E1E / #FFFFFF has the higher WCAG contrast ratio against the chip (ties dark; #F69216 -> #1E1E1E at 7.18:1 vs 2.32:1); unparseable -> #F69216 chip with dark text. The chip background is a rebuilt rgba(), never the raw setting. Outline strokes use the contrast colour (currentColor).
18. **Motion with chips:** the chip stays still and only fades (in over the first half of the entrance, out over the last 60% of the exit; typewriter: 250 ms after the erase) while the text animates inside it. Rise clips the text inside the chip rather than sliding the chip (reads as a label whose text rolls in). Words with no background and no border never animate the word's opacity.
19. **Editor sync:** the mixin's ignore list became `CSS_KEYS` (typography, max_size, bg_color, bg_opacity, border, radius, text_shadow, padding) with an `onStyleChange` hook: 120 ms + one frame after a CSS-only change, `refitHolding()` re-measures holding words; one that grew into an older word or out of the band leaves early.

Verification: CLI section 5c (order after Typography, types, defaults, responsive flags, conditions, live flag on bg_mode, global picker on bg_color, CSS_KEYS vs PHP, the min() cap rule); node unit check of the contrast / colour parsing; browser checks written for fo-ft-chips / fo-ft-chips-dark (not run in this session).

## Word size as a MIN/MAX range - added 2026-09-27 (supersedes decisions 6 and 14)

Control: `framify_ft_min_size` "Min font size (px)", responsive px slider 6-200, default empty, `live()` (JS-read), first control under the Word Style heading. Removed: `framify_ft_size_var` (Size variation) and `framify_ft_max_size` (Max font size, its `--ft-max` selector and the CSS `min()` cap). Saved values of the removed controls are simply ignored.

20. **The Typography size is the maximum, Min font size the minimum.** Per word, `build()` appends the word unseen and reads `getComputedStyle( word ).fontSize` before any inline size (the Typography size of the current breakpoint, whatever unit it was set in). `wordSize( maxPx, minPx )` picks uniformly in [min, max]: empty min = 0.75 x max (existing elements get 75-100%, close to the old +-25%), min above max is capped to max (fix round 1: never a swap, since tablet / mobile inherit a desktop min and a word must never exceed the Typography size; e.g. desktop min 24 with mobile Typography 20 gives every mobile word 20px), the low end never drops under 4px. `minPx` = `readMinSize()` via `FramifyFx.readResponsive` (walks the breakpoints; NaN when empty everywhere).
21. **The final size lives on the chip.** It is written inline as the word element's `font-size` (inline beats Elementor's Typography rule on the same class); mask, text, letters and caret inherit it (1em). So the default pill padding (`0.3em 0.8em`) and any em padding / radius scale with the word and a chip keeps its proportions at every size; px Padding values stay px (the user's choice). This replaces the `--ft-scale` factor on the mask, which could not scale the chip's own em padding because the chip's font-size was the unscaled Typography size.
22. **Live updates:** Min font size is not in `CSS_KEYS`, so a change rebuilds. Typography stays CSS-only: `onStyleChange` still refits holding words, and every new word reads the new max (holding words keep their size until they leave). `watchSize()` rebuilds on any device-mode change (`fx.device`), because the range differs per breakpoint and on-screen words carry a px size.

Verification: CLI section 5c (controls gone, min_size id / type / label / responsive / default / range / live / no selectors, ignore list without max_size or min_size, JS writes the size on the word, CSS free of `--ft-max` / `--ft-scale`); node sampling of `wordSize()` (copied verbatim) for max 28 with min empty / 14 / 40 (all 28) / 2, and max 20 with min 24 (all 20); browser check "Min font size" written for fo-ft-chips (not run in this session).

## Spacer support (2026-09-27)

The Spacer widget is a host too: `section_spacer` hook at priority 30 via `register_spacer_controls()`, `attachHandler( 'spacer', FloatingText )`, host `FramifyFx.hostOf()` (as Floating Shapes). The controls are shared through `register_section( $element, $layer )`; only the CSS layer selector differs: `{{WRAPPER}} .framify-ft` on the Spacer (its layer sits inside `.elementor-widget-container`; a Spacer has no children, so a descendant selector cannot leak) vs `{{WRAPPER}} > .framify-ft` on Containers / Sections (unchanged). See 2026-09-27-framify-spacer-support-design.md.
