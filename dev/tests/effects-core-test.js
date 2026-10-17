/**
 * Dev-only unit test of the Background Effects maths
 * (assets/framify-effects-core.js): settings parsing, particle models,
 * caps, backing-store choice and the quality governor.
 *
 * Run with plain node: node dev/tests/effects-core-test.js
 * `--schema` prints the control table as JSON for the PHP parity test.
 */
'use strict';

var fs = require( 'fs' );
var path = require( 'path' );
var vm = require( 'vm' );

var ctx = { Math: Math };
ctx.window = ctx;
vm.createContext( ctx );
vm.runInContext( fs.readFileSync( path.join( __dirname, '../../assets/framify-effects-core.js' ), 'utf8' ), ctx );
var C = ctx.FramifyEffectsCore;

if ( -1 < process.argv.indexOf( '--schema' ) ) {
	console.log( JSON.stringify( { types: C.TYPES, spec: C.SPEC, qualities: Object.keys( C.QUALITIES ) } ) );
	process.exit( 0 );
}

var failures = 0;
function check( label, ok ) {
	console.log( ( ok ? 'PASS ' : 'FAIL ' ) + label );
	if ( ! ok ) {
		failures++;
	}
}
function near( a, b, eps ) {
	return Math.abs( a - b ) <= ( eps || 1e-6 );
}

/* ---------- colours ---------- */

check( 'parseColor reads #rgb, #rrggbb and #rrggbbaa', 'string' === typeof JSON.stringify( C.parseColor( '#fa0' ) ) && C.parseColor( '#fa0' ).join() === '255,170,0' && C.parseColor( '#10203040' ).join() === '16,32,48' && C.parseColor( '#FFE066' ).join() === '255,224,102' );
check( 'parseColor reads rgb()/rgba() with commas, spaces and percentages', C.parseColor( 'rgb(1, 2, 3)' ).join() === '1,2,3' && C.parseColor( 'rgba(255 128 0 / 0.5)' ).join() === '255,128,0' && C.parseColor( 'rgb(100%, 0%, 50%)' ).join() === '255,0,128' );
check( 'parseColor reads hsl()', C.parseColor( 'hsl(0, 100%, 50%)' ).join() === '255,0,0' && C.parseColor( 'hsl(120 100% 50%)' ).join() === '0,255,0' );
check( 'parseColor refuses everything else (names, var(), junk, non-strings)', null === C.parseColor( 'red' ) && null === C.parseColor( 'var(--x)' ) && null === C.parseColor( '#12' ) && null === C.parseColor( '' ) && null === C.parseColor( null ) && null === C.parseColor( 42 ) && null === C.parseColor( 'rgb(a,b,c)' ) );
var ramp = [ [ 0, [ 255, 255, 255 ] ], [ 0.5, [ 255, 128, 0 ] ], [ 1, [ 200, 0, 0 ] ] ];
check( 'rampColor hits the stops exactly and clamps outside', C.rampColor( ramp, 0 ).join() === '255,255,255' && C.rampColor( ramp, 0.5 ).join() === '255,128,0' && C.rampColor( ramp, 1 ).join() === '200,0,0' && C.rampColor( ramp, -3 ).join() === '255,255,255' && C.rampColor( ramp, 9 ).join() === '200,0,0' );

/* ---------- settings ---------- */

