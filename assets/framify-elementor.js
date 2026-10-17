/**
 * Framify - Elementor Organic Shape (frontend + editor preview)
 *
 * Image widget: clips the real <img> (srcset, alt, lazy-load, links all
 * intact) to an SVG <clipPath> in objectBoundingBox units, so the shape
 * scales with any image size. Container: either clips the whole container
 * the same way, or puts a coloured shape behind its children. The Image
 * widget's deco blob can be solid or outlined and can move on its own
 * timeline (trigger, timing and rotation), separate from the image.
 *
 * Three built-in shape families come from the server: round Blobs; wide
 * Wavy shapes with one straight side (the "flat edge", drawn on the right
 * and turned to any side here with an SVG transform); and hand-placed Flow
 * shapes, which also keep a flat edge. A fourth, Custom, is parsed in the
 * browser from pasted SVG (validated path data only, never server-generated).
 * Custom shapes stay static unless a trigger is set, then move in one of two
 * modes: Liquid (traced and rippled, morphed like the built-ins) or Gentle
 * (the exact path, tilted and swelled via its transform). Placement -
 * position, size, offset - is written by
 * Elementor as CSS custom properties per breakpoint and read back from
 * computed style, so each device gets its own placement.
 *
 * Every rest/hover pair from a server-generated family shares an identical
 * path structure, so morphing is just blending the numbers in the two path
 * strings, driven by a small spring (elastic) animator. Reduced-motion
 * visitors only ever see the rest shape.
 *
 * Settings: published pages get Elementor's get_frontend_settings(), which
 * keeps control defaults but drops every null or '' value; the editor sends
 * '' for an off switch or a cleared colour. So a missing key means empty,
 * never default: a switch is on only when 'yes' === value.
 *
 * File: assets/framify-elementor.js
 */
