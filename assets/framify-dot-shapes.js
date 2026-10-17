/**
 * Framify - dot-grid shape generator (Shape studio > Generate).
 *
 * Pure: no DOM, no Elementor. Turns a handful of numbers plus a seed into a
 * halftone-style clip shape: a grid of circles in a few sizes with gaps and
 * horizontal runs. The same options and seed always give the same shape.
 *
 * Output contract (the Organic Shape script recognises exactly this form to
 * animate the dots, see dotField() in framify-elementor.js):
 *   - an optional outline "M0 0H{w}V{h}H0Z" (Invert), clockwise on screen;
 *   - one subpath per dot, a circle made of two arcs, counter-clockwise, so
 *     under the clip's nonzero fill rule a dot is a hole when the outline is
 *     present and a filled disc when it is not:
 *       M{cx-r} {cy}a{r} {r} 0 1 0 {2r} 0a{r} {r} 0 1 0 {-2r} 0Z
 *   - integers only, every token separated by a space (never packed arc
 *     flags), long side of the viewBox = 1000.
 */
( function ( window ) {
	'use strict';

	var VB = 1000;
	// [ min, max, default ]. Sizes are a percentage of the cell diameter.
	var LIMITS = {
		dots: [ 1, 400, 120 ],
		variations: [ 1, 12, 6 ],
		cols: [ 6, 40, 22 ],
		steps: [ 1, 5, 3 ],
		runs: [ 0, 100, 40 ],
		min: [ 10, 92, 30 ],
		max: [ 10, 92, 80 ]
	};
	var RATIOS = { '1:1': [ 1, 1 ], '4:3': [ 4, 3 ], '3:4': [ 3, 4 ], '16:9': [ 16, 9 ] };

	function clampInt( v, lim ) {
		v = Math.round( +v );
		if ( ! isFinite( v ) ) {
			v = lim[ 2 ];
		}
		return Math.min( lim[ 1 ], Math.max( lim[ 0 ], v ) );
	}

	function randomSeed() {
		return ( Math.random() * 4294967296 ) >>> 0;
	}

	// Clean option object: every number clamped, min <= max, known ratio.
	function normalise( o ) {
		o = o || {};
		var out = {
			seed: undefined === o.seed || ! isFinite( +o.seed ) ? 1 : ( +o.seed ) >>> 0,
			ratio: RATIOS[ o.ratio ] ? o.ratio : '1:1',
			invert: !! o.invert
		};
		Object.keys( LIMITS ).forEach( function ( key ) {
			out[ key ] = clampInt( undefined === o[ key ] ? LIMITS[ key ][ 2 ] : o[ key ], LIMITS[ key ] );
		} );
		if ( out.min > out.max ) {
			var swap = out.min;
			out.min = out.max;
			out.max = swap;
		}
		return out;
	}

	function mulberry32( seed ) {
		var a = seed >>> 0;
		return function () {
			a = ( a + 0x6D2B79F5 ) >>> 0;
			var t = a;
			t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
			t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
			return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
		};
	}

	// The i-th variation of a base seed.
	function variantSeed( seed, i ) {
		return ( ( seed ^ 0x9E3779B9 ) + Math.imul( i + 1, 0x85EBCA6B ) ) >>> 0;
	}

	function dotPath( cx, cy, r ) {
		return 'M' + ( cx - r ) + ' ' + cy + 'a' + r + ' ' + r + ' 0 1 0 ' + ( 2 * r ) + ' 0a' + r + ' ' + r + ' 0 1 0 ' + ( -2 * r ) + ' 0Z';
	}

	// One shape: { d, vb, count }. `variation` picks which of the seed's
	// shapes (0 = the first).
	function generate( options, variation ) {
		var o = normalise( options );
		var rng = mulberry32( variantSeed( o.seed, variation || 0 ) );
		var ratio = RATIOS[ o.ratio ];
		var cols = o.cols;
		var rows = Math.max( 3, Math.round( cols * ratio[ 1 ] / ratio[ 0 ] ) );
		var cell = Math.max( 4, Math.floor( VB / Math.max( cols, rows ) ) );
		var w = cols * cell;
		var h = rows * cell;
		var cells = cols * rows;
		var target = Math.min( o.dots, cells );
		var occupied = [];
		var level = [];
		var placed = 0;
		var steps = o.steps;
		var i;

		function pickLevel() {
			return Math.min( steps - 1, Math.floor( rng() * steps ) );
		}
		function put( cell, lv ) {
			occupied[ cell ] = 1;
			level[ cell ] = lv;
			placed++;
		}

		if ( 0 === o.runs ) {
			// Pure scatter: a partial shuffle of every cell.
			var order = [];
			for ( i = 0; i < cells; i++ ) {
				order.push( i );
			}
			for ( i = 0; i < target; i++ ) {
				var j = i + Math.floor( rng() * ( cells - i ) );
				var tmp = order[ i ];
				order[ i ] = order[ j ];
				order[ j ] = tmp;
				put( order[ i ], pickLevel() );
			}
		} else {
			var p = o.runs / 100;
			var maxRun = 1 + Math.round( p * cols * 0.6 );
			var attempts = target * 40;
			var prevRow = -1;
			var prevCol = 0;
			while ( placed < target && attempts-- > 0 ) {
				var row;
				var col;
				if ( prevRow >= 0 && rng() < 0.6 * p ) {
					// Next to the previous run, one row up or down.
					row = Math.min( rows - 1, Math.max( 0, prevRow + ( rng() < 0.5 ? -1 : 1 ) ) );
					col = Math.min( cols - 1, Math.max( 0, prevCol + Math.floor( ( rng() - 0.5 ) * 7 ) ) );
				} else {
					row = Math.floor( rng() * rows );
					col = Math.floor( rng() * cols );
				}
				var len = 1 + Math.floor( rng() * rng() * maxRun );
				var base = pickLevel();
				var c = col;
				while ( c < cols && len > 0 && placed < target && ! occupied[ row * cols + c ] ) {
					var lv = rng() < 0.3 ? Math.min( steps - 1, Math.max( 0, base + ( rng() < 0.5 ? -1 : 1 ) ) ) : base;
					put( row * cols + c, lv );
					c++;
					len--;
				}
				prevRow = row;
				prevCol = col;
			}
			// Top up with scattered dots if the run placement ran out of tries.
			var scan = Math.floor( rng() * cells );
			for ( i = 0; i < cells && placed < target; i++ ) {
				var k = ( scan + i ) % cells;
				if ( ! occupied[ k ] ) {
					put( k, pickLevel() );
				}
			}
		}

		// Radii: `steps` evenly spaced sizes between min and max (% of cell).
		var radii = [];
		for ( i = 0; i < steps; i++ ) {
			var pct = 1 === steps ? o.max : o.min + ( o.max - o.min ) * i / ( steps - 1 );
			radii.push( Math.max( 1, Math.round( cell * pct / 200 ) ) );
		}

		var d = o.invert ? 'M0 0H' + w + 'V' + h + 'H0Z' : '';
		for ( i = 0; i < cells; i++ ) {
			if ( occupied[ i ] ) {
				var cx = ( i % cols ) * cell + Math.round( cell / 2 );
				var cy = Math.floor( i / cols ) * cell + Math.round( cell / 2 );
				d += dotPath( cx, cy, radii[ level[ i ] ] );
			}
		}
		return { d: d, vb: '0 0 ' + w + ' ' + h, count: placed };
	}

	// `variations` shapes from one set of options.
	function generateSet( options ) {
		var o = normalise( options );
		var out = [];
		for ( var i = 0; i < o.variations; i++ ) {
			out.push( generate( o, i ) );
		}
		return out;
	}

	window.FramifyDotShapes = {
		LIMITS: LIMITS,
		RATIOS: RATIOS,
		normalise: normalise,
		generate: generate,
		generateSet: generateSet,
		randomSeed: randomSeed
	};
}( window ) );
