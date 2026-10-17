/**
 * Dev-only unit test of the dot-grid shape generator
 * (assets/framify-dot-shapes.js) and of the runtime that animates its output
 * (dotField / dotPair / blendDots in assets/framify-elementor.js).
 *
 * Run with plain node: node dev/tests/dot-shapes-test.js
 *
 * Both scripts are loaded into vm contexts, the same way
 * divider-sanitiser-test.js does it. Real browsers (clip rendering, winding)
 * are covered by dev/tests/shape-studio/studio-test.js.
 */
'use strict';

var fs = require( 'fs' );
var path = require( 'path' );
var vm = require( 'vm' );

var failures = 0;
function check( label, ok ) {
	console.log( ( ok ? 'PASS ' : 'FAIL ' ) + label );
	if ( ! ok ) {
		failures++;
	}
}
function load( file, context ) {
	context.window = context;
	vm.createContext( context );
	vm.runInContext( fs.readFileSync( path.join( __dirname, '../../assets/' + file ), 'utf8' ), context );
	return context;
}

/* ---------- generator (checked through the runtime recogniser) ---------- */

var Gen = load( 'framify-dot-shapes.js', { Math: Math, console: console } ).FramifyDotShapes;
var hooks = [];
var Org = load( 'framify-elementor.js', { Math: Math, console: console, DOMParser: function () {}, addEventListener: function ( n ) { hooks.push( n ); } } ).FramifyOrganicShape;

// The dots of a generated path, read by the same recogniser the front end
// uses: the generator and the runtime must agree on the format.
function dotsOf( d ) {
	var field = Org.dotField( d );
	return { outline: 0 === d.indexOf( 'M0 0H' ), dots: field ? field.dots : [], ok: !! field };
}

check( 'generator is exposed', !! Gen && 'function' === typeof Gen.generate && 'function' === typeof Gen.generateSet && 'function' === typeof Gen.normalise );

var a = Gen.generate( { seed: 7 }, 0 );
var b = Gen.generate( { seed: 7 }, 0 );
var c = Gen.generate( { seed: 8 }, 0 );
check( 'same options and seed reproduce the same shape', a.d === b.d && a.vb === b.vb );
check( 'a different seed gives a different shape', a.d !== c.d );
check( 'variation i of a seed is stable and differs from variation 0', Gen.generate( { seed: 7 }, 3 ).d === Gen.generate( { seed: 7 }, 3 ).d && Gen.generate( { seed: 7 }, 3 ).d !== a.d );

var set = Gen.generateSet( { seed: 5, variations: 8 } );
check( 'generateSet returns `variations` distinct shapes', 8 === set.length && 8 === new Set( set.map( function ( s ) { return s.d; } ) ).size );
check( 'variations are clamped to 1-12', 12 === Gen.generateSet( { variations: 99 } ).length && 1 === Gen.generateSet( { variations: 0 } ).length );

var n1 = Gen.normalise( { dots: 9999, cols: 2, steps: 0, runs: 500, min: 80, max: 20, ratio: 'banana', seed: 'x', invert: 1 } );
check( 'normalise clamps every field, swaps min/max, falls back to 1:1', 400 === n1.dots && 6 === n1.cols && 1 === n1.steps && 100 === n1.runs && 20 === n1.min && 80 === n1.max && '1:1' === n1.ratio && true === n1.invert );

var big = Gen.generate( { cols: 40, dots: 9999, ratio: '1:1' }, 0 );
check( 'dots are capped at 400 per shape', 400 === big.count );
var few = Gen.generate( { cols: 6, dots: 400, ratio: '1:1' }, 0 );
check( 'dots never exceed the number of cells (6 x 6 = 36)', 36 === few.count );
check( '400 dots stay far below the 50000-byte server cap', big.d.length < 30000 );

var parsed = dotsOf( a.d );
check( 'output is only canonical circle subpaths, and `count` matches', parsed.ok && parsed.dots.length === a.count && ! parsed.outline );
check( 'path uses only characters the server whitelist allows', ! /[^MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]/.test( a.d ) && ! /\d\s*e/i.test( a.d ) );

