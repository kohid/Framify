# Framify Floating Shapes - design record (2026-09-27)

## Goal

Calm, tasteful floating confetti for Elementor Containers and legacy Sections: small SVG shapes drifting across the element, behind the content or over it (clicks pass through).

## Approved architecture

- Lightweight inline SVG shapes animated by CSS; the JS handler only builds, measures and re-rolls.
- New module `framify-elementor-shapes.php` (`Framify_Elementor_Shapes`), loaded from `framify.php` after `framify-elementor.php`. Inert without Elementor; adds section `framify_fs_section` to the existing Framify tab (`Framify_Elementor::TAB`).
- Hooks: `elementor/element/container/_section_responsive/after_section_end` and `elementor/element/section/_section_responsive/after_section_end` (verified in `includes/elements/section.php`), priority 20 so the section follows Organic Shape / Grain.
- Assets `assets/framify-shapes.js` / `.css`, enqueued on `elementor/frontend/after_enqueue_scripts`, filemtime versions. Handler `FramifyFloatingShapes` attached to `container` and `section` with a null skin.

## Controls (all live: frontend_available + render_type none)

enable (off), layer background|overlay, shapes (SELECT2 multiple, all eight), style mix|solid|outline, stroke 1-8 px (2, hidden for solid), color_mode palette|random, color_1..5 (#F69216, #263238, empty x3), saturation 70 / lightness 60 (random), area full|left|right, area_width 10-90% (35), count responsive 1-60 (18), size 8-200 px (48), opacity 0.1-1 (0.8), direction up|down|left|right|random (up), speed slow|normal|fast|custom (20/12/7 s, custom reads `duration`), duration responsive 2-60 s step 0.5 (12, shown only when speed = custom), spin (yes).

## Approved features added 2026-09-27

1. **Hexagon shape.** New shape id `hexagon` ("Hexagon"), appended to `shape_options()` in PHP and to `ALL_SHAPES` in JS (both lists must stay in the same order; the CLI test checks the JS source literally contains the array and that the picker's default equals `array_keys()` of the options). Regular pointy-top hexagon, centred in the shared 0-100 box: vertices at -90/-30/30/90/150/210 degrees, radius 38 (same vertical padding as the circle, 12 to 88). Corners are very slightly rounded with a small shared helper (`roundedPolygon()`): each edge is cut back by a fixed amount and a quadratic curve bows through the true vertex, matching the softened square's `rx=6` feel without a separate solid/outline code path. Built as one `path` via `createElementNS` + `setAttribute('d', ...)`, no innerHTML. Solid = fill; outline = stroke, reusing the module's existing `vector-effect: non-scaling-stroke` and outline-width handling. Added to the default shape list, so containers/sections that never customised the picker now also draw hexagons; a custom-picked list is unaffected.
2. **Custom speed.** `framify_fs_speed` gains `custom` ("Custom"). New responsive control `framify_fs_duration` ("Seconds per pass", SLIDER unit `s`, range 2-60 step 0.5, default 12, condition `framify_fs_speed = custom`), live like every other control. In JS, `readDuration()` resolves the current device's value with the same fallback chain as `readCount()` (`getCurrentDeviceSetting()`, then walk the breakpoints by hand for a device holding an empty slider object, then desktop, then 12), clamped 2-60, and that becomes the base cycle fed into `readOptions()`'s `speed` field. Each shape still varies about +-40% around that base exactly like the slow/normal/fast presets -- the per-shape jitter in `makeItem()` was not touched. `watchSize()`'s resize handler was extended to rebuild when `readDuration()` changes for a custom speed (not only when `readCount()` changes), so a breakpoint switch in the editor picks up a different per-device duration.

## Decisions made during implementation

1. **Stacking:** background layer at z-index 0, inserted after Elementor's background children, instead of z-index -1. At -1 the layer paints under a Container's `::before` background overlay. At 0 it paints after the overlay and before widgets (which Elementor positions relatively). The overlay layer is z-index 5, appended last. The host gets `isolation: isolate` so z-index stays local.
2. **Depth:** each shape draws one depth value (skewed toward far) that sets size (40-100% of max), opacity (55-100% of max) and speed (near is a little faster, about +-40% overall). The field reads as layered rather than noisy.
3. **Three nested layers** (drift + fade, sway, spin), each running one keyframe animation, so the three motions never compete for one transform.
4. **Travel distance** is `calc()` over the wrapper's `--fs-w` / `--fs-h`, updated by a rAF-throttled ResizeObserver. A breakpoint change with a different Count rebuilds.
5. **Responsive count:** `getCurrentDeviceSetting()` first. If a device holds an empty slider object, the code walks up the breakpoints itself, then uses desktop, then 18.
6. **Editor sync:** besides `onElementChange`, the handler listens to the element's settings model, so undo/redo and `$e` settings commands rebuild too.
7. **Re-roll** on each drift `animationiteration`, while the shape is invisible: lane, direction (Random), type, style and colour. Duration is kept, so progress never jumps.
8. **Global Colours are disabled** on the five palette slots (`'global' => array( 'active' => false )`). A linked value lives only in `__globals__`, which reaches neither the published `data-settings` nor the editor's active settings, so a linked slot could never be resolved in the JS. (Corrected 2026-09-27: an earlier `__globals__` -> `var(--e-global-color-<id>)` mapping never received any data.)
9. Spin off means no rotation at all, not even a static tilt.
10. **How settings arrive** (corrected 2026-09-27; the first version assumed "published pages omit defaults", which is the wrong way round). Published pages use Elementor's `get_frontend_settings()`: control defaults are present, but every `null` / `''` value is dropped. The editor sends `''` for an off switch or a cleared colour. So a missing key means empty: `framify_fs_enable` / `framify_fs_spin` are on only when `'yes' === value`; a missing palette slot is empty (no per-slot default fallback); only if all five are empty does the layer fall back to `#F69216`. Select/slider fallbacks stay, harmlessly, since their defaults are always present.

## Verification

Covered by the CLI test (section 5 of `dev/tests/elementor-shapes-test.php`) and by browser checks on page 145. The browser checks covered shape count and types, band width, overlay pass-through, heading above shapes, shapes above a Section's background overlay, motion, the opacity cap, pausing off-screen, reduced motion, the editor's conditional controls and live rebuild, and the responsive count.

## Spacer support (2026-09-27)

The Spacer widget is a host too: `elementor/element/spacer/section_spacer/after_section_end` at priority 20 (same `register_controls`, after Organic Shape / Grain at 10) and `attachHandler( 'spacer', FloatingShapes )` (widget, default skin). The layer lives in `FramifyFx.hostOf( handler )`: the element that paints the Spacer's Advanced > Background (its direct `.elementor-widget-container`, or the widget element with Optimized Markup), so it fills the Spacer area. A Spacer has no content, so Background and Overlay both simply sit above its background. Containers and Sections are unchanged (host = the element). See 2026-09-27-framify-spacer-support-design.md.
