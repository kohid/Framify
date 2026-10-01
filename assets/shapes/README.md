# Framify shape library

Drop `.svg` files in this folder and they appear on the **Uploaded** tab of the
Organic Shape and Deco Blob **Shape** pickers, on every site this plugin is
installed on. The file name becomes the label (`soft-leaf.svg` -> "Soft Leaf").

- One or more `<path d="...">` elements; they are merged into one shape.
  Other elements (circle, rect, text, images) and transforms are ignored, so
  convert strokes/shapes to paths in your design tool first.
- Keep a `viewBox` on the `<svg>`; the shape is fitted to it.
- Max 50 KB per file, 200 files.
- Uploaded shapes run through the Custom shape pipeline (Flat edge, Rotate,
  Flip, Liquid / Gentle motion). On the Deco Blob they are static.