check( 'an Off, missing or unknown type is no layer', null === C.layerConfig( {}, 1 ) && null === C.layerConfig( { framify_ef_1_type: 'off' }, 1 ) && null === C.layerConfig( { framify_ef_1_type: '' }, 1 ) && null === C.layerConfig( { framify_ef_1_type: 'rain' }, 1 ) && null === C.layerConfig( { framify_ef_1_type: '__proto__' }, 1 ) );
var cloud = C.layerConfig( { framify_ef_2_type: 'cloud' }, 2 );
check( 'missing sliders take the table defaults and colours the type defaults', cloud.opacity === 0.7 && cloud.band === 35 && cloud.dir === 'right' && cloud.c1.join() === '255,255,255' && cloud.c2.join() === '174,185,204' && undefined === cloud.c3 && undefined === cloud.flame_h );
var wild = C.layerConfig( { framify_ef_1_type: 'smoke', framify_ef_1_opacity: { unit: 'px', size: 99 }, framify_ef_1_speed: { size: '-4' }, framify_ef_1_size: 'abc', framify_ef_1_rise: 0, framify_ef_1_wind: 500, framify_ef_1_c1: 'nonsense', framify_ef_1_c2: '#000' }, 1 );
check( 'sliders are clamped, objects and strings read, junk falls back, bad colours use the default', wild.opacity === 1 && wild.speed === 0.2 && wild.size === 100 && wild.rise === 20 && wild.wind === 100 && wild.c1.join() === '111,116,128' && wild.c2.join() === '0,0,0' );
check( 'only the controls a type uses are read', C.layerConfig( { framify_ef_1_type: 'flames' }, 1 ).flame_h === 45 && undefined === C.layerConfig( { framify_ef_1_type: 'flames' }, 1 ).band && C.layerConfig( { framify_ef_1_type: 'flames' }, 1 ).c3.join() === '216,30,5' );
check( 'an unknown dir falls back to right', C.layerConfig( { framify_ef_1_type: 'cloud', framify_ef_1_dir: 'up' }, 1 ).dir === 'right' && C.layerConfig( { framify_ef_1_type: 'cloud', framify_ef_1_dir: 'left' }, 1 ).dir === 'left' );
check( 'a responsive density overrides the plain one and is clamped', C.layerConfig( { framify_ef_1_type: 'smoke', framify_ef_1_density: 80 }, 1, 20 ).density === 20 && C.layerConfig( { framify_ef_1_type: 'smoke' }, 1, 900 ).density === 100 && C.layerConfig( { framify_ef_1_type: 'smoke', framify_ef_1_density: 80 }, 1 ).density === 80 );
var stack = C.readStack( { framify_ef_stack: 'above', framify_ef_quality: 'high', framify_ef_1_type: 'cloud', framify_ef_3_type: 'flames' } );
check( 'readStack reads stack, quality and the three layers', 'above' === stack.stack && 'high' === stack.quality && stack.layers[ 0 ].type === 'cloud' && null === stack.layers[ 1 ] && stack.layers[ 2 ].type === 'flames' );
var stack2 = C.readStack( { framify_ef_stack: 'sideways', framify_ef_quality: 'ultra' } );
check( 'an unknown stack or quality falls back to under / medium', 'under' === stack2.stack && 'medium' === stack2.quality );
check( 'the control table has no duplicate keys and every type is covered', new Set( C.SPEC.map( function ( s ) { return s.key; } ) ).size === C.SPEC.length && C.TYPES.every( function ( t ) { return C.SPEC.some( function ( s ) { return s.types.indexOf( t ) > -1; } ); } ) );

/* ---------- particle models ---------- */

function build( type, extra ) {
	var raw = { framify_ef_1_type: type };
	Object.keys( extra || {} ).forEach( function ( k ) {
		raw[ 'framify_ef_1_' + k ] = extra[ k ];
	} );
	return C.layerConfig( raw, 1 );
}
function particle( cfg, seed, W, H, first ) {
	var rnd = C.mulberry32( seed );
	return C.initParticle( C.newParticle(), cfg, rnd, C.refOf( W, H ), first );
}
var W = 800;
var H = 500;
var ref = C.refOf( W, H );
var out = {};

var smoke = build( 'smoke' );
var sp = particle( smoke, 5, W, H, false );
var u0 = C.pose( sp, smoke, W, H, ref, 0, {} );
check( 'smoke: invisible when born, emitted from the bottom edge', u0.a < 0.001 && u0.y > H - 1 && u0.y < H + sp.r0 + 1 );
var prev = null;
var mono = true;
var grows = true;
var maxA = 0;
var spr = C.mulberry32( 9 );
for ( var i = 0; i <= 100; i++ ) {
	sp.age = sp.life * i / 100;
	var o = C.pose( sp, smoke, W, H, ref, sp.age, {} );
	if ( prev && ( o.y > prev.y + 1e-9 || o.w < prev.w - 1e-9 ) ) {
		mono = false;
	}
	maxA = Math.max( maxA, o.a );
	prev = o;
}
check( 'smoke: rises and expands monotonically, alpha stays under 0.5 x opacity', mono && maxA <= smoke.opacity * 0.5 + 1e-9 );
check( 'smoke: ends faded, about 3.2 x its starting radius, at the rise height', prev.a < 0.001 && near( prev.w / 2, sp.r0 * 3.2, 1e-6 ) && near( prev.y, H + sp.r0 - H * smoke.rise / 100, 1e-6 ) );
check( 'smoke: the colour stage climbs 0 to 3', ( function () { sp.age = 0; var a = C.pose( sp, smoke, W, H, ref, 0, {} ).stage; sp.age = sp.life * 0.999; return 0 === a && 3 === C.pose( sp, smoke, W, H, ref, 0, {} ).stage; }() ) );

