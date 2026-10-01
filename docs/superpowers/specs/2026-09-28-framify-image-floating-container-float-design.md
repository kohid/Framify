# Framify: Image zoom 0% inset, Floating layers on the Image widget, Float on nested Containers

Date: 2026-09-28. Status: approved by the user in conversation.

## 1. Image widget at 0% zoom keeps the shape inside the photo

Problem (reproduced on the test page, Image 05cc959: Custom shape, Liquid,
Strong, zoom 0): the clip is on the img, and a photo has no pixels past its
own box, so the outward part of a Liquid ripple or Gentle swell is cut in a
straight line at the image edges. Zoom hides it because the photo grows with
the motion.

Decision: inset the shape, do not crop the photo.

- Applies only to the Image widget's main clip with a Custom shape and a
  moving custom motion (Liquid / Gentle). Built-in families, containers,
  the Spacer and the deco are unchanged.
- Each side of the placement box pulls inward by the part of the motion's
  outward reach (at its peak) that the current Image zoom does not cover at
  that moment's peak. Zoom 0 on Strong insets by the full reach; a zoom
  that already covers the reach insets by 0. Zoom scales around the flat
  edge's middle (zoomOrigin), so coverage differs per side; compute per side.
- The flat-edge side (after flip/rotate, fx.zoomSide) is never inset, so the
  straight edge stays on the photo edge.
- The shape keeps its aspect as far as possible; it is not re-centred on the
  flat side.

## 2. Floating Shapes and Floating Text on the Image widget

- Both sections are registered on the Image widget's Framify tab through the
  same registration functions as Containers / Spacer (all controls, same ids).
  Tab order: Organic Shape, Deco Blob, Grain, Floating Shapes, Floating Text.
- Handlers attach to 'image' (attachHandler), reusing the existing classes.
- Frame: each layer lives in a frame matching the img's offset box (not the
  widget box), so a narrow centred image gets shapes around the photo only.
  The frame follows the img's size (ResizeObserver) and responsive changes.
- Behind content: stacking deco blob < floating layer < img. With Organic
  Shape on, the layer shows where the shape cuts the photo away. With it
  off, an opaque photo hides it (panel note says so).
