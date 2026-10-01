// Browser test of the Shape studio pen toolkit (assets/framify-shape-studio.js).
// Run: PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM=/path/to/chromium node dev/tests/shape-studio/studio-test.js
const { chromium } = require( process.env.PLAYWRIGHT_MODULE || 'playwright' );
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const p = await b.newPage({ viewport: { width: 900, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  await p.goto('file://' + __dirname + '/studio.html');
  await p.evaluate(() => openStudio());
  const c = p.locator('canvas.framify-studio__canvas');
  const box = await c.boundingBox();
  const X = (x) => box.x + x * box.width / 340, Y = (y) => box.y + y * box.height / 340;
  const tool = async (n) => p.getByRole('button', { name: n, exact: true }).click();
  const ok = (name, v) => console.log((v ? 'PASS ' : 'FAIL ') + name);

  // Pen: triangle with a dragged (curved) top point, closed by clicking the first point.
  await tool('Pen');
  await p.mouse.click(X(60), Y(280));
  await p.mouse.move(X(170), Y(60)); await p.mouse.down(); await p.mouse.move(X(230), Y(60), { steps: 5 }); await p.mouse.up();
  await p.mouse.click(X(280), Y(280));
  await p.mouse.click(X(60), Y(280));   // close
  await p.locator('.framify-studio__field input').fill('Tri');
  await p.getByRole('button', { name: 'Save shape' }).click();
  await p.waitForTimeout(100);
  let post = await p.evaluate(() => window.__posts.pop());
  ok('pen: saved path has a curve (C) and is closed', post && /C/.test(post.d) && /Z$/.test(post.d) && /^M/.test(post.d));
  ok('pen: viewBox longer side is 100', post && /^0 0 (100|[\d.]+) (100|[\d.]+)$/.test(post.vb) && post.vb.split(' ').slice(2).some(v => parseFloat(v) === 100));
  console.log('  d=', post && post.d.slice(0, 120), 'vb=', post && post.vb);

  // Reopen for the other tools.
  await p.evaluate(() => openStudio());
  const c2 = p.locator('canvas.framify-studio__canvas'); const bx = await c2.boundingBox();
  const X2 = (x) => bx.x + x * bx.width / 340, Y2 = (y) => bx.y + y * bx.height / 340;
  await tool('Pen');
  for (const [x, y] of [[60,60],[280,60],[280,280],[60,280]]) await p.mouse.click(X2(x), Y2(y));
  await p.mouse.click(X2(60), Y2(60)); // close square
  const save = async (n) => { await p.locator('.framify-studio__field input').fill(n); await p.getByRole('button', { name: 'Save shape' }).click(); await p.waitForTimeout(80); return p.evaluate(() => window.__posts.pop()); };
  let sq = await save('sq');
  ok('square: 4 straight segments become C with endpoint controls', sq && (sq.d.match(/C/g) || []).length === 4);

  // Add point on the top edge midpoint.
  await p.evaluate(() => openStudio());
  const c3 = p.locator('canvas.framify-studio__canvas'); const b3 = await c3.boundingBox();
  const X3 = (x) => b3.x + x * b3.width / 340, Y3 = (y) => b3.y + y * b3.height / 340;
  await tool('Pen');
  for (const [x, y] of [[60,60],[280,60],[280,280],[60,280]]) await p.mouse.click(X3(x), Y3(y));
  await p.mouse.click(X3(60), Y3(60));
  await tool('Add point'); await p.mouse.click(X3(170), Y3(60));
  let added = await save('added');
  ok('add anchor: 5 segments after splitting one', added && (added.d.match(/C/g) || []).length === 5);

  // Delete the added point again.
  await p.evaluate(() => openStudio());
  const c4 = p.locator('canvas.framify-studio__canvas'); const b4 = await c4.boundingBox();
  const X4 = (x) => b4.x + x * b4.width / 340, Y4 = (y) => b4.y + y * b4.height / 340;
  await tool('Pen');
  for (const [x, y] of [[60,60],[170,60],[280,60],[280,280],[60,280]]) await p.mouse.click(X4(x), Y4(y));
  await p.mouse.click(X4(60), Y4(60));
  await tool('Delete point'); await p.mouse.click(X4(170), Y4(60));
  let del = await save('del');
  ok('delete anchor: back to 4 segments', del && (del.d.match(/C/g) || []).length === 4);

  // Convert: click a corner -> smooth handles appear (controls move off the endpoints).
  await p.evaluate(() => openStudio());
  const c7 = p.locator('canvas.framify-studio__canvas'); const b7 = await c7.boundingBox();
  const X7 = (x) => b7.x + x * b7.width / 340, Y7 = (y) => b7.y + y * b7.height / 340;
  await tool('Pen');
  for (const [x, y] of [[60,60],[280,60],[280,280],[60,280]]) await p.mouse.click(X7(x), Y7(y));
  await p.mouse.click(X7(60), Y7(60));
  await tool('Convert point'); await p.mouse.click(X7(280), Y7(60));
  let conv = await save('conv');
  ok('convert anchor: corner becomes curve (differs from the plain square)', conv && conv.d !== sq.d);
  // Convert again toggles back to a corner.
  await p.evaluate(() => openStudio());
  const b8 = await p.locator('canvas.framify-studio__canvas').boundingBox();
  const X8 = (x) => b8.x + x * b8.width / 340, Y8 = (y) => b8.y + y * b8.height / 340;
  await tool('Pen');
  for (const [x, y] of [[60,60],[280,60],[280,280],[60,280]]) await p.mouse.click(X8(x), Y8(y));
  await p.mouse.click(X8(60), Y8(60));
  await tool('Convert point'); await p.mouse.click(X8(280), Y8(60)); await p.mouse.click(X8(280), Y8(60));
  let back = await save('back');
  ok('convert twice returns to the plain square', back && back.d === sq.d);
  // Select tool: drag a point moves it.
  await p.evaluate(() => openStudio());
  const b9 = await p.locator('canvas.framify-studio__canvas').boundingBox();
  const X9 = (x) => b9.x + x * b9.width / 340, Y9 = (y) => b9.y + y * b9.height / 340;
  await tool('Pen');
  for (const [x, y] of [[60,60],[280,60],[280,280],[60,280]]) await p.mouse.click(X9(x), Y9(y));
  await p.mouse.click(X9(60), Y9(60));
  await tool('Select');
  await p.mouse.move(X9(280), Y9(60)); await p.mouse.down(); await p.mouse.move(X9(330), Y9(20), { steps: 4 }); await p.mouse.up();
  let moved = await save('moved');
  ok('select: dragging a point changes the shape', moved && moved.d !== sq.d);
  // Undo.
  await p.evaluate(() => openStudio());
  const ba = await p.locator('canvas.framify-studio__canvas').boundingBox();
  await tool('Pen');
  for (const [x, y] of [[60,60],[280,60],[280,280],[60,280],[170,170]]) await p.mouse.click(ba.x + x * ba.width / 340, ba.y + y * ba.height / 340);
  await p.getByRole('button', { name: 'Undo', exact: true }).click();
  await p.mouse.click(ba.x + 60 * ba.width / 340, ba.y + 60 * ba.height / 340);
  let und = await save('undo');
  ok('undo removes the last placed point (square again)', und && und.d === sq.d);


  // Undo keeps the pen's connection to the points already placed.
  await p.evaluate(() => openStudio());
  const bu = await p.locator('canvas.framify-studio__canvas').boundingBox();
  const XU = (x) => bu.x + x * bu.width / 340, YU = (y) => bu.y + y * bu.height / 340;
  await tool('Pen');
  for (const [x, y] of [[60,60],[280,60],[280,280]]) await p.mouse.click(XU(x), YU(y));
  await p.mouse.click(XU(60), YU(280));
  await p.getByRole('button', { name: 'Undo', exact: true }).click();   // removes (60,280); pen path stays open
  await p.mouse.click(XU(60), YU(280));                                  // continue the SAME path
  await p.mouse.click(XU(60), YU(60));                                   // close on the first point
  let cont = await save('cont');
  ok('undo: the pen continues the open path (one closed square, not a second path)', cont && cont.d === sq.d);

  // Canvas up to 2000 and the window grows with it.
  await p.evaluate(() => openStudio());
  const si = p.locator('.framify-studio__size input');
  await si.nth(0).fill('5000'); await si.nth(0).dispatchEvent('change');
  const big = await p.locator('canvas.framify-studio__canvas').evaluate(e => [+e.dataset.w, +e.dataset.h]);
  ok('canvas width is capped at 2000', big[0] === 2000);
  const bw = await p.locator('.framify-studio__box').evaluate(e => e.style.width);
  ok('the window grows with the canvas (2000 + 372 = 2372px, capped to the screen by CSS)', bw === '2372px');
  await si.nth(0).fill('300'); await si.nth(0).dispatchEvent('change');
  ok('a small canvas keeps the minimum window width', await p.locator('.framify-studio__box').evaluate(e => e.style.width) === '880px');

  // Saving updates the pickers live (no reload) and selects the new shape.
  await tool('Pen');
  const bl = await p.locator('canvas.framify-studio__canvas').boundingBox();
  for (const [x, y] of [[60,60],[240,60],[240,260]]) await p.mouse.click(bl.x + x * bl.width / 300, bl.y + y * bl.height / 340);
  await p.mouse.click(bl.x + 60 * bl.width / 300, bl.y + 60 * bl.height / 340);
  await p.locator('.framify-studio__field input').fill('Live');
  await p.getByRole('button', { name: 'Save shape' }).click();
  await p.waitForTimeout(150);
  const msgTxt = await p.locator('.framify-studio__done').textContent();
  ok('save: applied live, no reload needed', /applied/.test(msgTxt) && !(await p.getByRole('button', { name: 'Reload editor' }).count()));
  ok('save: the picker definition and the preview library got the new shape', await p.evaluate(() => 'lib_u_live' in libDef.options && 'lib_u_live' in decoDef.options && 'lib_u_live' in elementor.$preview[0].contentWindow.framifyOrganic.library));
  ok('save: the new shape is picked on the Uploaded tab', await p.evaluate(() => window.__applied && window.__applied.settings.framify_org_shape_source === 'library' && window.__applied.settings.framify_org_shape_lib === 'lib_u_live'));
  await p.getByRole('button', { name: 'Done', exact: true }).click();

  // The Deco Blob button targets the deco picker.
  await p.evaluate(() => openStudio('framify_org_deco_shape'));
  await tool('Pen');
  const bd = await p.locator('canvas.framify-studio__canvas').boundingBox();
  for (const [x, y] of [[60,60],[240,60],[240,260]]) await p.mouse.click(bd.x + x * bd.width / 340, bd.y + y * bd.height / 340);
  await p.mouse.click(bd.x + 60 * bd.width / 340, bd.y + 60 * bd.height / 340);
  await p.locator('.framify-studio__field input').fill('Deco');
  await p.getByRole('button', { name: 'Save shape' }).click();
  await p.waitForTimeout(150);
  ok('deco context: applies framify_org_deco_shape_source / _lib', await p.evaluate(() => window.__applied.settings.framify_org_deco_shape_source === 'library' && window.__applied.settings.framify_org_deco_shape_lib === 'lib_u_deco'));

  // Canvas size + keep frame.
  await p.evaluate(() => openStudio());
  const ins = p.locator('.framify-studio__size input');
  await ins.nth(0).fill('600'); await ins.nth(0).dispatchEvent('change');
  await ins.nth(1).fill('200'); await ins.nth(1).dispatchEvent('change');
  const cw = await p.locator('canvas.framify-studio__canvas').evaluate(e => [+e.dataset.w, +e.dataset.h]);
  ok('canvas size inputs resize the canvas to 600x200', cw[0] === 600 && cw[1] === 200);
  const b5 = await p.locator('canvas.framify-studio__canvas').boundingBox();
  await tool('Pen');
  const X5 = (x) => b5.x + x * b5.width / 600, Y5 = (y) => b5.y + y * b5.height / 200;
  for (const [x, y] of [[100,40],[500,40],[500,160]]) await p.mouse.click(X5(x), Y5(y));
  await p.mouse.click(X5(100), Y5(40));
  await p.locator('.framify-studio__section').first().locator('.framify-studio__switch input').check({ force: true });
  let fr = await save('frame');
  ok('keep frame: viewBox follows the 600:200 canvas (100 x 33.3)', fr && fr.vb === '0 0 100 33.3');


  // Link / unlink the canvas size.
  await p.evaluate(() => openStudio());
  const lk = p.locator('.framify-studio__size input');
  await lk.nth(0).fill('600'); await lk.nth(0).dispatchEvent('change');
  await lk.nth(1).fill('300'); await lk.nth(1).dispatchEvent('change');
  ok('unlinked by default: width and height change separately (600 x 300)', await p.locator('canvas.framify-studio__canvas').evaluate(e => e.dataset.w === '600' && e.dataset.h === '300'));
  await p.locator('.framify-studio__link').click();
  await lk.nth(0).fill('400'); await lk.nth(0).dispatchEvent('change');
  ok('linked: changing the width keeps the 2:1 ratio (400 x 200)', await p.locator('canvas.framify-studio__canvas').evaluate(e => e.dataset.w === '400' && e.dataset.h === '200'));
  await lk.nth(1).fill('100'); await lk.nth(1).dispatchEvent('change');
  ok('linked: changing the height drives the width (200 x 100)', await p.locator('canvas.framify-studio__canvas').evaluate(e => e.dataset.w === '200' && e.dataset.h === '100'));
  await p.locator('.framify-studio__link').click();
  await lk.nth(0).fill('500'); await lk.nth(0).dispatchEvent('change');
  ok('unlinked again: the height stays (500 x 100)', await p.locator('canvas.framify-studio__canvas').evaluate(e => e.dataset.w === '500' && e.dataset.h === '100'));

  // Shift = straight lines (45 degree steps) with the pen.
  await p.evaluate(() => openStudio());
  const bs = await p.locator('canvas.framify-studio__canvas').boundingBox();
  const XS = (x) => bs.x + x * bs.width / 340, YS = (y) => bs.y + y * bs.height / 340;
  await tool('Pen');
  await p.mouse.click(XS(60), YS(60));
  await p.keyboard.down('Shift'); await p.mouse.click(XS(200), YS(75)); await p.keyboard.up('Shift');   // ~ 6 degrees -> snaps to horizontal
  await p.mouse.click(XS(200), YS(260));
  await p.mouse.click(XS(60), YS(60));
  let sh = await save('shift');
  ok('shift: the second point snaps onto the horizontal through the first', sh && /^M0 0C0 0 [\d.]+ 0 [\d.]+ 0C/.test(sh.d));

  // Tracing image: drawn on the canvas, never saved, can be hidden.
  await p.evaluate(() => openStudio());
  const br = await p.locator('canvas.framify-studio__canvas').boundingBox();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await p.locator('.framify-studio__inspector input[type=file]').setInputFiles({ name: 'ref.png', mimeType: 'image/png', buffer: png });
  await p.waitForSelector('.framify-studio__reftools:not([hidden])');
  const alpha = () => p.locator('canvas.framify-studio__canvas').evaluate(e => { const c = e.getContext('2d'); return c.getImageData(e.width >> 1, e.height >> 1, 1, 1).data[3]; });
  const a40 = await alpha();
  ok('tracing image: visible on the canvas', a40 > 0);
  await p.locator('.framify-studio__reftools .framify-studio__switch').click();
  ok('tracing image: Show off hides it', (await alpha()) === 0);
  await p.locator('.framify-studio__reftools .framify-studio__switch').click();
  await p.locator('.framify-studio__reftools input[type=range]').fill('100');
  ok('tracing image: the opacity slider changes how strongly it shows (100% > 40%)', (await alpha()) > a40 * 2);
  await tool('Pen');
  const XR = (x) => br.x + x * br.width / 340, YR = (y) => br.y + y * br.height / 340;
  for (const [x, y] of [[60,60],[280,60],[280,280],[60,280]]) await p.mouse.click(XR(x), YR(y));
  await p.mouse.click(XR(60), YR(60));
  let withRef = await save('withref');
  ok('tracing image: not part of the saved shape (same path as without it)', withRef && withRef.d === sq.d && !('img' in withRef) && !('svg' in withRef));

  // Anchors stay small and undistorted on a wide canvas.
  await p.evaluate(() => openStudio());
  const ws = p.locator('.framify-studio__size input');
  await ws.nth(0).fill('900'); await ws.nth(0).dispatchEvent('change');
  await ws.nth(1).fill('150'); await ws.nth(1).dispatchEvent('change');
  const css = await p.locator('canvas.framify-studio__canvas').evaluate(e => { const r = e.getBoundingClientRect(); return [r.width / r.height, e.dataset.w / e.dataset.h]; });
  ok('wide canvas keeps its aspect ratio on screen (anchors are not stretched)', Math.abs(css[0] - css[1]) < 0.02);

  // Freehand.
  await p.evaluate(() => openStudio());
  const b6 = await p.locator('canvas.framify-studio__canvas').boundingBox();
  await tool('Freehand');
  await p.mouse.move(b6.x + 100, b6.y + 100); await p.mouse.down();
  for (let i = 0; i <= 24; i++) { const a = i / 24 * 6.28; await p.mouse.move(b6.x + 170 + 90 * Math.cos(a), b6.y + 170 + 90 * Math.sin(a)); }
  await p.mouse.up();
  let fh = await save('free');
  ok('freehand: becomes editable curve nodes', fh && /C/.test(fh.d));
  ok('no page errors', errs.length === 0); if (errs.length) console.log(errs);
  await b.close();
})();
