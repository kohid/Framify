// Browser golden test of the Organic Shape handler (assets/framify-elementor.js) with a stubbed Elementor.
// Run: PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM=/path/to/chromium node dev/tests/organic/organic-test.js [--record]
// --record rewrites baseline.json from the CURRENT code (do that only on code known to be right).
const fs = require( 'fs' );
const path = require( 'path' );
const { chromium } = require( process.env.PLAYWRIGHT_MODULE || 'playwright' );

const RECORD = process.argv.includes( '--record' );
const BASELINE = path.join( __dirname, 'baseline.json' );
const ok = ( name, v ) => { console.log( ( v ? 'PASS ' : 'FAIL ' ) + name ); if ( ! v ) { process.exitCode = 1; } };

const CUSTOM_SVG = '<svg viewBox="0 0 100 60"><path d="M10 50 L10 20 Q50 0 90 20 L90 50 Z"/></svg>';
const base = { framify_org_enable: 'yes' };
const hover = { framify_org_trigger: 'hover', framify_org_duration: { size: 400 }, framify_org_spring: 'subtle' };

// id => [ kind, settings, interact ]  (interact: 'hover' plays the hover pose before the snapshot)
const CASES = {};
[ 'deco', 'clip', 'bg' ].forEach( ( mode ) => {
  [ 'container', 'spacer' ].forEach( ( kind ) => {
    CASES[ kind + '-' + mode + '-blob' ] = [ kind, { ...base, framify_org_mode: mode, framify_org_shape: 'pebble' } ];
    CASES[ kind + '-' + mode + '-wavy' ] = [ kind, { ...base, framify_org_mode: mode, framify_org_shape: 'tide' } ];
    CASES[ kind + '-' + mode + '-flow-flip' ] = [ kind, { ...base, framify_org_mode: mode, framify_org_shape: 'brook', framify_org_flip_h: 'yes', framify_org_flip_v: 'yes' } ];
    CASES[ kind + '-' + mode + '-custom-rot90' ] = [ kind, { ...base, framify_org_mode: mode, framify_org_shape: 'custom', framify_org_custom_svg: CUSTOM_SVG, framify_org_custom_rotate: '90' } ];
    CASES[ kind + '-' + mode + '-library' ] = [ kind, { ...base, framify_org_mode: mode, framify_org_shape_source: 'library', framify_org_shape_lib: 'lib_soft-leaf' } ];
    CASES[ kind + '-' + mode + '-gentle' ] = [ kind, { ...base, framify_org_mode: mode, framify_org_shape: 'custom', framify_org_custom_svg: CUSTOM_SVG, framify_org_custom_motion: 'gentle', ...hover }, 'hover' ];
    CASES[ kind + '-' + mode + '-liquid' ] = [ kind, { ...base, framify_org_mode: mode, framify_org_shape: 'custom', framify_org_custom_svg: CUSTOM_SVG, framify_org_custom_motion: 'liquid', ...hover }, 'hover' ];
    CASES[ kind + '-' + mode + '-blob-hover' ] = [ kind, { ...base, framify_org_mode: mode, framify_org_shape: 'pebble', ...hover }, 'hover' ];
  } );
  // the Deco Blob switch (in Clip it is the extra blob; elsewhere the legacy control is only read in clip)
  CASES[ 'container-' + mode + '-deco-builtin' ] = [ 'container', { ...base, framify_org_mode: mode, framify_org_deco: 'yes', framify_org_deco_shape: 'splash', framify_org_shape: 'pebble' } ];
  CASES[ 'container-' + mode + '-deco-library' ] = [ 'container', { ...base, framify_org_mode: mode, framify_org_deco: 'yes', framify_org_deco_shape_source: 'library', framify_org_deco_shape_lib: 'lib_pebble-wide', framify_org_shape: 'pebble' } ];
  CASES[ 'container-' + mode + '-deco-outline-hover' ] = [ 'container', { ...base, framify_org_mode: mode, framify_org_deco: 'yes', framify_org_deco_style: 'outline', framify_org_deco_trigger: 'hover', framify_org_deco_duration: { size: 400 }, framify_org_deco_rotate: { size: 20 }, framify_org_shape: 'pebble', framify_org_trigger: 'none' }, 'hover' ];
} );
CASES[ 'image-blob' ] = [ 'image', { ...base, framify_org_shape: 'pebble' } ];
CASES[ 'image-wavy-flip' ] = [ 'image', { ...base, framify_org_shape: 'tide', framify_org_flip_h: 'yes' } ];
CASES[ 'image-custom-gentle-hover' ] = [ 'image', { ...base, framify_org_shape: 'custom', framify_org_custom_svg: CUSTOM_SVG, framify_org_custom_motion: 'gentle', ...hover }, 'hover' ];
CASES[ 'image-deco-builtin' ] = [ 'image', { ...base, framify_org_shape: 'pebble', framify_org_deco: 'yes', framify_org_deco_shape: 'splash' } ];
CASES[ 'image-deco-library' ] = [ 'image', { ...base, framify_org_shape: 'pebble', framify_org_deco: 'yes', framify_org_deco_shape_source: 'library', framify_org_deco_shape_lib: 'lib_soft-leaf' } ];
CASES[ 'image-deco-hover' ] = [ 'image', { ...base, framify_org_shape: 'pebble', framify_org_deco: 'yes', framify_org_deco_trigger: 'hover', framify_org_deco_duration: { size: 400 }, framify_org_deco_rotate: { size: 15 }, framify_org_trigger: 'none' }, 'hover' ];
CASES[ 'off' ] = [ 'container', { framify_org_enable: '', framify_org_mode: 'clip', framify_org_shape: 'pebble' } ];