var sixteen = Gen.generate( { cols: 22, ratio: '16:9' }, 0 );
check( '22 columns at 16:9 give a 990 x 540 sheet', '0 0 990 540' === sixteen.vb );
var okRatios = [ '1:1', '4:3', '3:4', '16:9' ].every( function ( r ) {
	var s = Gen.generate( { ratio: r }, 0 );
	var p = s.vb.split( ' ' ).map( Number );
	var want = Gen.RATIOS[ r ][ 0 ] / Gen.RATIOS[ r ][ 1 ];
	return Math.max( p[ 2 ], p[ 3 ] ) <= 1000 && Math.abs( p[ 2 ] / p[ 3 ] - want ) < 0.08;
} );
check( 'every ratio keeps the long side <= 1000 and the aspect within a row of the request', okRatios );

var steps3 = Gen.generate( { steps: 3, min: 30, max: 80, dots: 300 }, 0 );
var radii = {};
dotsOf( steps3.d ).dots.forEach( function ( dot ) {
	radii[ dot.r ] = 1;
} );
check( 'at most `steps` distinct radii', Object.keys( radii ).length <= 3 );
var one = Gen.generate( { steps: 1, min: 30, max: 80, dots: 100 }, 0 );
var oneRadii = {};
dotsOf( one.d ).dots.forEach( function ( dot ) {
	oneRadii[ dot.r ] = 1;
} );
check( 'steps = 1 gives a single size', 1 === Object.keys( oneRadii ).length );

var inside = true;
var overlap = false;
[ 1, 2, 3, 4, 5 ].forEach( function ( seed ) {
	var s = Gen.generate( { seed: seed, dots: 400, cols: 22, max: 92 }, 0 );
	var vb = s.vb.split( ' ' ).map( Number );
	var ds = dotsOf( s.d ).dots;
	ds.forEach( function ( dot, i ) {
		if ( dot.x - dot.r < 0 || dot.y - dot.r < 0 || dot.x + dot.r > vb[ 2 ] || dot.y + dot.r > vb[ 3 ] ) {
			inside = false;
		}
		for ( var j = i + 1; j < ds.length; j++ ) {
			if ( Math.hypot( dot.x - ds[ j ].x, dot.y - ds[ j ].y ) < dot.r + ds[ j ].r ) {
				overlap = true;
			}
		}
	} );
} );
check( 'every dot lies inside the sheet', inside );
check( 'no two dots overlap, even at the largest size', ! overlap );

var inv = Gen.generate( { invert: true, seed: 3 }, 0 );
var invParsed = dotsOf( inv.d );
check( 'Invert prepends the outline and keeps the dots canonical', invParsed.outline && invParsed.ok && 0 === inv.d.indexOf( 'M0 0H' ) );
var invVb = inv.vb.split( ' ' );
check( 'the outline covers the whole sheet', 0 === inv.d.indexOf( 'M0 0H' + invVb[ 2 ] + 'V' + invVb[ 3 ] + 'H0Z' ) );
check( 'Invert does not change which cells hold dots', Gen.generate( { seed: 3, invert: false }, 0 ).count === inv.count );

function longestRun( d ) {
	var cells = {};
	dotsOf( d ).dots.forEach( function ( dot ) {
		cells[ dot.y + ':' + dot.x ] = dot;
	} );
	var best = 0;
	Object.keys( cells ).forEach( function ( key ) {
		var dot = cells[ key ];
		var left = ( dot.y ) + ':' + ( dot.x - 45 );
		if ( cells[ left ] ) {
			return;
		}
		var len = 1;
		while ( cells[ dot.y + ':' + ( dot.x + 45 * len ) ] ) {
			len++;
		}
		best = Math.max( best, len );
	} );
	return best;
}
var runSum = [ 0, 100 ].map( function ( runs ) {
	var total = 0;
	for ( var s = 1; s <= 20; s++ ) {
		total += longestRun( Gen.generate( { seed: s, runs: runs, dots: 120, cols: 22 }, 0 ).d );
	}
	return total;
} );
check( 'Runs = 100 gives longer horizontal runs than Runs = 0', runSum[ 1 ] > runSum[ 0 ] * 1.5 );

/* ---------- runtime: dotField / dotPair ---------- */

check( 'runtime exposes dotField and dotPair', !! Org && 'function' === typeof Org.dotField && 'function' === typeof Org.dotPair );