( function () {
	'use strict';

	var CONFIG = window.framifyOrganic || { shapes: {}, defaultShape: 'pebble' };
	var SVG_NS = 'http://www.w3.org/2000/svg';
	var NUMBER = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
	var SPRING_PERIOD = { subtle: 0.75, normal: 0.45, bouncy: 0.3 };
	// Custom shape motion per "Motion amount": ripple = Liquid edge push in
	// 0-100 box units; rotate (deg) and scale = Gentle tilt and swell.
	var CUSTOM_AMOUNT = {
		subtle: { ripple: 2, rotate: 1.5, scale: 1.02 },
		normal: { ripple: 3.5, rotate: 3, scale: 1.04 },
		strong: { ripple: 5, rotate: 5, scale: 1.07 }
	};
	// Dots motion (a pattern of circles from Shape studio > Generate): how far
	// each dot's radius moves at the hover pose, per "Motion amount".
	var DOT_AMOUNT = { subtle: 0.3, normal: 0.7, strong: 1.5 };
	var DOT_STYLES = { breathe: 1, twinkle: 1, wave: 1, drift: 1 };
	// Drift: how far every particle moves away from the anchor, as a share of
	// its distance from it (a pure expansion, so particles never meet).
	var DRIFT_AMOUNT = { subtle: 0.06, normal: 0.14, strong: 0.28 };
	// Above this many dots Liquid is skipped: its 400-sample trace drops every
	// part shorter than 1% of the path, which is every dot of a large pattern.
	var DOT_LIQUID_MAX = 24;
	// The recogniser refuses bigger fields: the pitch search is O(n^2) and
	// every frame rebuilds the whole path. The generator stops at 400.
	var DOT_MAX = 600;
	// One dot is 16 numbers in the path (M x y, then two arcs):
	//   0 x-r  1 y  | arc 1: 2 rx  3 ry  4 rot  5 large  6 sweep  7 dx  8 dy
	//                | arc 2: 9 rx 10 ry 11 rot 12 large 13 sweep 14 dx 15 dy
	var DOT_TOKENS = 16;
	// Wave: the share of the 0-1 animation the sweep takes to cross the shape.
	var DOT_SPREAD = 0.6;
	var REDUCE_MOTION = !! ( window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches );
	// Wavy shapes are drawn with a straight right edge. These turn that edge to
	// the chosen side inside the 0-100 box, which is still square at that
	// point (objectBoundingBox / preserveAspectRatio="none" stretch it later).
	var EDGE_TRANSFORM = { right: '', left: 'translate(100 0) scale(-1 1)', top: 'rotate(-90 50 50)', bottom: 'rotate(90 50 50)' };
	// The inverse of each EDGE_TRANSFORM: turns that side back to the right.
	// A custom shape's detected straight side goes through this first, then
	// through EDGE_TRANSFORM of the chosen side.
	var EDGE_INVERSE = { right: '', left: 'translate(100 0) scale(-1 1)', top: 'rotate(90 50 50)', bottom: 'rotate(-90 50 50)' };
	// Flip / rotate options, outermost inside the 0-100 box. rotate(90) turns
	// clockwise on screen (y points down), so each quarter turn moves a side
	// one step round ROTATE_SIDE.
	var FLIP_H = 'translate(100 0) scale(-1 1)';
	var FLIP_V = 'translate(0 100) scale(1 -1)';
	var ROTATE_SIDE = { right: 'bottom', bottom: 'left', left: 'top', top: 'right' };
	// Placement defaults, mirroring the PHP control defaults.
	var MAIN_BOX = { w: 100, h: 100, ox: 0, oy: 0 };
	var DECO_BOX = { w: 108, h: 108, ox: 6, oy: 6 };
	// A resolved box (readBox() units, 0-1) covering the whole anchor.
	var FULL_BOX = { x: 0, y: 0, w: 1, h: 1 };
	// Px of clip kept round Elementor's editor handle (keepHandle).
	var HANDLE_PAD = 2;
	// Ms the handle rect follows the handle after it shows (Elementor slides
	// it for 0.3 s), and stays after the pointer leaves (to reach it).
	var HANDLE_TRACK = 450;
	var HANDLE_GRACE = 800;
	var uid = 0;

	/* ---------- path morphing ---------- */

	function parsePath( d ) {
		return { d: d, parts: d.split( NUMBER ), nums: ( d.match( NUMBER ) || [] ).map( Number ) };
	}

	function blendPath( a, b, t ) {
		var out = a.parts[ 0 ];
		for ( var i = 0; i < a.nums.length; i++ ) {
			out += ( a.nums[ i ] + ( b.nums[ i ] - a.nums[ i ] ) * t ).toFixed( 2 ) + a.parts[ i + 1 ];
		}
		return out;
	}

	/* ---------- shapes ---------- */

	// Callers pass the control's own default as the fallback. A shape id is
	// never empty in practice (its default is always sent), so this only
	// guards against a stale id from a removed shape.
	// An uploaded (assets/shapes) shape runs through the Custom pipeline: the
	// effective settings carry its SVG text as the Custom paste.
	function libraryShape( s ) {
		var svg = 'library' === s.framify_org_shape_source && CONFIG.library && CONFIG.library[ s.framify_org_shape_lib ];
		if ( ! svg ) {
			return s;
		}
		var out = {};
		Object.keys( s ).forEach( function ( key ) {
			out[ key ] = s[ key ];
		} );
		out.framify_org_shape = 'custom';
		out.framify_org_custom_svg = svg;
		return out;
	}

	function shapeData( id, fallback ) {
		return CONFIG.shapes[ id ] || CONFIG.shapes[ fallback || CONFIG.defaultShape ] || null;
	}

	function familyOf( id, fallback ) {
		var shape = shapeData( id, fallback );
		return shape && shape.family ? shape.family : 'blob';
	}

	// A Wavy shape with no flat edge uses its free-standing variant.
	function shapePair( id, fallback, edge ) {
		var shape = shapeData( id, fallback );
		if ( ! shape ) {
			return null;
		}
		var source = 'none' === edge && shape.free ? shape.free : shape;
		return { rest: parsePath( source.rest ), hover: parsePath( source.hover ) };
	}

	// Blobs have no straight side; Flow always keeps one. A Custom paste is
	// turned only by an explicit left/right/top/bottom, and only when
	// parseCustom detected a straight side (custom = its parse result); Auto
	// and None keep it as pasted. Auto is the always-present default, so
	// letting it pick a side would silently refit and turn every existing
	// custom element. For Wavy / Flow, Auto only picks a side the shape's box
	// actually reaches, so a narrowed or offset shape never shows its
	// straight side as a hard cut inside the element. Flow has no free
	// variant, so where Wavy would drop the edge, Flow falls back to the side
	// it touches, else right.
	function resolveEdge( family, setting, box, custom ) {
		if ( 'custom' === family ) {
			return custom && custom.straight && ROTATE_SIDE[ setting ] ? setting : 'none';
		}
		if ( 'wavy' !== family && 'flow' !== family ) {
			return 'none';
		}
		var flow = 'flow' === family;
		if ( setting && 'auto' !== setting ) {
			return flow && 'none' === setting ? 'right' : setting;
		}
		var side = autoSide( box );
		if ( side || ! flow ) {
			return side || 'none';
		}
		return box.x + box.w >= 0.999 || box.x > 0.001 ? 'right' : 'left';
	}

	// The side Auto picks from the horizontal position, or null when the
	// box doesn't reach that side.
	function autoSide( box ) {
		if ( box.ax < 0.25 && box.x <= 0.001 ) {
			return 'left';
		}
		if ( box.ax > 0.75 && box.x + box.w >= 0.999 ) {
			return 'right';
		}
		return null;
	}

	function edgeTransform( edge ) {
		return EDGE_TRANSFORM[ edge ] || '';
	}

	// SVG transform lists apply right to left to the points, so the first
	// argument here is applied last. Empty parts are dropped.
	function joinTransforms() {
		return Array.prototype.filter.call( arguments, Boolean ).join( ' ' );
	}

	// Flip horizontal / vertical (every shape) and Rotate (Custom only; the
	// setting survives a shape switch, so it is gated on the family here).
	function readOrient( s, family ) {
		var rotate = 'custom' === family ? parseInt( s.framify_org_custom_rotate, 10 ) : 0;
		return {
			rotate: 90 === rotate || 180 === rotate || 270 === rotate ? rotate : 0,
			flipH: 'yes' === s.framify_org_flip_h,
			flipV: 'yes' === s.framify_org_flip_v
		};
	}

	// The outermost part of the inner chain: rotate first, then the flips.
	function orientTransform( orient ) {
		return joinTransforms(
			orient.flipH ? FLIP_H : '',
			orient.flipV ? FLIP_V : '',
			orient.rotate ? 'rotate(' + orient.rotate + ' 50 50)' : ''
		);
	}

	// Where a side ends up after orientTransform(), so the zoom origin stays
	// on the straight side's final position. 'none' passes through.
	function orientSide( side, orient ) {
		if ( ! ROTATE_SIDE[ side ] ) {
			return side;
		}
		for ( var turn = 0; turn < orient.rotate; turn += 90 ) {
			side = ROTATE_SIDE[ side ];
		}
		if ( orient.flipH && ( 'left' === side || 'right' === side ) ) {
			side = 'left' === side ? 'right' : 'left';
		}
		if ( orient.flipV && ( 'top' === side || 'bottom' === side ) ) {
			side = 'top' === side ? 'bottom' : 'top';
		}
		return side;
	}

	// Grain defaults to on, but its default 'yes' is always present in the
	// settings. Switched off it is '' in the editor and MISSING on published
	// pages (Elementor drops empty values), so missing must mean off.
	function grainOn( s ) {
		return 'yes' === s.framify_org_deco_grain;
	}

	// Grain amount and pattern from the Grain section. cut is the colour
	// matrix's alpha offset: amount 50 = 0.78, the original look; 0 gives a
	// few faint specks, 100 heavy chalk. Pattern 0 = a speckle of the
	// element's own, seeded from its Elementor id so it stays the same
	// across reloads.
	function grainOptions( s, el ) {
		var amount = Math.max( 0, Math.min( 100, number( s.framify_org_grain_amount, 50 ) ) );
		var pattern = Math.round( number( s.framify_org_grain_pattern, 0 ) );
		return {
			cut: Math.round( ( 1.11 - 0.0066 * amount ) * 1000 ) / 1000,
			seed: pattern > 0 ? pattern : elementSeed( el )
		};
	}

	// closest(): a Spacer's host is its inner .elementor-widget-container,
	// which has no data-id of its own (for every other host it is el itself).
	function elementSeed( el ) {
		var owner = el && el.closest ? el.closest( '[data-id]' ) : el;
		var id = ( owner && owner.getAttribute( 'data-id' ) ) || '';
		if ( ! id ) {
			return 7;
		}
		var h = 0;
		for ( var i = 0; i < id.length; i++ ) {
			h = ( h * 31 + id.charCodeAt( i ) ) % 997;
		}
		return h + 1;
	}

	// Image widget "Grain on" target: deco | image | both | none.
	function grainTarget( s ) {
		var target = s.framify_org_grain_target || 'deco';
		return {
			deco: 'deco' === target || 'both' === target,
			image: 'image' === target || 'both' === target
		};
	}

	// What the deco blob looks like: a grainy colour fill, or a pixel-width
	// outline (grain is skipped: on a thin line it would be invisible).
	// grain = grainOptions() when the caller's setting puts grain on the deco
	// (the switch on containers, the target on the Image widget), else null.
	// A cleared colour is '' in the editor and missing on published pages;
	// the || fallback treats both the same, so editor and live agree.
	function decoLook( s, grain ) {
		var outline = 'outline' === s.framify_org_deco_style;
		return {
			outline: outline,
			color: s.framify_org_deco_color || '#F2C53D',
			outlineColor: s.framify_org_deco_outline_color || '#1E1E1E',
			outlineWidth: number( s.framify_org_deco_outline_width, 2 ),
			grain: outline ? null : grain || null
		};
	}

	/* ---------- custom shape ---------- */

	// Only characters of the SVG path grammar; anything else is dropped.
	var PATH_CHARS = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/;
	// A single-entry memo (last text -> last result) rather than a growing
	// map: the editor rebuilds with the same text repeatedly on every
	// debounced edit, so one slot is all that's ever needed.
	var customCache = null;

	// Pasted SVG code (or bare path data) -> { d, box } in the paste's own
	// coordinates, or null. Only the validated d string is ever used, and
	// only through setAttribute('d'), so pasted markup can never inject.
	function parseCustom( text ) {
		text = String( text || '' ).trim();
		if ( ! text || text.length > 50000 ) {
			return null;
		}
		if ( customCache && customCache.text === text ) {
			return customCache.result;
		}
		var paths = [];
		if ( -1 === text.indexOf( '<' ) ) {
			paths.push( text );
		} else {
			var re = /\sd\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
			var m;
			while ( ( m = re.exec( text ) ) ) {
				paths.push( undefined !== m[ 1 ] ? m[ 1 ] : m[ 2 ] );
			}
		}
		var d = paths.map( function ( p ) {
			p = p.trim();
			// A later subpath's leading lowercase "m" is read relative to the
			// previous subpath once joined, which would misplace its first
			// point. Rewriting the command itself to "M" would be wrong: any
			// extra coordinate pairs after a leading "m" are implicit relative
			// lineto's (e.g. Heroicons' "m4.5 12.75 6 6 9-13.5"), and turning
			// the "m" absolute would turn those relative pairs into absolute
			// ones too, distorting the shape. Prefixing a relative moveto from
			// the origin instead lands at the same absolute point while
			// leaving the original command, and everything after it, alone.
			// Safe for a single pasted path too: the extra moveto adds no
			// geometry.
			if ( 'm' === p.charAt( 0 ) ) {
				p = 'M0 0' + p;
			}
			return p;
		} ).filter( function ( p ) {
			return p && PATH_CHARS.test( p );
		} ).join( ' ' );
		var measured = d ? measureCustom( d ) : null;
		var box = d ? customBox( text, measured ) : null;
		var result = box ? {
			d: d,
			box: box,
			bbox: measured ? measured.bbox : box,
			straight: measured ? measured.straight : null
		} : null;
		customCache = { text: text, result: result };
		return result;
	}

	var STRAIGHT_SAMPLES = 240;
	// A sample is "on" a side within 0.6% of the bbox dimension across it; a
	// run of such samples must span at least half that side to count.
	var STRAIGHT_TOLERANCE = 0.006;
	var STRAIGHT_COVERAGE = 0.5;

	// The validated path's own bounds and its straight side (right | left |
	// top | bottom | null), measured once per paste in a hidden svg (the
	// result is memoised with parseCustom's). Returns null if the browser
	// can't measure it.
	function measureCustom( d ) {
		var svg = svgEl( 'svg', { width: '0', height: '0', 'aria-hidden': 'true', style: 'position:absolute;width:0;height:0;overflow:hidden' } );
		var path = svgEl( 'path', { d: d } );
		svg.appendChild( path );
		document.body.appendChild( svg );
		var b = null;
		var samples = [];
		try {
			b = path.getBBox();
			var total = path.getTotalLength();
			if ( total > 0 && isFinite( total ) ) {
				for ( var i = 0; i < STRAIGHT_SAMPLES; i++ ) {
					var pt = path.getPointAtLength( total * i / STRAIGHT_SAMPLES );
					samples.push( { x: pt.x, y: pt.y } );
				}
			}
		} catch ( e ) {
			b = null;
		}
		svg.remove();
		if ( ! b || ! ( b.width > 0 ) || ! ( b.height > 0 ) ) {
			return null;
		}
		var bbox = { x: b.x, y: b.y, w: b.width, h: b.height };
		return { bbox: bbox, straight: samples.length > 1 ? straightSide( samples, bbox ) : null };
	}

	// For each side of the bbox: the longest run of consecutive samples lying
	// on that side's line; its extent along the side / the side's length is
	// the coverage. The best side wins if it covers at least half the side.
	function straightSide( pts, bbox ) {
		var sides = {
			right: [ 'x', bbox.x + bbox.w, bbox.w, 'y', bbox.h ],
			left: [ 'x', bbox.x, bbox.w, 'y', bbox.h ],
			top: [ 'y', bbox.y, bbox.h, 'x', bbox.w ],
			bottom: [ 'y', bbox.y + bbox.h, bbox.h, 'x', bbox.w ]
		};
		var best = null;
		var bestCoverage = 0;
		Object.keys( sides ).forEach( function ( name ) {
			var side = sides[ name ];
			var coverage = runCoverage( pts, side[ 0 ], side[ 1 ], STRAIGHT_TOLERANCE * side[ 2 ], side[ 3 ] ) / side[ 4 ];
			if ( coverage > bestCoverage ) {
				best = name;
				bestCoverage = coverage;
			}
		} );
		return bestCoverage >= STRAIGHT_COVERAGE ? best : null;
	}

	// Longest extent (along `along`) of a run of consecutive points within
	// tol of the line axis = at. The outline is closed, so the walk starts
	// just after an off-line point and wraps round, keeping a run that
	// crosses the path's start in one piece.
	function runCoverage( pts, axis, at, tol, along ) {
		var n = pts.length;
		var start = -1;
		for ( var i = 0; i < n; i++ ) {
			if ( Math.abs( pts[ i ][ axis ] - at ) > tol ) {
				start = i;
				break;
			}
		}
		if ( start < 0 ) {
			return Infinity;
		}
		var best = 0;
		var lo = Infinity;
		var hi = -Infinity;
		for ( var k = 1; k <= n; k++ ) {
			var p = pts[ ( start + k ) % n ];
			if ( Math.abs( p[ axis ] - at ) <= tol ) {
				lo = Math.min( lo, p[ along ] );
				hi = Math.max( hi, p[ along ] );
				best = Math.max( best, hi - lo );
			} else {
				lo = Infinity;
				hi = -Infinity;
			}
		}
		return best;
	}

	// The paste's coordinate box: its viewBox, else numeric width/height,
	// else the path's own measured bounds (measureCustom's bbox).
	function customBox( text, measured ) {
		// Only the opening <svg> tag's own viewBox/width/height count, never a
		// nested element's (e.g. a child <symbol viewBox="..."> or a
		// <rect width="50"> inside a "100%" canvas).
		var svgTag = text.match( /<svg\b[^>]*>/i );
		if ( svgTag ) {
			var vb = svgTag[ 0 ].match( /viewBox\s*=\s*["']([^"']+)["']/i );
			if ( vb ) {
				var v = vb[ 1 ].trim().split( /[\s,]+/ ).map( Number );
				if ( 4 === v.length && v.every( isFinite ) && v[ 2 ] > 0 && v[ 3 ] > 0 ) {
					return { x: v[ 0 ], y: v[ 1 ], w: v[ 2 ], h: v[ 3 ] };
				}
			}
			var w = svgTag[ 0 ].match( /\swidth\s*=\s*["']?([\d.]+)(?:px)?["'\s>\/]/i );
			var h = svgTag[ 0 ].match( /\sheight\s*=\s*["']?([\d.]+)(?:px)?["'\s>\/]/i );
			if ( w && h && +w[ 1 ] > 0 && +h[ 1 ] > 0 ) {
				return { x: 0, y: 0, w: +w[ 1 ], h: +h[ 1 ] };
			}
		}
		return measured ? measured.bbox : null;
	}

	// Fits a custom path's box into the 0-100 shape box.
	function customTransform( box ) {
		return 'scale(' + ( 100 / box.w ) + ' ' + ( 100 / box.h ) + ') translate(' + ( -box.x ) + ' ' + ( -box.y ) + ')';
	}

	// How a custom paste sits in the 0-100 box for a resolved flat edge.
	// With a flat edge it is fitted by its own bbox, so the detected straight
	// side lands exactly on the box edge, then turned: back to the right
	// (EDGE_INVERSE), then to the chosen side (EDGE_TRANSFORM). Without one
	// it keeps the paste's own box (viewBox fit) and is not turned.
	function customFit( custom, edge ) {
		if ( 'none' === edge || ! custom.straight ) {
			return { box: custom.box, turn: '' };
		}
		return {
			box: custom.bbox,
			turn: joinTransforms( EDGE_TRANSFORM[ edge ], EDGE_INVERSE[ custom.straight ] )
		};
	}

	// Gentle motion: the exact pasted shape tilts and swells around the
	// centre of the 0-100 box. v is the animation value (it springs past 1).
	// The 0-100 box is square, but the clip (objectBoundingBox) and the deco
	// (preserveAspectRatio="none") both stretch it to the shape's rendered
	// pixel aspect, so a plain rotate here would come out as a shear on any
	// non-square element. aspect is that pixel width/height; conjugating the
	// rotation with it (stretch x by aspect, rotate, unstretch) undoes the
	// later pixel stretch so the shape actually rotates. inner = the custom
	// shape's whole static inner chain (flip/rotate, flat-edge turn, fit),
	// which this wraps.
	function gentleTransform( motion, v, inner, aspect ) {
		aspect = aspect > 0 && isFinite( aspect ) ? aspect : 1;
		return 'translate(50 50) scale(' + ( 1 / aspect ) + ' 1) rotate(' + ( motion.rotate * v ) + ') scale(' + aspect + ' 1) scale(' + ( 1 + ( motion.scale - 1 ) * v ) + ') translate(-50 -50) ' + inner;
	}

	// The trigger actually in effect: Auto springs Blobs on hover and leaves
	// every other family (Wavy, Flow, Custom) static.
	function resolveTrigger( setting, family ) {
		var trigger = setting || 'auto';
		if ( 'auto' === trigger ) {
			return 'blob' === family ? 'hover' : 'none';
		}
		return trigger;
	}

	/* ---------- custom shape: liquid tracing ---------- */

	var TRACE_SAMPLES = 400;
	var TRACE_POINTS = 96;
	var traceCache = null;

	// Evenly spaced points along a custom path, split into its separate parts
	// (a jump between neighbouring samples means a moveto), normalised into
	// the 0-100 box by `box` (the same box the static fit would use). Returns
	// an array of point arrays, or null.
	function tracePoints( custom, box ) {
		var svg = svgEl( 'svg', { width: '0', height: '0', 'aria-hidden': 'true', style: 'position:absolute;width:0;height:0;overflow:hidden' } );
		var path = svgEl( 'path', { d: custom.d } );
		svg.appendChild( path );
		document.body.appendChild( svg );
		var total = 0;
		var samples = [];
		try {
			total = path.getTotalLength();
			if ( total > 0 && isFinite( total ) ) {
				for ( var i = 0; i <= TRACE_SAMPLES; i++ ) {
					var pt = path.getPointAtLength( total * i / TRACE_SAMPLES );
					samples.push( { x: pt.x, y: pt.y } );
				}
			}
		} catch ( e ) {
			samples = [];
		}
		svg.remove();
		if ( samples.length < 2 ) {
			return null;
		}

		var step = total / TRACE_SAMPLES;
		var chains = [];
		var chain = [ samples[ 0 ] ];
		for ( var j = 1; j < samples.length; j++ ) {
			var a = samples[ j - 1 ];
			var b = samples[ j ];
			if ( Math.sqrt( ( b.x - a.x ) * ( b.x - a.x ) + ( b.y - a.y ) * ( b.y - a.y ) ) > 3 * step ) {
				chains.push( chain );
				chain = [];
			}
			chain.push( b );
		}
		chains.push( chain );

		var kept = [];
		var sum = 0;
		chains.forEach( function ( c ) {
			var len = polylineLength( c );
			if ( c.length > 1 && len >= 0.01 * total ) {
				kept.push( { points: c, len: len } );
				sum += len;
			}
		} );
		if ( ! kept.length ) {
			return null;
		}
		return kept.map( function ( k ) {
			var n = Math.max( 8, Math.round( TRACE_POINTS * k.len / sum ) );
			return resample( k.points, k.len, n ).map( function ( p ) {
				return { x: ( p.x - box.x ) * 100 / box.w, y: ( p.y - box.y ) * 100 / box.h };
			} );
		} );
	}

	function polylineLength( pts ) {
		var len = 0;
		for ( var i = 1; i < pts.length; i++ ) {
			len += Math.sqrt( ( pts[ i ].x - pts[ i - 1 ].x ) * ( pts[ i ].x - pts[ i - 1 ].x ) + ( pts[ i ].y - pts[ i - 1 ].y ) * ( pts[ i ].y - pts[ i - 1 ].y ) );
		}
		return len;
	}

	// n points at equal distances along a polyline of length len.
	function resample( pts, len, n ) {
		var out = [];
		var seg = 0;
		var walked = 0;
		for ( var i = 0; i < n; i++ ) {
			var target = len * i / n;
			while ( seg < pts.length - 2 ) {
				var sl = Math.sqrt( ( pts[ seg + 1 ].x - pts[ seg ].x ) * ( pts[ seg + 1 ].x - pts[ seg ].x ) + ( pts[ seg + 1 ].y - pts[ seg ].y ) * ( pts[ seg + 1 ].y - pts[ seg ].y ) );
				if ( walked + sl >= target ) {
					break;
				}
				walked += sl;
				seg++;
			}
			var p0 = pts[ seg ];
			var p1 = pts[ seg + 1 ];
			var l = Math.sqrt( ( p1.x - p0.x ) * ( p1.x - p0.x ) + ( p1.y - p0.y ) * ( p1.y - p0.y ) ) || 1;
			var t = Math.max( 0, Math.min( 1, ( target - walked ) / l ) );
			out.push( { x: p0.x + ( p1.x - p0.x ) * t, y: p0.y + ( p1.y - p0.y ) * t } );
		}
		return out;
	}

	// Pushes each point along its normal by a 2- and 3-lobe wave: the hover
	// pose's ripple. Fixed phases per part, so it never looks random. The
	// normal comes from a tangent summed over 3 neighbours each side: at a
	// sharp corner a one-step tangent turns 90 degrees within one point
	// spacing, so neighbouring pushes cross; a wider tangent turns gradually.
	// pin = the straight side (right | left | top | bottom) when a Flat edge
	// fitted the shape by its bbox, so that side sits on the 0-100 box edge:
	// the push fades to zero within PIN_TAPER units of it, so the side stays
	// flush while the rest ripples (as Wavy / Flow keep theirs).
	function ripplePoints( pts, amp, index, pin ) {
		var n = pts.length;
		var ph1 = 0.9 + 1.7 * index;
		var ph2 = 2.1 + 1.3 * index;
		return pts.map( function ( p, i ) {
			var tx = 0;
			var ty = 0;
			for ( var j = 1; j <= 3; j++ ) {
				var prev = pts[ ( ( i - j ) % n + n ) % n ];
				var next = pts[ ( i + j ) % n ];
				tx += next.x - prev.x;
				ty += next.y - prev.y;
			}
			var tl = Math.sqrt( tx * tx + ty * ty ) || 1;
			var s = i / n;
			var k = amp * ( 0.6 * Math.sin( 2 * Math.PI * 2 * s + ph1 ) + 0.4 * Math.sin( 2 * Math.PI * 3 * s + ph2 ) );
			if ( pin ) {
				k *= Math.min( 1, pinDistance( p, pin ) / PIN_TAPER );
			}
			return { x: p.x - ty / tl * k, y: p.y + tx / tl * k };
		} );
	}

	var PIN_TAPER = 10;

	// Distance (0-100 box units) from a point to one side of the box, or to
	// the nearest of a list of sides (the Shape Divider pins its container
	// edge and both ends; Organic Shape passes a single side).
	function pinDistance( p, side ) {
		if ( Array.isArray( side ) ) {
			return Math.min.apply( null, side.map( function ( one ) {
				return pinDistance( p, one );
			} ) );
		}
		if ( 'right' === side ) {
			return Math.abs( 100 - p.x );
		}
		if ( 'left' === side ) {
			return Math.abs( p.x );
		}
		return Math.abs( 'top' === side ? p.y : 100 - p.y );
	}

	// Closed Catmull-Rom path through points: the same maths and 2-decimal
	// format as the PHP smooth_path( $points, true ), so rest and hover share
	// one structure and the number blend morphs them.
	function smoothClosed( pts ) {
		var n = pts.length;
		var f = function ( v ) {
			return v.toFixed( 2 );
		};
		var d = 'M' + f( pts[ 0 ].x ) + ' ' + f( pts[ 0 ].y );
		for ( var i = 0; i < n; i++ ) {
			var p0 = pts[ ( i - 1 + n ) % n ];
			var p1 = pts[ i ];
			var p2 = pts[ ( i + 1 ) % n ];
			var p3 = pts[ ( i + 2 ) % n ];
			d += 'C' + f( p1.x + ( p2.x - p0.x ) / 6 ) + ' ' + f( p1.y + ( p2.y - p0.y ) / 6 )
				+ ' ' + f( p2.x - ( p3.x - p1.x ) / 6 ) + ' ' + f( p2.y - ( p3.y - p1.y ) / 6 )
				+ ' ' + f( p2.x ) + ' ' + f( p2.y );
		}
		return d + 'Z';
	}

	// Liquid motion for a custom shape: { rest, hover } path strings in the
	// 0-100 box, or null when the paste can't be traced. Single-entry memo,
	// like parseCustom, keyed on path, box and amount (the box drives the
	// normalisation, so the same path with a new viewBox, or switching
	// between the viewBox fit and a flat edge's bbox fit, must re-trace).
	// pin = the straight side to keep flush (see ripplePoints), or null.
	function traceCustom( custom, box, amount, pin ) {
		var key = custom.d + '|' + box.x + ',' + box.y + ',' + box.w + ',' + box.h + '|' + amount + '|' + ( pin || '' );
		if ( traceCache && traceCache.key === key ) {
			return traceCache.result;
		}
		var parts = tracePoints( custom, box );
		var result = null;
		if ( parts ) {
			var amp = CUSTOM_AMOUNT[ amount ].ripple;
			result = {
				rest: parts.map( function ( pts ) {
					return smoothClosed( pts );
				} ).join( ' ' ),
				// The ripple is in absolute box units, so small parts (a dot, a
				// short island) get a proportionally smaller push; otherwise they
				// would invert or cross themselves. A full-box outline (~300) is
				// unaffected.
				hover: parts.map( function ( pts, i ) {
					var perimeter = polylineLength( pts.concat( [ pts[ 0 ] ] ) );
					return smoothClosed( ripplePoints( pts, amp * Math.min( 1, perimeter / 60 ), i, pin ) );
				} ).join( ' ' )
			};
		}
		traceCache = { key: key, result: result };
		return result;
	}

	/* ---------- custom shape: dot fields ----------
	 *
	 * A pattern made in Shape studio > Generate is a path of circle subpaths
	 * in one exact form (see assets/framify-dot-shapes.js). dotField() accepts
	 * only that form, so an ordinary shape never enters Dots motion.
	 *
	 * blendPath() cannot move these paths: it writes every number with
	 * toFixed( 2 ), so an arc flag 1 becomes 1.00, which is not a valid flag
	 * and the clip disappears. blendDots() keeps every number that does not
	 * change (flags, rotation, the outline) exactly as written.
	 */
	var dotMemo = null;

	function dotField( d ) {
		d = String( d || '' ).trim();
		if ( dotMemo && dotMemo.d === d ) {
			return dotMemo.result;
		}
		var result = parseDotField( d );
		dotMemo = { d: d, result: result };
		return result;
	}

	function parseDotField( d ) {
		var chunks = d ? d.split( /(?=M)/ ) : [];
		if ( ! chunks.length || chunks.length > DOT_MAX + 2 ) {
			return null;
		}
		var at = 0;
		var first = 0;
		if ( /^M0 0H[\d.]+V[\d.]+H0Z$/.test( chunks[ 0 ] ) ) {
			at = chunks[ 0 ].match( NUMBER ).length;
			first = 1;
		}
		// Dispersion: a solid mass polygon comes before the particles.
		var mass = null;
		if ( chunks[ first ] && /^M[^MCSQTAHVZ]*L/.test( chunks[ first ] ) ) {
			mass = parsePoly( chunks[ first ], 8, 64 );
			if ( ! mass ) {
				return null;
			}
			at += chunks[ first ].match( NUMBER ).length;
			first++;
		}
		var dots = [];
		for ( var i = first; i < chunks.length; i++ ) {
			var dot = parseParticle( chunks[ i ], at, mass );
			if ( ! dot ) {
				return null;
			}
			dots.push( dot );
			at += dot.tokens;
		}
		if ( ! dots.length || dots.length > DOT_MAX ) {
			return null;
		}
		var pitch = Infinity;
		var minX = Infinity;
		var maxX = -Infinity;
		dots.forEach( function ( dot, i ) {
			minX = Math.min( minX, dot.x );
			maxX = Math.max( maxX, dot.x );
			dot.near = Infinity;
			for ( var j = 0; j < dots.length; j++ ) {
				if ( j !== i ) {
					dot.near = Math.min( dot.near, Math.hypot( dot.x - dots[ j ].x, dot.y - dots[ j ].y ) );
				}
			}
			pitch = Math.min( pitch, dot.near );
		} );
		var field = { rest: parsePath( d ), dots: dots, pitch: pitch, minX: minX, maxX: maxX, mass: mass, anchor: null };
		if ( mass ) {
			// Each particle may swell to half its own nearest-neighbour gap and
			// no further than the mass; a particle already closer keeps its size.
			dots.forEach( function ( dot ) {
				dot.cap = Math.min( dot.near / 2, polyDistance( dot.x, dot.y, mass.pts ) );
			} );
			field.anchor = massAnchor( mass.pts );
		} else {
			var sx = 0;
			var sy = 0;
			dots.forEach( function ( dot ) {
				sx += dot.x;
				sy += dot.y;
			} );
			field.anchor = [ sx / dots.length, sy / dots.length ];
		}
		return field;
	}

	// One particle chunk: a circle in the exact dot form, or a convex
	// counter-clockwise polygon of 3-4 corners. Dispersion polygons are only
	// accepted next to a mass, so an ordinary icon is never taken for them.
	function parseParticle( chunk, at, mass ) {
		var n;
		// M x y  a rx ry rot large sweep dx dy  a rx ry rot large sweep dx dy  Z
		if ( 'M##a#######a#######Z' === chunk.replace( NUMBER, '#' ).replace( /[\s,]+/g, '' ) ) {
			n = chunk.match( NUMBER ).map( Number );
			var r = n[ 2 ];
			if ( ! ( r > 0 ) || n[ 3 ] !== r || n[ 9 ] !== r || n[ 10 ] !== r
				|| 0 !== n[ 4 ] || 0 !== n[ 11 ] || 1 !== n[ 5 ] || 1 !== n[ 12 ] || 0 !== n[ 6 ] || 0 !== n[ 13 ]
				|| 0 !== n[ 8 ] || 0 !== n[ 15 ] || Math.abs( n[ 7 ] - 2 * r ) > 0.011 || Math.abs( n[ 14 ] + 2 * r ) > 0.011 ) {
				return null;
			}
			return { x: n[ 0 ] + r, y: n[ 1 ], r: r, at: at, tokens: DOT_TOKENS, pts: null };
		}
		var poly = mass ? parsePoly( chunk, 3, 4 ) : null;
		if ( ! poly || ! poly.convex ) {
			return null;
		}
		return { x: poly.cx, y: poly.cy, r: poly.reach, at: at, tokens: poly.pts.length * 2, pts: poly.pts };
	}

	// "M x y L x y ... Z" with min-max corners, counter-clockwise on screen.
	function parsePoly( chunk, min, max ) {
		var skeleton = chunk.replace( NUMBER, '#' ).replace( /[\s,]+/g, '' );
		if ( ! /^M##(?:L##)+Z$/.test( skeleton ) ) {
			return null;
		}
		var n = chunk.match( NUMBER ).map( Number );
		var count = n.length / 2;
		if ( count < min || count > max ) {
			return null;
		}
		var pts = [];
		var sx = 0;
		var sy = 0;
		for ( var i = 0; i < count; i++ ) {
			pts.push( [ n[ 2 * i ], n[ 2 * i + 1 ] ] );
			sx += n[ 2 * i ];
			sy += n[ 2 * i + 1 ];
		}
		var area = 0;
		var convex = true;
		var reach = 0;
		for ( var k = 0; k < count; k++ ) {
			var a = pts[ k ];
			var b = pts[ ( k + 1 ) % count ];
			var c = pts[ ( k + 2 ) % count ];
			area += a[ 0 ] * b[ 1 ] - b[ 0 ] * a[ 1 ];
			// Counter-clockwise on screen: every turn has a negative cross.
			if ( ( b[ 0 ] - a[ 0 ] ) * ( c[ 1 ] - b[ 1 ] ) - ( b[ 1 ] - a[ 1 ] ) * ( c[ 0 ] - b[ 0 ] ) >= 0 ) {
				convex = false;
			}
			reach = Math.max( reach, Math.hypot( a[ 0 ] - sx / count, a[ 1 ] - sy / count ) );
		}
		if ( ! ( area < 0 ) ) {
			return null;
		}
		return { pts: pts, cx: sx / count, cy: sy / count, convex: convex, reach: reach };
	}

	function polyDistance( x, y, pts ) {
		var best = Infinity;
		for ( var i = 0; i < pts.length; i++ ) {
			var a = pts[ i ];
			var b = pts[ ( i + 1 ) % pts.length ];
			var dx = b[ 0 ] - a[ 0 ];
			var dy = b[ 1 ] - a[ 1 ];
			var u = Math.min( 1, Math.max( 0, ( ( x - a[ 0 ] ) * dx + ( y - a[ 1 ] ) * dy ) / ( dx * dx + dy * dy || 1 ) ) );
			best = Math.min( best, Math.hypot( x - a[ 0 ] - u * dx, y - a[ 1 ] - u * dy ) );
		}
		return best;
	}

	// A point the whole mass can be seen from (inside its kernel): Drift
	// expands about it, which can never push a particle into the mass. The
	// area centre is tried first, then it is pulled toward each side of the
	// mass; null when none works (the mass is not star-shaped).
	function massAnchor( pts ) {
		var minX = Infinity;
		var maxX = -Infinity;
		var minY = Infinity;
		var maxY = -Infinity;
		var cx = 0;
		var cy = 0;
		pts.forEach( function ( p ) {
			minX = Math.min( minX, p[ 0 ] );
			maxX = Math.max( maxX, p[ 0 ] );
			minY = Math.min( minY, p[ 1 ] );
			maxY = Math.max( maxY, p[ 1 ] );
			cx += p[ 0 ] / pts.length;
			cy += p[ 1 ] / pts.length;
		} );
		var tries = [ [ cx, cy ] ];
		[ 0.8, 0.9, 0.95 ].forEach( function ( k ) {
			tries.push( [ cx + ( minX - cx ) * k, cy ], [ cx + ( maxX - cx ) * k, cy ], [ cx, cy + ( minY - cy ) * k ], [ cx, cy + ( maxY - cy ) * k ] );
		} );
		for ( var i = 0; i < tries.length; i++ ) {
			var o = tries[ i ];
			var ok = true;
			for ( var k = 0; k < pts.length && ok; k++ ) {
				var a = pts[ k ];
				var b = pts[ ( k + 1 ) % pts.length ];
				// Inside every edge of a counter-clockwise polygon (negative cross).
				ok = ( b[ 0 ] - a[ 0 ] ) * ( o[ 1 ] - a[ 1 ] ) - ( b[ 1 ] - a[ 1 ] ) * ( o[ 0 ] - a[ 0 ] ) <= 0;
			}
			if ( ok ) {
				return o;
			}
		}
		return null;
	}

	// A stable 0-1 value per dot index (the same on every rebuild).
	function dotHash( i ) {
		var v = Math.sin( ( i + 1 ) * 12.9898 ) * 43758.5453;
		return v - Math.floor( v );
	}

	// Rest and hover poses with the same token skeleton. Radii never pass half
	// the nearest-neighbour distance, so dots never merge (and in Invert mode
	// two opposite-wound holes can never overlap and fill in).
	function dotPair( field, style, amount ) {
		var rest = field.rest;
		var a = DOT_AMOUNT[ amount ] || DOT_AMOUNT.normal;
		var cap = isFinite( field.pitch ) ? field.pitch / 2 : 0;
		var span = field.maxX - field.minX || 1;
		var nums = rest.nums.slice();
		var delays = 'wave' === style ? rest.nums.map( function () {
			return 0;
		} ) : null;
		var drift = 'drift' === style && field.anchor;
		if ( 'drift' === style && ! drift ) {
			style = 'breathe';
		}
		var push = DRIFT_AMOUNT[ amount ] || DRIFT_AMOUNT.normal;
		field.dots.forEach( function ( dot, i ) {
			var at = dot.at;
			if ( drift ) {
				// Slide the whole particle along the line from the anchor through
				// its centre. Expanding about one point only ever moves particles
				// apart, and away from a mass that is seen from that point.
				var dx = ( dot.x - field.anchor[ 0 ] ) * push;
				var dy = ( dot.y - field.anchor[ 1 ] ) * push;
				for ( var m = 0; m < ( dot.pts ? dot.pts.length : 1 ); m++ ) {
					nums[ at + 2 * m ] = Math.round( ( rest.nums[ at + 2 * m ] + dx ) * 100 ) / 100;
					nums[ at + 2 * m + 1 ] = Math.round( ( rest.nums[ at + 2 * m + 1 ] + dy ) * 100 ) / 100;
				}
				return;
			}
			var room = field.mass ? dot.cap : cap;
			var limit = room ? Math.max( dot.r, room ) : dot.r * 2;
			var target = 'twinkle' === style ? dot.r * ( 1 + a * ( 1.4 * dotHash( i ) - 0.5 ) ) : dot.r * ( 1 + a );
			var rt = Math.round( Math.min( limit, Math.max( dot.r * 0.2, target ) ) * 100 ) / 100;
			if ( dot.pts ) {
				// Corners scale about the centre; r is the reach of the farthest.
				for ( var q = 0; q < dot.pts.length; q++ ) {
					nums[ at + 2 * q ] = Math.round( ( dot.x + ( dot.pts[ q ][ 0 ] - dot.x ) * rt / dot.r ) * 100 ) / 100;
					nums[ at + 2 * q + 1 ] = Math.round( ( dot.y + ( dot.pts[ q ][ 1 ] - dot.y ) * rt / dot.r ) * 100 ) / 100;
				}
			} else {
				nums[ at ] = Math.round( ( dot.x - rt ) * 100 ) / 100;
				nums[ at + 2 ] = nums[ at + 3 ] = nums[ at + 9 ] = nums[ at + 10 ] = rt;
				nums[ at + 7 ] = Math.round( 2 * rt * 100 ) / 100;
				nums[ at + 14 ] = -nums[ at + 7 ];
			}
			if ( delays ) {
				var delay = DOT_SPREAD * ( dot.x - field.minX ) / span;
				for ( var k = 0; k < dot.tokens; k++ ) {
					delays[ at + k ] = delay;
				}
			}
		} );
		var hover = { d: '', parts: rest.parts, nums: nums };
		return {
			rest: rest,
			hover: hover,
			blend: function ( t ) {
				return blendDots( rest, hover, delays, t );
			}
		};
	}

	// Wave: dots on the left finish early, dots on the right start late; at 0
	// and 1 every dot is exactly at rest / hover. The progress is clamped to
	// 0-1 so the spring's overshoot cannot push a radius past its cap.
	function dotProgress( t, delay ) {
		if ( t <= 0 ) {
			return 0;
		}
		if ( t >= 1 ) {
			return 1;
		}
		return Math.min( 1, Math.max( 0, ( t - delay ) / ( 1 - DOT_SPREAD ) ) );
	}

	function blendDots( rest, hover, delays, t ) {
		var out = rest.parts[ 0 ];
		var all = Math.min( 1, Math.max( 0, t ) );
		for ( var i = 0; i < rest.nums.length; i++ ) {
			var a = rest.nums[ i ];
			var b = hover.nums[ i ];
			var k = delays ? dotProgress( t, delays[ i ] ) : all;
			// Shortest form (123, not 123.00), so t = 0 is the original path.
			out += ( a === b ? String( a ) : String( +( a + ( b - a ) * k ).toFixed( 2 ) ) ) + rest.parts[ i + 1 ];
		}
		return out;
	}

	/* ---------- full SVG documents (Shape Divider) ----------
	 *
	 * The Custom shape reads d attributes with a regex and ignores
	 * transforms. A divider SVG (pasted, or fetched from the Media Library)
	 * is usually a whole document built from rects, polygons and transformed
	 * groups, so it is parsed as XML instead: DOMParser (image/svg+xml)
	 * returns a detached document that is never inserted, adopted or
	 * rendered, and XML parsing runs no script. Only the geometry elements
	 * in SVG_GEOMETRY are read, walking only through the containers in
	 * SVG_GROUPS; every other element (script, style, image, use,
	 * foreignObject, text, defs, clipPath, mask, ...) and every attribute
	 * except the numbers below, transform and the root viewBox is ignored.
	 * Each shape becomes absolute path data built here from numbers only
	 * (M / L / C / Z: rect, circle, ellipse, arcs and quadratics converted
	 * to cubics), with its own and its ancestors' transforms applied, so
	 * the result is safe by construction and still goes out only through
	 * setAttribute('d').
	 */

	var SVG_GEOMETRY = { path: 1, rect: 1, circle: 1, ellipse: 1, line: 1, polyline: 1, polygon: 1 };
	// A nested svg is walked like a group (its own viewport is ignored).
	var SVG_GROUPS = { g: 1, a: 1, svg: 1 };
	var SVG_DOC_MAX = 200000;
	var SVG_DEPTH_MAX = 32;
	var SVG_SHAPES_MAX = 2000;
	var IDENTITY = [ 1, 0, 0, 1, 0, 0 ];
	var ONE_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:px)?$/i;
	var TRANSFORM_CHARS = /^[a-zA-Z0-9\s(),.+\-]*$/;
	var POINTS_CHARS = /^[0-9eE\s,.+\-]*$/;
	var svgDocCache = null;

	// Pasted / fetched SVG text (or bare path data) -> the same result shape
	// as parseCustom ({ d, box, bbox, straight } in the source's own
	// coordinates; box = the root viewBox, else width / height, else the
	// measured bounds), or null. A document also gives `parts`, one d per
	// source shape: overlapping shapes drawn with opposite windings would
	// cut holes in each other inside one path, so they are painted apart. Bare path data, and markup that is not
	// well-formed XML (e.g. an HTML entity such as &nbsp;), go through
	// parseCustom unchanged: the Custom shape's rule, d attributes only.
	function parseSvgShape( text ) {
		text = String( text || '' ).trim();
		if ( -1 === text.indexOf( '<' ) ) {
			return parseCustom( text );
		}
		if ( svgDocCache && svgDocCache.text === text ) {
			return svgDocCache.result;
		}
		var geo = svgGeometry( text );
		var result = null;
		if ( geo ) {
			var measured = measureCustom( geo.d );
			var box = geo.box || ( measured ? measured.bbox : null );
			result = box ? {
				d: geo.d,
				parts: geo.parts,
				box: box,
				bbox: measured ? measured.bbox : box,
				straight: measured ? measured.straight : null
			} : null;
		} else if ( false === geo ) {
			result = parseCustom( text );
		}
		svgDocCache = { text: text, result: result };
		return result;
	}

	// The DOM-free part of parseSvgShape (the node test runs it with a tiny
	// DOMParser stand-in): { d, parts, box | null } when the document has geometry,
	// null when it has none, false when it is not a parsable SVG document.
	function svgGeometry( text ) {
		if ( ! text || text.length > SVG_DOC_MAX || ! window.DOMParser ) {
			return false;
		}
		var doc = null;
		try {
			doc = new window.DOMParser().parseFromString( text, 'image/svg+xml' );
		} catch ( e ) {
			return false;
		}
		var root = doc && doc.documentElement;
		if ( ! root || 'svg' !== root.localName || doc.getElementsByTagName( 'parsererror' ).length ) {
			return false;
		}
		var out = [];
		walkSvg( root, IDENTITY, out, 0 );
		return out.length ? { d: out.join( ' ' ), parts: out, box: rootBox( root ) } : null;
	}

	function walkSvg( el, ctm, out, depth ) {
		var kids = el.children || [];
		if ( depth > SVG_DEPTH_MAX ) {
			return;
		}
		for ( var i = 0; i < kids.length && out.length < SVG_SHAPES_MAX; i++ ) {
			var node = kids[ i ];
			var name = node.localName;
			if ( ( ! SVG_GEOMETRY[ name ] && ! SVG_GROUPS[ name ] ) || 'none' === node.getAttribute( 'display' ) ) {
				continue;
			}
			var m = parseTransform( node.getAttribute( 'transform' ) );
			if ( ! m ) {
				continue;
			}
			m = matMul( ctm, m );
			if ( SVG_GROUPS[ name ] ) {
				walkSvg( node, m, out, depth + 1 );
				continue;
			}
			var d = geometryPath( node, name );
			var abs = d ? transformPath( d, m ) : '';
			if ( abs ) {
				out.push( abs );
			}
		}
	}

	// The root's coordinate box: viewBox, else numeric width / height.
	function rootBox( root ) {
		var vb = String( root.getAttribute( 'viewBox' ) || '' ).trim().split( /[\s,]+/ ).map( Number );
		if ( 4 === vb.length && vb.every( isFinite ) && vb[ 2 ] > 0 && vb[ 3 ] > 0 ) {
			return { x: vb[ 0 ], y: vb[ 1 ], w: vb[ 2 ], h: vb[ 3 ] };
		}
		var w = attrNumber( root, 'width', NaN );
		var h = attrNumber( root, 'height', NaN );
		return w > 0 && h > 0 ? { x: 0, y: 0, w: w, h: h } : null;
	}

	// A plain number (px allowed) or `fallback` when the attribute is
	// missing; NaN for anything else (%, em, calc...), which drops the shape.
	function attrNumber( node, name, fallback ) {
		var v = node.getAttribute( name );
		if ( null === v || '' === String( v ).trim() ) {
			return fallback;
		}
		v = String( v ).trim();
		return ONE_NUMBER.test( v ) ? parseFloat( v ) : NaN;
	}

	// One geometry element as path data in its own user space, or ''.
	function geometryPath( node, name ) {
		var n = function ( attr, fallback ) {
			return attrNumber( node, attr, fallback );
		};
		var d = '';
		if ( 'path' === name ) {
			d = String( node.getAttribute( 'd' ) || '' ).trim();
			return PATH_CHARS.test( d ) ? d : '';
		}
		if ( 'rect' === name ) {
			var x = n( 'x', 0 );
			var y = n( 'y', 0 );
			var w = n( 'width', NaN );
			var h = n( 'height', NaN );
			var rx = n( 'rx', null );
			var ry = n( 'ry', null );
			// SVG: a missing (or auto) radius takes the other one; both
			// are clamped to half the side.
			rx = null === rx || isNaN( rx ) ? ry : rx;
			ry = null === ry || isNaN( ry ) ? rx : ry;
			rx = Math.min( Math.max( 0, rx || 0 ), w / 2 );
			ry = Math.min( Math.max( 0, ry || 0 ), h / 2 );
			if ( ! ( w > 0 && h > 0 ) || ! isFinite( x + y ) ) {
				return '';
			}
			if ( ! rx || ! ry ) {
				return 'M' + x + ' ' + y + 'H' + ( x + w ) + 'V' + ( y + h ) + 'H' + x + 'Z';
			}
			var arc = 'A' + rx + ' ' + ry + ' 0 0 1 ';
			return 'M' + ( x + rx ) + ' ' + y + 'H' + ( x + w - rx ) + arc + ( x + w ) + ' ' + ( y + ry )
				+ 'V' + ( y + h - ry ) + arc + ( x + w - rx ) + ' ' + ( y + h ) + 'H' + ( x + rx ) + arc + x + ' ' + ( y + h - ry )
				+ 'V' + ( y + ry ) + arc + ( x + rx ) + ' ' + y + 'Z';
		}
		if ( 'circle' === name || 'ellipse' === name ) {
			var cx = n( 'cx', 0 );
			var cy = n( 'cy', 0 );
			var ex = 'circle' === name ? n( 'r', NaN ) : n( 'rx', NaN );
			var ey = 'circle' === name ? ex : n( 'ry', NaN );
			if ( ! ( ex > 0 && ey > 0 ) || ! isFinite( cx + cy ) ) {
				return '';
			}
			var half = 'A' + ex + ' ' + ey + ' 0 1 0 ';
			return 'M' + ( cx - ex ) + ' ' + cy + half + ( cx + ex ) + ' ' + cy + half + ( cx - ex ) + ' ' + cy + 'Z';
		}
		if ( 'line' === name ) {
			var line = [ n( 'x1', 0 ), n( 'y1', 0 ), n( 'x2', 0 ), n( 'y2', 0 ) ];
			return line.every( isFinite ) ? 'M' + line[ 0 ] + ' ' + line[ 1 ] + 'L' + line[ 2 ] + ' ' + line[ 3 ] : '';
		}
		// polyline / polygon
		var raw = String( node.getAttribute( 'points' ) || '' );
		var pts = POINTS_CHARS.test( raw ) ? ( raw.match( NUMBER ) || [] ).map( Number ) : [];
		if ( pts.length < 4 ) {
			return '';
		}
		for ( var i = 0; i + 1 < pts.length; i += 2 ) {
			d += ( i ? 'L' : 'M' ) + pts[ i ] + ' ' + pts[ i + 1 ];
		}
		return d + ( 'polygon' === name ? 'Z' : '' );
	}

	// A transform attribute as a matrix [ a b c d e f ]; identity when
	// missing, null (drop the element) when it cannot be read.
	function parseTransform( str ) {
		str = String( str || '' ).trim();
		if ( ! str ) {
			return IDENTITY;
		}
		if ( ! TRANSFORM_CHARS.test( str ) ) {
			return null;
		}
		var m = IDENTITY;
		var re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
		var found = 0;
		var hit;
		while ( ( hit = re.exec( str ) ) ) {
			var v = ( hit[ 2 ].match( /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi ) || [] ).map( Number );
			var t = transformMatrix( hit[ 1 ], v );
			if ( ! t ) {
				return null;
			}
			m = matMul( m, t );
			found++;
		}
		return found ? m : null;
	}

	function transformMatrix( name, v ) {
		var rad = ( v[ 0 ] || 0 ) * Math.PI / 180;
		if ( 'matrix' === name ) {
			return 6 === v.length ? v : null;
		}
		if ( 'translate' === name ) {
			return v.length ? [ 1, 0, 0, 1, v[ 0 ], v[ 1 ] || 0 ] : null;
		}
		if ( 'scale' === name ) {
			return v.length ? [ v[ 0 ], 0, 0, 1 < v.length ? v[ 1 ] : v[ 0 ], 0, 0 ] : null;
		}
		if ( 'rotate' === name ) {
			if ( ! v.length ) {
				return null;
			}
			var r = [ Math.cos( rad ), Math.sin( rad ), -Math.sin( rad ), Math.cos( rad ), 0, 0 ];
			return 3 === v.length ? matMul( matMul( [ 1, 0, 0, 1, v[ 1 ], v[ 2 ] ], r ), [ 1, 0, 0, 1, -v[ 1 ], -v[ 2 ] ] ) : r;
		}
		if ( ! v.length ) {
			return null;
		}
		return 'skewX' === name ? [ 1, 0, Math.tan( rad ), 1, 0, 0 ] : [ 1, Math.tan( rad ), 0, 1, 0, 0 ];
	}

	// A x B: B is applied first.
	function matMul( a, b ) {
		return [
			a[ 0 ] * b[ 0 ] + a[ 2 ] * b[ 1 ],
			a[ 1 ] * b[ 0 ] + a[ 3 ] * b[ 1 ],
			a[ 0 ] * b[ 2 ] + a[ 2 ] * b[ 3 ],
			a[ 1 ] * b[ 2 ] + a[ 3 ] * b[ 3 ],
			a[ 0 ] * b[ 4 ] + a[ 2 ] * b[ 5 ] + a[ 4 ],
			a[ 1 ] * b[ 4 ] + a[ 3 ] * b[ 5 ] + a[ 5 ]
		];
	}

	var PATH_ARITY = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

	// Path data -> [ [ cmd, [ numbers ] ], ... ] with each command's argument
	// groups split out (an implicit repeat keeps its command; a repeat after
	// a moveto is a lineto). Arc flags may be packed ("a10 10 0 0110 10").
	// null on any syntax error.
	function pathCommands( d ) {
		var out = [];
		var i = 0;
		var len = d.length;
		var num = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/iy;
		var cmd = '';
		var skip = function () {
			while ( i < len && /[\s,]/.test( d.charAt( i ) ) ) {
				i++;
			}
		};
		skip();
		while ( i < len ) {
			var c = d.charAt( i );
			if ( /[a-z]/i.test( c ) ) {
				cmd = c;
				i++;
				if ( 'z' === c.toLowerCase() ) {
					out.push( [ c, [] ] );
					skip();
					continue;
				}
			} else if ( ! cmd || 'z' === cmd.toLowerCase() ) {
				return null;
			}
			var arity = PATH_ARITY[ cmd.toLowerCase() ];
			if ( undefined === arity ) {
				return null;
			}
			var args = [];
			for ( var k = 0; k < arity; k++ ) {
				skip();
				if ( 'a' === cmd.toLowerCase() && ( 3 === k || 4 === k ) ) {
					var flag = d.charAt( i );
					if ( '0' !== flag && '1' !== flag ) {
						return null;
					}
					args.push( +flag );
					i++;
					continue;
				}
				num.lastIndex = i;
				var hit = num.exec( d );
				if ( ! hit ) {
					return null;
				}
				args.push( parseFloat( hit[ 0 ] ) );
				i = num.lastIndex;
			}
			out.push( [ cmd, args ] );
			if ( 'm' === cmd.toLowerCase() ) {
				cmd = 'm' === cmd ? 'l' : 'L';
			}
			// Another argument group without a letter repeats the command.
			skip();
		}
		return out;
	}

	// Path data -> absolute M / L / C / Z with matrix m applied, numbers
	// rounded to 3 decimals; '' when it cannot be read.
	function transformPath( d, m ) {
		var list = pathCommands( d );
		if ( ! list || ! list.length ) {
			return '';
		}
		var f = function ( v ) {
			var r = Math.round( v * 1000 ) / 1000;
			return String( 0 === r ? 0 : r );
		};
		var pt = function ( x, y ) {
			return f( m[ 0 ] * x + m[ 2 ] * y + m[ 4 ] ) + ' ' + f( m[ 1 ] * x + m[ 3 ] * y + m[ 5 ] );
		};
		var s = '';
		var x = 0;
		var y = 0;
		var sx = 0;
		var sy = 0;
		var cx = 0;
		var cy = 0;
		var prev = '';
		var cubic = function ( x1, y1, x2, y2, x3, y3 ) {
			s += 'C' + pt( x1, y1 ) + ' ' + pt( x2, y2 ) + ' ' + pt( x3, y3 );
			cx = x2;
			cy = y2;
			x = x3;
			y = y3;
		};
		for ( var i = 0; i < list.length; i++ ) {
			var c = list[ i ][ 0 ];
			var a = list[ i ][ 1 ];
			var up = c.toUpperCase();
			var rel = c !== up;
			var ox = rel ? x : 0;
			var oy = rel ? y : 0;
			var qx;
			var qy;
			if ( 'Z' === up ) {
				s += 'Z';
				x = sx;
				y = sy;
			} else if ( 'M' === up ) {
				x = sx = a[ 0 ] + ox;
				y = sy = a[ 1 ] + oy;
				s += 'M' + pt( x, y );
			} else if ( 'L' === up || 'H' === up || 'V' === up ) {
				x = 'V' === up ? x : a[ 0 ] + ox;
				y = 'H' === up ? y : ( 'V' === up ? a[ 0 ] : a[ 1 ] ) + oy;
				s += 'L' + pt( x, y );
			} else if ( 'C' === up ) {
				cubic( a[ 0 ] + ox, a[ 1 ] + oy, a[ 2 ] + ox, a[ 3 ] + oy, a[ 4 ] + ox, a[ 5 ] + oy );
			} else if ( 'S' === up ) {
				var smooth = 'C' === prev || 'S' === prev;
				cubic( smooth ? 2 * x - cx : x, smooth ? 2 * y - cy : y, a[ 0 ] + ox, a[ 1 ] + oy, a[ 2 ] + ox, a[ 3 ] + oy );
			} else if ( 'Q' === up || 'T' === up ) {
				if ( 'Q' === up ) {
					qx = a[ 0 ] + ox;
					qy = a[ 1 ] + oy;
				} else {
					var reflect = 'Q' === prev || 'T' === prev;
					qx = reflect ? 2 * x - cx : x;
					qy = reflect ? 2 * y - cy : y;
				}
				var ex = ( 'Q' === up ? a[ 2 ] : a[ 0 ] ) + ox;
				var ey = ( 'Q' === up ? a[ 3 ] : a[ 1 ] ) + oy;
				cubic( x + 2 / 3 * ( qx - x ), y + 2 / 3 * ( qy - y ), ex + 2 / 3 * ( qx - ex ), ey + 2 / 3 * ( qy - ey ), ex, ey );
				// The quadratic control, for a following T.
				cx = qx;
				cy = qy;
			} else if ( 'A' === up ) {
				var segs = arcToCubics( x, y, a[ 0 ], a[ 1 ], a[ 2 ], a[ 3 ], a[ 4 ], a[ 5 ] + ox, a[ 6 ] + oy );
				for ( var j = 0; j < segs.length; j++ ) {
					cubic.apply( null, segs[ j ] );
				}
				x = a[ 5 ] + ox;
				y = a[ 6 ] + oy;
			}
			prev = up;
		}
		// PATH_CHARS also rejects a NaN / Infinity that slipped through.
		return /\d/.test( s ) && PATH_CHARS.test( s ) ? s : '';
	}

	// An SVG elliptical arc (endpoint form, SVG 1.1 F.6.5) as cubic
	// segments of at most 90 degrees: [ [ x1 y1 x2 y2 x y ], ... ].
	function arcToCubics( x1, y1, rx, ry, angle, large, sweep, x2, y2 ) {
		if ( x1 === x2 && y1 === y2 ) {
			return [];
		}
		rx = Math.abs( rx );
		ry = Math.abs( ry );
		if ( ! rx || ! ry ) {
			return [ [ x1, y1, x2, y2, x2, y2 ] ];
		}
		var phi = angle * Math.PI / 180;
		var cos = Math.cos( phi );
		var sin = Math.sin( phi );
		var hx = ( x1 - x2 ) / 2;
		var hy = ( y1 - y2 ) / 2;
		var px = cos * hx + sin * hy;
		var py = -sin * hx + cos * hy;
		var lambda = px * px / ( rx * rx ) + py * py / ( ry * ry );
		if ( lambda > 1 ) {
			rx *= Math.sqrt( lambda );
			ry *= Math.sqrt( lambda );
		}
		var num = rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px;
		var den = rx * rx * py * py + ry * ry * px * px;
		var co = Math.sqrt( Math.max( 0, num / den ) ) * ( large === sweep ? -1 : 1 );
		var ccx = co * rx * py / ry;
		var ccy = -co * ry * px / rx;
		var mx = cos * ccx - sin * ccy + ( x1 + x2 ) / 2;
		var my = sin * ccx + cos * ccy + ( y1 + y2 ) / 2;
		var ang = function ( ux, uy, vx, vy ) {
			return Math.atan2( ux * vy - uy * vx, ux * vx + uy * vy );
		};
		var t1 = ang( 1, 0, ( px - ccx ) / rx, ( py - ccy ) / ry );
		var dt = ang( ( px - ccx ) / rx, ( py - ccy ) / ry, ( -px - ccx ) / rx, ( -py - ccy ) / ry );
		if ( ! sweep && dt > 0 ) {
			dt -= 2 * Math.PI;
		} else if ( sweep && dt < 0 ) {
			dt += 2 * Math.PI;
		}
		var n = Math.max( 1, Math.ceil( Math.abs( dt ) / ( Math.PI / 2 ) - 1e-9 ) );
		var step = dt / n;
		var k = 4 / 3 * Math.tan( step / 4 );
		var at = function ( t ) {
			var c = Math.cos( t );
			var s = Math.sin( t );
			return [ mx + rx * c * cos - ry * s * sin, my + rx * c * sin + ry * s * cos, -rx * s * cos - ry * c * sin, -rx * s * sin + ry * c * cos ];
		};
		var out = [];
		for ( var i = 0; i < n; i++ ) {
			var p0 = at( t1 + i * step );
			var p3 = at( t1 + ( i + 1 ) * step );
			if ( i === n - 1 ) {
				p3[ 0 ] = x2;
				p3[ 1 ] = y2;
			}
			out.push( [ p0[ 0 ] + k * p0[ 2 ], p0[ 1 ] + k * p0[ 3 ], p3[ 0 ] - k * p3[ 2 ], p3[ 1 ] - k * p3[ 3 ], p3[ 0 ], p3[ 1 ] ] );
		}
		return out;
	}

	/* ---------- easing ---------- */

	// Elastic ease-out; a smaller period = more, faster wobbles.
	function elastic( period ) {
		return function ( t ) {
			if ( t <= 0 ) {
				return 0;
			}
			if ( t >= 1 ) {
				return 1;
			}
			return Math.pow( 2, -10 * t ) * Math.sin( ( t - period / 4 ) * ( 2 * Math.PI ) / period ) + 1;
		};
	}

	function easeInOutSine( t ) {
		return -( Math.cos( Math.PI * t ) - 1 ) / 2;
	}

	/* ---------- helpers ---------- */

	// Elementor slider settings arrive as { unit, size }.
	function number( setting, fallback ) {
		if ( setting && 'object' === typeof setting ) {
			setting = setting.size;
		}
		var n = parseFloat( setting );
		return isNaN( n ) ? fallback : n;
	}

	function svgEl( name, attrs ) {
		var el = document.createElementNS( SVG_NS, name );
		Object.keys( attrs || {} ).forEach( function ( key ) {
			el.setAttribute( key, attrs[ key ] );
		} );
		return el;
	}

	/* ---------- placement ---------- */

	// The shape's box in fractions of the element (or image) box, from the
	// CSS custom properties Elementor writes for the current breakpoint.
	function readBox( el, prefix, defaults ) {
		var style = window.getComputedStyle( el );
		var read = function ( name, fallback ) {
			var n = parseFloat( style.getPropertyValue( '--framify-' + prefix + name ) );
			return isNaN( n ) ? fallback : n;
		};
		var w = read( 'w', defaults.w ) / 100;
		var h = read( 'h', defaults.h ) / 100;
		var ax = read( 'ax', 0.5 );
		var ay = read( 'ay', 0.5 );
		return {
			x: ( 1 - w ) * ax + read( 'ox', defaults.ox ) / 100,
			y: ( 1 - h ) * ay + read( 'oy', defaults.oy ) / 100,
			w: w,
			h: h,
			ax: ax
		};
	}

	// The point the image zooms around: the middle of the flat edge, so no
	// gap opens along it; otherwise the centre of the shape.
	function zoomOrigin( box, edge ) {
		var x = box.x + box.w / 2;
		var y = box.y + box.h / 2;
		if ( 'left' === edge ) {
			x = box.x;
		} else if ( 'right' === edge ) {
			x = box.x + box.w;
		} else if ( 'top' === edge ) {
			y = box.y;
		} else if ( 'bottom' === edge ) {
			y = box.y + box.h;
		}
		return { x: x, y: y };
	}

	// How far the main animation value swings past its ends: the elastic
	// spring (hover / in view) overshoots past 1 on the way in and below 0
	// by the same amount on the way back; a loop eases without overshoot.
	function springOvershoot( trigger, period ) {
		if ( 'loop' === trigger ) {
			return 0;
		}
		var ease = elastic( period || SPRING_PERIOD.normal );
		var peak = 1;
		for ( var i = 1; i < 200; i++ ) {
			peak = Math.max( peak, ease( i / 200 ) );
		}
		return peak - 1;
	}

	// Outward reach of a moving custom shape past its placement box, in
	// fractions of that box, at animation value v. Liquid (motion.ripple):
	// every traced point moves along its normal by at most ripple x |v| box
	// units (a negative v flips the inward pushes outward). Gentle
	// (motion.rotate / scale): the worst case, a shape filling the box
	// corners, swollen and rotated in pixel space (aspect = box px width /
	// height, as gentleTransform conjugates it).
	function motionReach( motion, v, aspect ) {
		if ( motion.ripple ) {
			var r = motion.ripple * Math.abs( v ) / 100;
			return { x: r, y: r };
		}
		var a = Math.PI * motion.rotate * v / 180;
		var s = 1 + ( motion.scale - 1 ) * v;
		var c = Math.cos( a );
		var n = Math.abs( Math.sin( a ) );
		return {
			x: Math.max( 0, s * 0.5 * ( c + n / aspect ) - 0.5 ),
			y: Math.max( 0, s * 0.5 * ( c + n * aspect ) - 0.5 )
		};
	}

	// Image widget only: an img has no pixels past its own box, so the part
	// of the motion's outward reach that the zoom does not cover is cut in a
	// straight line there. Returns how far to pull each side of the placement
	// box (fractions of the img box) so the shape stays on the photo. The
	// clip is counter-scaled by 1/zoom, so the shape stays put on screen
	// while the photo grows about `origin` past each img edge by
	// (zoom - 1) x the origin's distance to that edge; the room a side
	// already has inside the img counts too. Checked at the value's peaks
	// (1 + over with its zoom, and -over, where the zoom stays at 1). The
	// flat side (zoomSide) is never pulled in, so the straight edge stays on
	// the photo edge. All zeros when the zoom covers the reach.
	function motionInset( box, side, motion, aspect, zoom, over ) {
		var origin = zoomOrigin( box, side );
		var hi = motionReach( motion, 1 + over, aspect );
		var lo = motionReach( motion, -over, aspect );
		var cover = zoom * ( 1 + over );
		var need = function ( reachHi, reachLo, span, room, dist ) {
			room = Math.max( 0, room );
			return Math.max( 0, reachHi * span - cover * dist - room, reachLo * span - room );
		};
		return {
			left: 'left' === side ? 0 : need( hi.x, lo.x, box.w, box.x, origin.x ),
			right: 'right' === side ? 0 : need( hi.x, lo.x, box.w, 1 - box.x - box.w, 1 - origin.x ),
			top: 'top' === side ? 0 : need( hi.y, lo.y, box.h, box.y, origin.y ),
			bottom: 'bottom' === side ? 0 : need( hi.y, lo.y, box.h, 1 - box.y - box.h, 1 - origin.y )
		};
	}

	// The placement box pulled in by motionInset(); the same object when
	// nothing moves, so the clip transform string stays identical.
	function insetBox( box, inset ) {
		if ( ! ( inset.left || inset.right || inset.top || inset.bottom ) ) {
			return box;
		}
		return {
			x: box.x + inset.left,
			y: box.y + inset.top,
			w: Math.max( 0.01, box.w - inset.left - inset.right ),
			h: Math.max( 0.01, box.h - inset.top - inset.bottom ),
			ax: box.ax
		};
	}

	// Clip paths live in 0-100 units; this maps one into the placement box in
	// objectBoundingBox units (0-1). `inner` is applied first, in the 0-100
	// box: flip/rotate, the flat-edge turn and a custom shape's fit. zoom > 1
	// shrinks the clip around `origin` by the factor the image is scaled up,
	// so the photo zooms inside a shape that stays put.
	function clipTransform( box, inner, zoom, origin ) {
		var t = '';
		if ( zoom && 1 !== zoom ) {
			t = 'translate(' + origin.x + ' ' + origin.y + ') scale(' + ( 1 / zoom ) + ') translate(' + ( -origin.x ) + ' ' + ( -origin.y ) + ') ';
		}
		t += 'translate(' + box.x + ' ' + box.y + ') scale(' + ( box.w / 100 ) + ' ' + ( box.h / 100 ) + ')';
		return inner ? t + ' ' + inner : t;
	}

	// Image widget: against the <img> layout box (offset*, which ignore the
	// zoom transform). Container: against the container, in percent.
	function positionDeco( svg, box, img ) {
		if ( img ) {
			svg.style.left = ( img.offsetLeft + img.offsetWidth * box.x ) + 'px';
			svg.style.top = ( img.offsetTop + img.offsetHeight * box.y ) + 'px';
			svg.style.width = ( img.offsetWidth * box.w ) + 'px';
			svg.style.height = ( img.offsetHeight * box.h ) + 'px';
			return;
		}
		svg.style.left = ( box.x * 100 ) + '%';
		svg.style.top = ( box.y * 100 ) + '%';
		svg.style.width = ( box.w * 100 ) + '%';
		svg.style.height = ( box.h * 100 ) + '%';
	}

	// Floating Shapes / Text on the Image widget keep an Over frame on the
	// photo (FramifyFx.photoFrame in assets/framify-shapes.js) that copies
	// the img's clip-path, transform and transform-origin. This handler owns
	// those values, so it tells the frame whenever it has written them (every
	// render) or removed them (teardown). The frame state lives on the widget
	// element, so no load order between the two scripts is assumed.
	function syncPhoto( el ) {
		if ( el && el.framifyFxPhoto ) {
			el.framifyFxPhoto.sync();
		}
	}

	function buildClip( id, d ) {
		var svg = svgEl( 'svg', { 'class': 'framify-organic__defs', width: '0', height: '0', 'aria-hidden': 'true', focusable: 'false' } );
		var clip = svgEl( 'clipPath', { id: id, clipPathUnits: 'objectBoundingBox' } );
		var path = svgEl( 'path', { d: d } );
		clip.appendChild( path );
		svg.appendChild( clip );
		return { svg: svg, path: path };
	}

	// Chalky speckle: fractal noise thresholded into soft white specks, kept
	// inside the source shape. Low frequency + soft alpha ramp = broad chalky
	// patches, like a dry-brushed print; higher frequency read as sharp
	// sprinkles. specksOnly drops the source itself, for the Clip-mode layer
	// that sits over the container's own background. frequency is in the
	// drawing's own user units: the 0-100 box for the deco blob, real pixels
	// for the Clip-mode layer (which has no viewBox), so the two need very
	// different values for the same speck size. grain = { cut, seed } from
	// grainOptions().
	function buildGrainFilter( filterId, specksOnly, frequency, grain ) {
		grain = grain || { cut: 0.78, seed: 7 };
		var filter = svgEl( 'filter', { id: filterId, x: '0', y: '0', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' } );
		filter.appendChild( svgEl( 'feTurbulence', { type: 'fractalNoise', baseFrequency: frequency || '0.45', numOctaves: '3', seed: String( grain.seed ), result: 'noise' } ) );
		filter.appendChild( svgEl( 'feColorMatrix', { 'in': 'noise', type: 'matrix', values: '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1.6 0 0 0 ' + ( -grain.cut ), result: 'specks' } ) );
		filter.appendChild( svgEl( 'feComposite', { 'in': 'specks', in2: 'SourceGraphic', operator: 'in', result: 'specksIn' } ) );
		if ( ! specksOnly ) {
			var merge = svgEl( 'feMerge' );
			merge.appendChild( svgEl( 'feMergeNode', { 'in': 'SourceGraphic' } ) );
			merge.appendChild( svgEl( 'feMergeNode', { 'in': 'specksIn' } ) );
			filter.appendChild( merge );
		}
		return filter;
	}

	function buildDeco( id, d, look ) {
		var svg = svgEl( 'svg', { 'class': 'framify-organic__deco', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' } );
		var path = svgEl( 'path', { d: d } );
		if ( look.outline ) {
			// non-scaling-stroke: the svg is stretched with
			// preserveAspectRatio="none", so a plain stroke would be thicker
			// along the stretched axis. This keeps a true pixel width.
			path.setAttribute( 'fill', 'none' );
			path.setAttribute( 'stroke', look.outlineColor );
			path.setAttribute( 'stroke-width', String( look.outlineWidth ) );
			path.setAttribute( 'stroke-linejoin', 'round' );
			path.setAttribute( 'vector-effect', 'non-scaling-stroke' );
		} else {
			path.setAttribute( 'fill', look.color );
			if ( look.grain ) {
				var defs = svgEl( 'defs' );
				defs.appendChild( buildGrainFilter( id + '-grain', false, null, look.grain ) );
				svg.appendChild( defs );
				path.setAttribute( 'filter', 'url(#' + id + '-grain)' );
			}
		}
		svg.appendChild( path );
		return { svg: svg, path: path };
	}

	// Clip mode: specks only, full size, so the container's own background
	// colour shows through; the container's clip cuts it to the shape.
	function buildGrainLayer( id, grain, frequency ) {
		// No viewBox: this layer draws in real pixels (unlike the deco blob's
		// 0-100 box), so the noise frequency below is tuned for pixels, and
		// stays isotropic regardless of how wide or tall the container is.
		var svg = svgEl( 'svg', { 'class': 'framify-organic__deco framify-organic__grain', 'aria-hidden': 'true', focusable: 'false' } );
		var defs = svgEl( 'defs' );
		defs.appendChild( buildGrainFilter( id + '-grain', true, frequency || '0.09', grain ) );
		svg.appendChild( defs );
		svg.appendChild( svgEl( 'rect', { x: '0', y: '0', width: '100%', height: '100%', fill: '#fff', filter: 'url(#' + id + '-grain)' } ) );
		return svg;
	}

	// The element that paints a Spacer's Advanced > Background, which Clip
	// mode must clip and the deco / grain layers must sit in. Elementor's
	// "common" widget controls put it on the direct .elementor-widget-container
	// child; with Optimized Markup the Spacer drops that wrapper and
	// "common-optimized" paints the widget element itself. Same rule as
	// FramifyFx.hostOf in framify-shapes.js (this script does not load it).
	function paintHost( el ) {
		for ( var c = el.firstElementChild; c; c = c.nextElementSibling ) {
			if ( c.classList.contains( 'elementor-widget-container' ) ) {
				return c;
			}
		}
		return el;
	}

	/* ---------- Spacer fill layer ---------- */

	// What moves from a Spacer's host onto its fill layer: every background
	// longhand plus the corner radii (a Wavy / Flow flat edge reaches the
	// corners, where the host's radius used to round the clipped paint).
	var FILL_PROPS = [ 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'background-origin', 'background-clip', 'background-attachment', 'background-blend-mode', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius' ];
	// Keys (prefixes) of Spacer settings that change what the fill copies:
	// Advanced > Background and Border (Elementor's common controls, ids
	// from Widget_Common_Base). Not the Space height: the fill's insets
	// follow the host box in CSS. Hover variants are not mirrored (see
	// takeBackground), so they need no rebuild.
	var FILL_KEYS = [ '_background_', '_border_' ];
	// The same for a Container's fill (its own Style > Background and
	// Border controls, which have no leading underscore). The overlay stays
	// Elementor's (a ::before), so its keys only change CSS.
	var CONTAINER_FILL_KEYS = [ 'background_', 'border_' ];
	// Custom properties a bled Container (bleedLayers) writes for the CSS
	// that extends Elementor's overlay and background video / slideshow
	// layers: the fill's margin per side and its four corner radii.
	var BLEED_VARS = [ '--framify-bleed-t', '--framify-bleed-r', '--framify-bleed-b', '--framify-bleed-l', '--framify-bleed-tl', '--framify-bleed-tr', '--framify-bleed-br', '--framify-bleed-bl' ];
	// The fill reaches this far past the host box on every side. Only what
	// the fill covers can be painted, so a fill exactly the host box cut a
	// Liquid ripple, a Gentle swell or a Placement past 100% off in straight
	// lines at the box edges. 20% of the larger side is over three times the
	// strongest motion (Liquid / Gentle Strong move an edge ~5-6% of the box)
	// and leaves room for an overhanging Placement; the cap keeps a wide
	// Spacer from growing a layer hundreds of px past the page. Whole px, so
	// a sub-pixel resize does not re-copy the background.
	var FILL_MARGIN_RATIO = 0.2;
	var FILL_MARGIN_MAX = 200;

	function fillMargin( w, h ) {
		return Math.round( Math.min( FILL_MARGIN_MAX, FILL_MARGIN_RATIO * Math.max( w, h, 0 ) ) );
	}

	// A fill margin as { top, right, bottom, left } px: a number (the
	// Spacer's, the same on every side) or already per side (a Container's,
	// fillSides).
	function marginSides( m ) {
		return 'object' === typeof m ? m : { top: m, right: m, bottom: m, left: m };
	}

	// Compares two fill margins (numbers or fillSides() results).
	function marginKey( m ) {
		return 'object' === typeof m ? [ m.top, m.right, m.bottom, m.left ].join( ' ' ) : m;
	}

	// Containers: the fill margin m per side. clip-path does not trim
	// scrollable overflow, so a fill reaching past the page's left or right
	// edge would widen the document (a full-width container got a horizontal
	// scrollbar); those two sides stop at the edge, where nothing past it
	// could be seen anyway. Whole px, so a sub-pixel move does not re-copy.
	// Top and bottom keep m (the page grows downwards anyway).
	function fillSides( el, m ) {
		var r = el.getBoundingClientRect();
		var left = r.left + ( window.pageXOffset || 0 );
		var room = document.documentElement.clientWidth - left - r.width;
		return {
			top: m,
			right: Math.max( 0, Math.min( m, Math.floor( room ) ) ),
			bottom: m,
			left: Math.max( 0, Math.min( m, Math.floor( left ) ) )
		};
	}

	// The placement box (fractions of the host box, W x H px) in fractions of
	// the fill, which is the host box grown by m px on every side (or by
	// m.top / m.right / ... per side): the objectBoundingBox the fill's clip
	// resolves against.
	function fillBox( box, w, h, m ) {
		var s = marginSides( m );
		var fw = w + s.left + s.right;
		var fh = h + s.top + s.bottom;
		if ( ! ( fw > 0 ) || ! ( fh > 0 ) ) {
			return box;
		}
		return {
			x: ( s.left + box.x * w ) / fw,
			y: ( s.top + box.y * h ) / fh,
			w: box.w * w / fw,
			h: box.h * h / fh,
			ax: box.ax
		};
	}

	// One background-position-x/y list, each layer moved so it lands where it
	// did in the host box. A position a + p% resolves against the positioning
	// area; grown by lo on the start side and hi on the end side, that point
	// moves by p(lo + hi) - lo px, so the correction is lo - p(lo + hi); with
	// the same m on both sides that is m(1 - 2p): +m at 0%, none at 50%
	// (centred stays centred), -m at 100%. A fixed-attachment layer is
	// positioned against the viewport and is left alone.
	function shiftPositions( list, attachments, lo, hi ) {
		return list.split( ',' ).map( function ( v, i ) {
			v = v.trim();
			if ( 'fixed' === ( attachments[ i % attachments.length ] || '' ).trim() ) {
				return v;
			}
			var p = 0;
			( v.match( /-?[\d.]+%/g ) || [] ).forEach( function ( pc ) {
				p += parseFloat( pc ) / 100;
			} );
			var shift = Math.round( ( lo === hi ? lo * ( 1 - 2 * p ) : lo - p * ( lo + hi ) ) * 100 ) / 100;
			return shift ? 'calc(' + v + ' + ' + shift + 'px)' : v;
		} ).join( ', ' );
	}

	// A corner radius grown by mx horizontally and my vertically (the
	// margins of the two sides meeting there), so the fill is the host's
	// rounded border box offset outwards (an offset of a radius r corner has
	// radius r + m); percentages are resolved against the host box first. A
	// sharp corner stays sharp.
	function growRadius( value, w, h, mx, my ) {
		var parts = String( value || '0' ).trim().split( /\s+/ );
		var px = function ( v, size ) {
			var n = parseFloat( v ) || 0;
			return -1 !== v.indexOf( '%' ) ? n * size / 100 : n;
		};
		var rx = px( parts[ 0 ], w );
		var ry = px( parts[ 1 ] || parts[ 0 ], h );
		if ( ! ( rx > 0 ) || ! ( ry > 0 ) ) {
			return value;
		}
		return ( rx + mx ) + 'px ' + ( ry + my ) + 'px';
	}

	// keys = FILL_KEYS (Spacer) or CONTAINER_FILL_KEYS.
	function fillKey( name, keys ) {
		if ( -1 !== name.indexOf( '_hover' ) ) {
			return false;
		}
		for ( var i = 0; i < keys.length; i++ ) {
			if ( 0 === name.indexOf( keys[ i ] ) ) {
				return true;
			}
		}
		return false;
	}

	// The element's own inline declarations whose names start with prefix,
	// as [ name, value, priority ], so they can be put back exactly.
	function inlineProps( el, prefix ) {
		var out = [];
		for ( var i = 0; i < el.style.length; i++ ) {
			var name = el.style[ i ];
			if ( 0 === name.indexOf( prefix ) ) {
				out.push( [ name, el.style.getPropertyValue( name ), el.style.getPropertyPriority( name ) ] );
			}
		}
		return out;
	}

	function restoreProps( el, shorthand, saved ) {
		el.style.removeProperty( shorthand );
		saved.forEach( function ( p ) {
			el.style.setProperty( p[ 0 ], p[ 1 ], p[ 2 ] );
		} );
	}

	// Copies the host's painted background onto a new fill layer, then hides
	// the host's own (inline !important beats Elementor's stylesheet rules).
	// Transitions are off while it reads and hides: on a rebuild the teardown
	// has just put the background back, and a background transition
	// (Advanced > Background hover transition) would otherwise be read at its
	// start value and fade the host out again. The hover background is not
	// mirrored: the suppression hides it too, and copying it on hover would
	// mean re-reading mid-transition values; set the colour on the Spacer's
	// normal state instead. Returns { fill, restore }. Pass the existing fill
	// to re-copy into it (a breakpoint change: background and border
	// controls are responsive), after restore() has lifted the suppression.
	// margin = fillMargin() px: the fill reaches that far past the host's
	// border box, background images stay anchored to the host box
	// (shiftPositions) and radii grow with it (growRadius). A percentage /
	// cover background-size now resolves against the larger fill, so such an
	// image is scaled and cropped slightly differently than on the host.
	// A Container passes the margin per side (fillSides()).
	function takeBackground( el, fill, margin ) {
		var m = marginSides( margin || 0 );
		var savedBg = inlineProps( el, 'background' );
		var savedTransition = inlineProps( el, 'transition' );
		el.style.setProperty( 'transition', 'none', 'important' );
		var cs = window.getComputedStyle( el );
		if ( ! fill ) {
			fill = document.createElement( 'div' );
			fill.className = 'framify-organic__fill';
			fill.setAttribute( 'aria-hidden', 'true' );
		}
		FILL_PROPS.forEach( function ( prop ) {
			fill.style.setProperty( prop, cs.getPropertyValue( prop ) );
		} );
		// Absolute insets start inside the border; push out by the border
		// widths so the fill covers the border box, the box the old clip on
		// the host (and objectBoundingBox) resolved against, then by the
		// margin (see FILL_MARGIN_RATIO; place() maps the shape back into
		// the host box with fillBox()).
		fill.style.top = -( ( parseFloat( cs.borderTopWidth ) || 0 ) + m.top ) + 'px';
		fill.style.right = -( ( parseFloat( cs.borderRightWidth ) || 0 ) + m.right ) + 'px';
		fill.style.bottom = -( ( parseFloat( cs.borderBottomWidth ) || 0 ) + m.bottom ) + 'px';
		fill.style.left = -( ( parseFloat( cs.borderLeftWidth ) || 0 ) + m.left ) + 'px';
		if ( m.top || m.right || m.bottom || m.left ) {
			var w = el.offsetWidth;
			var h = el.offsetHeight;
			// Each corner grows by the margins of the two sides meeting there.
			[ [ 'border-top-left-radius', m.left, m.top ], [ 'border-top-right-radius', m.right, m.top ], [ 'border-bottom-right-radius', m.right, m.bottom ], [ 'border-bottom-left-radius', m.left, m.bottom ] ].forEach( function ( c ) {
				fill.style.setProperty( c[ 0 ], growRadius( cs.getPropertyValue( c[ 0 ] ), w, h, c[ 1 ], c[ 2 ] ) );
			} );
			if ( 'none' !== cs.backgroundImage ) {
				var attachments = cs.backgroundAttachment.split( ',' );
				fill.style.setProperty( 'background-position-x', shiftPositions( cs.getPropertyValue( 'background-position-x' ), attachments, m.left, m.right ) );
				fill.style.setProperty( 'background-position-y', shiftPositions( cs.getPropertyValue( 'background-position-y' ), attachments, m.top, m.bottom ) );
			}
		}
		el.style.setProperty( 'background', 'none', 'important' );
		// Flush with transitions still off, so hiding it doesn't fade.
		cs.getPropertyValue( 'background-color' );
		restoreProps( el, 'transition', savedTransition );
		return {
			fill: fill,
			restore: function () {
				restoreProps( el, 'background', savedBg );
			}
		};
	}

	/* ---------- shared with the Shape Divider ----------
	 *
	 * assets/framify-divider.js depends on this script's handle and reuses
	 * the sanitiser and the Liquid tracer rather than copying them, so one
	 * security rule covers every pasted or uploaded SVG. Read-only helpers;
	 * nothing here holds per-element state (the parse / trace memos are
	 * keyed on their full input).
	 */
	window.FramifyOrganicShape = {
		CUSTOM_AMOUNT: CUSTOM_AMOUNT,
		parseCustom: parseCustom,
		parseSvgShape: parseSvgShape,
		svgGeometry: svgGeometry,
		customTransform: customTransform,
		traceCustom: traceCustom,
		dotField: dotField,
		dotPair: dotPair,
		DOT_AMOUNT: DOT_AMOUNT,
		parsePath: parsePath,
		blendPath: blendPath,
		elastic: elastic,
		easeInOutSine: easeInOutSine
	};

	// Shape Divider controls share the framify_org_ prefix; they belong to
	// assets/framify-divider.js, so this handler never rebuilds for them.
	var DIVIDER_PREFIX = 'framify_org_dv_';

	/* ---------- Elementor handler ---------- */

	window.addEventListener( 'elementor/frontend/init', function () {
		var Base = elementorModules.frontend.handlers.Base;

		var OrganicShape = Base.extend( {

			// Explicit ID so this handler never collides with another
			// extend()-built handler on the same element in the editor.
			getConstructorID: function () {
				return 'FramifyOrganicShape';
			},

			onInit: function () {
				Base.prototype.onInit.apply( this, arguments );
				this.setup();
				if ( 'spacer' === this.getWidgetType() ) {
					this.watchSpacerModel();
				}
			},

			onElementChange: function ( name ) {
				if ( '__globals__' !== name && ( 0 !== name.indexOf( 'framify_org_' ) || 0 === name.indexOf( DIVIDER_PREFIX ) ) ) {
					if ( this.fx && this.fx.fill && fillKey( name, this.fillKeys() ) ) {
						this.scheduleFill();
					}
					return;
				}
				var self = this;
				clearTimeout( this.rebuildTimer );
				// Placement controls change CSS rather than settings; give the
				// preview time to apply it before reading it back.
				this.rebuildTimer = setTimeout( function () {
					self.rebuild();
				}, 120 );
			},

			// The setting keys a fill copies from: a Spacer's Advanced
			// background / border, or a Container's own.
			fillKeys: function () {
				return 'spacer' === this.getWidgetType() ? FILL_KEYS : CONTAINER_FILL_KEYS;
			},

			// Fill (Spacer, or a Container in Clip mode with a deco or a
			// bleed): Elementor re-renders its CSS for a background /
			// border change, so wait 120 ms plus a frame before the fill
			// re-copies the host's computed background.
			scheduleFill: function () {
				var self = this;
				clearTimeout( this.rebuildTimer );
				cancelAnimationFrame( this.rebuildFrame );
				this.rebuildTimer = setTimeout( function () {
					self.rebuildFrame = requestAnimationFrame( function () {
						self.rebuild();
					} );
				}, 120 );
			},

			// Spacers only: $e settings commands and undo / redo change the
			// model without a control view, so onElementChange never hears
			// them (the same gap FramifyFx.editorMixin closes for Floating
			// Shapes / Text). Containers and the Image widget keep their
			// panel-only path unchanged.
			watchSpacerModel: function () {
				var model = this.isEdit && elementorFrontend.config.elements.data[ this.getModelCID() ];
				if ( ! model || ! model.on ) {
					return;
				}
				var self = this;
				this.spacerModelListener = function ( changed ) {
					// A re-render (a render_type template control) can replace
					// the element without destroying this handler; let a stale
					// one drop out.
					if ( ! self.$element[ 0 ].isConnected ) {
						model.off( 'change', self.spacerModelListener );
						self.teardown();
						return;
					}
					var keys = Object.keys( ( changed && changed.changed ) || {} );
					for ( var i = 0; i < keys.length; i++ ) {
						if ( '__globals__' === keys[ i ] || 0 === keys[ i ].indexOf( 'framify_org_' ) || ( self.fx && self.fx.fill && fillKey( keys[ i ], FILL_KEYS ) ) ) {
							self.scheduleFill();
							return;
						}
					}
				};
				this.spacerModel = model;
				model.on( 'change', this.spacerModelListener );
			},

			onDestroy: function () {
				clearTimeout( this.rebuildTimer );
				cancelAnimationFrame( this.rebuildFrame );
				if ( this.spacerModel ) {
					this.spacerModel.off( 'change', this.spacerModelListener );
					this.spacerModel = null;
				}
				this.teardown();
				Base.prototype.onDestroy.apply( this, arguments );
			},

			rebuild: function () {
				clearTimeout( this.rebuildTimer );
				cancelAnimationFrame( this.rebuildFrame );
				this.teardown();
				this.setup();
			},

			// The element's own shape as a rest/hover pair. A static or Gentle
			// custom shape never morphs, so both poses are the same raw path;
			// Liquid uses its traced pair.
			mainPair: function ( s ) {
				var fx = this.fx;
				if ( fx.custom ) {
					if ( fx.liquid ) {
						return fx.liquid;
					}
					if ( fx.dots ) {
						return fx.dots;
					}
					var path = parsePath( fx.custom.d );
					return { rest: path, hover: path };
				}
				return shapePair( s.framify_org_shape, null, fx.edge );
			},

			// Editor only, once per distinct paste: say why nothing happened.
			warnCustom: function ( text ) {
				if ( elementorFrontend.isEditMode() && this.warnedFor !== text ) {
					this.warnedFor = text;
					window.console.warn( 'Framify: custom shape has no usable path.' );
				}
			},

			// Custom shapes only move when a real trigger is set. Liquid swaps in
			// a traced, rippling pair (already fitted into 0-100 units, so the
			// inner transform keeps only the turn: flip/rotate + flat edge);
			// Gentle keeps the raw path and animates fx.inner in render().
			// Custom shapes only move when a real trigger is set. Dots moves
			// each circle of a generated dot pattern (dotPair); Liquid hands a
			// big dot pattern to Dots too, because tracing drops parts that
			// small. Otherwise Liquid swaps in the traced pair, and falls back
			// to Gentle when the paste can't be traced.
			setupCustomMotion: function ( s ) {
				var fx = this.fx;
				var amount = CUSTOM_AMOUNT[ s.framify_org_custom_amount ] ? s.framify_org_custom_amount : 'normal';
				fx.over = springOvershoot( resolveTrigger( s.framify_org_trigger, fx.family ), SPRING_PERIOD[ s.framify_org_spring ] );
				var field = 'gentle' === s.framify_org_custom_motion ? null : dotField( fx.custom.d );
				if ( 'dots' === s.framify_org_custom_motion && ! field ) {
					this.warnDots( fx.custom.d );
				}
				if ( field && ( 'dots' === s.framify_org_custom_motion || field.mass || field.dots.length > DOT_LIQUID_MAX ) ) {
					// Dots stay in the paste's own units, like Gentle (fx.inner is
					// left as set), and never leave their cells, so there is no
					// motion inset or container bleed: fx.motion stays null.
					// The style is only honoured when Dots was chosen: the control is
					// hidden otherwise, and Elementor drops hidden controls from a
					// published page, so Liquid's hand-off always uses Breathe (the
					// editor must not preview something else).
					fx.dots = dotPair( field, 'dots' === s.framify_org_custom_motion && DOT_STYLES[ s.framify_org_dot_style ] ? s.framify_org_dot_style : 'breathe', amount );
					return;
				}
				if ( 'gentle' !== s.framify_org_custom_motion ) {
					var traced = traceCustom( fx.custom, fx.customFit.box, amount, 'none' === fx.edge ? null : fx.custom.straight );
					if ( traced ) {
						fx.liquid = { rest: parsePath( traced.rest ), hover: parsePath( traced.hover ) };
						fx.inner = fx.customTurn;
						fx.motion = { ripple: CUSTOM_AMOUNT[ amount ].ripple };
						return;
					}
					if ( field ) {
						// Liquid could not trace a small dot pattern: use Dots.
						fx.dots = dotPair( field, 'breathe', amount );
						return;
					}
					this.warnTrace( fx.custom.d );
				}
				fx.gentle = CUSTOM_AMOUNT[ amount ];
				fx.motion = fx.gentle;
			},

			// Editor only, once per distinct path: Dots was chosen on a shape
			// that is not a generated dot pattern.
			warnDots: function ( d ) {
				if ( elementorFrontend.isEditMode() && this.warnedDots !== d ) {
					this.warnedDots = d;
					window.console.warn( 'Framify: Dots motion needs a dot pattern from Shape studio > Generate; using another motion.' );
				}
			},

			// Editor only, once per distinct paste: an explicit Flat edge side
			// was chosen but the paste has no straight side, so it stays as
			// pasted.
			warnFlat: function ( text ) {
				if ( elementorFrontend.isEditMode() && this.warnedFlat !== text ) {
					this.warnedFlat = text;
					window.console.warn( 'Framify: custom shape has no straight side; Flat edge ignored.' );
				}
			},

			// Editor only, once per distinct path: say why Liquid became Gentle.
			warnTrace: function ( d ) {
				if ( elementorFrontend.isEditMode() && this.warnedTrace !== d ) {
					this.warnedTrace = d;
					window.console.warn( 'Framify: custom shape could not be traced; using Gentle motion.' );
				}
			},

			// Deco and grain layers sit at z-index -1 inside the container: make
			// it a stacking context (and a positioning context if it's static).
			holdLayer: function ( el, layer ) {
				var madeRelative = 'static' === window.getComputedStyle( el ).position;
				if ( madeRelative ) {
					el.style.position = 'relative';
				}
				el.classList.add( 'framify-organic-container' );
				el.insertBefore( layer, el.firstChild );
				this.fx.cleanup.push( function () {
					layer.remove();
					el.classList.remove( 'framify-organic-container' );
					if ( madeRelative ) {
						el.style.position = '';
					}
				} );
			},

			setup: function () {
				var s = libraryShape( window.FramifyColor.settings( this ) );
				if ( 'yes' !== s.framify_org_enable || ! shapeData( s.framify_org_shape ) ) {
					return;
				}
				var custom = null;
				if ( 'custom' === s.framify_org_shape ) {
					custom = parseCustom( s.framify_org_custom_svg );
					if ( ! custom ) {
						this.warnCustom( s.framify_org_custom_svg );
						return;
					}
				}

				// A Spacer is a block like a container: no image, its own
				// background is the fill. The host's box (the Spacer's height)
				// is the placement box; the --framify-* properties on the
				// widget element reach it by inheritance.
				var spacer = 'spacer' === this.getWidgetType();
				var el = spacer ? paintHost( this.$element[ 0 ] ) : this.$element[ 0 ];
				var id = 'framify-org-' + ( ++uid );
				var fx = this.fx = {
					el: el,
					// Two animation timelines: the image/shape, and the Image
					// widget's deco when it has its own trigger.
					channels: {
						main: { value: 0, raf: 0, loopTimer: 0, looping: false },
						deco: { value: 0, raf: 0, loopTimer: 0, looping: false }
					},
					parts: [],
					cleanup: [],
					family: custom ? 'custom' : familyOf( s.framify_org_shape ),
					custom: custom,
					edgeSetting: s.framify_org_edge || 'auto',
					edge: 'none',
					// The flat edge's final side after flip/rotate: the zoom
					// origin sits on it.
					zoomSide: 'none',
					orient: readOrient( s, custom ? 'custom' : '' ),
					inner: '',
					customFit: null,
					customTurn: '',
					customInner: '',
					gentle: null,
					liquid: null,
					dots: null,
					// Custom motion amounts ({ ripple } for Liquid, the Gentle
					// entry otherwise) and the spring's overshoot, for the
					// Image widget's motionInset().
					motion: null,
					over: 0,
					aspect: 1,
					img: null,
					imgGrain: null,
					clip: null,
					// Spacer Clip mode: the layer carrying the Spacer's
					// background, clipped instead of the host.
					fill: null,
					// Px the fill reaches past the host box (fillMargin; per
					// side for a Container, fillSides).
					fillMargin: 0,
					// Container Clip mode with a moving custom shape: the host
					// stays clipped and its background bleeds into an
					// unclipped, oversized fill (bleedLayers).
					bleed: false,
					deco: null,
					zoom: 0
				};
				var box = readBox( el, '', MAIN_BOX );
				fx.edge = resolveEdge( fx.family, fx.edgeSetting, box, custom );
				fx.zoomSide = orientSide( fx.edge, fx.orient );
				// The inner chain, innermost last: fit (custom) or the drawn
				// shape, then the flat-edge turn, then flip/rotate.
				var orient = orientTransform( fx.orient );
				if ( custom ) {
					if ( ! custom.straight && ROTATE_SIDE[ fx.edgeSetting ] ) {
						this.warnFlat( s.framify_org_custom_svg );
					}
					fx.customFit = customFit( custom, fx.edge );
					fx.customTurn = joinTransforms( orient, fx.customFit.turn );
					fx.customInner = joinTransforms( fx.customTurn, customTransform( fx.customFit.box ) );
					fx.inner = fx.customInner;
				} else {
					fx.inner = joinTransforms( orient, edgeTransform( fx.edge ) );
				}
				if ( custom && ! REDUCE_MOTION && 'none' !== resolveTrigger( s.framify_org_trigger, fx.family ) ) {
					this.setupCustomMotion( s );
				}

				if ( spacer || 'container' === this.getElementType() ) {
					// Fill path only with a deco to spill; otherwise a Spacer
					// or Container in Clip mode clips its host exactly as
					// before (which also cuts its Floating Shapes / Text,
					// border and shadow).
					// "Clip background only" (mode bg) always takes the fill path:
					// the background is clipped, the content is not.
					if ( 'bg' === s.framify_org_mode || ( 'clip' === s.framify_org_mode && 'yes' === s.framify_org_deco ) ) {
						this.setupFill( el, id, s );
					} else {
						// Only a moving custom shape (Liquid / Gentle) reaches
						// past the box, so only then does a Container's
						// background bleed; every other clip is unchanged.
						fx.bleed = ! spacer && 'clip' === s.framify_org_mode && !! custom && !! fx.motion;
						this.setupContainer( el, id, s );
					}
				} else {
					this.setupImage( el, id, s );
				}

				if ( ! fx.parts.length ) {
					return;
				}
				this.observeLayout();
				this.place();
				if ( ! REDUCE_MOTION ) {
					this.bindTrigger( el, 'main', resolveTrigger( s.framify_org_trigger, fx.family ), number( s.framify_org_duration, 1500 ), SPRING_PERIOD[ s.framify_org_spring ] );
					if ( fx.deco && 'deco' === fx.deco.channel ) {
						this.bindTrigger( el, 'deco', s.framify_org_deco_trigger, number( s.framify_org_deco_duration, 2400 ), SPRING_PERIOD[ s.framify_org_deco_spring ] );
					}
				}
			},

			setupImage: function ( el, id, s ) {
				var fx = this.fx;
				var img = el.querySelector( 'img' );
				if ( ! img ) {
					return;
				}

				var main = this.mainPair( s );
				var clip = buildClip( id, main.rest.d );
				el.appendChild( clip.svg );
				el.classList.add( 'framify-organic' );
				img.style.clipPath = 'url(#' + id + ')';
				img.style.webkitClipPath = 'url(#' + id + ')';

				fx.img = img;
				fx.clip = { path: clip.path, box: null, origin: null };
				fx.zoom = number( s.framify_org_zoom, 10 ) / 100;
				fx.parts.push( { pair: main, path: clip.path, channel: 'main' } );
				fx.cleanup.push( function () {
					clip.svg.remove();
					img.style.clipPath = '';
					img.style.webkitClipPath = '';
					img.style.transform = '';
					img.style.transformOrigin = '';
					el.classList.remove( 'framify-organic' );
				} );

				// One grainOptions result for deco and image, so "both" shares
				// a seed and amount.
				var target = grainTarget( s );
				var grain = grainOptions( s, el );
				if ( target.image ) {
					// Specks over the photo, in real pixels like the Clip-mode
					// layer. It takes the img's layout box (place()), clip and
					// zoom transform (render()), so the objectBoundingBox clip
					// resolves to the same shape and the specks move with the
					// photo. Finer than the container layer's 0.09: on a photo
					// that read as blotchy frost, while 0.15 matches the deco
					// blob's speck size (0.45 in its 0-100 box at ~300px).
					var imgGrain = buildGrainLayer( id + '-img', grain, '0.15' );
					imgGrain.classList.add( 'framify-organic__image-grain' );
					imgGrain.style.clipPath = 'url(#' + id + ')';
					imgGrain.style.webkitClipPath = 'url(#' + id + ')';
					el.appendChild( imgGrain );
					fx.imgGrain = imgGrain;
					fx.cleanup.push( function () {
						imgGrain.remove();
					} );
				}

				if ( 'yes' !== s.framify_org_deco ) {
					return;
				}
				var decoSvg = this.ownDeco( el, id, s, target.deco ? grain : null, img );
				el.insertBefore( decoSvg, el.firstChild );
				fx.cleanup.push( function () {
					decoSvg.remove();
				} );
			},

			// The Image widget's extra deco blob (also the Spacer's in Clip
			// mode): its own shape, placement (deco-* properties, against
			// anchor = the img, or the host box when null) and motion channel.
			// Returns the svg; the caller inserts it and removes it on teardown.
			ownDeco: function ( el, id, s, grain, anchor ) {
				var fx = this.fx;
				// The deco has its own shape and placement; a Wavy deco's flat
				// edge always follows its own horizontal position.
				// An uploaded deco shape is static (no morph, no flat edge): its
				// path is fitted into the 0-100 box by its own viewBox.
				var decoLib = 'library' === s.framify_org_deco_shape_source && CONFIG.library ? parseCustom( CONFIG.library[ s.framify_org_deco_shape_lib ] ) : null;
				var decoFamily = decoLib ? 'blob' : familyOf( s.framify_org_deco_shape, 'splash' );
				var decoEdge = resolveEdge( decoFamily, 'auto', readBox( el, 'deco-', DECO_BOX ) );
				var decoPair = shapePair( s.framify_org_deco_shape, 'splash', decoEdge );
				if ( decoLib ) {
					var libPath = parsePath( decoLib.d );
					decoPair = { rest: libPath, hover: libPath };
				}
				var deco = buildDeco( id, decoPair.rest.d, decoLook( s, grain ) );
				deco.path.setAttribute( 'transform', decoLib ? customTransform( decoLib.box ) : edgeTransform( decoEdge ) );

				// "Same as image" (the default) keeps following the main channel.
				var decoTrigger = s.framify_org_deco_trigger || 'same';
				var decoChannel = 'same' === decoTrigger ? 'main' : 'deco';
				fx.deco = {
					svg: deco.svg,
					prefix: 'deco-',
					defaults: DECO_BOX,
					family: decoFamily,
					edge: decoEdge,
					anchor: anchor,
					channel: decoChannel,
					rotate: 'none' === decoTrigger ? 0 : number( s.framify_org_deco_rotate, 0 )
				};
				fx.parts.push( { pair: decoPair, path: deco.path, channel: decoChannel } );
				return deco.svg;
			},

			// Spacer, Clip mode. Clipping the host (as a Container does) would
			// also clip anything inside it, so a deco blob could never spill
			// past the shape. Instead the Spacer's background moves onto a fill
			// layer and only the fill is clipped: fill and deco both sit at
			// z-index -1 in the isolated host, the deco inserted first so the
			// fill paints over it by tree order. Only used with the deco on
			// (setup() checks); without one the host clip is kept, so existing
			// Clip-mode Spacers look exactly as before.
			setupFill: function ( el, id, s ) {
				var fx = this.fx;
				var main = this.mainPair( s );
				var clip = buildClip( id, main.rest.d );
				el.appendChild( clip.svg );
				fx.fillMargin = this.fillMarginFor( el );
				fx.taken = takeBackground( el, null, fx.fillMargin );
				fx.fillDevice = elementorFrontend.getCurrentDeviceMode();
				this.watchLazy( el );
				var fill = fx.taken.fill;
				fill.style.clipPath = 'url(#' + id + ')';
				fill.style.webkitClipPath = 'url(#' + id + ')';
				if ( 'yes' === s.framify_org_clip_grain ) {
					// Inside the fill, so the fill's clip cuts it too.
					fill.appendChild( buildGrainLayer( id, grainOptions( s, el ) ) );
				}
				fx.fill = fill;
				fx.clip = { path: clip.path, box: null, origin: null };
				fx.parts.push( { pair: main, path: clip.path, channel: 'main' } );
				fx.cleanup.push( function () {
					clip.svg.remove();
					// fx.taken, not a captured copy: refill() replaces it.
					fx.taken.restore();
				} );
				this.holdLayer( el, fill );

				// Own id: the clip grain above already uses id + '-grain'.
				if ( 'bg' !== s.framify_org_mode ) {
					this.holdLayer( el, this.ownDeco( el, id + '-deco', s, grainOn( s ) ? grainOptions( s, el ) : null, null ) );
				}
				this.spill( el );
			},

			// The fill margin for this host: the same on every side for a
			// Spacer (unchanged), per side for a Container (fillSides).
			fillMarginFor: function ( el ) {
				var m = fillMargin( el.offsetWidth, el.offsetHeight );
				return 'spacer' === this.getWidgetType() ? m : fillSides( el, m );
			},

			// Containers: Elementor's lazy-loaded backgrounds hide a top-level
			// container's background image (and its descendants') with
			// !important until it nears the viewport and gains e-lazyloaded;
			// a fill copied before that would keep "none" for good. Re-copy
			// once the class arrives.
			watchLazy: function ( el ) {
				var self = this;
				var fx = this.fx;
				// Containers only: the Spacer's fill path is left as it was.
				var parent = 'spacer' !== this.getWidgetType() && el.closest ? el.closest( '.e-con.e-parent:not(.e-lazyloaded)' ) : null;
				if ( ! parent || ! ( 'MutationObserver' in window ) ) {
					return;
				}
				var observer = new MutationObserver( function () {
					if ( parent.classList.contains( 'e-lazyloaded' ) && self.fx === fx ) {
						observer.disconnect();
						fx.fillDevice = null;
						self.refill( self.fillMarginFor( fx.el ) );
					}
				} );
				observer.observe( parent, { attributes: true, attributeFilter: [ 'class' ] } );
				fx.cleanup.push( function () {
					observer.disconnect();
				} );
			},

			// Background, border width and radius controls are responsive, but
			// the fill holds an inline snapshot and the host's own value is
			// hidden by !important. On a breakpoint change (window resize,
			// editor device switch, tablet rotation; all reach place()), lift
			// the suppression and re-copy into the same fill, insets and radii
			// included. Likewise when the host's size changes the margin
			// (insets, grown radii and image offsets all depend on it; a
			// Container's per-side margin also follows its distance to the
			// page edges).
			refill: function ( margin ) {
				var fx = this.fx;
				var device = elementorFrontend.getCurrentDeviceMode();
				if ( device === fx.fillDevice && marginKey( margin ) === marginKey( fx.fillMargin ) ) {
					return;
				}
				fx.fillDevice = device;
				fx.fillMargin = margin;
				fx.taken.restore();
				fx.taken = takeBackground( fx.el, fx.fill, margin );
				if ( fx.bleed ) {
					this.bleedVars();
				}
			},

			// Container Clip mode with a moving custom shape (fx.bleed). A
			// Liquid ripple / Gentle swell reaches past the container box,
			// but the background ended at the box, so the host clip had
			// nothing to reveal there and cut the shape flat. The clip stays
			// on the host (its content stays clipped; a clip-path region is
			// not bounded by the border box and shows whatever paints inside
			// it), and the background moves into an unclipped fill reaching
			// the fill margin past the box (the Spacer's takeBackground: host
			// background suppressed, positions anchored, radii grown). The
			// clip is objectBoundingBox of the host itself, so the shape needs
			// no remap (place() skips fillBox). Grain goes inside the fill so
			// it bleeds too. Elementor's overlay (::before) and background
			// video / slideshow layers are extended by the same margins in
			// CSS (framify-organic-bleed + BLEED_VARS). Fill at z-index -1:
			// under the overlay, Floating Shapes / Text (0) and content.
			bleedLayers: function ( el, id, s ) {
				var fx = this.fx;
				fx.fillMargin = this.fillMarginFor( el );
				fx.taken = takeBackground( el, null, fx.fillMargin );
				fx.fillDevice = elementorFrontend.getCurrentDeviceMode();
				this.watchLazy( el );
				var fill = fx.fill = fx.taken.fill;
				if ( 'yes' === s.framify_org_clip_grain ) {
					fill.appendChild( buildGrainLayer( id, grainOptions( s, el ) ) );
				}
				fx.cleanup.push( function () {
					// fx.taken, not a captured copy: refill() replaces it.
					fx.taken.restore();
				} );
				this.holdLayer( el, fill );
				el.classList.add( 'framify-organic-bleed' );
				this.bleedVars();
				fx.cleanup.push( function () {
					el.classList.remove( 'framify-organic-bleed' );
					BLEED_VARS.forEach( function ( name ) {
						el.style.removeProperty( name );
					} );
				} );
				// An overflow clip on the host would crop the fill at its box.
				this.spill( el );
			},

			// The bled layers' margins and corner radii (the fill's, which
			// takeBackground grew), for the overlay / video / slideshow CSS.
			bleedVars: function () {
				var fx = this.fx;
				var m = marginSides( fx.fillMargin );
				var fs = fx.fill.style;
				var values = [ m.top + 'px', m.right + 'px', m.bottom + 'px', m.left + 'px', fs.borderTopLeftRadius, fs.borderTopRightRadius, fs.borderBottomRightRadius, fs.borderBottomLeftRadius ];
				BLEED_VARS.forEach( function ( name, i ) {
					fx.el.style.setProperty( name, values[ i ] || '0px' );
				} );
			},

			// The deco (outline ring especially) is meant to spill past the
			// Spacer's box: lift an overflow clip on the host and the widget
			// element, only where one is set, and put the inline value back
			// exactly on teardown.
			spill: function ( host ) {
				var fx = this.fx;
				var widget = this.$element[ 0 ];
				( host === widget ? [ host ] : [ host, widget ] ).forEach( function ( node ) {
					var cs = window.getComputedStyle( node );
					if ( 'visible' === cs.overflowX && 'visible' === cs.overflowY ) {
						return;
					}
					var saved = inlineProps( node, 'overflow' );
					node.style.setProperty( 'overflow', 'visible' );
					fx.cleanup.push( function () {
						restoreProps( node, 'overflow', saved );
					} );
				} );
			},

			// Editor only. Elementor's settings handle sits inside the element
			// box (a Container's at the top centre, a widget's at the top
			// right), so a clip that doesn't cover that spot cut it off and
			// clicks there went to the page behind. While the handle shows
			// (hovered, or the element is the selected one) a rect over it
			// joins the clipPath: children of a clipPath are a union. The
			// handle is display:none until hover and then slides into place
			// (Elementor adds e-handles-inside at the top of the page and
			// transitions it for 0.3 s), so it is measured every frame for
			// HANDLE_TRACK ms after it shows, in the clipped element's
			// objectBoundingBox units. On leave the rect AND the handle stay
			// HANDLE_GRACE ms: the pointer usually crosses unclipped space
			// between the shape and the handle (which can sit outside the
			// element box, where only the handle itself can be hovered), and
			// Elementor hides the handle as soon as the element loses :hover.
			// Its display:none rule has no !important, so an inline display
			// holds it; reaching it hovers the element again (it is a
			// descendant) and Elementor's own CSS takes over.
			keepHandle: function ( el, clipEl ) {
				var rect = null;
				var frame = 0;
				var graceTimer = 0;
				// Seeded from the DOM: a rebuild while the pointer rests on the
				// element fires no new mouseenter.
				var hovered = el.matches( ':hover' );
				var handleEl = null;
				var shownDisplay = '';
				var held = null;
				var release = function () {
					if ( held ) {
						held.node.style.removeProperty( 'display' );
						if ( held.value ) {
							held.node.style.setProperty( 'display', held.value, held.priority );
						}
						held = null;
					}
				};
				var hide = function () {
					cancelAnimationFrame( frame );
					clearTimeout( graceTimer );
					graceTimer = 0;
					release();
					if ( rect ) {
						rect.remove();
						rect = null;
					}
				};
				var measure = function () {
					var handle = el.querySelector( ':scope > .elementor-element-overlay .elementor-editor-element-settings' );
					var hr = handle ? handle.getBoundingClientRect() : null;
					var er = el.getBoundingClientRect();
					if ( ! hr || ! hr.width || ! hr.height || ! er.width || ! er.height ) {
						return;
					}
					handleEl = handle;
					shownDisplay = window.getComputedStyle( handle ).display;
					if ( ! rect ) {
						rect = svgEl( 'rect' );
						rect.setAttribute( 'class', 'framify-organic__handle' );
						clipEl.appendChild( rect );
					}
					rect.setAttribute( 'x', ( hr.left - er.left - HANDLE_PAD ) / er.width );
					rect.setAttribute( 'y', ( hr.top - er.top - HANDLE_PAD ) / er.height );
					rect.setAttribute( 'width', ( hr.width + 2 * HANDLE_PAD ) / er.width );
					rect.setAttribute( 'height', ( hr.height + 2 * HANDLE_PAD ) / er.height );
				};
				var show = function () {
					var start = null;
					clearTimeout( graceTimer );
					graceTimer = 0;
					release();
					cancelAnimationFrame( frame );
					var track = function ( now ) {
						if ( null === start ) {
							start = now;
						}
						measure();
						if ( now - start < HANDLE_TRACK ) {
							frame = requestAnimationFrame( track );
						}
					};
					frame = requestAnimationFrame( track );
				};
				var update = function () {
					if ( hovered || el.classList.contains( 'elementor-element-editable' ) ) {
						show();
					} else if ( rect && ! graceTimer ) {
						if ( handleEl && handleEl.isConnected && shownDisplay && 'none' !== shownDisplay ) {
							held = { node: handleEl, value: handleEl.style.getPropertyValue( 'display' ), priority: handleEl.style.getPropertyPriority( 'display' ) };
							handleEl.style.setProperty( 'display', shownDisplay );
						}
						graceTimer = setTimeout( hide, HANDLE_GRACE );
					} else if ( ! rect ) {
						hide();
					}
				};
				var enter = function () {
					hovered = true;
					update();
				};
				var leave = function () {
					hovered = false;
					update();
				};
				el.addEventListener( 'mouseenter', enter );
				el.addEventListener( 'mouseleave', leave );
				var observer = 'MutationObserver' in window ? new MutationObserver( update ) : null;
				if ( observer ) {
					observer.observe( el, { attributes: true, attributeFilter: [ 'class' ] } );
				}
				update();
				this.fx.cleanup.push( function () {
					el.removeEventListener( 'mouseenter', enter );
					el.removeEventListener( 'mouseleave', leave );
					if ( observer ) {
						observer.disconnect();
					}
					hide();
				} );
			},

			setupContainer: function ( el, id, s ) {
				var fx = this.fx;
				var main = this.mainPair( s );

				if ( 'clip' === s.framify_org_mode ) {
					var clip = buildClip( id, main.rest.d );
					el.appendChild( clip.svg );
					el.style.clipPath = 'url(#' + id + ')';
					el.style.webkitClipPath = 'url(#' + id + ')';
					fx.clip = { path: clip.path, box: null, origin: null };
					fx.parts.push( { pair: main, path: clip.path, channel: 'main' } );
					fx.cleanup.push( function () {
						clip.svg.remove();
						el.style.clipPath = '';
						el.style.webkitClipPath = '';
					} );
					// Editor only: the clip lands on the element that owns
					// Elementor's editing overlay (a Container, or a Spacer
					// with Optimized Markup; a Spacer's inner wrapper does not
					// hold it).
					if ( elementorFrontend.isEditMode() && el === this.$element[ 0 ] ) {
						this.keepHandle( el, clip.path.parentNode );
					}
					if ( fx.bleed ) {
						// Grain included (it goes inside the fill).
						this.bleedLayers( el, id, s );
						return;
					}
					if ( 'yes' === s.framify_org_clip_grain ) {
						this.holdLayer( el, buildGrainLayer( id, grainOptions( s, el ) ) );
					}
					return;
				}

				var deco = buildDeco( id, main.rest.d, decoLook( s, grainOn( s ) ? grainOptions( s, el ) : null ) );
				deco.path.setAttribute( 'transform', fx.inner );

				this.holdLayer( el, deco.svg );

				// In deco mode the deco IS the shape, so it uses the main placement.
				fx.deco = { svg: deco.svg, path: deco.path, prefix: '', defaults: MAIN_BOX, family: fx.family, edge: fx.edge, anchor: null, channel: 'main', rotate: 0 };
				fx.parts.push( { pair: main, path: deco.path, channel: 'main' } );
			},

			// Placement can change with no settings change: a window resize, an
			// editor device switch, a breakpoint, the image loading. ResizeObserver
			// covers a size change of the element or image, but a breakpoint can
			// flip the CSS custom properties (e.g. a fixed-width image with a
			// different Placement on tablet) with no size change at all, so it
			// fires no callback; window resize also covers that case, and is the
			// only signal in browsers without ResizeObserver. place() is
			// idempotent, so the two listeners overlapping is harmless.
			observeLayout: function () {
				var self = this;
				var fx = this.fx;
				var place = function () {
					self.place();
				};
				var observer = 'ResizeObserver' in window ? new ResizeObserver( place ) : null;
				if ( observer ) {
					observer.observe( fx.el );
					if ( fx.img ) {
						observer.observe( fx.img );
					}
				}
				if ( fx.img ) {
					fx.img.addEventListener( 'load', place );
				}
				window.addEventListener( 'resize', place );
				fx.cleanup.push( function () {
					if ( observer ) {
						observer.disconnect();
					}
					if ( fx.img ) {
						fx.img.removeEventListener( 'load', place );
					}
					window.removeEventListener( 'resize', place );
				} );
			},

			// Applies the current placement. A different flat edge needs a
			// different path, so that case rebuilds instead.
			place: function () {
				var fx = this.fx;
				if ( ! fx ) {
					return;
				}
				var box = readBox( fx.el, '', MAIN_BOX );
				if ( resolveEdge( fx.family, fx.edgeSetting, box, fx.custom ) !== fx.edge ) {
					this.rebuild();
					return;
				}

				var hostW = fx.el.offsetWidth;
				var hostH = fx.el.offsetHeight;
				if ( fx.fill ) {
					this.refill( this.fillMarginFor( fx.el ) );
				}

				if ( fx.deco ) {
					var deco = fx.deco;
					var decoBox = deco.prefix ? readBox( fx.el, deco.prefix, deco.defaults ) : box;
					if ( deco.prefix && resolveEdge( deco.family, 'auto', decoBox ) !== deco.edge ) {
						this.rebuild();
						return;
					}
					positionDeco( deco.svg, decoBox, deco.anchor );
				}

				// The box the clipped shape actually fills, for Gentle's aspect
				// below (the Image widget's motion inset may shrink it).
				var shapeBox = box;
				if ( fx.clip ) {
					// A clipped fill (Spacer / Container with a deco) is the
					// host box grown by the margin: map the shape back into the
					// host box (zoom origin with it; Gentle's aspect below
					// stays in host pixels). A bled Container keeps the clip on
					// the host, so its shape needs no mapping.
					var clipBox = fx.fill && ! fx.bleed ? fillBox( box, hostW, hostH, fx.fillMargin ) : box;
					if ( fx.img && fx.motion ) {
						// A moving custom shape on a photo: pull the sides in by
						// the reach the zoom does not cover (see motionInset).
						var reachAspect = fx.img.offsetWidth * box.w / ( fx.img.offsetHeight * box.h );
						reachAspect = reachAspect > 0 && isFinite( reachAspect ) ? reachAspect : 1;
						clipBox = shapeBox = insetBox( box, motionInset( box, fx.zoomSide, fx.motion, reachAspect, fx.zoom, fx.over ) );
					}
					fx.clip.box = clipBox;
					fx.clip.origin = zoomOrigin( clipBox, fx.zoomSide );
					if ( fx.img ) {
						fx.img.style.transformOrigin = ( fx.clip.origin.x * 100 ) + '% ' + ( fx.clip.origin.y * 100 ) + '%';
					}
					if ( fx.imgGrain ) {
						// The img's own box (a full-size Placement box), so the
						// grain's objectBoundingBox clip matches the img's.
						positionDeco( fx.imgGrain, FULL_BOX, fx.img );
						fx.imgGrain.style.transformOrigin = fx.img.style.transformOrigin;
					}
				}

				if ( fx.custom ) {
					// Gentle's rotation needs the shape box's rendered pixel aspect
					// (see gentleTransform); an Image widget clips the img itself, a
					// Container (clip or deco mode) clips/traces the element, so
					// fx.img (when set) is always the right element to measure.
					var aspectEl = fx.img || fx.el;
					var rawAspect = aspectEl.offsetWidth * shapeBox.w / ( aspectEl.offsetHeight * shapeBox.h );
					fx.aspect = rawAspect > 0 && isFinite( rawAspect ) ? rawAspect : 1;
				}

				this.render();
			},

			// Binds one animation channel to a trigger on the element: hover,
			// once in view, or a loop while visible. 'none' (or no trigger)
			// binds nothing, leaving that channel at rest.
			bindTrigger: function ( el, channel, trigger, duration, period ) {
				var self = this;
				var fx = this.fx;
				if ( ! trigger || 'none' === trigger || 'same' === trigger ) {
					return;
				}
				duration = Math.max( 200, duration );
				var ease = elastic( period || SPRING_PERIOD.normal );

				if ( 'hover' === trigger ) {
					var enter = function () {
						self.animate( channel, 1, duration, ease );
					};
					var leave = function () {
						self.animate( channel, 0, duration, ease );
					};
					el.addEventListener( 'mouseenter', enter );
					el.addEventListener( 'mouseleave', leave );
					fx.cleanup.push( function () {
						el.removeEventListener( 'mouseenter', enter );
						el.removeEventListener( 'mouseleave', leave );
					} );
					return;
				}

				if ( ! ( 'IntersectionObserver' in window ) ) {
					return;
				}

				var observer = new IntersectionObserver( function ( entries ) {
					entries.forEach( function ( entry ) {
						if ( 'inview' === trigger ) {
							if ( entry.isIntersecting ) {
								self.animate( channel, 1, duration, ease );
								observer.disconnect();
							}
						} else if ( entry.isIntersecting ) {
							self.startLoop( channel, duration );
						} else {
							self.stopLoop( channel );
						}
					} );
				}, { threshold: 0.35 } );
				observer.observe( el );
				fx.cleanup.push( function () {
					observer.disconnect();
				} );
			},

			animate: function ( channel, target, duration, ease ) {
				var self = this;
				var ch = this.fx.channels[ channel ];
				var from = ch.value;
				var start = null;
				cancelAnimationFrame( ch.raf );

				var step = function ( now ) {
					if ( null === start ) {
						start = now;
					}
					var t = Math.min( 1, ( now - start ) / duration );
					ch.value = from + ( target - from ) * ease( t );
					self.render();
					if ( t < 1 ) {
						ch.raf = requestAnimationFrame( step );
					} else {
						ch.value = target;
					}
				};
				ch.raf = requestAnimationFrame( step );
			},

			startLoop: function ( channel, duration ) {
				var self = this;
				var ch = this.fx.channels[ channel ];
				if ( ch.looping ) {
					return;
				}
				ch.looping = true;
				var go = function ( target ) {
					if ( ! ch.looping ) {
						return;
					}
					self.animate( channel, target, duration, easeInOutSine );
					ch.loopTimer = setTimeout( function () {
						go( target ? 0 : 1 );
					}, duration );
				};
				go( ch.value >= 0.5 ? 0 : 1 );
			},

			stopLoop: function ( channel ) {
				var ch = this.fx.channels[ channel ];
				ch.looping = false;
				clearTimeout( ch.loopTimer );
				cancelAnimationFrame( ch.raf );
			},

			render: function () {
				var fx = this.fx;
				var value = fx.channels.main.value;
				fx.parts.forEach( function ( part ) {
					if ( part.pair.rest === part.pair.hover ) {
						// A static shape (Custom: rest and hover are the same
						// parsed path). blendPath's NUMBER tokenizer would mangle
						// packed arc flags (e.g. "a10 10 0 0110 10" becomes
						// "a10.00 10.00 0.00 110.00 10.00") and round every number
						// to 2 decimals, faceting tiny viewBox units. Use the
						// original string untouched, and only once.
						if ( part.path.getAttribute( 'd' ) !== part.pair.rest.d ) {
							part.path.setAttribute( 'd', part.pair.rest.d );
						}
					} else if ( part.pair.blend ) {
						// Dots: its own blender (arc flags must stay integers).
						part.path.setAttribute( 'd', part.pair.blend( fx.channels[ part.channel ].value ) );
					} else {
						part.path.setAttribute( 'd', blendPath( part.pair.rest, part.pair.hover, fx.channels[ part.channel ].value ) );
					}
				} );
				if ( fx.deco && fx.deco.rotate ) {
					// A CSS turn on the deco svg: it rotates in pixel space, so it
					// never shears the way a rotation inside the stretched 0-100
					// box would.
					var turn = fx.deco.rotate * fx.channels[ fx.deco.channel ].value;
					fx.deco.svg.style.transform = turn ? 'rotate(' + turn + 'deg)' : '';
				}
				if ( fx.gentle ) {
					// Gentle custom motion lives in the inner transform, shared by
					// the clip and by a container's deco path.
					fx.inner = gentleTransform( fx.gentle, value, fx.customInner, fx.aspect );
					if ( fx.deco && ! fx.deco.prefix ) {
						fx.deco.path.setAttribute( 'transform', fx.inner );
					}
				}
				if ( fx.clip && fx.clip.box ) {
					var zoom = fx.img ? 1 + fx.zoom * Math.max( 0, value ) : 1;
					if ( fx.img ) {
						fx.img.style.transform = 1 === zoom ? '' : 'scale(' + zoom + ')';
						if ( fx.imgGrain ) {
							fx.imgGrain.style.transform = fx.img.style.transform;
						}
					}
					fx.clip.path.setAttribute( 'transform', clipTransform( fx.clip.box, fx.inner, zoom, fx.clip.origin ) );
					if ( fx.img ) {
						syncPhoto( fx.el );
					}
				}
			},

			teardown: function () {
				var fx = this.fx;
				if ( ! fx ) {
					return;
				}
				Object.keys( fx.channels ).forEach( function ( name ) {
					var ch = fx.channels[ name ];
					ch.looping = false;
					clearTimeout( ch.loopTimer );
					cancelAnimationFrame( ch.raf );
				} );
				fx.cleanup.forEach( function ( fn ) {
					fn();
				} );
				this.fx = null;
				// The img's clip / zoom are gone: an Over photo frame drops
				// them too (plain rectangle until a rebuild clips again).
				if ( fx.img ) {
					syncPhoto( fx.el );
				}
			}
		} );

		elementorFrontend.elementsHandler.attachHandler( 'image', OrganicShape );
		// null skin: containers fire "frontend/element_ready/container", not "container.default".
		elementorFrontend.elementsHandler.attachHandler( 'container', OrganicShape, null );
		// A widget: default skin, so it fires "frontend/element_ready/spacer.default".
		elementorFrontend.elementsHandler.attachHandler( 'spacer', OrganicShape );
	} );
}() );