( async () => {
  const config = fs.readFileSync( path.join( __dirname, 'config.json' ), 'utf8' );
  const browser = await chromium.launch( process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {} );
  const errors = [];
  const out = {};
  for ( const id of Object.keys( CASES ) ) {
    const [ kind, settings, interact ] = CASES[ id ];
    const page = await browser.newPage( { viewport: { width: 800, height: 600 } } );
    page.on( 'pageerror', ( e ) => errors.push( id + ': ' + e.message ) );
    await page.addInitScript( 'window.framifyOrganic = ' + config + ';' );
    await page.goto( 'file://' + path.join( __dirname, 'organic.html' ) );
    await page.evaluate( ( [ i, k, s ] ) => { window.__m = window.mountOrganic( i, k, s ); }, [ 'c1', kind, settings ] );
    await page.waitForTimeout( 150 );
    if ( 'hover' === interact ) {
      await page.evaluate( () => { window.__m.host.dispatchEvent( new MouseEvent( 'mouseenter' ) ); } );
      await page.waitForTimeout( 900 );
    }
    out[ id ] = await page.evaluate( () => window.snapshot( window.__m.host ) );
    await page.close();
  }
  await browser.close();

  ok( 'no page errors', 0 === errors.length );
  if ( errors.length ) { console.log( errors ); }
  if ( RECORD ) {
    fs.writeFileSync( BASELINE, JSON.stringify( out, null, 1 ) );
    console.log( 'Baseline written: ' + Object.keys( out ).length + ' cases' );
    return;
  }
  const golden = JSON.parse( fs.readFileSync( BASELINE, 'utf8' ) );
  // What 1.18.0 added on purpose, removed before comparing: the extra Deco
  // Blob's class and overlay path, and (in Behind content and Background
  // only modes, where the switch used to be ignored) the whole extra blob.
  const EXTRA_SVG = /<svg class="framify-organic__deco framify-organic__deco--extra"[\s\S]*?<\/svg>/g;
  const ADDED = /^container-(deco|bg)-deco-/;
  const normalise = ( id, html ) => {
    let h = html.replace( /<path class="framify-organic__overlay"[^>]*><\/path>/g, '' ).replace( / framify-organic__deco--extra/g, '' );
    if ( ADDED.test( id ) ) { h = html.replace( EXTRA_SVG, '' ); }
    return h;
  };
  let same = 0;
  for ( const id of Object.keys( CASES ) ) {
    const good = golden[ id ] === normalise( id, out[ id ] );
    if ( good ) { same++; } else { ok( 'golden: ' + id + ' is unchanged', false ); }
  }
  for ( const id of Object.keys( CASES ).filter( ( i ) => ADDED.test( i ) ) ) {
    ok( 'extra blob: ' + id + ' now draws it, in front of nothing else but behind the main layer', 1 === ( out[ id ].match( /framify-organic__deco--extra/g ) || [] ).length );
  }
  ok( 'golden: ' + same + ' of ' + Object.keys( CASES ).length + ' snapshots are byte-identical to the baseline', same === Object.keys( CASES ).length );

  /* ---------- behaviour of the 1.18.0 additions ---------- */
  const SQUARE = '<svg viewBox="0 0 100 100"><path d="M0 0H100V100H0Z"/></svg>';
  const run = async ( kind, settings, fn, interact ) => {
    const page = await browser2.newPage( { viewport: { width: 800, height: 600 } } );
    page.on( 'pageerror', ( e ) => errors.push( 'behaviour: ' + e.message ) );
    await page.addInitScript( 'window.framifyOrganic = ' + config + ';' );
    await page.goto( 'file://' + path.join( __dirname, 'organic.html' ) );
    await page.evaluate( ( [ k, st ] ) => { window.__m = window.mountOrganic( 'c1', k, st ); }, [ kind, settings ] );
    await page.waitForTimeout( 150 );
    if ( 'hover' === interact ) {
      await page.evaluate( () => { window.__m.host.dispatchEvent( new MouseEvent( 'mouseenter' ) ); } );
      await page.waitForTimeout( 900 );
    }
    const res = await fn( page );
    await page.close();
    return res;
  };
  const browser2 = await chromium.launch( process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {} );
  const q = ( page, code ) => page.evaluate( code );

  // The Deco Blob on its own: Organic Shape off.
  for ( const kind of [ 'container', 'spacer', 'image' ] ) {
    const r = await run( kind, { framify_org_enable: '', framify_org_deco: 'yes', framify_org_deco_shape: 'splash' }, ( page ) => q( page, () => {
      const h = window.__m.host;
      return {
        blobs: h.querySelectorAll( '.framify-organic__deco--extra' ).length,
        clip: h.querySelectorAll( 'clipPath' ).length + ( h.style.clipPath ? 1 : 0 ) + h.querySelectorAll( '.framify-organic__fill' ).length,
        placed: ( h.querySelector( '.framify-organic__deco--extra' ).getAttribute( 'style' ) || '' ).indexOf( 'width' ) > -1
      };
    } ) );
    ok( 'deco alone (' + kind + '): with Organic Shape off the blob is drawn and placed, with no clip or fill', 1 === r.blobs && 0 === r.clip && r.placed );
  }
  ok( 'deco alone: nothing is drawn when the switch is off too', 0 === ( await run( 'container', { framify_org_enable: '', framify_org_deco: '' }, ( page ) => q( page, () => window.__m.host.querySelectorAll( 'svg' ).length ) ) ) );
  const aloneHover = await run( 'container', { framify_org_enable: '', framify_org_deco: 'yes', framify_org_deco_trigger: 'hover', framify_org_deco_duration: { size: 400 }, framify_org_deco_shape: 'pebble' }, async ( page ) => {
    const d0 = await q( page, () => window.__m.host.querySelector( '.framify-organic__deco--extra path' ).getAttribute( 'd' ) );
    await page.evaluate( () => { window.__m.host.dispatchEvent( new MouseEvent( 'mouseenter' ) ); } );
    await page.waitForTimeout( 900 );
    return d0 !== await q( page, () => window.__m.host.querySelector( '.framify-organic__deco--extra path' ).getAttribute( 'd' ) );
  } );
  ok( 'deco alone: its own hover trigger morphs it', aloneHover );
  ok( 'deco alone: "Same as shape" with no shape means it stays still', false === await run( 'container', { framify_org_enable: '', framify_org_deco: 'yes', framify_org_deco_shape: 'pebble' }, async ( page ) => {
    const d0 = await q( page, () => window.__m.host.querySelector( '.framify-organic__deco--extra path' ).getAttribute( 'd' ) );
    await page.evaluate( () => { window.__m.host.dispatchEvent( new MouseEvent( 'mouseenter' ) ); } );
    await page.waitForTimeout( 500 );
    return d0 !== await q( page, () => window.__m.host.querySelector( '.framify-organic__deco--extra path' ).getAttribute( 'd' ) );
  } ) );

  // Every mode draws the blob when the switch is on; it sits behind the clipped fill.
  const bgOrder = await run( 'container', { ...base, framify_org_mode: 'bg', framify_org_deco: 'yes', framify_org_shape: 'pebble' }, ( page ) => q( page, () => {
    const kids = [ ...window.__m.host.children ].map( ( c ) => ( c.getAttribute( 'class' ) || '' ).split( ' ' ).filter( ( x ) => /framify-organic__(fill|deco)/.test( x ) ).join( ' ' ) ).filter( Boolean );
    return kids.join( ',' );
  } ) );
  ok( 'bg mode: the Deco Blob is the first child, under the clipped fill', 'framify-organic__deco framify-organic__deco--extra,framify-organic__fill' === bgOrder );

  // Full parity: own shape, flips, pasted SVG and motion on the blob.
  const flipTransform = await run( 'container', { ...base, framify_org_mode: 'clip', framify_org_deco: 'yes', framify_org_deco_shape: 'custom', framify_org_deco_custom_svg: CUSTOM_SVG, framify_org_deco_flip_h: 'yes', framify_org_shape: 'pebble' }, ( page ) => q( page, () => window.__m.host.querySelector( '.framify-organic__deco--extra path' ).getAttribute( 'transform' ) ) );
  ok( 'deco parity: a pasted SVG with Flip horizontal gets the flip in its own transform chain', /scale\(-1 1\)/.test( flipTransform ) && /scale\(/.test( flipTransform ) );
  const decoMotion = async ( motion ) => run( 'container', { ...base, framify_org_mode: 'clip', framify_org_deco: 'yes', framify_org_deco_shape: 'custom', framify_org_deco_custom_svg: CUSTOM_SVG, framify_org_deco_trigger: 'hover', framify_org_deco_duration: { size: 400 }, framify_org_deco_spring: 'subtle', framify_org_deco_custom_motion: motion, framify_org_trigger: 'none', framify_org_shape: 'pebble' }, async ( page ) => {
    const read = () => q( page, () => { const p = window.__m.host.querySelector( '.framify-organic__deco--extra path' ); return [ p.getAttribute( 'd' ), p.getAttribute( 'transform' ) ]; } );
    const before = await read();
    await page.evaluate( () => { window.__m.host.dispatchEvent( new MouseEvent( 'mouseenter' ) ); } );
    await page.waitForTimeout( 900 );
    const after = await read();
    return { d: before[ 0 ] !== after[ 0 ], t: before[ 1 ] !== after[ 1 ] };
  } );
  const mStatic = await decoMotion( 'static' );
  const mGentle = await decoMotion( 'gentle' );
  const mLiquid = await decoMotion( 'liquid' );
  ok( 'deco parity: Custom motion Static keeps a pasted blob still', ! mStatic.d && ! mStatic.t );
  ok( 'deco parity: Custom motion Gentle tilts and swells the pasted blob (its transform changes, its path does not)', mGentle.t && ! mGentle.d );
  ok( 'deco parity: Custom motion Liquid ripples the pasted blob (its path changes)', mLiquid.d );

  // Overlay path and its CSS controls.
  const ov = await run( 'container', { ...base, framify_org_mode: 'clip', framify_org_deco: 'yes', framify_org_shape: 'pebble' }, ( page ) => q( page, () => {
    const svg = window.__m.host.querySelector( '.framify-organic__deco--extra' );
    const twin = svg.querySelector( '.framify-organic__overlay' );
    const before = getComputedStyle( twin ).fill;
    svg.style.setProperty( '--framify-deco-overlay', 'rgb(255, 0, 0)' );
    svg.style.setProperty( '--framify-deco-overlay-o', '0.5' );
    return { before, after: getComputedStyle( twin ).fill, o: getComputedStyle( twin ).fillOpacity, same: twin.getAttribute( 'd' ) === svg.querySelector( 'path' ).getAttribute( 'd' ) };
  } ) );
  ok( 'overlay: a solid blob has an overlay path with the same outline, transparent until a colour is set, then tinted at the chosen opacity', 'rgba(0, 0, 0, 0)' === ov.before || 'none' === ov.before || /rgba\(0, 0, 0, 0\)/.test( ov.before ) ? ov.same && 'rgb(255, 0, 0)' === ov.after && '0.5' === ov.o : false );
  ok( 'overlay: an Outline blob has none', 0 === await run( 'container', { ...base, framify_org_mode: 'clip', framify_org_deco: 'yes', framify_org_deco_style: 'outline', framify_org_shape: 'pebble' }, ( page ) => q( page, () => window.__m.host.querySelectorAll( '.framify-organic__overlay' ).length ) ) );

  // Shape look (Behind content mode, Deco Blob on).
  const looks = await run( 'container', { ...base, framify_org_mode: 'deco', framify_org_deco: 'yes', framify_org_deco_color: '#112233', framify_org_look: 'own', framify_org_look_color: '#aabbcc', framify_org_shape: 'pebble' }, ( page ) => q( page, () => {
    const svgs = [ ...window.__m.host.querySelectorAll( '.framify-organic__deco' ) ];
    return svgs.map( ( v ) => v.className.baseVal.indexOf( '--extra' ) > -1 ? 'extra:' + v.querySelector( 'path' ).getAttribute( 'fill' ) : 'main:' + v.querySelector( 'path' ).getAttribute( 'fill' ) ).join( ',' );
  } ) );
  ok( 'shape look Own: the extra blob keeps the Deco Blob colour and sits behind the shape, which uses its own', 'extra:#112233,main:#aabbcc' === looks );
  const shared = await run( 'container', { ...base, framify_org_mode: 'deco', framify_org_deco: 'yes', framify_org_deco_color: '#112233', framify_org_shape: 'pebble' }, ( page ) => q( page, () => [ ...window.__m.host.querySelectorAll( '.framify-organic__deco path:not(.framify-organic__overlay)' ) ].map( ( p ) => p.getAttribute( 'fill' ) ).join( ',' ) ) );
  ok( 'shape look Same (the default): both blobs share the Deco Blob look', '#112233,#112233' === shared );

  // Free Angle.
  const angleSvg = ( s ) => run( 'container', { ...base, framify_org_mode: 'deco', framify_org_shape: 'pebble', ...s }, ( page ) => q( page, () => window.__m.host.querySelector( '.framify-organic__deco' ).style.transform ) );
  ok( 'angle: a Behind content shape turns as a rigid element (CSS rotate in pixel space)', 'rotate(30deg)' === await angleSvg( { framify_org_angle: { size: 30 } } ) );
  ok( 'angle 0: no transform at all', '' === await angleSvg( { framify_org_angle: { size: 0 } } ) );
  const fitted = await angleSvg( { framify_org_angle: { size: 45 }, framify_org_angle_fit: 'yes' } );
  ok( 'angle + Keep inside the box: shrinks (a 600x300 element at 45 degrees)', /^rotate\(45deg\) scale\(0\.\d+\)$/.test( fitted ) && parseFloat( fitted.match( /scale\(([\d.]+)\)/ )[ 1 ] ) < 0.7 );
  ok( 'angle: the extra blob turns too, on top of Turn while moving', 'rotate(40deg)' === await run( 'container', { ...base, framify_org_mode: 'clip', framify_org_deco: 'yes', framify_org_shape: 'pebble', framify_org_deco_angle: { size: 40 } }, ( page ) => q( page, () => window.__m.host.querySelector( '.framify-organic__deco--extra' ).style.transform ) ) );
  // A clipped shape (objectBoundingBox) must rotate rigidly, not shear, on a 2:1 element.
  const shear = await run( 'container', { ...base, framify_org_mode: 'clip', framify_org_shape: 'custom', framify_org_custom_svg: SQUARE, framify_org_angle: { size: 20 }, framify_org_trigger: 'none' }, ( page ) => q( page, () => {
    const h = window.__m.host;
    const r = h.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const th = 20 * Math.PI / 180, u = [ Math.cos( th ), Math.sin( th ) ], v = [ -Math.sin( th ), Math.cos( th ) ];
    let agree = 0, total = 0, inside = 0;
    for ( let x = r.left + 4; x < r.right - 4; x += 12 ) {
      for ( let y = r.top + 4; y < r.bottom - 4; y += 12 ) {
        const dx = x - cx, dy = y - cy;
        const pu = Math.abs( dx * u[ 0 ] + dy * u[ 1 ] ), pv = Math.abs( dx * v[ 0 ] + dy * v[ 1 ] );
        // Skip points within 8 px of the rotated outline (anti-alias / rounding).
        if ( Math.abs( pu - r.width / 2 ) < 8 || Math.abs( pv - r.height / 2 ) < 8 ) { continue; }
        const want = pu < r.width / 2 && pv < r.height / 2;
        const el = document.elementFromPoint( x, y );
        const got = !! ( el && h.contains( el ) );
        total++;
        if ( want === got ) { agree++; }
        if ( want ) { inside++; }
      }
    }
    return { agree, total, inside };
  } ) );
  ok( 'angle: a clipped square turned 20 degrees on a 600x300 element is a true rotated rectangle (' + shear.agree + ' of ' + shear.total + ' probe points agree), not a sheared one', shear.total > 300 && shear.agree / shear.total > 0.985 && shear.inside > 100 );

  // Lifecycle: rebuild leaves one blob, teardown leaves nothing.
  const life = await run( 'container', { ...base, framify_org_mode: 'deco', framify_org_deco: 'yes', framify_org_shape: 'pebble' }, async ( page ) => {
    await page.evaluate( () => { window.__m.inst.rebuild(); } );
    await page.waitForTimeout( 100 );
    const afterRebuild = await q( page, () => window.__m.host.querySelectorAll( '.framify-organic__deco' ).length );
    await page.evaluate( () => { window.__m.inst.teardown(); } );
    return { afterRebuild, left: await q( page, () => ( { svgs: window.__m.host.querySelectorAll( 'svg' ).length, cls: window.__m.host.className, style: window.__m.host.getAttribute( 'style' ) } ) ) };
  } );
  ok( 'lifecycle: a rebuild redraws exactly the two blobs; teardown removes every layer and restores the host', 2 === life.afterRebuild && 0 === life.left.svgs && ! /framify-organic/.test( life.left.cls ) && ! life.left.style );
  await browser2.close();
  console.log( process.exitCode ? '\nFAILED' : '\nALL PASSED' );
} )();