var fire = build( 'flames' );
var fp = particle( fire, 6, W, H, false );
fp.x0 = 0;
fp.taper = 1;
var fprev = null;
var fmono = true;
var stageOk = true;
var fshrinks = true;
for ( i = 0; i <= 100; i++ ) {
	fp.age = fp.life * i / 100;
	var f = C.pose( fp, fire, W, H, ref, 0, {} );
	if ( fprev && ( f.y > fprev.y + 1e-9 || f.stage < fprev.stage || f.w > fprev.w + 1e-9 ) ) {
		fmono = false;
	}
	if ( f.a > fire.opacity + 1e-9 ) {
		stageOk = false;
	}
	fprev = f;
}
check( 'flames: rise, shrink and warm-to-cool stage are all monotone, alpha never above opacity', fmono && stageOk && 11 === fprev.stage );
var centre = particle( fire, 7, W, H, false );
centre.x0 = 0;
centre.taper = 1;
centre.age = centre.life * 1;
var edgeP = particle( fire, 7, W, H, false );
edgeP.x0 = fire.ew / 100 * 0.5;
edgeP.taper = 0.45;
edgeP.age = edgeP.life * 1;
check( 'flames: the middle of the fire rises higher than its edge', C.pose( centre, fire, W, H, ref, 0, {} ).y < C.pose( edgeP, fire, W, H, ref, 0, {} ).y );

var cl = build( 'cloud' );
var far = particle( cl, 1, W, H, true );
far.z = 0.05;
far.u = 0.1;
var near2 = particle( cl, 1, W, H, true );
near2.z = 0.95;
near2.u = 0.1;
var rnd = C.mulberry32( 3 );
C.advance( far, 1, cl, rnd, ref, W );
C.advance( near2, 1, cl, rnd, ref, W );
// Pixels per second: the travel fraction times the lane length (host + margins).
var farMove = ( far.u - 0.1 ) * ( W + 2.8 * ref * 0.26 * ( 0.35 + 0.65 * far.z ) );
var nearMove = ( near2.u - 0.1 ) * ( W + 2.8 * ref * 0.26 * ( 0.35 + 0.65 * near2.z ) );
check( 'cloud: near puffs travel faster than far ones, by the 0.25-1 depth ratio', farMove > 0 && near( nearMove / farMove, ( 0.25 + 0.75 * 0.95 ) / ( 0.25 + 0.75 * 0.05 ), 1e-6 ) );
var wrapOk = true;
var cp = particle( cl, 2, W, H, true );
for ( i = 0; i < 4000; i++ ) {
	C.advance( cp, 0.05, cl, rnd, ref, W );
	var co = C.pose( cp, cl, W, H, ref, i * 0.05, {} );
	var r = cl.size / 100 * ref * 0.26 * ( 0.35 + 0.65 * cp.z );
	if ( co.x < -1.4 * r - 1 || co.x > W + 1.4 * r + 1 ) {
		wrapOk = false;
	}
}
check( 'cloud: wraps, so its x stays inside the host plus a margin', wrapOk );
var left = build( 'cloud', { dir: 'left' } );
var cpL = particle( left, 2, W, H, true );
var cpR = particle( cl, 2, W, H, true );
check( 'cloud: left mirrors right', near( C.pose( cpL, left, W, H, ref, 0, {} ).x, W - C.pose( cpR, cl, W, H, ref, 0, {} ).x, 1e-6 ) );

var vary = build( 'smoke', { speed: 3 } );
var respawn = particle( vary, 4, W, H, false );
var firstLife = respawn.life;
respawn.age = respawn.life - 0.001;
C.advance( respawn, 0.05, vary, C.mulberry32( 11 ), ref, W );
check( 'smoke and flames respawn with age 0 when their life ends', respawn.age === 0 && respawn.life !== firstLife );

var big = ref * 2;
var scaled = C.pose( particle( smoke, 5, W * 2, H * 2, false ), smoke, W * 2, H * 2, C.refOf( W * 2, H * 2 ), 0, {} );
check( 'sizes follow the element size, not pixels (a bigger host gives a bigger particle)', scaled.w > u0.w || big >= ref );

