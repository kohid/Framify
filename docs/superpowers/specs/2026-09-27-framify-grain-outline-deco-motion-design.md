# Framify Elementor: Grain section, outlined deco, separate deco motion

Date: 2026-09-27
Status: design approved, awaiting spec review
Builds on the implemented Organic Shape module (Blob, Wavy, Flow, Custom; Placement; deco blob; clip grain; Custom motion).

## Goal

Make the user's reference cards buildable in Elementor. Each card is a solid, grainy colour blob with a thin dark outline blob of a different shape around it, and each card's speckle differs.

1. **Grain section.** Grain moves out of the Deco Blob group into its own "Grain" section. It gains an **amount** and a **pattern**; the pattern defaults to a different random speckle per element.
2. **Deco style.** The deco blob can be **Solid** (today) or **Outline**, a stroke only with its own colour and width.
3. **Deco motion.** The Image widget's deco blob gets its own motion (trigger, duration, spring, and a rotate amount), so it can move differently from the image.

## 1. Grain section (PHP + JS)

- **New section** `framify_grain_section`:
  - Label "Grain", tab `self::TAB`.
  - Registered directly after `framify_org_section` for both the Image widget and Containers.
  - Section condition: `framify_org_enable = yes`.
- **The existing grain controls move into it, with ids and saved values unchanged:**
  - `framify_org_deco_grain`: "Grain on deco blob", default `yes`.
    - Image widget condition: `framify_org_deco = yes` and `framify_org_deco_style != outline`.
    - Container condition: `framify_org_mode = deco` and `framify_org_deco_style != outline`.
  - `framify_org_clip_grain`: "Grain on container fill", default off. Containers only, condition `framify_org_mode = clip`.
- **New controls** (both `live()`):
  - `framify_org_grain_amount`: SLIDER, unit px (unitless in practice), 0-100, step 1, default 50. Label "Grain amount". Description: "Applies wherever grain is on."
  - `framify_org_grain_pattern`: NUMBER, min 0, max 999, step 1, default 0. Label "Pattern". Description: "0 gives every element its own random speckle. Any other number fixes the pattern."
- **JS: `grainOptions( s, el )`** returns `{ cut, seed }`.
  - **Amount:** `cut = 1.11 - 0.0066 * amount`, where `amount = number( s.framify_org_grain_amount, 50 )`, clamped to 0-100. So amount 50 gives 0.78, today's value; 0 gives 1.11 (a few specks); 100 gives 0.45 (heavy chalk).
  - **Seed:** `seed = pattern > 0 ? pattern : elementSeed( el )`.
  - **Element seed:** `elementSeed( el )` hashes the element's `data-id`, which is stable across reloads. Formula: `h = ( h * 31 + charCode ) % 997` over the characters, then `+ 1`, giving a value from 1 to 997. With no `data-id` the seed is 7, today's value.
- **`buildGrainFilter( filterId, specksOnly, frequency, grain )`:**
  - The new last argument `grain = { cut, seed }` replaces the hard-coded `seed: '7'` and the `-0.78` in the colour matrix. The matrix becomes `'0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1.6 0 0 0 ' + ( -cut )`.
  - Every caller passes `grainOptions( s, el )`: the deco blob, both Image widget and Container, and the clip grain layer.
  - The frequencies stay as they are: 0.45 for the deco in its 0-100 box, 0.09 for the clip layer in pixels.

## 2. Deco style: Solid or Outline

- **New deco controls** (`live()`, in the Deco Blob group, same `$deco_on` condition as the existing deco controls; this covers the Image widget deco and Container deco mode):
  - `framify_org_deco_style`: SELECT, `solid` ("Solid") or `outline` ("Outline"), default `solid`. Placed first in the group, after the deco switch and deco shape.
  - `framify_org_deco_outline_color`: COLOR, default `#1E1E1E`. Condition: `$deco_on` + style `outline`.
  - `framify_org_deco_outline_width`: SLIDER px, 1-10, step 0.5, default 2. Condition: `$deco_on` + style `outline`.
  - The existing `framify_org_deco_color` gets the extra condition `framify_org_deco_style != outline`.
- **JS: `buildDeco( id, d, look )`.** The `look` argument replaces the `color` and `grain` arguments:
  - `look = { style, color, outlineColor, outlineWidth, grain }`, where `grain` is null or a `grainOptions` result.
  - **Outline:**
    - The path gets `fill="none"`, `stroke` set to the outline colour, `stroke-width` set to the outline width, `stroke-linejoin="round"`, and `vector-effect="non-scaling-stroke"`.
    - The stroke stays a true pixel width even though the SVG is stretched with `preserveAspectRatio="none"`.
    - No grain filter.
  - **Solid:** today's fill and grain.
  - The deco SVG already has `overflow: visible`, so the stroke is never cut off at the edge.
- **Fallback defaults:** a missing style means solid; a missing outline colour means `#1E1E1E`; a missing width means 2.

## 3. Separate deco motion (Image widget deco)

**New controls** (`live()`, Image widget only, in the Deco Blob group after the placement controls, condition `$deco_on`):

