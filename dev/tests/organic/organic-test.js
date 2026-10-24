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
  let same = 0;
  for ( const id of Object.keys( CASES ) ) {
    const good = golden[ id ] === out[ id ];
    if ( good ) { same++; } else { ok( 'golden: ' + id + ' is unchanged', false ); }
  }
  ok( 'golden: ' + same + ' of ' + Object.keys( CASES ).length + ' snapshots are byte-identical to the baseline', same === Object.keys( CASES ).length );
  console.log( process.exitCode ? '\nFAILED' : '\nALL PASSED' );
} )();
