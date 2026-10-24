/**
 * Page loader in a real browser: the cover is there first, stays while a
 * Organic Shape is pending, goes when it is ready, and gives up after the
 * limit. Needs php; writes plain.html / shape.html next to itself.
 *   PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM=/path/to/chromium node dev/tests/loader/loader-test.js
 */
const path = require( 'path' );
const { execFileSync } = require( 'child_process' );
const { chromium } = require( process.env.PLAYWRIGHT_MODULE || 'playwright' );

execFileSync( 'php', [ path.join( __dirname, '..', 'loader-test.php' ), '--dump-html' ], { stdio: 'ignore' } );

let failed = 0;
const ok = ( name, cond ) => { console.log( ( cond ? 'PASS ' : 'FAIL ' ) + name ); if ( ! cond ) { failed++; } };

( async () => {
  const browser = await chromium.launch( process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {} );
  const errors = [];
  const open = async ( file ) => {
    const page = await browser.newPage( { viewport: { width: 800, height: 600 } } );
    page.on( 'pageerror', ( e ) => errors.push( e.message ) );
    await page.goto( 'file://' + path.join( __dirname, file ) );
    return page;
  };
  const state = ( page ) => page.evaluate( () => {
    const l = document.getElementById( 'framify-loader' );
    return { present: !! l, shown: !! l && 'none' !== getComputedStyle( l ).display && '0' !== getComputedStyle( l ).opacity, cls: document.documentElement.className };
  } );

  // No shape on the page: the cover lifts shortly after load.
  const plain = await open( 'plain.html' );
  await plain.waitForTimeout( 1200 );
  const p = await state( plain );
  ok( 'no shapes: the cover is gone and the page is released once everything has loaded', ! p.present && ! /framify-load/.test( p.cls ) );
  await plain.close();

  // A pending shape holds it.
  const shape = await open( 'shape.html' );
  const first = await state( shape );
  ok( 'shape pending: the cover is up and covers the whole viewport', first.present && first.shown && /framify-loading/.test( first.cls ) && await shape.evaluate( () => { const r = document.getElementById( 'framify-loader' ).getBoundingClientRect(); return r.width === innerWidth && r.height === innerHeight; } ) );
  ok( 'shape pending: the page behind cannot scroll', 'hidden' === await shape.evaluate( () => getComputedStyle( document.documentElement ).overflow ) );
  await shape.waitForTimeout( 1200 );
  ok( 'shape pending: the cover is still there after the page has loaded', ( await state( shape ) ).shown );
  await shape.evaluate( () => { document.getElementById( 'm' ).setAttribute( 'data-framify-shape', 'ready' ); } );
  await shape.waitForTimeout( 700 );
  const done = await state( shape );
  ok( 'shape ready: the cover fades out and is removed', ! done.present && ! /framify-load/.test( done.cls ) );
  await shape.close();

  // A shape that never gets ready: the limit lifts it (3 s here).
  const stuck = await open( 'shape.html' );
  await stuck.waitForTimeout( 2300 );
  ok( 'safety limit: still covered before the limit', ( await state( stuck ) ).shown );
  await stuck.waitForTimeout( 1600 );
  ok( 'safety limit: the cover lifts after the limit even if a shape never finishes', ! ( await state( stuck ) ).present );
  await stuck.close();

  // Reduced motion: no fade.
  const rm = await browser.newPage( { viewport: { width: 800, height: 600 }, reducedMotion: 'reduce' } );
  await rm.goto( 'file://' + path.join( __dirname, 'plain.html' ) );
  await rm.waitForTimeout( 500 );
  ok( 'reduced motion: the cover goes without waiting for a fade', ! ( await state( rm ) ).present );
  await rm.close();

  ok( 'no page errors', 0 === errors.length );
  await browser.close();
  console.log( failed ? '\nFAILED' : '\nALL PASSED' );
  process.exit( failed ? 1 : 0 );
} )();
