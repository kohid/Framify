// Browser test of the Background Effects engine (assets/framify-effects.js) on plain divs.
// Run: PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM=/path/to/chromium node dev/tests/effects/effects-test.js
const { chromium } = require( process.env.PLAYWRIGHT_MODULE || 'playwright' );
const ok = ( name, v ) => { console.log( ( v ? 'PASS ' : 'FAIL ' ) + name ); if ( ! v ) { process.exitCode = 1; } };

( async () => {
  const b = await chromium.launch( process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {} );
  const p = await b.newPage( { viewport: { width: 1300, height: 900 } } );
  const errs = [];
  p.on( 'pageerror', e => errs.push( e.message ) );
  p.on( 'console', m => { if ( 'error' === m.type() ) { errs.push( m.text() ); } } );
  await p.goto( 'file://' + __dirname + '/effects.html' );

  // In-page helpers: mount an effect, read pixels of its canvas.
  await p.evaluate( () => {
    window.mount = ( id, raw, hostOpts, createOpts ) => {
      const host = makeHost( id, hostOpts );
      window[ 'fx_' + id ] = FramifyEffects.create( host, stackOf( raw ), createOpts );
      return host;
    };
    // pixels of a rectangle given as fractions of the canvas
    const region = ( id, x0, y0, x1, y1 ) => {
      const cv = window[ 'fx_' + id ].stats().canvas, w = cv.width, h = cv.height;
      return cv.getContext( '2d' ).getImageData( Math.floor( x0 * w ), Math.floor( y0 * h ), Math.max( 1, Math.floor( ( x1 - x0 ) * w ) ), Math.max( 1, Math.floor( ( y1 - y0 ) * h ) ) ).data;
    };
    // mean alpha (0-255)
    window.alphaIn = ( id, x0, y0, x1, y1 ) => {
      const d = region( id, x0, y0, x1, y1 );
      let a = 0; for ( let i = 3; i < d.length; i += 4 ) { a += d[ i ]; }
      return a / ( d.length / 4 );
    };
    window.colorIn = ( id, x0, y0, x1, y1 ) => {
      const d = region( id, x0, y0, x1, y1 );
      let r = 0, g = 0, bl = 0, n = 0;
      for ( let i = 0; i < d.length; i += 4 ) { if ( d[ i + 3 ] > 90 ) { r += d[ i ]; g += d[ i + 1 ]; bl += d[ i + 2 ]; n++; } }
      return n ? [ r / n, g / n, bl / n, n ] : null;
    };
  } );

  /* ---------- look (still frames: deterministic) ---------- */
  await p.emulateMedia( { reducedMotion: 'reduce' } );
  await p.evaluate( () => {
    mount( 'fire', { framify_ef_1_type: 'flames', framify_ef_1_density: 90 } );
    mount( 'smoke', { framify_ef_1_type: 'smoke', framify_ef_1_density: 90 } );
    mount( 'cloud', { framify_ef_1_type: 'cloud', framify_ef_1_density: 80 } );
    mount( 'all3', { framify_ef_1_type: 'cloud', framify_ef_2_type: 'smoke', framify_ef_3_type: 'flames' } );
  } );
  await p.waitForTimeout( 200 );
  const m = await p.evaluate( () => ( {
    fireLow: alphaIn( 'fire', 0.3, 0.6, 0.7, 1 ), fireHigh: alphaIn( 'fire', 0.3, 0, 0.7, 0.3 ), fireCorner: alphaIn( 'fire', 0, 0.5, 0.12, 1 ) + alphaIn( 'fire', 0.88, 0.5, 1, 1 ),
    fireBase: colorIn( 'fire', 0.35, 0.8, 0.65, 1 ), fireTop: colorIn( 'fire', 0.35, 0.62, 0.65, 0.8 ),
    smokeMid: alphaIn( 'smoke', 0.25, 0.3, 0.75, 1 ), smokeTop: alphaIn( 'smoke', 0, 0, 1, 0.1 ), smokeCorner: alphaIn( 'smoke', 0, 0.3, 0.1, 1 ),
    smokeCol: colorIn( 'smoke', 0.25, 0.3, 0.75, 1 ),
    cloudBand: alphaIn( 'cloud', 0, 0.05, 1, 0.5 ), cloudBelow: alphaIn( 'cloud', 0, 0.85, 1, 1 ),
    all3Cloud: alphaIn( 'all3', 0, 0, 1, 0.3 ), all3Fire: alphaIn( 'all3', 0.3, 0.8, 0.7, 1 ),
    canvases: document.querySelectorAll( '#all3 canvas' ).length, particles: fx_all3.stats().particles, still: fx_fire.stats().still, running: fx_fire.stats().running, frames: fx_fire.stats().frames
  } ) );
  ok( 'flames: strong at the base of the fire, empty near the top and at the sides', m.fireLow > 25 && m.fireHigh < 4 && m.fireCorner < 3 );
  ok( 'flames: hot yellow-white at the base, redder and darker higher up (colour ramp)', m.fireBase && m.fireTop && m.fireBase[ 1 ] > m.fireTop[ 1 ] && m.fireTop[ 0 ] > m.fireTop[ 2 ] + 40 );
  ok( 'smoke: fills the column, nothing at the very top or the far side', m.smokeMid > 6 && m.smokeTop < 2 && m.smokeCorner < 2 );
  ok( 'smoke: grey, not coloured', m.smokeCol && Math.abs( m.smokeCol[ 0 ] - m.smokeCol[ 1 ] ) < 30 && Math.abs( m.smokeCol[ 1 ] - m.smokeCol[ 2 ] ) < 30 );
  ok( 'cloud: a band in the upper half, nothing in the bottom strip', m.cloudBand > 30 && m.cloudBelow < 2 );
  ok( 'three layers share one canvas and all three regions show', 1 === m.canvases && m.all3Cloud > 20 && m.all3Fire > 15 );
  ok( 'reduced motion at mount: one still frame, no loop', m.still && ! m.running && 1 === m.frames );

  /* ---------- colours ---------- */
  await p.evaluate( () => mount( 'green', { framify_ef_1_type: 'cloud', framify_ef_1_c1: '#00ff00', framify_ef_1_c2: '#00aa00', framify_ef_1_density: 90 } ) );
  const g = await p.evaluate( () => colorIn( 'green', 0, 0, 1, 1 ) );
  ok( 'a chosen colour reaches the pixels (green cloud)', g && g[ 1 ] > g[ 0 ] + 60 && g[ 1 ] > g[ 2 ] + 60 );

  /* ---------- stacking vs the background overlay ---------- */
  await p.evaluate( () => { document.getElementById( 'stage' ).innerHTML = ''; } );
  await p.evaluate( () => {
    const raw = { framify_ef_1_type: 'cloud', framify_ef_1_opacity: 1, framify_ef_1_density: 100, framify_ef_1_c1: '#ffffff', framify_ef_1_c2: '#ffffff' };
    makeHost( 'plain', { overlay: '1', label: 'x' } );
    mount( 'under', Object.assign( { framify_ef_stack: 'under' }, raw ), { overlay: '1', label: 'x' } );
    mount( 'above', Object.assign( { framify_ef_stack: 'above' }, raw ), { overlay: '1', label: 'x' } );
  } );
  await p.waitForTimeout( 150 );
  const shot = async ( id ) => { const bb = await p.locator( '#' + id ).boundingBox(); return ( await p.screenshot( { clip: { x: bb.x, y: bb.y + 60, width: bb.width, height: bb.height - 60 } } ) ).toString( 'base64' ); };
  const sPlain = await shot( 'plain' ), sUnder = await shot( 'under' ), sAbove = await shot( 'above' );
  ok( 'Under: an opaque Background Overlay hides the effect completely', sUnder === sPlain );
  ok( 'Above: the effect shows over the overlay', sAbove !== sPlain );
  const z = await p.evaluate( () => ( { u: getComputedStyle( document.querySelector( '#under .framify-ef' ) ).zIndex, a: getComputedStyle( document.querySelector( '#above .framify-ef' ) ).zIndex, pe: getComputedStyle( document.querySelector( '#above .framify-ef' ) ).pointerEvents,
    order: [ ...document.querySelector( '#above' ).children ].map( c => c.className.split( ' ' )[ 0 ] ).join() } ) );
  ok( 'computed z-index is -1 (Under) and 0 (Above); clicks pass through', '-1' === z.u && '0' === z.a && 'none' === z.pe );
  ok( 'Above is inserted after Elementor\'s overlay and before the content', 'elementor-background-overlay,framify-ef,content' === z.order );
  ok( 'the host is claimed (isolated + positioned) while an effect runs', await p.evaluate( () => document.getElementById( 'under' ).classList.contains( 'framify-fs-host' ) ) );

  /* ---------- live reduced motion, off-screen pause, cleanup ---------- */
  await p.emulateMedia( { reducedMotion: 'no-preference' } );
  await p.evaluate( () => { document.getElementById( 'stage' ).innerHTML = ''; window.rafCalls = 0; const raf = window.requestAnimationFrame; window.requestAnimationFrame = f => { window.rafCalls++; return raf( f ); }; } );
  await p.evaluate( () => mount( 'live', { framify_ef_1_type: 'smoke', framify_ef_quality: 'high' } ) );
  await p.waitForTimeout( 500 );
  const f1 = await p.evaluate( () => fx_live.stats().frames );
  await p.waitForTimeout( 300 );
  const f2 = await p.evaluate( () => fx_live.stats().frames );
  ok( 'animation: frames advance while visible', f2 > f1 && f1 > 5 );
  const a1 = await p.evaluate( () => alphaIn( 'live', 0, 0, 1, 1 ) );
  await p.waitForTimeout( 700 );
  const a2 = await p.evaluate( () => alphaIn( 'live', 0, 0, 1, 1 ) );
  ok( 'animation: the picture changes over time', Math.abs( a1 - a2 ) > 0.001 );
  await p.emulateMedia( { reducedMotion: 'reduce' } ); await p.waitForTimeout( 150 );
  const r1 = await p.evaluate( () => ( { run: fx_live.stats().running, still: fx_live.stats().still, frames: fx_live.stats().frames } ) );
  await p.waitForTimeout( 400 );
  const r2 = await p.evaluate( () => fx_live.stats().frames );
  ok( 'reduced motion switched on live: the loop stops and the frame count freezes (no rebuild)', ! r1.run && r1.still && r2 === r1.frames );
  await p.emulateMedia( { reducedMotion: 'no-preference' } ); await p.waitForTimeout( 400 );
  const r3 = await p.evaluate( () => ( { run: fx_live.stats().running, frames: fx_live.stats().frames } ) );
  ok( 'reduced motion switched off live: it runs again on the same canvas', r3.run && r3.frames > r2 && 1 === await p.evaluate( () => document.querySelectorAll( '#live canvas' ).length ) );

  await p.evaluate( () => { document.getElementById( 'stage' ).insertAdjacentHTML( 'afterbegin', '<div style="height:1600px;width:100%"></div>' ); window.scrollTo( 0, 0 ); } );
  await p.waitForTimeout( 400 );
  const o1 = await p.evaluate( () => ( { run: fx_live.stats().running, frames: fx_live.stats().frames, vis: fx_live.stats().visible } ) );
  await p.waitForTimeout( 400 );
  const o2 = await p.evaluate( () => fx_live.stats().frames );
  ok( 'off-screen: the loop pauses and frames stay put', ! o1.vis && ! o1.run && o2 === o1.frames );
  await p.evaluate( () => window.scrollTo( 0, 1500 ) ); await p.waitForTimeout( 500 );
  ok( 'back on-screen: it resumes', await p.evaluate( ( f ) => fx_live.stats().running && fx_live.stats().frames > f, o2 ) );

  await p.evaluate( () => fx_live.destroy() );
  await p.waitForTimeout( 100 );
  const rafsAfter = await p.evaluate( () => window.rafCalls );
  await p.waitForTimeout( 400 );
  const rafsLater = await p.evaluate( () => window.rafCalls );
  ok( 'destroy: canvas gone, host released, loop stopped', await p.evaluate( () => ! document.querySelector( '#live .framify-ef' ) && ! document.getElementById( 'live' ).classList.contains( 'framify-fs-host' ) ) && rafsLater === rafsAfter );
  await p.evaluate( () => { for ( let i = 0; i < 20; i++ ) { const id = 'cyc' + i; mount( id, { framify_ef_1_type: 'flames', framify_ef_2_type: 'cloud' } ); window[ 'fx_' + id ].destroy(); } } );
  ok( 'create and destroy twenty times leaves no canvas behind', 0 === await p.evaluate( () => document.querySelectorAll( '.framify-ef' ).length ) );

  /* ---------- caps ---------- */
  const big = await b.newPage( { viewport: { width: 3000, height: 1900 }, deviceScaleFactor: 3 } );
  await big.goto( 'file://' + __dirname + '/effects.html' );
  await big.evaluate( () => {
    const h = makeHost( 'huge', { style: 'width:2900px;height:1800px' } );
    window.fx_huge = FramifyEffects.create( h, stackOf( { framify_ef_quality: 'high', framify_ef_1_type: 'flames', framify_ef_1_density: 100, framify_ef_2_type: 'flames', framify_ef_2_density: 100, framify_ef_3_type: 'smoke', framify_ef_3_density: 100 } ) );
    makeHost( 'tiny', { style: 'width:1px;height:1px' } );
    window.tinyOk = true;
    try { FramifyEffects.create( document.getElementById( 'tiny' ), stackOf( { framify_ef_1_type: 'smoke' } ) ).destroy(); } catch ( e ) { window.tinyOk = false; }
  } );
  const cap = await big.evaluate( () => { const s = fx_huge.stats(); return { px: s.backing[ 0 ] * s.backing[ 1 ], n: s.particles, ok: tinyOk }; } );
  ok( 'caps: a 2900x1800 host at devicePixelRatio 3 keeps the backing store under 0.7 MP and at most 260 particles', cap.px <= 700000 + 4000 && cap.n <= 260 && cap.n > 20 );
  ok( 'caps: a 1x1 host does not throw', cap.ok );
  await big.close();

  /* ---------- the Elementor handler (stubbed Elementor) ---------- */
  await p.evaluate( () => { document.getElementById( 'stage' ).innerHTML = ''; } );
  const hd = await p.evaluate( () => {
    const attached = [];
    const Base = function ( o ) { this.$element = o.$element; this.settings = o.settings; this.isEdit = false; };
    Base.prototype.onInit = function () {};
    Base.prototype.onDestroy = function () {};
    Base.prototype.getElementSettings = function () { return this.settings; };
    Base.prototype.getCurrentDeviceSetting = function ( key ) { return this.settings[ key ]; };
    Base.prototype.getWidgetType = function () { return 'container'; };
    Base.extend = function ( proto ) {
      const Parent = this;
      const C = function ( o ) { Parent.call( this, o ); };
      C.prototype = Object.create( Parent.prototype );
      Object.keys( proto ).forEach( k => { C.prototype[ k ] = proto[ k ]; } );
      C.extend = Parent.extend;
      return C;
    };
    window.elementorModules = { frontend: { handlers: { Base } } };
    window.elementorFrontend = { elementsHandler: { attachHandler: ( t, H, skin ) => attached.push( [ t, H, skin ] ) }, isEditMode: () => false, getCurrentDeviceMode: () => 'desktop', config: { elements: { data: {} } }, breakpoints: null };
    window.FramifyColor = { settings: h => h.getElementSettings() };
    window.dispatchEvent( new Event( 'elementor/frontend/init' ) );
    // Floating Shapes (loaded by the fixture for its helpers) attaches too.
    const mine = attached.filter( a => 'FramifyBackgroundEffects' === a[ 1 ].prototype.getConstructorID() );
    const H = mine[ 0 ] && mine[ 0 ][ 1 ];
    const mk = ( id, settings ) => {
      const host = makeHost( id );
      const inst = new H( { $element: { 0: host, data: () => id }, settings } );
      inst.onInit();
      return { host, inst };
    };
    const lo = mk( 'h_lo', { framify_ef_1_type: 'smoke', framify_ef_1_density: { unit: '%', size: 5 } } );
    const hi = mk( 'h_hi', { framify_ef_1_type: 'smoke', framify_ef_1_density: { unit: '%', size: 95 } } );
    const off = mk( 'h_off', { framify_ef_1_type: 'off' } );
    const n = ( m ) => m.inst.fx.engine.stats().particles;
    const out = {
      attached: mine.map( a => a[ 0 ] + ':' + a[ 2 ] ).join(),
      id: H.prototype.getConstructorID(),
      lo: n( lo ), hi: n( hi ), offHasFx: !! off.inst.fx, offCanvas: off.host.querySelectorAll( 'canvas' ).length,
      stack: lo.host.querySelector( '.framify-ef' ).className
    };
    lo.inst.settings = { framify_ef_stack: 'above', framify_ef_1_type: 'flames' };
    lo.inst.rebuild();
    out.rebuiltClass = lo.host.querySelector( '.framify-ef' ).className;
    out.rebuiltCount = lo.host.querySelectorAll( 'canvas' ).length;
    lo.inst.settings = { framify_ef_1_type: 'off' };
    lo.inst.rebuild();
    out.afterOff = lo.host.querySelectorAll( 'canvas' ).length;
    hi.inst.onDestroy();
    out.afterDestroy = hi.host.querySelectorAll( 'canvas' ).length + ( hi.host.classList.contains( 'framify-fs-host' ) ? 100 : 0 );
    return out;
  } );
  ok( 'handler: attaches to container and section with the null skin and its own constructor id', 'container:null,section:null' === hd.attached && 'FramifyBackgroundEffects' === hd.id );
  ok( 'handler: a layer set to Off builds nothing', ! hd.offHasFx && 0 === hd.offCanvas );
  ok( 'handler: the responsive density reaches the engine (more particles at 95 than at 5)', hd.hi > hd.lo * 2 );
  ok( 'handler: default stack is Under', /framify-ef--under/.test( hd.stack ) );
  ok( 'handler: a settings change rebuilds into the new stack with a single canvas', /framify-ef--above/.test( hd.rebuiltClass ) && 1 === hd.rebuiltCount );
  ok( 'handler: switching every layer Off removes the canvas', 0 === hd.afterOff );
  ok( 'handler: onDestroy tears down the canvas and releases the host', 0 === hd.afterDestroy );

  /* ---------- governor ---------- */
  await p.evaluate( () => { document.getElementById( 'stage' ).innerHTML = ''; let t = 0; window.slow = () => ( t += 25 ); } );
  await p.evaluate( () => mount( 'gov', { framify_ef_quality: 'high', framify_ef_1_type: 'flames' }, {}, { now: window.slow } ) );
  await p.waitForTimeout( 3500 );
  const gov = await p.evaluate( () => { const s = fx_gov.stats(); return { level: s.level, px: s.backing[ 0 ] * s.backing[ 1 ] }; } );
  ok( 'governor: frames that cost too much raise the governor level (quality down)', gov.level >= 1 && gov.level <= 3 );

  ok( 'no page errors', 0 === errs.length );
  if ( errs.length ) { console.log( errs ); }
  await b.close();
  console.log( process.exitCode ? '\nFAILED' : '\nALL PASSED' );
} )();