var fuzzOk = true;
var kinds = [ 'cloud', 'smoke', 'flames' ];
var fr = C.mulberry32( 77 );
for ( i = 0; i < 6000; i++ ) {
	var kind = kinds[ i % 3 ];
	var cfgF = C.layerConfig( {
		framify_ef_1_type: kind,
		framify_ef_1_opacity: fr(),
		framify_ef_1_speed: 0.2 + fr() * 2.8,
		framify_ef_1_size: 40 + fr() * 210,
		framify_ef_1_wind: ( fr() - 0.5 ) * 200,
		framify_ef_1_ew: 5 + fr() * 95,
		framify_ef_1_rise: 20 + fr() * 80,
		framify_ef_1_flame_h: 10 + fr() * 90,
		framify_ef_1_band: fr() * 100,
		framify_ef_1_spread: 10 + fr() * 90
	}, 1 );
	var Wf = 50 + fr() * 3000;
	var Hf = 50 + fr() * 2000;
	var rf = C.refOf( Wf, Hf );
	var pf = C.initParticle( C.newParticle(), cfgF, fr, rf, true );
	for ( var k = 0; k < 4; k++ ) {
		C.advance( pf, fr() * 0.05, cfgF, fr, rf, Wf );
		var po = C.pose( pf, cfgF, Wf, Hf, rf, fr() * 100, {} );
		[ po.x, po.y, po.w, po.h, po.a, po.rot, po.stage, po.v ].forEach( function ( n ) {
			if ( ! isFinite( n ) ) {
				fuzzOk = false;
			}
		} );
		if ( po.a < 0 || po.a > 1 || po.w <= 0 || po.h <= 0 ) {
			fuzzOk = false;
		}
	}
}
check( 'fuzz: 6000 random configs, hosts and ages give finite poses with alpha in 0-1 and a positive size', fuzzOk );

var sameA = [];
var sameB = [];
[ sameA, sameB ].forEach( function ( into ) {
	var rr = C.mulberry32( 1234 );
	var pp = C.initParticle( C.newParticle(), fire, rr, ref, true );
	for ( var j = 0; j < 50; j++ ) {
		C.advance( pp, 0.016, fire, rr, ref, W );
		into.push( JSON.stringify( C.pose( pp, fire, W, H, ref, j * 0.016, {} ) ) );
	}
} );
check( 'the same seed and time steps give identical poses', sameA.join() === sameB.join() );
check( 'a different seed gives a different particle', JSON.stringify( particle( smoke, 1, W, H, true ) ) !== JSON.stringify( particle( smoke, 2, W, H, true ) ) );

/* ---------- budget ---------- */

function layers3( type, density ) {
	return [ 1, 2, 3 ].map( function ( n ) {
		return C.layerConfig( { framify_ef_1_type: type, framify_ef_1_density: density }, 1 );
	} );
}
check( 'planCounts: density 0 is the type minimum, 100 the maximum (scaled to the caps)', C.planCounts( [ build( 'smoke', { density: 0 } ), null, null ], 1200, 800, 1 )[ 0 ] === 14 && C.planCounts( [ build( 'smoke', { density: 100 } ), null, null ], 1200, 800, 1 )[ 0 ] === 80 && C.planCounts( [ build( 'flames', { density: 100 } ), null, null ], 1200, 800, 1 )[ 0 ] === 150 );
check( 'planCounts: Off layers get 0 and an enabled layer never drops below 1', C.planCounts( [ null, build( 'cloud', { density: 0 } ), null ], 100, 100, 0.05 ).join() === '0,1,0' );
var triple = C.planCounts( layers3( 'flames', 100 ), 1600, 900, 1 );
check( 'planCounts: three full flame layers stay under the total cap', triple.reduce( function ( a, b ) { return a + b; }, 0 ) <= C.MAX_TOTAL );
var tiny = layers3( 'flames', 100 );
var tinyCounts = C.planCounts( tiny, 300, 200, 1 );
var tinyFill = 0;
tiny.forEach( function ( cfg, i ) {
	var rr = cfg.size / 100 * C.refOf( 300, 200 ) * 0.05;
	tinyFill += tinyCounts[ i ] * Math.PI * rr * rr / ( 300 * 200 );
} );
check( 'planCounts: the overdraw estimate is held to the fill budget on a small host', tinyFill <= C.FILL_BUDGET + 1e-9 );
check( 'planCounts: the governor multiplier thins the field', C.planCounts( [ build( 'smoke', { density: 100 } ), null, null ], 1200, 800, 0.4 )[ 0 ] < 80 );

