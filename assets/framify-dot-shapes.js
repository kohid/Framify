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
 *
 * The Dispersion pattern uses the same contract with two additions, read by
 * the same recogniser: right after the optional outline comes one "mass", a
 * counter-clockwise polygon of 8-64 corners (M x y L x y ... Z), then
 * the particles, each either a circle as above or a convex counter-clockwise
 * polygon of 3 or 4 corners (M x y L x y L x y [L x y] Z). The mass is
 * star-shaped around an anchor point, which is what lets the Drift motion
 * push every particle away from it without ever touching it or each other.
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
	var PATTERNS = [ 'dots', 'dispersion' ];
	// Where the particles travel. 'out' scatters from a mass in the middle.
	var DIRECTIONS = [ 'right', 'left', 'down', 'up', 'out' ];
	var PARTICLES = [ 'circle', 'square', 'triangle', 'diamond', 'mixed' ];
	// 'mixed' picks one of the others for each particle.
	var KINDS = PARTICLES.filter( function ( kind ) {
		return 'mixed' !== kind;
	} );
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
			invert: !! o.invert,
			pattern: -1 < PATTERNS.indexOf( o.pattern ) ? o.pattern : 'dots',
			direction: -1 < DIRECTIONS.indexOf( o.direction ) ? o.direction : 'right',
			particle: -1 < PARTICLES.indexOf( o.particle ) ? o.particle : 'circle'
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

	function polyPath( pts ) {
		return 'M' + pts.map( function ( p ) {
			return Math.round( p[ 0 ] ) + ' ' + Math.round( p[ 1 ] );
		} ).join( 'L' ) + 'Z';
	}

	// Distance from a point to the closest edge of a polygon.
	function edgeDistance( x, y, poly ) {
		var best = Infinity;
		for ( var i = 0; i < poly.length; i++ ) {
			var a = poly[ i ];
			var b = poly[ ( i + 1 ) % poly.length ];
			var dx = b[ 0 ] - a[ 0 ];
			var dy = b[ 1 ] - a[ 1 ];
			var u = ( ( x - a[ 0 ] ) * dx + ( y - a[ 1 ] ) * dy ) / ( dx * dx + dy * dy || 1 );
			u = Math.min( 1, Math.max( 0, u ) );
			best = Math.min( best, Math.hypot( x - a[ 0 ] - u * dx, y - a[ 1 ] - u * dy ) );
		}
		return best;
	}

	function insidePoly( x, y, poly ) {
		var inside = false;
		for ( var i = 0, j = poly.length - 1; i < poly.length; j = i++ ) {
			if ( ( poly[ i ][ 1 ] > y ) !== ( poly[ j ][ 1 ] > y )
				&& x < ( poly[ j ][ 0 ] - poly[ i ][ 0 ] ) * ( y - poly[ i ][ 1 ] ) / ( poly[ j ][ 1 ] - poly[ i ][ 1 ] ) + poly[ i ][ 0 ] ) {
				inside = ! inside;
			}
		}
		return inside;
	}

	// Signed area; negative is counter-clockwise on screen (y points down).
	function area( poly ) {
		var sum = 0;
		for ( var i = 0; i < poly.length; i++ ) {
			var b = poly[ ( i + 1 ) % poly.length ];
			sum += poly[ i ][ 0 ] * b[ 1 ] - b[ 0 ] * poly[ i ][ 1 ];
		}
		return sum / 2;
	}

	// A smooth wobble in -1..1 from a few seeded sines.
	function wobble( rng, cycles ) {
		var waves = [];
		for ( var i = 0; i < 3; i++ ) {
			waves.push( [ ( 0.5 + rng() ) * cycles * ( i + 1 ) / 2, rng() * 6.2832, 1 / ( i + 1 ) ] );
		}
		return function ( t ) {
			var v = 0;
			waves.forEach( function ( w ) {
				v += w[ 2 ] * Math.sin( w[ 0 ] * 6.2832 * t + w[ 1 ] );
			} );
			return v / 1.8;
		};
	}

	// The corners of one particle, counter-clockwise, around ( cx, cy ).
	// `r` is its visible size; `R` (returned) is its reach from the centre.
	function particle( kind, cx, cy, r, aim ) {
		var out;
		if ( 'circle' === kind ) {
			return { d: dotPath( cx, cy, r ), R: r };
		}
		if ( 'square' === kind ) {
			out = [ [ cx - r, cy - r ], [ cx - r, cy + r ], [ cx + r, cy + r ], [ cx + r, cy - r ] ];
			return { d: polyPath( out ), R: r * 1.4143 };
		}
		var q = Math.round( r * ( 'diamond' === kind ? 1.25 : 1.3 ) );
		if ( 'diamond' === kind ) {
			return { d: polyPath( [ [ cx - q, cy ], [ cx, cy + q ], [ cx + q, cy ], [ cx, cy - q ] ] ), R: q };
		}
		out = [];
		for ( var i = 0; i < 3; i++ ) {
			var a = aim - i * 2.0944;
			out.push( [ cx + q * Math.cos( a ), cy + q * Math.sin( a ) ] );
		}
		return { d: polyPath( out ), R: q };
	}

	// Dispersion: one solid mass that breaks into particles which thin out
	// and shrink the further they travel. Worked out in a flow frame
	// ( s along the travel, v across it ) and mapped onto the canvas.
	function disperse( o, rng ) {
		var ratio = RATIOS[ o.ratio ];
		var big = Math.max( ratio[ 0 ], ratio[ 1 ] );
		var w = Math.round( VB * ratio[ 0 ] / big );
		var h = Math.round( VB * ratio[ 1 ] / big );
		var radial = 'out' === o.direction;
		var horizontal = 'left' === o.direction || 'right' === o.direction;
		var L = horizontal ? w : h;
		var W = horizontal ? h : w;
		// Not the Columns setting: Dispersion has no such control, a value left
		// over from Dots must not rescale its particles.
		var unit = Math.floor( VB / LIMITS.cols[ 2 ] );
		var rMin = Math.max( 3, unit * o.min / 200 );
		var rMax = Math.max( rMin, unit * o.max / 200 );
		var i;

		// ( s, v ) in the flow frame -> canvas point.
		function toCanvas( s, v ) {
			switch ( o.direction ) {
				case 'right':
					return [ s, v ];
				case 'left':
					return [ w - s, v ];
				case 'down':
					return [ v, s ];
				default:
					return [ v, h - s ];
			}
		}

		// The mass, and how far it reaches at a given place.
		var mass = [];
		var radius = 0.17 * Math.min( w, h ) * ( 0.9 + rng() * 0.2 );
		var swing = wobble( rng, 2 );
		var base = 0.27 + rng() * 0.07;
		var steps = 14;
		if ( radial ) {
			var turn = rng() * 6.2832;
			for ( i = 0; i < 16; i++ ) {
				var ang = turn + i * 6.2832 / 16;
				var rr = radius * ( 1 + 0.16 * swing( i / 16 ) );
				mass.push( [ w / 2 + rr * Math.cos( ang ), h / 2 + rr * Math.sin( ang ) ] );
			}
		} else {
			// The edge may move at most a quarter of its own step sideways, so
			// the mass stays star-shaped around a point inside it.
			var edge = [];
			var gap = W / ( steps - 1 );
			for ( i = 0; i < steps; i++ ) {
				var e = L * ( base + 0.05 * swing( i / ( steps - 1 ) ) );
				if ( i ) {
					e = Math.min( edge[ i - 1 ] + gap * 0.25, Math.max( edge[ i - 1 ] - gap * 0.25, e ) );
				}
				edge.push( e );
			}
			mass.push( toCanvas( 0, 0 ) );
			for ( i = 0; i < steps; i++ ) {
				mass.push( toCanvas( edge[ i ], i * gap ) );
			}
			mass.push( toCanvas( 0, W ) );
		}
		mass = mass.map( function ( p ) {
			return [ Math.round( p[ 0 ] ), Math.round( p[ 1 ] ) ];
		} );
		if ( area( mass ) > 0 ) {
			mass.reverse();
		}

		// Particles, biggest (nearest the mass) first.
		var ts = [];
		for ( i = 0; i < o.dots; i++ ) {
			ts.push( Math.pow( rng(), 1.6 ) );
		}
		ts.sort( function ( a, b ) {
			return a - b;
		} );
		var placed = [];
		var inner = radial ? radius * 1.1 : L * 0.2;
		var outer = radial ? Math.min( w, h ) / 2 - 4 : L - 4;
		ts.forEach( function ( t ) {
			var r = Math.round( ( rMin + ( rMax - rMin ) * Math.pow( 1 - t, 1.3 ) ) * ( 0.75 + rng() * 0.5 ) );
			r = Math.max( 3, r );
			var kind = 'mixed' === o.particle ? KINDS[ Math.floor( rng() * KINDS.length ) ] : o.particle;
			for ( var tries = 0; tries < 30; tries++ ) {
				var pos;
				var aim;
				var s = inner + ( outer - inner ) * Math.min( 1, t + ( rng() - 0.5 ) * 0.12 );
				if ( radial ) {
					aim = rng() * 6.2832;
					pos = [ w / 2 + s * Math.cos( aim ), h / 2 + s * Math.sin( aim ) ];
				} else {
					pos = toCanvas( s, rng() * W );
					aim = { right: 0, left: Math.PI, down: Math.PI / 2, up: -Math.PI / 2 }[ o.direction ];
				}
				aim += ( rng() - 0.5 ) * 0.7;
				var cx = Math.round( pos[ 0 ] );
				var cy = Math.round( pos[ 1 ] );
				var p = particle( kind, cx, cy, r, aim );
				if ( cx - p.R < 1 || cy - p.R < 1 || cx + p.R > w - 1 || cy + p.R > h - 1
					|| insidePoly( cx, cy, mass ) || edgeDistance( cx, cy, mass ) < p.R * 1.35 + 3 ) {
					continue;
				}
				var free = true;
				for ( var k = 0; k < placed.length && free; k++ ) {
					free = Math.hypot( cx - placed[ k ].x, cy - placed[ k ].y ) >= ( p.R + placed[ k ].R ) * 1.35 + 3;
				}
				if ( free ) {
					placed.push( { x: cx, y: cy, R: p.R, d: p.d } );
					break;
				}
			}
		} );

		var d = o.invert ? 'M0 0H' + w + 'V' + h + 'H0Z' : '';
		d += polyPath( mass );
		placed.forEach( function ( p ) {
			d += p.d;
		} );
		return { d: d, vb: '0 0 ' + w + ' ' + h, count: placed.length };
	}

	// One shape: { d, vb, count }. `variation` picks which of the seed's
	// shapes (0 = the first).
	function generate( options, variation ) {
		var o = normalise( options );
		var rng = mulberry32( variantSeed( o.seed, variation || 0 ) );
		if ( 'dispersion' === o.pattern ) {
			return disperse( o, rng );
		}
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
		PATTERNS: PATTERNS,
		DIRECTIONS: DIRECTIONS,
		PARTICLES: PARTICLES,
		RATIOS: RATIOS,
		normalise: normalise,
		generate: generate,
		generateSet: generateSet,
		randomSeed: randomSeed
	};
}( window ) );
