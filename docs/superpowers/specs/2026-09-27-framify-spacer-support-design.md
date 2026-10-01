# Framify Elementor: Spacer support ("decor block")

Date: 2026-09-27
Status: design approved, implemented
Builds on Organic Shape (framify-elementor.php), Floating Shapes and Floating Text.

## Goal

Turn Elementor's Spacer widget into a clean standalone decor block: every Framify Elementor
feature works on it as on a Container, with the Spacer's height as the box.

## Decisions

1. **Hook.** The Spacer's only controls section is `section_spacer`
   (elementor/includes/widgets/spacer.php). All three modules hook
   `elementor/element/spacer/section_spacer/after_section_end`: Organic Shape + Grain at 10
   (`register_container_controls`), Floating Shapes at 20, Floating Text at 30
   (`register_spacer_controls`). Panel order: Organic Shape, Grain, Floating Shapes, Floating
   Text, then Float (a common control).
2. **Tab position.** `Widget_Base::get_stack()` array_merges the widget's own controls and tabs
   with the common ones, so the Framify tab lands after Content and before Advanced, like the
   Image widget. The Spacer has no Style tab.
3. **Same control set as a Container.** No new definitions: the Spacer gets exactly the
   container controls (Mode clip / behind content, every shape family, Custom SVG, Placement,
   Flat edge, Flip / Rotate, motion incl. Liquid / Gentle, deco Solid / Outline, grain on deco /
   on clip fill, amount, pattern). The CLI test compares the two sets.
4. **Host element.** Clip mode must clip the Spacer's Advanced > Background. The common widget
   controls paint `_background` on `{{WRAPPER}} > .elementor-widget-container`; with Optimized
   Markup the Spacer has no inner wrapper and `common-optimized` paints `{{WRAPPER}}` itself. So
   the host is the direct `.elementor-widget-container` child when present, else the widget
   element: `paintHost()` in framify-elementor.js and `FramifyFx.hostOf()` in framify-shapes.js
   (same rule; the organic script does not load the shapes script). When the inner wrapper
   exists, the outer widget element is not clipped, so the editor handles and the Float
   animation are untouched. With Optimized Markup the host IS the widget element, so the clip
   lands on it (in the editor that also clips the element's editing overlay, as with
   containers).
5. **Box.** The host's box is the Spacer's height (100% of the widget in a Container; wrapping
   `.elementor-spacer-inner` in a column). Placement custom properties are written on
   `{{WRAPPER}}` and reach the inner host by inheritance, so `readBox()` needs no change.
6. **JS routing.** `attachHandler( 'spacer', H )` with the default skin for all three handlers.
   Organic `setup()`: `'spacer' === getWidgetType()` goes to `setupContainer()` on the host.
   `elementSeed()` reads `data-id` from `closest( '[data-id]' )` (the inner host has none;
   identical for every other host).
7. **Positioning.** The inner host is static. Each module sets an inline `position: relative`
   only when it finds the host static, and clears it on teardown, so a class rule
   (`.elementor-widget-spacer > .elementor-widget-container.framify-organic-container` and
   `.framify-fs-host`) keeps the host positioned while either module still has a layer there.
8. **Floating Text selectors.** Containers keep `{{WRAPPER}} > .framify-ft` (nested containers
   must not share styles). The Spacer uses `{{WRAPPER}} .framify-ft`: its layer is inside the
   inner wrapper, and a Spacer has no child elements for a descendant selector to leak into.
   One `register_section( $element, $layer )` serves both.
9. **Float** was already on every widget through `common` / `common-optimized`; it applies to
   the Spacer unchanged.

## Unchanged

Image widget, Containers and Sections: same hooks, priorities, controls, selectors and JS paths.

## Verification

CLI test section 7 (hooks, section id and priorities; organic, shapes and text control sets vs
the container ones; Floating Text selectors; JS attach and host strings). Browser checks: the
"Spacer" section of the sdd10 browser-checks file (not run in this session: no browser).

## Addendum: Spacer deco (Clip mode)

Status: design approved, implemented. Goal: a Spacer in Clip mode can carry the Image widget's
deco blob (e.g. a pink clipped fill with an orange outline ring behind it, spilling outside).