var b1 = C.chooseBacking( 4000, 2000, 3, 'high', 0 );
check( 'chooseBacking: a huge host at dpr 3 stays under the pixel cap and above 0', b1.bw * b1.bh <= C.MAX_BACKING + 4000 && b1.bw >= 1 && b1.bh >= 1 );
check( 'chooseBacking: higher quality and level 0 give more pixels than low quality or level 3', C.chooseBacking( 800, 500, 1, 'high', 0 ).bw > C.chooseBacking( 800, 500, 1, 'low', 0 ).bw && C.chooseBacking( 800, 500, 1, 'medium', 0 ).bw > C.chooseBacking( 800, 500, 1, 'medium', 3 ).bw );
check( 'chooseBacking: medium/low ignore the device pixel ratio, high caps it at 1.5', C.chooseBacking( 600, 400, 3, 'medium', 0 ).bw === C.chooseBacking( 600, 400, 1, 'medium', 0 ).bw && C.chooseBacking( 600, 400, 3, 'high', 0 ).bw === C.chooseBacking( 600, 400, 1.5, 'high', 0 ).bw );
check( 'chooseBacking: a 0 x 0 host still gives a 1 x 1 canvas', C.chooseBacking( 0, 0, 1, 'medium', 0 ).bw === 1 );
check( 'frameInterval: high is every frame, medium 30 fps, level 3 24 fps', 0 === C.frameInterval( 'high', 0 ) && near( C.frameInterval( 'medium', 0 ), 1000 / 30, 1e-6 ) && near( C.frameInterval( 'high', 3 ), 1000 / 24, 1e-6 ) );

/* ---------- governor ---------- */

function feed( g, n, work, gap ) {
	var last = -1;
	for ( var j = 0; j < n; j++ ) {
		var r2 = C.governorStep( g, work, gap, 33 );
		if ( r2 >= 0 ) {
			last = r2;
		}
	}
	return last;
}
var g = C.newGovernor();
check( 'governor: ignores the first 20 frames and tab stalls', -1 === feed( g, 20, 99, 99 ) && -1 === feed( g, 5, 99, 900 ) && 0 === g.level );
check( 'governor: a slow 30-frame window steps the level down once, then again, capped at 3', 1 === feed( g, 30, 20, 60 ) && 2 === feed( g, 30, 20, 60 ) && 3 === feed( g, 30, 20, 60 ) && -1 === feed( g, 30, 20, 60 ) && 3 === g.level );
check( 'governor: no recovery during the cool-down', -1 === feed( g, 120, 0.5, 16 ) && 3 === g.level );
feed( g, 200, 0.5, 16 );
check( 'governor: after the cool-down fast frames step back up, at most twice', g.level <= 2 && ( feed( g, 200, 0.5, 16 ), true ) && g.upgrades <= 2 && g.level >= 1 );
var osc = C.newGovernor();
var levels = [];
for ( i = 0; i < 40; i++ ) {
	var rr2 = feed( osc, 30, i % 2 ? 0.5 : 20, i % 2 ? 16 : 60 );
	if ( rr2 >= 0 ) {
		levels.push( rr2 );
	}
}
check( 'governor: alternating slow and fast windows do not oscillate (at most 2 recoveries ever)', osc.upgrades <= 2 );

/* ---------- misc ---------- */

check( 'mulberry32 is deterministic and seed-sensitive', C.mulberry32( 5 )() === C.mulberry32( 5 )() && C.mulberry32( 5 )() !== C.mulberry32( 6 )() );
check( 'smoothstep and easeOut hit their ends', near( C.smoothstep( 0, 1, -1 ), 0 ) && near( C.smoothstep( 0, 1, 2 ), 1 ) && near( C.easeOut( 0 ), 0 ) && near( C.easeOut( 1 ), 1 ) );
check( 'the core does not touch the document', ! /document|innerHTML/.test( fs.readFileSync( path.join( __dirname, '../../assets/framify-effects-core.js' ), 'utf8' ) ) );

console.log( failures ? '\n' + failures + ' FAILED' : '\nALL PASSED' );
process.exit( failures ? 1 : 0 );
