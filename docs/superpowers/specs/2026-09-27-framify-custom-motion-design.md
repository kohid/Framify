# Framify Elementor: motion for Custom shapes

Date: 2026-09-27
Status: design approved, awaiting spec review
Builds on: `2026-09-26-framify-flow-custom-shapes-design.md` (implemented). Custom shapes are currently static: a trigger only zooms the photo.

## Goal

When a Custom (pasted SVG) shape has a Trigger (Hover, In view or Loop), the outline itself moves too. Each element picks one of two modes:

- **Liquid.** The pasted outline is traced into smooth points and its edge ripples into a hover pose, so it flows like the built-in Blob, Wavy and Flow shapes. Tracing softens sharp corners and fine detail slightly. Meant for organic shapes.
- **Gentle.** The path stays exactly as pasted, and the whole shape springs into a slight tilt and swell around its centre. Meant for logos, icons and anything with sharp corners.

## Controls (PHP)

The new controls sit in the Motion group, directly after Spring.

`framify_org_custom_motion`:
- `live()` SELECT with options `liquid` ("Liquid (traced, rippling edge)") and `gentle` ("Gentle (exact shape, tilt and swell)"). Default `liquid`.
- Description: "Liquid traces your shape and ripples its edge, softening sharp corners. Gentle keeps it exact and moves it as a whole; use it for logos and icons."

`framify_org_custom_amount`:
- `live()` SELECT with options `subtle`, `normal` and `strong`. Default `normal`. Label: "Motion amount".

Both controls use the condition `$on + array( 'framify_org_shape' => 'custom', 'framify_org_trigger!' => array( 'auto', 'none' ) )`. Custom's Auto trigger stays static, so the controls only appear once you pick Hover, In view or Loop.

## Behaviour (JS)

