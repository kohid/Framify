/**
 * Framify - Background Effects, pure core (cloud / smoke / flames).
 *
 * No DOM, no Elementor: settings in, numbers out, so it runs in node (see
 * dev/tests/effects-core-test.js) and the engine in framify-effects.js only
 * has to draw. Every particle pose is an analytic function of the particle's
 * age and a few fixed random numbers, so a resize, a resolution change or a
 * quality step can never make anything jump, and a still frame for reduced
 * motion is simply "advance, pose once".
 *
 * Sizes are expressed against `ref`, the element's geometric size clamped to
 * 240-1400 px, so an effect looks the same on a small card and a full-width
 * hero. Colours arrive as strings from the settings and are parsed to
 * integers here; no settings string ever reaches the DOM or CSS.
 */
( function ( window ) {
	'use strict';

	var PREFIX = 'framify_ef_';
	var TYPES = [ 'cloud', 'smoke', 'flames' ];
	var QUALITIES = { low: { scale: 0.4, dpr: 1, fps: 30 }, medium: { scale: 0.6, dpr: 1, fps: 30 }, high: { scale: 0.85, dpr: 1.5, fps: 60 } };
	var MAX_LAYER = { cloud: 16, smoke: 80, flames: 160 };
	var COUNT_RANGE = { cloud: [ 4, 16 ], smoke: [ 14, 80 ], flames: [ 30, 150 ] };
	var MAX_TOTAL = 260;
	var FILL_BUDGET = 9;
	var MAX_BACKING = 700000;
	var DT_MAX = 0.05;
	var LEVELS = [ { scale: 1, count: 1, fps: 0 }, { scale: 0.75, count: 0.8, fps: 0 }, { scale: 0.55, count: 0.6, fps: 30 }, { scale: 0.4, count: 0.4, fps: 24 } ];
	var COLORS = { cloud: [ '#FFFFFF', '#AEB9CC' ], smoke: [ '#6F7480', '#D6D9DF' ], flames: [ '#FFE066', '#FF8A1F', '#D81E05' ] };
	var ALL = TYPES;

	// One row per per-layer control: the PHP side builds its controls from
	// the same table (checked by the parity test), keys are
	// framify_ef_{layer}_{key}. `types` lists the effects that use it.
	var SPEC = [
		{ key: 'opacity', kind: 'slider', min: 0.05, max: 1, step: 0.05, def: 0.7, types: ALL },
		{ key: 'speed', kind: 'slider', min: 0.2, max: 3, step: 0.05, def: 1, types: ALL },
		{ key: 'density', kind: 'slider', min: 0, max: 100, step: 1, def: 50, types: ALL },
		{ key: 'size', kind: 'slider', min: 40, max: 250, step: 1, def: 100, types: ALL },
		{ key: 'c1', kind: 'color', types: ALL },
		{ key: 'c2', kind: 'color', types: ALL },
		{ key: 'c3', kind: 'color', types: [ 'flames' ] },
		{ key: 'dir', kind: 'select', options: [ 'right', 'left' ], def: 'right', types: [ 'cloud' ] },
		{ key: 'softness', kind: 'slider', min: 0, max: 100, step: 1, def: 60, types: [ 'cloud' ] },
		{ key: 'band', kind: 'slider', min: 0, max: 100, step: 1, def: 35, types: [ 'cloud' ] },
		{ key: 'spread', kind: 'slider', min: 10, max: 100, step: 1, def: 60, types: [ 'cloud' ] },
		{ key: 'rise', kind: 'slider', min: 20, max: 100, step: 1, def: 70, types: [ 'smoke' ] },
		{ key: 'turb', kind: 'slider', min: 0, max: 100, step: 1, def: 50, types: [ 'smoke' ] },
		{ key: 'flame_h', kind: 'slider', min: 10, max: 100, step: 1, def: 45, types: [ 'flames' ] },
		{ key: 'flicker', kind: 'slider', min: 0, max: 100, step: 1, def: 60, types: [ 'flames' ] },
		{ key: 'ox', kind: 'slider', min: 0, max: 100, step: 1, def: 50, types: [ 'smoke', 'flames' ] },
		{ key: 'ew', kind: 'slider', min: 5, max: 100, step: 1, def: 40, types: [ 'smoke', 'flames' ] },
		{ key: 'wind', kind: 'slider', min: -100, max: 100, step: 1, def: 0, types: [ 'smoke', 'flames' ] }
	];

	/* ---------- small maths ---------- */

	function clamp( v, lo, hi ) {
		return Math.min( hi, Math.max( lo, v ) );
	}

	function lerp( a, b, t ) {
		return a + ( b - a ) * t;
	}

	function smoothstep( a, b, x ) {
		var t = clamp( ( x - a ) / ( b - a ), 0, 1 );
		return t * t * ( 3 - 2 * t );
	}

	function easeOut( u ) {
		return u * ( 2 - u );
	}

	// Cheap two-sine turbulence, -1..1.
	function wobble( t, f1, f2, p1, p2 ) {
		return 0.6 * Math.sin( t * f1 + p1 ) + 0.4 * Math.sin( t * f2 + p2 );
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

	/* ---------- colour ---------- */

	function hslToRgb( h, s, l ) {
		h = ( ( h % 360 ) + 360 ) % 360 / 360;
		s = clamp( s, 0, 1 );
		l = clamp( l, 0, 1 );
		function channel( t ) {
			t = ( t + 1 ) % 1;
			if ( t < 1 / 6 ) {
				return p + ( q - p ) * 6 * t;
			}
			if ( t < 1 / 2 ) {
				return q;
			}
			if ( t < 2 / 3 ) {
				return p + ( q - p ) * ( 2 / 3 - t ) * 6;
			}
			return p;
		}
		var q = l < 0.5 ? l * ( 1 + s ) : l + s - l * s;
		var p = 2 * l - q;
		return [ Math.round( channel( h + 1 / 3 ) * 255 ), Math.round( channel( h ) * 255 ), Math.round( channel( h - 1 / 3 ) * 255 ) ];
	}

	// "#rgb", "#rrggbb", "#rrggbbaa", rgb()/rgba(), hsl()/hsla() -> [ r, g, b ]
	// or null. Alpha is ignored: the opacity slider owns transparency.
	function parseColor( str ) {
		if ( 'string' !== typeof str ) {
			return null;
		}
		var v = str.trim().toLowerCase();
		var m = /^#([0-9a-f]{3})$/.exec( v );
		if ( m ) {
			return [ parseInt( m[ 1 ].charAt( 0 ) + m[ 1 ].charAt( 0 ), 16 ), parseInt( m[ 1 ].charAt( 1 ) + m[ 1 ].charAt( 1 ), 16 ), parseInt( m[ 1 ].charAt( 2 ) + m[ 1 ].charAt( 2 ), 16 ) ];
		}
		m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec( v );
		if ( m ) {
			return [ parseInt( m[ 1 ].slice( 0, 2 ), 16 ), parseInt( m[ 1 ].slice( 2, 4 ), 16 ), parseInt( m[ 1 ].slice( 4, 6 ), 16 ) ];
		}
		m = /^(rgb|hsl)a?\(\s*([^)]*)\)$/.exec( v );
		if ( ! m ) {
			return null;
		}
		var parts = m[ 2 ].split( /[\s,\/]+/ ).filter( Boolean );
		if ( parts.length < 3 ) {
			return null;
		}
		var nums = parts.slice( 0, 3 ).map( function ( p, i ) {
			var n = parseFloat( p );
			if ( 'rgb' === m[ 1 ] && /%$/.test( p ) ) {
				n = n * 255 / 100;
			}
			if ( 'hsl' === m[ 1 ] && i > 0 ) {
				n = n / 100;
			}
			return n;
		} );
		if ( nums.some( isNaN ) ) {
			return null;
		}
		if ( 'hsl' === m[ 1 ] ) {
			return hslToRgb( nums[ 0 ], nums[ 1 ], nums[ 2 ] );
		}
		return nums.map( function ( n ) {
			return clamp( Math.round( n ), 0, 255 );
		} );
	}

	function mix( a, b, t ) {
		return [ Math.round( lerp( a[ 0 ], b[ 0 ], t ) ), Math.round( lerp( a[ 1 ], b[ 1 ], t ) ), Math.round( lerp( a[ 2 ], b[ 2 ], t ) ) ];
	}

	// stops: [ [ position 0-1, [ r, g, b ] ], ... ] in ascending order.
	function rampColor( stops, t ) {
		if ( t <= stops[ 0 ][ 0 ] ) {
			return stops[ 0 ][ 1 ].slice();
		}
		for ( var i = 1; i < stops.length; i++ ) {
			if ( t <= stops[ i ][ 0 ] ) {
				return mix( stops[ i - 1 ][ 1 ], stops[ i ][ 1 ], ( t - stops[ i - 1 ][ 0 ] ) / ( stops[ i ][ 0 ] - stops[ i - 1 ][ 0 ] || 1 ) );
			}
		}
		return stops[ stops.length - 1 ][ 1 ].slice();
	}

	/* ---------- settings ---------- */

	// A slider arrives as { unit, size } (or a bare number in tests).
	function num( v, def ) {
		var n = v && 'object' === typeof v ? parseFloat( v.size ) : parseFloat( v );
		return isNaN( n ) ? def : n;
	}

	// One layer's clamped options, or null when the layer is Off or unknown.
	// An empty colour means the effect's own colour: unlike Floating Shapes,
	// "no colour" has no meaning for smoke or fire. `density` lets the caller
	// pass the responsive value for the current device.
	function layerConfig( s, n, density ) {
		var type = s[ PREFIX + n + '_type' ];
		if ( TYPES.indexOf( type ) < 0 ) {
			return null;
		}
		var cfg = { type: type };
		SPEC.forEach( function ( spec ) {
			if ( spec.types.indexOf( type ) < 0 ) {
				return;
			}
			var v = s[ PREFIX + n + '_' + spec.key ];
			if ( 'slider' === spec.kind ) {
				cfg[ spec.key ] = clamp( num( v, spec.def ), spec.min, spec.max );
			} else if ( 'select' === spec.kind ) {
				cfg[ spec.key ] = spec.options.indexOf( v ) < 0 ? spec.def : v;
			} else {
				var slot = 'c1' === spec.key ? 0 : ( 'c2' === spec.key ? 1 : 2 );
				cfg[ spec.key ] = parseColor( v ) || parseColor( COLORS[ type ][ slot ] );
			}
		} );
		if ( undefined !== density && ! isNaN( +density ) ) {
			cfg.density = clamp( +density, 0, 100 );
		}
		return cfg;
	}

	// The whole stack: the section's two switches and the three layers.
	function readStack( s, density ) {
		var layers = [];
		for ( var n = 1; n <= 3; n++ ) {
			layers.push( layerConfig( s, n, density ? density( n ) : undefined ) );
		}
		return {
			stack: 'above' === s[ PREFIX + 'stack' ] ? 'above' : 'under',
			quality: QUALITIES[ s[ PREFIX + 'quality' ] ] ? s[ PREFIX + 'quality' ] : 'medium',
			layers: layers
		};
	}

	/* ---------- planning, caps and the governor ---------- */

	function refOf( W, H ) {
		return clamp( Math.sqrt( Math.max( 1, W ) * Math.max( 1, H ) ), 240, 1400 );
	}

	// Rough size of one particle's footprint, for the overdraw budget.
	function typicalRadius( cfg, ref ) {
		var size = cfg.size / 100;
		if ( 'cloud' === cfg.type ) {
			return ref * 0.26 * size * 0.5;
		}
		if ( 'smoke' === cfg.type ) {
			return ref * 0.05 * 2.6 * size;
		}
		return ref * 0.05 * size;
	}

	// Particles per layer: density between the type's min and max, scaled by
	// the governor's `mult`, then held to the overdraw budget and the caps.
	function planCounts( layers, W, H, mult ) {
		var ref = refOf( W, H );
		var counts = layers.map( function ( cfg ) {
			if ( ! cfg ) {
				return 0;
			}
			var range = COUNT_RANGE[ cfg.type ];
			var n = Math.round( lerp( range[ 0 ], range[ 1 ], cfg.density / 100 ) * mult );
			return Math.max( 1, Math.min( MAX_LAYER[ cfg.type ], n ) );
		} );
		var area = Math.max( 1, W * H );
		var fill = 0;
		layers.forEach( function ( cfg, i ) {
			if ( cfg ) {
				var r = typicalRadius( cfg, ref );
				fill += counts[ i ] * Math.PI * r * r / area;
			}
		} );
		var scale = fill > FILL_BUDGET ? FILL_BUDGET / fill : 1;
		var total = 0;
		counts = counts.map( function ( n, i ) {
			var out = layers[ i ] ? Math.max( 1, Math.floor( n * scale ) ) : 0;
			total += out;
			return out;
		} );
		if ( total > MAX_TOTAL ) {
			counts = counts.map( function ( n, i ) {
				return layers[ i ] ? Math.max( 1, Math.floor( n * MAX_TOTAL / total ) ) : 0;
			} );
		}
		return counts;
	}

	// The canvas backing store: CSS size x quality x governor level x DPR,
	// held under MAX_BACKING pixels. The browser upscales it, which is
	// invisible on soft particles and is where the saving comes from.
	function chooseBacking( W, H, dpr, quality, level ) {
		var q = QUALITIES[ quality ] || QUALITIES.medium;
		var lv = LEVELS[ clamp( level | 0, 0, 3 ) ];
		var area = Math.max( 1, W * H );
		var s = q.scale * lv.scale * Math.min( dpr || 1, q.dpr );
		s = Math.min( s, Math.sqrt( MAX_BACKING / area ) );
		return { bw: Math.max( 1, Math.round( W * s ) ), bh: Math.max( 1, Math.round( H * s ) ), scale: s };
	}

	// Frame interval in ms for the quality and governor level (0 = every rAF).
	function frameInterval( quality, level ) {
		var q = QUALITIES[ quality ] || QUALITIES.medium;
		var fps = LEVELS[ clamp( level | 0, 0, 3 ) ].fps || q.fps;
		return 60 <= fps ? 0 : 1000 / fps;
	}

	function newGovernor() {
		return { level: 0, frames: 0, n: 0, work: 0, gap: 0, cool: 0, upgrades: 0 };
	}

	// Feed one frame (work and gap in ms). Over a 30-frame window it steps
	// the level down when the frames are slow and, at most twice and after a
	// cool-down, back up when they are clearly fast. Returns the new level,
	// or -1 when nothing changed. The first frames build sprites and a tab
	// stall is not the effect's fault, so both are ignored.
	function governorStep( g, workMs, gapMs, targetMs ) {
		g.frames++;
		if ( g.cool > 0 ) {
			g.cool--;
		}
		if ( g.frames <= 20 || gapMs > 250 ) {
			return -1;
		}
		g.n++;
		g.work += workMs;
		g.gap += gapMs;
		if ( g.n < 30 ) {
			return -1;
		}
		var pressure = Math.max( g.work / g.n / 8, g.gap / g.n / ( targetMs * 1.5 ) );
		g.n = 0;
		g.work = 0;
		g.gap = 0;
		if ( pressure > 1 && g.level < 3 ) {
			g.level++;
			g.cool = 300;
			return g.level;
		}
		if ( pressure < 0.35 && g.level > 0 && 0 === g.cool && g.upgrades < 2 ) {
			g.level--;
			g.upgrades++;
			return g.level;
		}
		return -1;
	}

	/* ---------- particle models ---------- */

	function newParticle() {
		return { age: 0, life: 1, x0: 0, ph1: 0, ph2: 0, f1: 1, f2: 2, rv: 0, r0: 1, jit: 1, taper: 1, fph: 0, ff: 20, fx: 4, z: 0, phase: 0, variant: 0, lane: 0, u: 0 };
	}

	// (Re)roll a particle. `first` spreads smoke and flames over their life
	// so the field is already full on frame one.
	function initParticle( p, cfg, rnd, ref, first ) {
		var size = cfg.size / 100;
		var speed = cfg.speed;
		var edge;
		if ( 'cloud' === cfg.type ) {
			p.z = Math.pow( rnd(), 1.3 );
			p.phase = rnd() * 6.2832;
			p.variant = Math.floor( rnd() * 4 );
			p.lane = rnd();
			p.u = rnd();
			return p;
		}
		if ( 'smoke' === cfg.type ) {
			p.life = ( 4.5 + 3.5 * rnd() ) / speed;
			p.x0 = ( rnd() - 0.5 ) * cfg.ew / 100;
			p.ph1 = rnd() * 6.2832;
			p.ph2 = rnd() * 6.2832;
			p.f1 = 0.6 + 0.6 * rnd();
			p.f2 = 1.7 + 0.9 * rnd();
			p.rv = ( rnd() - 0.5 ) * 0.8;
			p.r0 = ref * 0.05 * size * ( 0.8 + 0.4 * rnd() );
			p.jit = 0.6 + 0.4 * rnd();
		} else {
			p.life = ( 0.7 + 0.8 * rnd() ) / speed;
			edge = cfg.ew / 100 * 0.5;
			p.x0 = ( rnd() + rnd() - 1 ) * edge;
			p.taper = 1 - 0.55 * Math.abs( p.x0 ) / ( edge || 1 );
			p.fph = rnd() * 6.2832;
			p.ff = 18 + 14 * rnd();
			p.fx = 3 + 3 * rnd();
			p.r0 = ref * 0.05 * size * ( 0.7 + 0.6 * rnd() );
		}
		p.age = first ? rnd() * p.life : 0;
		return p;
	}

	// Move a particle on by dt seconds (already clamped by the caller).
	function advance( p, dt, cfg, rnd, ref, W ) {
		if ( 'cloud' === cfg.type ) {
			var r = ref * 0.26 * cfg.size / 100 * ( 0.35 + 0.65 * p.z );
			var m = 1.4 * r;
			var v = ( 14 * ref / 600 ) * cfg.speed * ( 0.25 + 0.75 * p.z );
			p.u = ( p.u + dt * v / ( W + 2 * m ) ) % 1;
			return;
		}
		p.age += dt;
		if ( p.age >= p.life ) {
			initParticle( p, cfg, rnd, ref, false );
		}
	}

	// The particle's pose at time t (seconds, for the slow wobbles). Writes
	// into `out`: x, y (centre), w, h (draw size), a (0-1), rot, stage, v.
	function pose( p, cfg, W, H, ref, t, out ) {
		var op = cfg.opacity;
		var u;
		var r;
		if ( 'cloud' === cfg.type ) {
			r = ref * 0.26 * cfg.size / 100 * ( 0.35 + 0.65 * p.z );
			var m = 1.4 * r;
			var x = -m + p.u * ( W + 2 * m );
			out.x = 'left' === cfg.dir ? W - x : x;
			out.y = H * cfg.band / 100 + ( p.lane - 0.5 ) * H * cfg.spread / 100 + Math.sin( t * 0.1 + p.phase ) * r * 0.04;
			var breathe = 1 + 0.03 * Math.sin( t * 0.15 + p.phase );
			out.w = 2 * r * breathe;
			out.h = 1.2 * r * breathe;
			out.a = op * 0.55 * ( 0.35 + 0.65 * p.z );
			out.rot = 0;
			out.stage = 0;
			out.v = p.variant;
			return out;
		}
		u = p.life > 0 ? clamp( p.age / p.life, 0, 1 ) : 0;
		if ( 'smoke' === cfg.type ) {
			r = p.r0 * ( 1 + 2.2 * easeOut( u ) );
			out.y = H + p.r0 - H * cfg.rise / 100 * easeOut( u );
			out.x = cfg.ox / 100 * W + p.x0 * W + wobble( p.age, p.f1, p.f2, p.ph1, p.ph2 ) * cfg.turb / 100 * ref * 0.06 * ( 0.3 + u ) + cfg.wind / 100 * W * 0.12 * Math.pow( u, 1.5 );
			out.a = op * 0.5 * p.jit * smoothstep( 0, 0.12, u ) * Math.pow( 1 - smoothstep( 0.35, 1, u ), 1.2 );
			out.rot = p.rv * p.age;
			out.stage = Math.min( 3, Math.floor( u * 4 ) );
			out.v = Math.floor( p.ph1 * 3 / 6.2832 ) % 3;
		} else {
			var tall = H * cfg.flame_h / 100;
			var flick = 1 - cfg.flicker / 100 * 0.5 * ( 0.5 + 0.5 * Math.sin( t * p.ff + p.fph ) );
			r = p.r0 * ( 1 - 0.75 * Math.pow( u, 1.2 ) );
			out.y = H + p.r0 * 0.3 - tall * p.taper * easeOut( u );
			out.x = cfg.ox / 100 * W + p.x0 * W * ( 1 - 0.5 * u ) + Math.sin( t * p.fx + p.fph ) * cfg.flicker / 100 * ref * 0.02 * ( 0.2 + u ) + cfg.wind / 100 * tall * 0.3 * u * u;
			out.a = op * 0.8 * smoothstep( 0, 0.08, u ) * Math.pow( 1 - u, 1.3 ) * flick;
			out.rot = 0;
			out.stage = Math.min( 11, Math.floor( Math.pow( u, 0.9 ) * 12 ) );
			out.v = 0;
		}
		out.w = out.h = 2 * Math.max( r, 0.5 );
		out.a = clamp( out.a, 0, 1 );
		return out;
	}

	window.FramifyEffectsCore = {
		PREFIX: PREFIX,
		TYPES: TYPES,
		QUALITIES: QUALITIES,
		SPEC: SPEC,
		COLORS: COLORS,
		LEVELS: LEVELS,
		MAX_LAYER: MAX_LAYER,
		MAX_TOTAL: MAX_TOTAL,
		FILL_BUDGET: FILL_BUDGET,
		MAX_BACKING: MAX_BACKING,
		DT_MAX: DT_MAX,
		clamp: clamp,
		lerp: lerp,
		smoothstep: smoothstep,
		easeOut: easeOut,
		wobble: wobble,
		mulberry32: mulberry32,
		parseColor: parseColor,
		mix: mix,
		rampColor: rampColor,
		layerConfig: layerConfig,
		readStack: readStack,
		refOf: refOf,
		planCounts: planCounts,
		chooseBacking: chooseBacking,
		frameInterval: frameInterval,
		newGovernor: newGovernor,
		governorStep: governorStep,
		newParticle: newParticle,
		initParticle: initParticle,
		advance: advance,
		pose: pose
	};
}( window ) );