- Over content: above the img (and above the image grain layer's order is
  fine either way; the text stays above shapes as elsewhere). With Organic
  Shape on (main clip active), the frame is clipped with the img's own
  url(#id) and copies the img's inline zoom transform + transform-origin
  each frame, exactly like the image grain layer, so it never spills out of
  the moving shape. Without Organic Shape: the plain photo rectangle.
- pointer-events: none on everything added; image links and lightboxes work.
- Shared helper in window.FramifyFx for the photo frame (create / size /
  follow clip) so shapes and text do not duplicate it.

## 3. Float on nested Containers only

- register_float_controls is also hooked on the Container (Framify tab,
  after the other Framify sections). Same controls and CSS as widgets.
- Runtime: Float applies only to a nested container (.e-child). A top-level
  container with Float settings stays still.
- Editor: when a Container panel opens, an editor-only hook hides the Float
  section for a top-level container. Fallback if the hide cannot run: the
  section carries a note "Float works on containers placed inside another
  container."
- Panel note: Float replaces an Entrance Animation (same as widgets).
- Composes with Organic Shape / Floating Shapes / Floating Text on the same
  container.

## Testing

- CLI (dev/tests/elementor-shapes-test.php): new registrations, the helper,
  the inset logic presence, the e-child gate.
- Real Chrome (Playwright node library): 05cc959 shows no straight cuts
  during its loop; zoomed images unchanged; an Image widget with Floating
  Shapes / Text in both modes (stacking, clipped to shape, link still
  clickable) in the editor preview, unsaved; Float moves a nested container,
  not a top-level one; the Float section is hidden on a top-level container.
- Never save or publish page 145. Do not rebuild the deploy zip.

## Implementation notes (Part 2)

- PHP: Framify_Elementor_Shapes::register_controls at 20 and
  Framify_Elementor_Text::register_spacer_controls at 30 on
  elementor/element/image/section_style_caption/after_section_end (Organic
  Shape's image sections are at 10 on it), so the tab reads Organic Shape,
  Deco Blob, Grain, Floating Shapes, Floating Text. Floating Text reuses the
  Spacer variant because its CSS selectors are descendant ones
  ({{WRAPPER}} .framify-ft), which the framed layer needs. The note is the
  Layer control's description on the Image widget only, from
  Framify_Elementor::image_layer_note() (one string for both modules).
- JS: attachHandler( 'image', FloatingShapes / FloatingText ). Both call
  FramifyFx.photoFrame( handler, over ) after hostOf(); on the Image widget
  it returns a shared, reference-counted frame (one Behind, one Over) sized
  to the img's offset box, and the layer is built inside it exactly as on a
  container (so measuring, text-above-shapes order and teardown are
  unchanged). Frames re-measure on ResizeObserver (widget + img), img load
  and window resize.
- Stacking: .framify-fx-photo img is position relative, z-index 1 even
  without Organic Shape; Behind frame z-index 0 inserted after the deco
  blob; Over frame z-index 3 (above the image grain's 2), appended.
- Coupling with Organic Shape: an explicit hook, not polling. The Over frame
  copies the img's inline clip-path, transform and transform-origin in
  el.framifyFxPhoto.sync(); framify-elementor.js calls it (syncPhoto) after
  every render() and after teardown(). Organic owns those values and already
  renders once per frame while moving, so the frame is exact on every frame,
  follows a rebuild's new clip id and the Part-1 inset (same url), and drops
  to a plain rectangle when Organic Shape is switched off.
- Checked in the editor preview, unsaved: frame box == img box (540x500 on
  05cc959; 1024x768 at x=58 in a 1140 px widget on fo00003 without Organic
  Shape); cut-away corners hit the Behind frame, the centre the img; the Over
  frame's computed clip-path / transform equal the img's through a hover
  zoom on 0d3ed4d; Organic off / on switches the frame clip from none to the
  new url; switching both layers off removes frames, class and host claim.
  Front end unchanged (no image has these settings saved).

## Implementation notes (Part 3)

- PHP: Framify_Elementor::register_float_controls is also hooked on
  elementor/element/container/_section_responsive/after_section_end at 40,
  so the container's Framify tab reads Organic Shape, Grain, Floating
  Shapes, Floating Text, Float. Same ids, prefix class (framify-float-) and
  {{WRAPPER}} custom properties as widgets; nothing in the function was
  widget-only. Only on a container the framify_float switch carries the
  fallback description "Float works on containers placed inside another
  container. It replaces an Entrance Animation on the same container."
  (there was no Entrance Animation note before; widgets still have none).
- Runtime gate, pure CSS: .e-con.framify-float-yes:not(.e-child) {
  animation: none; } after the widget rule (0,3,0 beats 0,2,0; the widget
  rule is untouched). Elementor sets e-child / e-parent from the model's
  isInner in PHP (container.php) and in the editor view, so saved and
  preview markup agree.
- Panel hiding: new assets/framify-elementor-editor.js on
  elementor/editor/after_enqueue_scripts (the plugin had only the editor
  stylesheet). elementor.hooks 'panel/open_editor/container' toggles
  .framify-float-off on elementor.getPanelView().$el when the model is not
  inner (isInner, else the view's e-child class); the editor CSS hides
  [class*="elementor-control-framify_float"] under it. The class is on the
  whole panel because clicking a panel tab replaces the editor page view in
  4.2.4 (a class on that view was lost; verified). 'panel/open_editor/'
  widget / section / column clear it, so widgets keep Float.
- Checked in the editor, unsaved: 8a2d709 / 4c4001f (isInner, e-child):
  Float section shown after Floating Text, also after a Layout -> Framify
  tab round trip; Float on via $e -> animation-name framify-float, top
  moved 221.6 -> 202 px over 1.2 s. 4e00dc5 (top level, e-parent): section
  and controls hidden, still hidden after Style -> Framify; Float forced
  via $e -> class present, animation none, no movement. A Heading opened
  right after it shows its Float section and still floats. 0 errors. Front
  end: all 31 elements' clip-path / animation identical with and without
  the new rule; no container has Float saved.