var plain = Gen.generate( { seed: 11, dots: 150, cols: 22 }, 0 );
var fPlain = Org.dotField( plain.d );
check( 'dotField recognises generator output with the same dot count', !! fPlain && fPlain.dots.length === plain.count );
var invShape = Gen.generate( { seed: 11, dots: 150, cols: 22, invert: true }, 0 );
var fInv = Org.dotField( invShape.d );
check( 'dotField recognises the inverted form (outline kept) with the same dot count', !! fInv && fInv.dots.length === invShape.count && fInv.dots[ 0 ].at === 5 );
check( 'every dot knows its offset into the path numbers', fPlain.dots.every( function ( dot, i ) { return dot.at === i * 16; } ) );
check( 'pitch is the nearest-neighbour distance (one cell here)', Math.abs( fPlain.pitch - 45 ) < 0.001 );

var heart = 'M50 90C10 60 0 30 25 15C40 8 50 20 50 25C50 20 60 8 75 15C100 30 90 60 50 90Z';
check( 'dotField rejects an ordinary shape', null === Org.dotField( heart ) );
var d1 = 'M10 20a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z';
check( 'dotField accepts one canonical circle', !! Org.dotField( d1 ) );
check( 'dotField rejects packed arc flags', null === Org.dotField( 'M10 20a5 5 0 110 10 0a5 5 0 110 -10 0Z' ) );
check( 'dotField rejects an ellipse (rx != ry)', null === Org.dotField( 'M10 20a5 6 0 1 0 10 0a5 6 0 1 0 -10 0Z' ) );
check( 'dotField rejects a clockwise circle (sweep 1)', null === Org.dotField( 'M10 20a5 5 0 1 1 10 0a5 5 0 1 1 -10 0Z' ) );
check( 'dotField rejects a stray extra subpath', null === Org.dotField( d1 + 'M0 0L5 5L0 5Z' ) );
check( 'dotField rejects an outline that is not the frame', null === Org.dotField( 'M1 1H9V9H1Z' + d1 ) );
var many = '';
for ( var q = 0; q < 601; q++ ) {
	many += 'M' + ( q * 12 ) + ' 20a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z';
}
check( 'dotField rejects more than 600 dots', null === Org.dotField( many ) );

function radiiOf( d ) {
	var f = Org.dotField( d );
	return f ? f.dots.map( function ( dot ) { return dot.r; } ) : null;
}
var amounts = [ 'subtle', 'normal', 'strong' ];
var styles = [ 'breathe', 'twinkle', 'wave' ];
var cap = fPlain.pitch / 2;
var poseOk = true;
var skeletonOk = true;
styles.forEach( function ( style ) {
	amounts.forEach( function ( amount ) {
		var pair = Org.dotPair( fPlain, style, amount );
		if ( pair.rest.nums.length !== pair.hover.nums.length ) {
			skeletonOk = false;
		}
		var hoverD = pair.blend( 1 );
		var hr = radiiOf( hoverD );
		if ( ! hr || hr.some( function ( r ) { return r > cap + 0.01 || r <= 0; } ) ) {
			poseOk = false;
		}
	} );
} );
check( 'rest and hover have the same number of path numbers in every style and amount', skeletonOk );
check( 'hover radii stay positive and never pass half the pitch (no merging dots)', poseOk );

var breathe = Org.dotPair( fPlain, 'breathe', 'normal' );
var restR = fPlain.dots.map( function ( dot ) { return dot.r; } );
var breatheR = radiiOf( breathe.blend( 1 ) );
check( 'breathe: every dot grows (or sits at the cap)', breatheR.every( function ( r, i ) { return r >= restR[ i ] - 0.01; } ) && breatheR.some( function ( r, i ) { return r > restR[ i ] + 0.5; } ) );
var tw = Org.dotPair( fPlain, 'twinkle', 'strong' );
var twR = radiiOf( tw.blend( 1 ) );
check( 'twinkle: some dots grow and some shrink', twR.some( function ( r, i ) { return r > restR[ i ] + 0.5; } ) && twR.some( function ( r, i ) { return r < restR[ i ] - 0.5; } ) );
check( 'twinkle is deterministic across rebuilds', Org.dotPair( fPlain, 'twinkle', 'strong' ).blend( 1 ) === tw.blend( 1 ) );