Resolving the mode:
- Motion applies only when the element's family is `custom` **and** the resolved trigger is `hover`, `inview` or `loop`.
- With a static trigger the shape stays exactly as it is today: the raw pasted path, no tracing, no transform.
- A missing `framify_org_custom_motion` means `liquid`; a missing `framify_org_custom_amount` means `normal`.
- Visitors who ask for less motion get the static behaviour (today's rule).

### Liquid

`traceCustom( custom, amount )` returns `{ rest, hover }`, two path strings in the 0-100 box, or `null`.

1. **Measure.** Draw the validated `custom.d` in a hidden, zero-size SVG (the same pattern as `customBox`) and call `getTotalLength()`. A non-finite or zero length returns `null`.
2. **Fine-sample and split into parts.**
   - Take 400 samples along the path with `getPointAtLength`.
   - Wherever two consecutive samples are more than 3x the sample step apart, a new moveto has started, so start a new part.
   - Drop parts shorter than 1% of the total length.
   - Remove the hidden SVG afterwards.
3. **Resample evenly.** Share **96** points across the parts in proportion to their length, with a minimum of 8 per part. Resample each part evenly along its length.
4. **Normalise into the box** with `x' = ( x - box.x ) * 100 / box.w` and `y' = ( y - box.y ) * 100 / box.h`, using `custom.box`.
5. **Rest pose:** a closed Catmull-Rom path through each part's points. This is a JS port of the PHP `smooth_path( $points, true )`, with the same maths and 2-decimal format. Parts are joined with spaces.
6. **Hover pose.**
   - Each point moves along its normal, the perpendicular to `p[i+1] - p[i-1]`, by `A * ( 0.6 * sin( 2*pi*2*s + ph1 ) + 0.4 * sin( 2*pi*3*s + ph2 ) )`.
     - `s` is the point's position along its part, from 0 to 1.
     - `ph1 = 0.9 + 1.7 * partIndex`, `ph2 = 2.1 + 1.3 * partIndex` (fixed, so no randomness).
   - `A` = 2 / 3.5 / 5 box units for subtle / normal / strong.
   - Then smooth the moved points the same way as the rest pose. Rest and hover therefore share one path structure, and the existing number-blend morph animates them unchanged.
7. **Memoise** by `custom.d + '|' + amount`, as a single-entry memo like `parseCustom`.

**Use.** Both poses are already in 0-100 units, so the inner transform for Liquid is `''` (identity), not `customTransform`. `mainPair` returns the traced pair as parsed paths.

**Fallback.** When `traceCustom` returns `null`, fall back to Gentle. In the editor, show one warning: "Framify: custom shape could not be traced; using Gentle motion." It works like `warnCustom`, once per distinct paste.

### Gentle

The pair stays the static raw path, so `render()` keeps its static branch and the `d` is never rewritten. The motion lives in the inner transform, recomputed on every render:

```
inner(v) = 'translate(50 50) rotate(' + ( R * v ) + ') scale(' + ( 1 + ( S - 1 ) * v ) + ') translate(-50 -50) ' + customTransform( box )
```

- `(R degrees, S)` = `(1.5, 1.02)` for subtle, `(3, 1.04)` for normal, `(5, 1.07)` for strong.
- `v` is the animation value, including any spring overshoot. Loop eases between 0 and 1 as it does today.
- `render()` applies `inner(v)` to the clip path (through `clipTransform`) and to a deco path's `transform` attribute. Container deco mode uses the same inner transform.

The image zoom keeps running alongside both modes, as it does today.

## Error handling and edge cases

- **Invalid paste:** unchanged; no effect and one warning.
- **Tracing fails:** Liquid falls back to Gentle (see above).
- **Shapes with even-odd holes:** Liquid keeps each part's point order, so shapes whose holes rely on winding direction survive. Shapes that rely on `fill-rule: evenodd` can fill in. The control description points such shapes to Gentle.
- **Open subpaths** (no Z) are traced and closed, which matches how a clip path fills them anyway.
- **Performance:** 400 samples plus 96 points, once per distinct paste and amount. The per-frame work matches the built-in shapes: one number blend (Liquid), or one transform string (Gentle).

## Testing

**CLI:** `php dev/tests/elementor-shapes-test.php` stays ALL PASSED. This work has no new PHP geometry.

**Browser, page 145:** create new elements inside a container, one element per create call. Use our own sample path (the one from the previous plan), never the user's reference SVGs.

| Element | Setup | Expected |
|---|---|---|
| `fo-cm-liquid` | Custom, Hover, Liquid, normal | Rest and hover `d` have the same skeleton, and the rest `d` is traced (starts with `M` and contains 96 `C` segments). On `mouseenter` + 3 s the clip `d` differs from rest. The inner transform is identity: the clip transform ends in `scale(0.01 0.01)`. |
| `fo-cm-gentle` | Custom, Hover, Gentle, strong | The clip `d` stays exactly the raw paste throughout. On `mouseenter` + 3 s the transform contains `rotate(5` (allow for spring settling) and `scale(1.07`. |
| `fo-cm-two` | Liquid, Loop, a two-part path `M10 10h30v30h-30z M60 60h30v30h-30z` with viewBox `0 0 100 100` | The traced rest `d` has two `M` commands. |
| `fo-cm-static` | Custom, Auto trigger | Unchanged: raw `d`, no motion. |
| Reduced motion | Any of the above, with `emulateMedia` | No change in `d` or transform on hover. |

- The console shows no errors.
- **Editor:** the two new controls appear only for Custom with Hover, In view or Loop; switching Liquid and Gentle updates the preview live; nothing is saved.
- **Frontend-design check:** screenshots of `fo-cm-liquid` at rest and mid-hover, and of `fo-cm-gentle` mid-hover. Judge whether Liquid reads as a liquid ripple like the presets, not jitter, and whether Gentle reads as a calm breathe, not a wobble. Tuning the amplitudes and angles above is allowed.

## Docs

- In the `CLAUDE.md` Custom bullet, add: Liquid (`traceCustom`, 96 points, normal-wave hover, identity inner transform) and Gentle (inner transform animated around the box centre, raw `d` kept); fallback Liquid -> Gentle.
- Update the JS file docblock: Custom can now move, in two modes.

## Out of scope

- A second pasted hover shape.
- Motion for the Image widget's deco when it uses Custom (Custom still isn't offered for that deco).
- Randomised or seeded ripples.

## Implementation notes (supersede the text above)

- The trace memo key is path + box + amount.
- Normals use a tangent summed over 3 neighbours each side.
- The ripple is scaled per part by `min(1, perimeter/60)`.
- Gentle's rotation is conjugated with the shape's pixel aspect so it rotates rather than shears.
- Sharp-cornered shapes can show a small horn at Strong (use Gentle).