| Control | Type | Values | Default | Extra condition |
|---|---|---|---|---|
| `framify_org_deco_trigger` | SELECT | `same` ("Same as image"), `none` ("None (static)"), `hover` ("On hover"), `inview` ("Once, when scrolled into view"), `loop` ("Continuous gentle loop") | `same` | none |
| `framify_org_deco_duration` | SLIDER, ms | 400-5000, step 100 | 2400 | `framify_org_deco_trigger` not `same` or `none` |
| `framify_org_deco_spring` | SELECT | subtle / normal / bouncy | normal | trigger not `same`, `none` or `loop` |
| `framify_org_deco_rotate` | SLIDER, deg | 0-45 | 0 | trigger not `none` |

The rotate control is labelled "Rotate (deg)". Its description: "Turns the deco blob as it moves, so it reads differently from the image."

**JS: two animation channels**

- `fx.channels = { main: {...}, deco: {...} }`. Each channel is `{ value: 0, raf: 0, loopTimer: 0, looping: false }`.
  - This replaces `fx.value`, `fx.raf`, `fx.loopTimer` and `fx.looping`.
  - Every read of `fx.value` becomes `fx.channels.main.value`.
- **Parts:** each entry in `fx.parts` gets a `channel` field.
  - The main clip is `'main'`.
  - The Image widget deco is `'deco'` when its trigger is its own. It is `'main'` when the deco trigger is `same`, today's behaviour.
  - Container deco mode is `'main'`, because there the deco is the main shape.
- **Methods:**
  - `animate( channel, target, duration, ease )`, `startLoop( channel, duration )` and `stopLoop( channel )` work on the named channel.
  - `render()` takes no argument. It blends each part with its own channel's value. The zoom, Gentle custom motion and the clip transform use `main`.
- **`bindTrigger( el, channel, trigger, duration, ease )` is generic:**
  - `setup()` binds `main` using the existing resolved trigger, duration and spring.
  - When the Image widget deco's trigger is not `same`, `setup()` also binds `deco` with the deco's own trigger (`none` binds nothing), duration (default 2400) and spring (default normal).
  - Hover and In view listen on the widget element, the same as the main channel.
- **Deco rotate:**
  - It is applied to the deco `<svg>` element as a CSS `transform: rotate( R * v deg )`, with `transform-origin: 50% 50%`, set in `render()`.
  - `v` is the deco part's channel value.
  - Because it rotates in pixel space, there is no shear.
  - When R is 0 or `v` is 0, the transform is cleared.
- **Teardown** cancels both channels (rAF, loop timer, looping flag).
- **Reduced motion:** no channels are bound (existing rule).
- **Placement rebuilds** (`place()`) re-render with the current channel values.

## Error handling and edge cases

- **Missing settings on published pages:**
  - `deco_trigger` defaults to `same`, today's behaviour.
  - `deco_rotate` defaults to 0.
  - `deco_duration` defaults to 2400, `deco_spring` to normal.
  - `grain_amount` defaults to 50, `grain_pattern` to 0 (auto).
- **Outline with grain on:** grain is ignored (hidden in the panel, skipped in JS).
- **Deco trigger `same` with rotate above 0:** it rotates with the image's motion value.
- **Deco trigger `none`:** a static deco, even if the image moves.

## Testing

Tests run on page 145, one element per create call, with widgets inside a container.

1. **CLI:** `php dev/tests/elementor-shapes-test.php` still passes (no geometry changes).
2. **Browser elements:**

| Element | Setup | Expected |
|---|---|---|
| `fo-dm-outline` | Image, main Pebble with hover trigger; deco on, deco shape Cloud, style outline, width 2, deco trigger loop, rotate 8 | The deco path has `fill="none"`, a stroke, and `vector-effect="non-scaling-stroke"`. While the page is idle (no hover), the deco `d` changes over 2.5 s and its svg gets `rotate(`, while the clip `d` stays at rest. On `mouseenter` the clip morphs. |
| `fo-dm-same` | Deco solid, deco trigger same, hover | The deco morphs together with the clip on hover (today's behaviour). |
| `fo-dm-none` | Deco trigger none, main hover | On hover the clip morphs and the deco `d` does not change. |
| `fo-gr-a`, `fo-gr-b` | Two Image widgets with solid decos, pattern 0 | The `feTurbulence` `seed` values differ between them. |
| `fo-gr-fixed` | Pattern 42 | The seed is `42`. |
| `fo-gr-heavy` | Amount 100 | The colour matrix ends in `-0.45`. |
| `fo-gr-light` | Amount 0 | The colour matrix ends in `-1.11`. |
| `fo-jr` (existing container, clip grain) | none | The clip grain layer still renders, with an element seed. |

3. **Console:** no errors.
4. **Reduced motion:** there is no deco motion and no rotation.
5. **Editor pass** (real clicks, nothing saved):
   - The Grain section appears as its own section.
   - The Outline colour and width show only for Outline.
   - The deco grain switch hides for Outline.
   - The deco duration and spring hide for Same and None.
6. **Frontend-design check:**
   - Build a four-card row in the style of the reference: flat-colour images (or containers) with Solid grainy blobs plus Outline decos in different shapes, with Loop and Rotate.
   - Screenshot it.
   - Judge it against the reference: outline weight, the speckle differing per card, and calm motion.

## Docs

`CLAUDE.md` Elementor module section:
- The Grain section, including the amount formula, the pattern/seed rule and `elementSeed`.
- Deco style: outline uses `non-scaling-stroke`.
- The two animation channels and the parts' `channel` field.
- Deco rotate is CSS on the deco svg.

Also update the JS docblock.

## Out of scope

- Separate deco motion for Container deco mode, where the deco is the main shape.
- A second deco layer.
- Grain on outlines.
- Grain colours other than white.