var wave = Org.dotPair( fPlain, 'wave', 'strong' );
check( 'blend at 0 is the original path, byte for byte', breathe.blend( 0 ) === plain.d );
check( 'blend at 1 equals the hover pose in every style', styles.every( function ( style ) { var p = Org.dotPair( fPlain, style, 'normal' ); return p.blend( 1 ) === p.blend( 1.37 ) && p.blend( 0 ) === p.blend( -0.3 ); } ) );
var mid = radiiOf( wave.blend( 0.3 ) );
var left = fPlain.dots.reduce( function ( best, dot, i ) { return dot.x < fPlain.dots[ best ].x ? i : best; }, 0 );
var right = fPlain.dots.reduce( function ( best, dot, i ) { return dot.x > fPlain.dots[ best ].x ? i : best; }, 0 );
check( 'wave: at t = 0.3 the leftmost dot has grown and the rightmost has not started', mid[ left ] > restR[ left ] + 0.5 && Math.abs( mid[ right ] - restR[ right ] ) < 0.01 );

var flagsOk = true;
var recognised = true;
[ -0.3, 0, 0.17, 0.5, 0.83, 1, 1.37 ].forEach( function ( t ) {
	styles.forEach( function ( style ) {
		var out = Org.dotPair( fInv, style, 'strong' ).blend( t );
		if ( /1\.00|0\.00 /.test( out ) || ! /^M0 0H\d+V\d+H0Z/.test( out ) ) {
			flagsOk = false;
		}
		if ( ! Org.dotField( out ) ) {
			recognised = false;
		}
	} );
} );
check( 'blend never writes an arc flag as 1.00, and keeps the Invert outline untouched', flagsOk );
check( 'every blended frame is still a valid dot field (round trip at t = -0.3 ... 1.37)', recognised );
check( 'regression guard: the generic blendPath WOULD corrupt the flags (why dots have their own blender)', /\b1\.00\b/.test( Org.blendPath( Org.parsePath( d1 ), Org.parsePath( d1 ), 0.5 ) ) );
/* ---------- Dispersion ---------- */

var crypto = require( 'crypto' );
var goldenSets = [];
[ 1, 7, 99, 12345 ].forEach( function ( seed ) {
	[ '1:1', '16:9' ].forEach( function ( ratio ) {
		[ true, false ].forEach( function ( invert ) {
			goldenSets.push( Gen.generateSet( { seed: seed, ratio: ratio, invert: invert, variations: 3, dots: 200, runs: seed % 3 * 40 } ) );
		} );
	} );
} );
check( 'Dots output is byte-identical to 1.15.0 (golden hash)', '46a2bb0792bfab0f1ed1e4af54e5d7069b7a530c' === crypto.createHash( 'sha1' ).update( JSON.stringify( goldenSets ) ).digest( 'hex' ) );

var disp = Gen.normalise( { pattern: 'swirl', direction: 'sideways', particle: 'star' } );
check( 'normalise falls back to dots / right / circle for unknown pattern, direction and particle', 'dots' === disp.pattern && 'right' === disp.direction && 'circle' === disp.particle );
check( 'dispersion is deterministic and differs per seed and variation', Gen.generate( { pattern: 'dispersion', seed: 4 }, 2 ).d === Gen.generate( { pattern: 'dispersion', seed: 4 }, 2 ).d && Gen.generate( { pattern: 'dispersion', seed: 4 }, 0 ).d !== Gen.generate( { pattern: 'dispersion', seed: 5 }, 0 ).d && Gen.generate( { pattern: 'dispersion', seed: 4 }, 0 ).d !== Gen.generate( { pattern: 'dispersion', seed: 4 }, 1 ).d );

