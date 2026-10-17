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


  // Generate tab: seeded dot patterns, several variations saved at once.
  const gen = async () => { await p.evaluate(() => openStudio()); await p.getByRole('button', { name: 'Generate', exact: true }).click(); await p.waitForSelector('.framify-studio__variant'); };
  const range = (label) => p.locator('label.framify-studio__range', { hasText: label }).locator('input');
  const setRange = async (label, v) => { await range(label).fill(String(v)); await p.waitForTimeout(60); };
  const DOT = /^(M0 0H\d+V\d+H0Z)?(M\d+ \d+a(\d+) \3 0 1 0 \d+ 0a\3 \3 0 1 0 -\d+ 0Z)+$/;
  await gen();
  ok('generate: 6 variations, all ticked by default', (await p.locator('.framify-studio__variant').count()) === 6 && (await p.locator('.framify-studio__variant.is-on').count()) === 6);
  ok('generate: the Save button counts the ticked shapes', (await p.getByRole('button', { name: 'Save 6 shapes' }).count()) === 1);
  await setRange('Variations', 8);
  ok('generate: Variations = 8 shows 8 tiles', (await p.locator('.framify-studio__variant').count()) === 8);
  const firstSrc = await p.locator('.framify-studio__variant img').first().getAttribute('src');
  await p.getByRole('button', { name: 'Shuffle', exact: true }).click(); await p.waitForTimeout(80);
  ok('generate: Shuffle gives different shapes', (await p.locator('.framify-studio__variant img').first().getAttribute('src')) !== firstSrc);
  const seedIn = p.locator('.framify-studio__seedrow input');
  await seedIn.fill('12345'); await p.waitForTimeout(80);
  const s1 = await p.locator('.framify-studio__variant img').first().getAttribute('src');
  await seedIn.fill('999'); await p.waitForTimeout(80);
  await seedIn.fill('12345'); await p.waitForTimeout(80);
  ok('generate: the same seed brings back the same shapes', (await p.locator('.framify-studio__variant img').first().getAttribute('src')) === s1);
  await p.locator('.framify-studio__variant').first().click();
  ok('generate: unticking a tile updates the count and Save label', (await p.locator('.framify-studio__variant.is-on').count()) === 7 && (await p.getByRole('button', { name: 'Save 7 shapes' }).count()) === 1);
  await p.evaluate(() => { window.__posts.length = 0; window.__applied = null; });
  await p.locator('.framify-studio__field input').fill('Dots');
  await p.getByRole('button', { name: 'Save 7 shapes' }).click();
  await p.waitForSelector('.framify-studio__done');
  const gp = await p.evaluate(() => window.__posts.slice());
  ok('generate: 7 posts, named "Dots 2" ... "Dots 8" (the unticked #1 is skipped)', gp.length === 7 && gp[0].name === 'Dots 2' && gp[6].name === 'Dots 8');
  ok('generate: every posted path is canonical circles only and under the server cap', gp.every(x => DOT.test(x.d) && x.d.length < 50000 && /^0 0 \d+ \d+$/.test(x.vb)));
  ok('generate: the done screen reports 7 shapes and the first is applied', /Saved 7 shapes/.test(await p.locator('.framify-studio__done').textContent()) && await p.evaluate(() => window.__applied && window.__applied.settings.framify_org_shape_lib === 'lib_u_dots 2'));
  await p.getByRole('button', { name: 'Add another', exact: true }).click(); await p.waitForSelector('.framify-studio__variant');
  ok('generate: "Add another" returns to Generate with the same settings but a NEW seed (no duplicate saves)', (await p.locator('.framify-studio__variant').count()) === 8 && (await p.locator('.framify-studio__seedrow input').inputValue()) !== '12345');
  await p.locator('.framify-studio__draw--gen .framify-studio__switch').click(); await p.waitForTimeout(60);
  await setRange('Variations', 1);
  await p.evaluate(() => { window.__posts.length = 0; });
  await p.locator('.framify-studio__field input').fill('Holes');
  await p.getByRole('button', { name: 'Save 1 shape' }).click(); await p.waitForSelector('.framify-studio__done');
  const hp = await p.evaluate(() => window.__posts.slice());
  ok('generate: Invert posts an outline first, then the dots; a single shape keeps the bare name', hp.length === 1 && hp[0].name === 'Holes' && /^M0 0H\d+V\d+H0Z/.test(hp[0].d) && DOT.test(hp[0].d));
  await gen();
  await p.getByRole('button', { name: 'Ratio 4:3', exact: true }).click(); await p.waitForTimeout(60);
  const vb43 = (await p.evaluate(() => 0)) || (await p.locator('.framify-studio__variant img').first().evaluate(i => i.style.aspectRatio));
  const ar = vb43.split(' / ').map(Number);
  ok('generate: ratio 4:3 gives a landscape sheet (about 1.33)', Math.abs(ar[0] / ar[1] - 4 / 3) < 0.12);
  await setRange('Dots', 400); await setRange('Columns', 40);
  const caption = await p.locator('.framify-studio__caption').first().textContent();
  ok('generate: 400 dots at 40 columns stay in size (caption shows count and KB)', /400 dots/.test(caption) && /\d+\.\d KB/.test(caption) && parseFloat(caption.match(/(\d+\.\d) KB/)[1]) < 50);
  await setRange('Smallest', 90);
  ok('generate: raising Smallest above Largest pushes Largest up (kept in order)', +(await range('Largest').inputValue()) >= 90);
  await p.evaluate(() => { const n = 98 - framifyShapeStudio.shapes.filter(s => s.source === 'user').length; for (let i = 0; i < n; i++) framifyShapeStudio.shapes.push({ id: 'x' + i, title: 'x', thumb: '', svg: '', source: 'user' }); });
  await p.evaluate(() => { window.__posts.length = 0; });
  await setRange('Variations', 6);
  await p.getByRole('button', { name: 'Save 6 shapes' }).click(); await p.waitForTimeout(80);
  ok('generate: with 98 of 100 slots used, saving 6 is blocked before any request', (await p.evaluate(() => window.__posts.length)) === 0 && /free slots/.test(await p.locator('.framify-studio__msg').last().textContent()));
  await p.evaluate(() => { framifyShapeStudio.shapes = framifyShapeStudio.shapes.filter(s => s.source !== 'user'); });


  // Real-browser geometry: winding of Invert, and the animated frames render.
  await p.addScriptTag({ path: require('path').join(__dirname, '../../../assets/framify-elementor.js') });
  const geo = await p.evaluate(() => {
    const G = window.FramifyDotShapes, O = window.FramifyOrganicShape;
    const inPath = (d, x, y) => document.createElement('canvas').getContext('2d').isPointInPath(new Path2D(d), x, y);
    const out = {};
    const plain = G.generate({ seed: 4, dots: 60, cols: 12 }, 0);
    const inv = G.generate({ seed: 4, dots: 60, cols: 12, invert: true }, 0);
    const fp = O.dotField(plain.d), fi = O.dotField(inv.d);
    const vb = plain.vb.split(' ').map(Number);
    const free = (f) => { for (let y = 25; y < vb[3]; y += 80) for (let x = 25; x < vb[2]; x += 80) if (!f.dots.some(d => Math.hypot(d.x - x, d.y - y) < d.r + 30)) return [x, y]; return null; };
    const last = fp.dots[fp.dots.length - 1], gap = free(fp);
    out.plainDotInside = inPath(plain.d, fp.dots[0].x, fp.dots[0].y);
    out.plainGapOutside = !gap || !inPath(plain.d, gap[0], gap[1]);
    out.invDotHole = !inPath(inv.d, fi.dots[0].x, fi.dots[0].y);
    out.invGapFilled = !gap || inPath(inv.d, gap[0], gap[1]);
    // the LAST dot of the path must still be drawn in the middle of an animation: a corrupted flag would truncate the path before it
    out.lastDotDrawn = ['breathe', 'twinkle', 'wave'].every(style => inPath(O.dotPair(fp, style, 'strong').blend(0.5), last.x, last.y));
    out.invFramesHole = ['breathe', 'twinkle', 'wave'].every(style => !inPath(O.dotPair(fi, style, 'strong').blend(0.6), fi.dots[fi.dots.length - 1].x, fi.dots[fi.dots.length - 1].y));
    out.genericBlendBreaks = !inPath(O.blendPath(O.parsePath(plain.d), O.parsePath(plain.d), 0.5), last.x, last.y);
    return out;
  });
  ok('browser: a plain dot is filled and an empty cell is not', geo.plainDotInside && geo.plainGapOutside);
  ok('browser: Invert (outline + opposite winding) makes the dot a hole and fills the gap', geo.invDotHole && geo.invGapFilled);
  ok('browser: the last dot is still drawn mid-animation in Breathe, Twinkle and Wave', geo.lastDotDrawn);
  ok('browser: in Invert mode the dots stay holes mid-animation', geo.invFramesHole);
  ok('browser: the generic blendPath really does break these paths (why dots have their own blender)', geo.genericBlendBreaks);


  // Dispersion: the second pattern in the Generate tab.
  await gen();
  const dotsBefore = await range('Dots').inputValue();
  ok('dispersion: the picker offers two cards, Dots active', (await p.locator('.framify-studio__kind').count()) === 2 && (await p.locator('.framify-studio__kind.is-active').count()) === 1 && /Dots/.test(await p.locator('.framify-studio__kind.is-active').textContent()));
  ok('dispersion: both cards show a live preview picture', await p.evaluate(() => [...document.querySelectorAll('.framify-studio__kind img')].every(i => /^data:image\/svg\+xml,/.test(i.src) && i.src.length > 400)));
  ok('dispersion: its own controls start hidden', await p.locator('.framify-studio__section', { hasText: 'Where the particles travel' }).isHidden());
  await p.getByRole('button', { name: 'Generate Dispersion', exact: true }).click(); await p.waitForTimeout(100);
  ok('dispersion: switching shows Direction and Particle shape, relabels Dots as Particles, hides Columns / Sizes / Runs', await p.evaluate(() => {
    const vis = (t) => { const e = [...document.querySelectorAll('label.framify-studio__range')].find(l => l.textContent.indexOf(t) === 0); return !!e && !e.hidden; };
    return vis('Particles') && !vis('Dots') && !vis('Columns') && !vis('Sizes') && !vis('Runs') && vis('Smallest') && vis('Variations')
      && ![...document.querySelectorAll('.framify-studio__section')].find(s => /Where the particles travel/.test(s.textContent)).hidden;
  }));
  ok('dispersion: the name defaults to Dispersion and tiles say particles', (await p.locator('.framify-studio__field input').inputValue()) === 'Dispersion' && /particles/.test(await p.locator('.framify-studio__caption').first().textContent()));
  ok('dispersion: 6 default tiles', (await p.locator('.framify-studio__variant').count()) === 6);
  const dsrc = await p.locator('.framify-studio__variant img').first().getAttribute('src');
  await p.getByRole('button', { name: 'Direction Down', exact: true }).click(); await p.waitForTimeout(100);
  ok('dispersion: choosing a Direction regenerates the tiles', (await p.locator('.framify-studio__variant img').first().getAttribute('src')) !== dsrc && (await p.getByRole('button', { name: 'Direction Down', exact: true }).getAttribute('aria-pressed')) === 'true');
  const dsrc2 = await p.locator('.framify-studio__variant img').first().getAttribute('src');
  await p.getByRole('button', { name: 'Particle Triangle', exact: true }).click(); await p.waitForTimeout(100);
  ok('dispersion: choosing a Particle shape regenerates the tiles', (await p.locator('.framify-studio__variant img').first().getAttribute('src')) !== dsrc2);
  await setRange('Variations', 2);
  await p.evaluate(() => { window.__posts.length = 0; framifyShapeStudio.shapes = framifyShapeStudio.shapes.filter(s => s.source !== 'user'); });
  await p.getByRole('button', { name: 'Save 2 shapes' }).click(); await p.waitForSelector('.framify-studio__done');
  const dp = await p.evaluate(() => window.__posts.slice());
  const dchk = await p.evaluate((posts) => {
    const O = window.FramifyOrganicShape;
    return posts.map(x => { const f = O.dotField(x.d); return !!f && !!f.mass && !!f.anchor && f.dots.length > 3 && x.d.length < 49000 && /^[-\dMLaZHV ]+$/.test(x.d); });
  }, dp);
  ok('dispersion: 2 posts, named "Dispersion 1/2", each a mass plus particles the runtime recognises', dp.length === 2 && dp[0].name === 'Dispersion 1' && dp[1].name === 'Dispersion 2' && dchk.every(Boolean));
  await p.getByRole('button', { name: 'Add another', exact: true }).click(); await p.waitForSelector('.framify-studio__variant');
  ok('dispersion: "Add another" stays on Dispersion with its settings', /Dispersion/.test(await p.locator('.framify-studio__kind.is-active').textContent()) && (await p.getByRole('button', { name: 'Direction Down', exact: true }).getAttribute('aria-pressed')) === 'true');
  await p.getByRole('button', { name: 'Generate Dots', exact: true }).click(); await p.waitForTimeout(100);
  ok('dispersion: back on Dots the count, name and labels return', (await range('Dots').inputValue()) === dotsBefore && (await p.locator('.framify-studio__field input').inputValue()) === 'Dots' && /dots/.test(await p.locator('.framify-studio__caption').first().textContent()));
  await p.evaluate(() => { window.__posts.length = 0; });
  // Real browser: a dispersion renders as filled marks, a hover pose never loses a particle
  const dgeo = await p.evaluate(() => {
    const G = window.FramifyDotShapes, O = window.FramifyOrganicShape;
    const inPath = (d, x, y) => document.createElement('canvas').getContext('2d').isPointInPath(new Path2D(d), x, y);
    const out = { ok: true };
    G.DIRECTIONS.forEach(dir => G.PARTICLES.forEach(par => {
      const plain = G.generate({ pattern: 'dispersion', direction: dir, particle: par, seed: 5, dots: 120 }, 0);
      const inv = G.generate({ pattern: 'dispersion', direction: dir, particle: par, seed: 5, dots: 120, invert: true }, 0);
      const f = O.dotField(plain.d), fi = O.dotField(inv.d);
      const m = f.mass.pts.reduce((a, q) => [a[0] + q[0] / f.mass.pts.length, a[1] + q[1] / f.mass.pts.length], [0, 0]);
      const first = f.dots[0], lastP = f.dots[f.dots.length - 1];
      if (!inPath(plain.d, first.x, first.y) || !inPath(plain.d, lastP.x, lastP.y)) out.ok = false;
      // Invert: the mass and every particle are holes in the frame
      if (inPath(inv.d, first.x, first.y) || inPath(inv.d, lastP.x, lastP.y)) out.ok = false;
      ['breathe', 'twinkle', 'wave', 'drift'].forEach(style => {
        const mid = O.dotPair(f, style, 'strong').blend(0.5), pose = O.dotField(mid);
        if (!pose || pose.dots.length !== f.dots.length) out.ok = false;
        const midI = O.dotPair(fi, style, 'strong').blend(0.5);
        const q = O.dotField(midI);
        if (!q || /1\.00|0\.00 /.test(midI)) out.ok = false;
      });
    }));
    return out;
  });
  ok('browser: every dispersion (all directions and shapes) fills, inverts to holes, and animates in all four styles', dgeo.ok);

  // Leaving the Generate tab (or closing the studio) while a batch is still saving
  // must not draw the "Saved" screen over the new tab or touch the element.
  await gen();
  await p.evaluate(() => { window.__slow = window.fetch; window.fetch = (u, o) => new Promise(res => setTimeout(() => res(window.__slow(u, o)), 150)); window.__posts.length = 0; window.__applied = null; framifyShapeStudio.shapes = []; });
  await setRange('Variations', 3);
  await p.locator('.framify-studio__field input').fill('Late');
  await p.getByRole('button', { name: 'Save 3 shapes' }).click();
  await p.getByRole('button', { name: 'Draw', exact: true }).click();
  await p.waitForTimeout(900);
  ok('generate: switching tabs mid-save keeps the new tab (no Saved screen drawn over it)', (await p.locator('.framify-studio__done').count()) === 0 && (await p.locator('canvas.framify-studio__canvas').count()) === 1);
  ok('generate: the shapes were still saved, listed and registered, but the element was not changed', await p.evaluate(() => window.__posts.length === 3 && framifyShapeStudio.shapes.length === 3 && 'lib_u_late 1' in libDef.options && window.__applied === null));
  await gen();
  await p.evaluate(() => { window.__posts.length = 0; window.__applied = null; });
  await setRange('Variations', 2);
  await p.locator('.framify-studio__field input').fill('Gone');
  await p.getByRole('button', { name: 'Save 2 shapes' }).click();
  await p.locator('.framify-studio__x').click();
  await p.waitForTimeout(900);
  ok('generate: closing the studio mid-save finishes quietly (saved and registered, element untouched)', (await p.locator('.framify-studio').count()) === 0 && await p.evaluate(() => window.__posts.length === 2 && 'lib_u_gone 1' in libDef.options && window.__applied === null));
  await p.evaluate(() => { window.fetch = window.__slow; framifyShapeStudio.shapes = framifyShapeStudio.shapes.filter(s => s.source !== 'user'); });

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
