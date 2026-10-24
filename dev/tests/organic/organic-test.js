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

  // Blob position: Above the shape.
  const order = ( mode, extra ) => run( 'container', { ...base, framify_org_mode: mode, framify_org_deco: 'yes', framify_org_shape: 'pebble', ...extra }, ( page ) => q( page, () => [ ...window.__m.host.children ].map( ( c ) => /__deco--extra/.test( c.getAttribute( 'class' ) || '' ) ? 'blob' : /__fill/.test( c.getAttribute( 'class' ) || '' ) ? 'fill' : /__deco/.test( c.getAttribute( 'class' ) || '' ) ? 'shape' : '' ).filter( Boolean ).join( ',' ) ) );
  ok( 'blob position: clip mode, Behind (default) puts the blob before the fill', 'blob,fill' === await order( 'clip', {} ) );
  ok( 'blob position: clip mode, Above puts it after the fill', 'fill,blob' === await order( 'clip', { framify_org_deco_layer: 'above' } ) );
  ok( 'blob position: bg mode, Above puts it after the fill', 'fill,blob' === await order( 'bg', { framify_org_deco_layer: 'above' } ) );
  ok( 'blob position: Behind content, Behind = blob under the shape', 'blob,shape' === await order( 'deco', { framify_org_deco_layer: 'behind' } ) );
  ok( 'blob position: Behind content, Above = blob over the shape', 'shape,blob' === await order( 'deco', { framify_org_deco_layer: 'above' } ) );
  const imgAbove = await run( 'image', { framify_org_enable: 'yes', framify_org_deco: 'yes', framify_org_deco_layer: 'above' }, ( page ) => q( page, () => {
    const h = window.__m.host;
    const blob = h.querySelector( '.framify-organic__deco--extra' );
    const img = h.querySelector( 'img' );
    return { after: !! ( img.compareDocumentPosition( blob ) & Node.DOCUMENT_POSITION_FOLLOWING ), z: getComputedStyle( blob ).zIndex };
  } ) );
  ok( 'blob position: Image widget, Above puts the blob after the photo at z-index 1', imgAbove.after && '1' === imgAbove.z );
  const imgBehind = await run( 'image', { framify_org_enable: 'yes', framify_org_deco: 'yes' }, ( page ) => q( page, () => {
    const h = window.__m.host;
    const blob = h.querySelector( '.framify-organic__deco--extra' );
    return h.firstChild === blob && '0' === getComputedStyle( blob ).zIndex;
  } ) );
  ok( 'blob position: Image widget default keeps the blob first, at z-index 0', imgBehind );

  // Grain textures, colour and size.
  const filterOf = ( settings ) => run( 'container', { ...base, framify_org_mode: 'deco', framify_org_shape: 'pebble', framify_org_deco_grain: 'yes', ...settings }, ( page ) => q( page, () => {
    const f = window.__m.host.querySelector( 'filter' );
    const prims = [ ...f.children ].map( ( n ) => n.tagName + ':' + ( n.getAttribute( 'baseFrequency' ) || '' ) + ':' + ( n.getAttribute( 'values' ) || '' ) );
    const results = [ ...f.children ].map( ( n ) => n.getAttribute( 'result' ) );
    return { prims, results, count: f.children.length, attached: !! f.parentNode };
  } ) );
  const legacy = await filterOf( {} );
  for ( const t of [ 'speckle', 'chalk', 'brush', 'fibre', 'film', 'halftone' ] ) {
    const r = await filterOf( { framify_org_grain_texture: t } );
    ok( 'grain texture ' + t + ': builds a filter that names a specks result and ends merged into the shape', r.results.indexOf( 'specks' ) > -1 && 'feMerge' === r.prims[ r.prims.length - 1 ].split( ':' )[ 0 ] );
    if ( 'speckle' === t ) {
      ok( 'grain texture speckle: identical to the filter with no texture saved (saved pages unchanged)', JSON.stringify( r.prims ) === JSON.stringify( legacy.prims ) );
    } else {
      ok( 'grain texture ' + t + ': differs from the classic speckle', JSON.stringify( r.prims ) !== JSON.stringify( legacy.prims ) );
    }
  }
  const unknown = await filterOf( { framify_org_grain_texture: 'nonsense' } );
  ok( 'grain texture: an unknown value falls back to speckle', JSON.stringify( unknown.prims ) === JSON.stringify( legacy.prims ) );
  const red = await filterOf( { framify_org_grain_color: '#ff0000' } );
  ok( 'grain colour: red grain writes red channels into the mask matrix', /^feColorMatrix::0 0 0 0 1 {2}0 0 0 0 0 {2}0 0 0 0 0 /.test( red.prims[ 1 ] ) );
  ok( 'grain colour: white (the default) and a cleared colour are the same filter', JSON.stringify( ( await filterOf( { framify_org_grain_color: '' } ) ).prims ) === JSON.stringify( legacy.prims ) );
  const coarse = await filterOf( { framify_org_grain_size: { size: 100 } } );
  const fine = await filterOf( { framify_org_grain_size: { size: 1 } } );
  const freq = ( r ) => parseFloat( r.prims[ 0 ].split( ':' )[ 1 ] );
  ok( 'grain size: 100 is coarser (lower frequency) and 1 finer than the default 50', freq( coarse ) < freq( legacy ) && freq( legacy ) < freq( fine ) );

  // Shape animations.
  const animState = ( settings, kind, wait ) => run( kind || 'container', { ...base, framify_org_mode: 'clip', framify_org_shape: 'pebble', framify_org_duration: { size: 400 }, framify_org_spring: 'subtle', ...settings }, async ( page ) => {
    const read = () => q( page, () => {
      const c = window.__m.host.querySelector( 'clipPath path' );
      return { d: c.getAttribute( 'd' ), t: c.getAttribute( 'transform' ) };
    } );
    const rest = await read();
    await page.evaluate( () => { window.__m.host.dispatchEvent( new MouseEvent( 'mouseenter' ) ); } );
    await page.waitForTimeout( wait || 130 );
    const mid = await read();
    await page.waitForTimeout( 1200 );
    return { rest, mid, end: await read() };
  } );
  const none = await animState( { framify_org_trigger: 'hover' } );
  const spin = await animState( { framify_org_trigger: 'hover', framify_org_anim: 'spin' } );
  ok( 'animation Spin: the shape turns mid-hover (clip transform changes) but its outline stays the same', spin.mid.t !== spin.rest.t && spin.mid.d === spin.rest.d );
  ok( 'animation Spin: replaces the blob hover morph (a built-in blob only morphs without an animation)', none.end.d !== none.rest.d && spin.end.d === spin.rest.d );
  const animFrom = {};
  for ( const kind of [ 'sway', 'pulse', 'jelly', 'float', 'drift' ] ) {
    animFrom[ kind ] = await animState( { framify_org_trigger: 'hover', framify_org_anim: kind } );
    ok( 'animation ' + kind + ': moves the shape mid-hover and keeps its outline', animFrom[ kind ].mid.t !== animFrom[ kind ].rest.t && animFrom[ kind ].mid.d === animFrom[ kind ].rest.d );
  }
  ok( 'animation Auto trigger means on hover for an animation (a wavy shape moves)', ( await animState( { framify_org_shape: 'tide', framify_org_anim: 'sway' } ) ).mid.t !== ( await animState( { framify_org_shape: 'tide' } ) ).mid.t );
  const morphSame = await animState( { framify_org_trigger: 'hover', framify_org_anim: 'morph', framify_org_anim_to: 'bean' } );
  ok( 'animation Morph (same structure): the outline changes towards the target and settles on it', morphSame.mid.d !== morphSame.rest.d && morphSame.end.d !== morphSame.rest.d );
  const morphCross = await animState( { framify_org_trigger: 'hover', framify_org_anim: 'morph', framify_org_anim_to: 'tide' } );
  ok( 'animation Morph (another family): resamples to a closed outline that moves', /^M[^A-Za-z]*(L[^A-Za-z]*)+Z$/.test( morphCross.end.d ) && morphCross.end.d !== morphCross.rest.d );
  const morphCustom = await animState( { framify_org_trigger: 'hover', framify_org_shape: 'custom', framify_org_custom_svg: CUSTOM_SVG, framify_org_anim: 'morph', framify_org_anim_to: 'bean' } );
  ok( 'animation Morph: a pasted single-outline shape morphs into the built-in target (a traced polygon that moves)', /^M[^A-Za-z]*(L[^A-Za-z]*)+Z$/.test( morphCustom.end.d ) && morphCustom.end.d !== morphCustom.rest.d );
  const nums = ( morphCustom.rest.d.match( /-?\d+\.?\d*/g ) || [] ).map( Number );
  const xs = nums.filter( ( _, k ) => 0 === k % 2 );
  ok( 'animation Morph: a pasted shape rests on its own outline, placed by its viewBox (x spans 10-90 of 100)', xs.length > 50 && Math.abs( Math.min( ...xs ) - 10 ) < 2 && Math.abs( Math.max( ...xs ) - 90 ) < 2 );
  const TWO = '<svg viewBox="0 0 100 100"><path d="M0 0H40V40H0Z M60 60H100V100H60Z"/></svg>';
  const twoOff = await animState( { framify_org_trigger: 'hover', framify_org_shape: 'custom', framify_org_custom_svg: TWO, framify_org_anim: 'morph', framify_org_anim_to: 'bean', framify_org_custom_motion: 'gentle' } );
  const twoPlain = await animState( { framify_org_trigger: 'hover', framify_org_shape: 'custom', framify_org_custom_svg: TWO, framify_org_custom_motion: 'gentle' } );
  ok( 'animation Morph: a pasted shape with two outlines cannot morph, so Custom motion applies as if no animation was chosen', twoOff.end.t === twoPlain.end.t && twoOff.end.d === twoPlain.end.d );
  const customSway = await animState( { framify_org_trigger: 'hover', framify_org_shape: 'custom', framify_org_custom_svg: CUSTOM_SVG, framify_org_custom_motion: 'liquid', framify_org_anim: 'sway' } );
  ok( 'animation replaces Custom motion: a pasted shape with Liquid chosen keeps its outline and sways instead', customSway.mid.d === customSway.rest.d && customSway.mid.t !== customSway.rest.t );
  const angled = await animState( { framify_org_trigger: 'hover', framify_org_angle: { size: 30 }, framify_org_anim: 'sway' } );
  ok( 'animation + Angle: both turn the shape (the rest pose already carries the angle)', /rotate\(30\)/.test( angled.rest.t ) && angled.mid.t !== angled.rest.t );
  // Keep flat edge fixed.
  const FLAT = '<svg viewBox="0 0 100 100"><path d="M0 0L60 0Q100 50 60 100L0 100Z"/></svg>';
  const pts = ( d ) => { const n = ( d.match( /-?\d+\.?\d*/g ) || [] ).map( Number ); const out = []; for ( let i = 0; i + 1 < n.length; i += 2 ) { out.push( [ n[ i ], n[ i + 1 ] ] ); } return out; };
  const held = ( a, b, near, far ) => {
    const A = pts( a ), B = pts( b );
    if ( A.length !== B.length || A.length < 20 ) { return false; }
    let stillNear = true, movedFar = false;
    A.forEach( ( q, i ) => {
      const dist = Math.hypot( q[ 0 ] - B[ i ][ 0 ], q[ 1 ] - B[ i ][ 1 ] );
      if ( near( q ) && dist > 0.06 ) { stillNear = false; }
      if ( far( q ) && dist > 0.3 ) { movedFar = true; }
    } );
    return stillNear && movedFar;
  };
  const flatBase = { framify_org_trigger: 'hover', framify_org_shape: 'custom', framify_org_custom_svg: FLAT, framify_org_edge: 'left', framify_org_custom_motion: 'gentle', framify_org_custom_amount: 'strong' };
  const pinned = await animState( { ...flatBase, framify_org_edge_pin: 'yes' } );
  ok( 'flat edge pinned: Gentle on a pasted shape moves the outline but the straight side stays put', held( pinned.rest.d, pinned.end.d, ( q ) => q[ 0 ] < 2, ( q ) => q[ 0 ] > 40 ) );
  const loose = await animState( { ...flatBase } );
  ok( 'flat edge not pinned (switch off or an old page): Gentle moves the whole shape by its transform, outline unchanged', loose.rest.d === loose.end.d && loose.rest.t !== loose.end.t );
  const along = ( d, near ) => pts( d ).filter( near ).length;
  const morphPinned = await animState( { ...flatBase, framify_org_anim: 'morph', framify_org_anim_to: 'splash', framify_org_edge_pin: 'yes' } );
  const morphFree = await animState( { ...flatBase, framify_org_anim: 'morph', framify_org_anim_to: 'splash' } );
  const onLeft = ( q ) => q[ 0 ] < 1;
  ok( 'flat edge pinned: Morph of a pasted shape keeps the straight side (' + along( morphPinned.end.d, onLeft ) + ' outline points still on it, against ' + along( morphFree.end.d, onLeft ) + ' unpinned)', along( morphPinned.end.d, onLeft ) >= 8 && along( morphFree.end.d, onLeft ) < 3 );
  ok( 'flat edge pinned: the rest of the pasted shape still morphs', morphPinned.end.d !== morphPinned.rest.d && along( morphPinned.end.d, ( q ) => q[ 0 ] > 40 ) > 20 );
  const wavy = await animState( { framify_org_trigger: 'hover', framify_org_shape: 'tide', framify_org_edge: 'right', framify_org_anim: 'morph', framify_org_anim_to: 'splash', framify_org_edge_pin: 'yes' } );
  const wavyFree = await animState( { framify_org_trigger: 'hover', framify_org_shape: 'tide', framify_org_edge: 'right', framify_org_anim: 'morph', framify_org_anim_to: 'splash' } );
  const onRight = ( q ) => q[ 0 ] > 99;
  ok( 'flat edge pinned: Morph of a built-in Wavy shape keeps its right edge (' + along( wavy.end.d, onRight ) + ' points on it, against ' + along( wavyFree.end.d, onRight ) + ' unpinned)', along( wavy.end.d, onRight ) >= 8 && along( wavyFree.end.d, onRight ) < 3 );

  // Loop clock: a Spin keeps turning the same way.
  const clock = await run( 'container', { ...base, framify_org_mode: 'clip', framify_org_shape: 'pebble', framify_org_trigger: 'loop', framify_org_duration: { size: 500 }, framify_org_anim: 'spin' }, async ( page ) => {
    const rot = () => q( page, () => { const m = /rotate\(([-\d.e]+)/.exec( window.__m.host.querySelector( 'clipPath path' ).getAttribute( 'transform' ) ); return m ? parseFloat( m[ 1 ] ) : null; } );
    await page.waitForTimeout( 400 );
    const a = await rot();
    await page.waitForTimeout( 400 );
    const b = await rot();
    await page.waitForTimeout( 400 );
    const v = await q( page, () => window.__m.inst.fx.channels.main.value );
    return [ a, b, await rot(), v ];
  } );
  ok( 'animation loop: Spin runs on a continuous clock (the angle only ever increases while the channel value stays within 0 to 1)', null !== clock[ 0 ] && clock[ 1 ] > clock[ 0 ] && clock[ 2 ] > clock[ 1 ] && clock[ 3 ] >= 0 && clock[ 3 ] <= 1 );
  // The Deco Blob's own animation.
  const decoAnim = await run( 'container', { ...base, framify_org_mode: 'clip', framify_org_shape: 'pebble', framify_org_trigger: 'none', framify_org_deco: 'yes', framify_org_deco_trigger: 'hover', framify_org_deco_duration: { size: 400 }, framify_org_deco_spring: 'subtle', framify_org_deco_anim: 'pulse' }, async ( page ) => {
    const read = () => q( page, () => window.__m.host.querySelector( '.framify-organic__deco--extra' ).style.transform );
    const rest = await read();
    await page.evaluate( () => { window.__m.host.dispatchEvent( new MouseEvent( 'mouseenter' ) ); } );
    await page.waitForTimeout( 130 );
    return [ rest, await read() ];
  } );
  ok( 'deco animation: Pulse scales the extra blob on its own trigger (CSS transform, pixel space)', '' === decoAnim[ 0 ] && /scale\(1\.\d+\)/.test( decoAnim[ 1 ] ) );
  const decoMorph = await run( 'container', { ...base, framify_org_mode: 'clip', framify_org_shape: 'pebble', framify_org_trigger: 'none', framify_org_deco: 'yes', framify_org_deco_shape: 'splash', framify_org_deco_trigger: 'hover', framify_org_deco_duration: { size: 400 }, framify_org_deco_spring: 'subtle', framify_org_deco_anim: 'morph', framify_org_deco_anim_to: 'tide' }, async ( page ) => {
    const read = () => q( page, () => window.__m.host.querySelector( '.framify-organic__deco--extra path' ).getAttribute( 'd' ) );
    const rest = await read();
    await page.evaluate( () => { window.__m.host.dispatchEvent( new MouseEvent( 'mouseenter' ) ); } );
    await page.waitForTimeout( 1200 );
    return [ rest, await read() ];
  } );
  ok( 'deco animation: Morph turns the extra blob into another family', decoMorph[ 0 ] !== decoMorph[ 1 ] && /Z$/.test( decoMorph[ 1 ] ) );
  const decoSame = await run( 'container', { ...base, framify_org_mode: 'clip', framify_org_shape: 'tide', framify_org_deco: 'yes', framify_org_deco_anim: 'spin', framify_org_deco_duration: { size: 400 }, framify_org_deco_spring: 'subtle' }, async ( page ) => {
    const read = () => q( page, () => window.__m.host.querySelector( '.framify-organic__deco--extra' ).style.transform );
    const rest = await read();
    await page.evaluate( () => { window.__m.host.dispatchEvent( new MouseEvent( 'mouseenter' ) ); } );
    await page.waitForTimeout( 130 );
    return [ rest, await read() ];
  } );
  ok( 'deco animation with the default trigger and a shape that does not animate: plays on hover', decoSame[ 0 ] !== decoSame[ 1 ] );
  // Reduced motion: no animation at all.
  const rm = await ( async () => {
    const page = await browser2.newPage( { viewport: { width: 800, height: 600 }, reducedMotion: 'reduce' } );
    await page.addInitScript( 'window.framifyOrganic = ' + config + ';' );
    await page.goto( 'file://' + path.join( __dirname, 'organic.html' ) );
    await page.evaluate( () => { window.__m = window.mountOrganic( 'c1', 'container', { framify_org_enable: 'yes', framify_org_mode: 'clip', framify_org_shape: 'pebble', framify_org_trigger: 'hover', framify_org_anim: 'spin' } ); } );
    const t0 = await page.evaluate( () => window.__m.host.querySelector( 'clipPath path' ).getAttribute( 'transform' ) );
    await page.evaluate( () => { window.__m.host.dispatchEvent( new MouseEvent( 'mouseenter' ) ); } );
    await page.waitForTimeout( 300 );
    const t1 = await page.evaluate( () => window.__m.host.querySelector( 'clipPath path' ).getAttribute( 'transform' ) );
    await page.close();
    return t0 === t1;
  } )();
  ok( 'animation: reduced motion leaves the shape still', rm );

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