var allRecognised = true;
var allClear = true;
var allMoves = true;
var integers = true;
var smallEnough = true;
var counts = true;
var combos = 0;
Gen.DIRECTIONS.forEach( function ( direction ) {
	Gen.PARTICLES.forEach( function ( particle ) {
		[ false, true ].forEach( function ( invert ) {
			[ '1:1', '4:3', '3:4' ].forEach( function ( ratio ) {
				combos++;
				var g = Gen.generate( { pattern: 'dispersion', direction: direction, particle: particle, invert: invert, ratio: ratio, seed: combos, dots: 400 }, 0 );
				var f = Org.dotField( g.d );
				if ( ! f || ! f.mass || ! f.anchor || f.dots.length !== g.count || g.count < 40 ) {
					allRecognised = false;
					return;
				}
				if ( ! /^[-\dMLaZHV ]+$/.test( g.d ) || /-0\b|\.|  /.test( g.d ) ) {
					integers = false;
				}
				if ( g.d.length > 30000 ) {
					smallEnough = false;
				}
				styles.concat( [ 'drift' ] ).forEach( function ( style ) {
					amounts.forEach( function ( amount ) {
						var pair = Org.dotPair( f, style, amount );
						var hover = Org.dotField( pair.blend( 1 ) );
						if ( ! hover || hover.dots.length !== f.dots.length || pair.rest.nums.length !== pair.hover.nums.length ) {
							allClear = false;
							return;
						}
						// Reach circles never touch each other or the mass, at rest or hovered.
						hover.dots.forEach( function ( dot, i ) {
							for ( var j = i + 1; j < hover.dots.length; j++ ) {
								if ( Math.hypot( dot.x - hover.dots[ j ].x, dot.y - hover.dots[ j ].y ) < dot.r + hover.dots[ j ].r - 0.05 ) {
									allClear = false;
								}
							}
						} );
						if ( 'drift' === style && pair.blend( 1 ) === g.d ) {
							allMoves = false;
						}
					} );
				} );
			} );
		} );
	} );
} );
check( 'every direction x particle x invert x ratio is recognised with a mass, an anchor and every particle', allRecognised );
check( 'dispersion output is plain integers (no decimals, no -0)', integers );
check( '400 particles stay well under the 49000-byte path cap', smallEnough );
check( 'hover poses (every style and amount, Drift included) never make particles touch', allClear );
check( 'Drift really moves the particles', allMoves );

var dg = Gen.generate( { pattern: 'dispersion', direction: 'right', particle: 'mixed', seed: 21, dots: 150 }, 0 );
var df = Org.dotField( dg.d );
var dpair = Org.dotPair( df, 'drift', 'normal' );
check( 'Drift never moves the mass, the outline or the first frame', dpair.blend( 0 ) === dg.d && dpair.blend( 1 ).indexOf( dg.d.split( /(?=M)/ )[ 0 ] ) === 0 );
var far = df.dots.reduce( function ( best, dot, i ) { return dot.x > df.dots[ best ].x ? i : best; }, 0 );
var near = df.dots.reduce( function ( best, dot, i ) { return dot.x < df.dots[ best ].x ? i : best; }, 0 );
var movedD = Org.dotField( dpair.blend( 1 ) );
check( 'Drift moves far particles further than near ones, away from the mass', movedD.dots[ far ].x - df.dots[ far ].x > movedD.dots[ near ].x - df.dots[ near ].x && movedD.dots[ far ].x > df.dots[ far ].x );
check( 'Drift keeps every particle its size', movedD.dots.every( function ( dot, i ) { return Math.abs( dot.r - df.dots[ i ].r ) < 0.05; } ) );
var plainDrift = Org.dotPair( fPlain, 'drift', 'strong' );
check( 'Drift works on a plain dot grid too (expands about its centre)', plainDrift.blend( 1 ) !== plain.d && !! Org.dotField( plainDrift.blend( 1 ) ) );

check( 'a mass-less field refuses polygon particles', null === Org.dotField( d1 + 'M30 30L40 30L35 20Z' ) );
check( 'an ordinary multi-subpath icon is never taken for a dispersion', null === Org.dotField( heart + 'M5 5L20 5L20 20L5 20Z' ) && null === Org.dotField( 'M0 0L9 0L9 9L0 9Z' + d1 ) );
var star = dg.d.split( /(?=M)/ );
var cw = star.slice();
cw[ 1 ] = 'M' + cw[ 1 ].slice( 1, -1 ).split( 'L' ).reverse().join( 'L' ) + 'Z';
check( 'a clockwise mass is refused', null === Org.dotField( cw.join( '' ) ) );
var wrongParticle = star.slice();
wrongParticle[ 2 ] = 'M10 10L20 10L20 20L10 20Z';
check( 'a clockwise particle polygon is refused', null === Org.dotField( wrongParticle.join( '' ) ) );
check( 'a 5-corner particle is refused', null === Org.dotField( star.slice( 0, 2 ).join( '' ) + 'M100 100L110 95L120 100L115 110L105 110Z' ) );
check( 'a mass with fewer than 8 corners is refused', null === Org.dotField( 'M0 0L100 0L100 100L0 100Z' + d1 ) );

check( 'loading the script still only registers the Elementor init listener', 1 === hooks.length && 'elementor/frontend/init' === hooks[ 0 ] );

console.log( failures ? '\n' + failures + ' FAILED' : '\nALL PASSED' );
process.exit( failures ? 1 : 0 );