1. **Panel.** The Spacer now hooks `register_spacer_controls`: Organic Shape (container set minus
   its in-section deco block), then a Deco Blob section, then Grain. The Deco Blob section reuses
   `register_deco_controls()` (variant 'spacer') and `register_deco_motion_controls()`, with the
   Image widget's ids. Deco switch, shape, placement and motion need mode = clip (+ deco on).
2. **Shared look ids (deviation from the brief).** `framify_org_deco_style`, both colours and
   the outline width style the shape in Behind content mode and the extra blob in Clip mode. An
   id can only be registered once, so they live once, in the Deco Blob section, shown by
   `conditions` (mode deco OR (mode clip AND deco on)); the section itself shows whenever the
   shape is on. Behind content mode behaves as before (same ids, same JS); its look controls
   just moved from Organic Shape to Deco Blob.
3. **Grain.** Kept the two container switches rather than a target select: `framify_org_clip_grain`
   (fill, default off, relabelled "Grain on shape fill") and `framify_org_deco_grain` (deco,
   default on, Solid only, same OR). Existing Spacers keep their saved values unchanged.
4. **Fill layer.** In Clip mode with the deco on (only; fix round 1: with it off the old host
   clip is kept, so existing Spacers, their Floating Shapes / Text, border and shadow are cut
   exactly as before) the Spacer's background moves onto
   `div.framify-organic__fill` and only the fill is clipped, so nothing else in the host is cut.
   Computed background-* longhands and corner radii are copied; the host's own background is
   hidden with inline `background: none !important` and restored exactly on teardown. The fill
   covers the border box (negative insets = border widths). Clip grain sits inside the fill.
5. **Deco.** Inserted before the fill (both z-index -1, tree order puts the fill on top),
   positioned in % of the host box with the deco Placement, its own motion channel and rotate.
   `overflow: visible` is set inline on the host / widget element only where needed.
6. **Editor.** Background / border changes rebuild the fill after 120 ms plus a frame (a Space
   change needs none: the fill's CSS insets follow the host); Spacers also listen on their
   settings model so `$e` commands and undo rebuild. Background and border controls are
   responsive, so `place()` re-copies into the fill when the device mode changes (`refill()`).
7. **Not mirrored.** The Advanced hover background (hidden with the rest; set the colour on the
   normal state). With the deco on, a host border or box-shadow is no longer cut to the shape. Hover triggers use
   the whole Spacer box, as on the Image widget.

Unchanged: Image widget, Containers, Sections. Verification: CLI test section 7 (section order,
deco ids vs the Image widget, conditions, container sets); browser checks in the sdd10 file,
section "Spacer deco" (not run: no browser this session).

### Fix round: fill margin and the editor handle (2026-09-28)

8. **Fill margin (bug: flat cuts).** A fill exactly the host box could not paint the parts of
   the shape outside the box (Liquid's outward ripple, Gentle's swell, Placement > 100% or
   offsets), so they were cut straight at the box edges. The fill now reaches
   M = round(min(200, 0.2 x the host's larger side)) px past the border box on every side
   (20% = over 3x the strongest motion, ~5-6% of the box; the cap bounds wide Spacers). The
   clip maps the shape back into the host box: x' = (M + x W) / (W + 2M), w' = w W / (W + 2M)
   (y / h with H); zoom origin uses the same box, Gentle's aspect stays in host pixels.
   Non-zero radii grow to r + M. Background images stay anchored to the host box: each
   non-fixed layer's position moves by M(1 - 2p) px (p = its percentage part), so 0% moves
   +M, 50% stays centred, 100% moves -M. A percentage / cover background-size now resolves
   against the larger fill (slightly different scale / crop). `refill()` re-copies on a
   device change or a margin change. Verified front end: fill 784 x 724 around a 560 x 500
   host (M = 112); during a Liquid loop the fill is hit up to 24 px outside the host box
   (0 before); every other clip string on the page is unchanged; no page errors.
9. **Editor handle (bug: clipped handle).** Editor only, wherever the clip-path lands on the
   element that owns Elementor's overlay (Container Clip mode, Spacer host clip with
   Optimized Markup): a rect over the settings handle joins the clipPath while the handle
   shows (hover, or selected via `elementor-element-editable`), tracked for 450 ms (Elementor
   slides the handle), and kept with the handle for 800 ms after leave so the pointer can
   cross unclipped space to reach it. Not the Image widget (clip on the img) and not the fill
   path (the host is not clipped).
