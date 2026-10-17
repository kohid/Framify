/**
 * Framify - Background Effects (cloud / smoke / flames on a canvas).
 *
 * Section and Container background layers: up to three independent effect
 * layers drawn, in order, onto ONE canvas per element, either under
 * Elementor's Background Overlay (z-index -1 in the isolated host) or above
 * it (z-index 0, like Floating Shapes), always below the content.
 *
 * The maths lives in framify-effects-core.js (pure, tested in node); this
 * file draws it: soft pre-rendered sprites blitted with drawImage onto a
 * reduced-resolution canvas, one shared requestAnimationFrame loop for the
 * page, an IntersectionObserver pause, live prefers-reduced-motion handling
 * (a still frame, no rebuild) and a quality governor that steps the cost
 * down when frames run long. window.FramifyEffects.create() has no Elementor
 * dependency, so it is also driven directly by dev/tests/effects.
 *
 * Settings rule (as elsewhere): published pages drop '' values, so a missing
 * colour means "the effect's own colour" here, not "cleared".
 */
( function () {
	'use strict';

	var Core = window.FramifyEffectsCore;
	var Fx = window.FramifyFx;
	if ( ! Core || ! Fx ) {
		return;
	}

	// Organic Shape's relocated background (-1) must sit under an effect in
	// tree order, so an Under effect is inserted after these.
	var ORGANIC_LAYERS = '.framify-organic__fill, .framify-organic__deco, .framify-organic__grain';
	var SPRITE_LIMIT = 48;
	var STILL_TIME = 6;
	var WHITE = [ 255, 255, 240 ];

	/* ---------- sprites ---------- */

	var sprites = {};
	var spriteCount = 0;

	function offscreen( w, h ) {
		var c = document.createElement( 'canvas' );
		c.width = w;
		c.height = h;
		return c;
	}

	function rgba( c, a ) {
		return 'rgba(' + c[ 0 ] + ',' + c[ 1 ] + ',' + c[ 2 ] + ',' + a + ')';
	}

	function remember( key, build ) {
		if ( sprites[ key ] ) {
			return sprites[ key ];
		}
		if ( spriteCount >= SPRITE_LIMIT ) {
			sprites = {};
			spriteCount = 0;
		}
		spriteCount++;
		sprites[ key ] = build();
		return sprites[ key ];
	}

	function disc( ctx, x, y, r, c, stops ) {
		var g = ctx.createRadialGradient( x, y, 0, x, y, r );
		stops.forEach( function ( s ) {
			g.addColorStop( s[ 0 ], rgba( c, s[ 1 ] ) );
		} );
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.arc( x, y, r, 0, 6.2832 );
		ctx.fill();
	}

	// A flat cluster of overlapping soft lobes with a shaded underside.
	function cloudSprite( variant, c1, c2, soft ) {
		return remember( 'cloud|' + variant + '|' + c1 + '|' + c2 + '|' + soft, function () {
			var cv = offscreen( 160, 96 );
			var ctx = cv.getContext( '2d' );
			var rnd = Core.mulberry32( 11 + variant * 12 );
			var edge = Core.clamp( 1 - soft / 100 * 0.7, 0.05, 1 );
			for ( var i = 0; i < 7; i++ ) {
				var t = i / 6;
				var arc = Math.sin( t * Math.PI );
				disc( ctx, 24 + t * 112 + ( rnd() - 0.5 ) * 10, 62 - arc * 22 + ( rnd() - 0.5 ) * 8, 20 + arc * 16 + rnd() * 8, c1, [ [ 0, 1 ], [ edge, 0.8 ], [ 1, 0 ] ] );
			}
			ctx.globalCompositeOperation = 'source-atop';
			var g = ctx.createLinearGradient( 0, 38, 0, 96 );
			g.addColorStop( 0, rgba( c2, 0 ) );
			g.addColorStop( 1, rgba( c2, 0.45 ) );
			ctx.fillStyle = g;
			ctx.fillRect( 0, 0, 160, 96 );
			return cv;
		} );
	}

	// An irregular puff, tinted from c1 (fresh) to c2 (aged) by stage 0-3.
	function smokeSprite( variant, stage, c1, c2 ) {
		return remember( 'smoke|' + variant + '|' + stage + '|' + c1 + '|' + c2, function () {
			var cv = offscreen( 64, 64 );
			var ctx = cv.getContext( '2d' );
			var rnd = Core.mulberry32( 31 + variant * 17 );
			var tint = Core.mix( c1, c2, stage / 3 );
			for ( var i = 0; i < 4; i++ ) {
				disc( ctx, 32 + ( rnd() - 0.5 ) * 20, 32 + ( rnd() - 0.5 ) * 20, 14 + rnd() * 8, tint, [ [ 0, 0.9 ], [ 0.5, 0.45 ], [ 1, 0 ] ] );
			}
			return cv;
		} );
	}

	// One flame puff; stage 0 (white-hot) to 11 (cool tip).
	function flameSprite( stage, c1, c2, c3 ) {
		return remember( 'flame|' + stage + '|' + c1 + '|' + c2 + '|' + c3, function () {
			var cv = offscreen( 48, 48 );
			var ctx = cv.getContext( '2d' );
			var tint = Core.rampColor( [ [ 0, WHITE ], [ 0.22, c1 ], [ 0.55, c2 ], [ 0.85, c3 ], [ 1, Core.mix( c3, [ 0, 0, 0 ], 0.4 ) ] ], stage / 11 );
			disc( ctx, 24, 24, 24, tint, [ [ 0, 1 ], [ 0.35, 0.55 ], [ 1, 0 ] ] );
			return cv;
		} );
	}

	function glowSprite( c ) {
		return remember( 'glow|' + c, function () {
			var cv = offscreen( 96, 96 );
			disc( cv.getContext( '2d' ), 48, 48, 48, c, [ [ 0, 0.5 ], [ 1, 0 ] ] );
			return cv;
		} );
	}

	// The sprites one layer needs, indexed by pose(): cloud [v], smoke
	// [v * 4 + stage], flames [stage].
	function spritesFor( cfg ) {
		var out = [];
		var a;
		var b;
		if ( 'cloud' === cfg.type ) {
			for ( a = 0; a < 4; a++ ) {
				out.push( cloudSprite( a, cfg.c1, cfg.c2, cfg.softness ) );
			}
		} else if ( 'smoke' === cfg.type ) {
			for ( a = 0; a < 3; a++ ) {
				for ( b = 0; b < 4; b++ ) {
					out.push( smokeSprite( a, b, cfg.c1, cfg.c2 ) );
				}
			}
		} else {
			for ( a = 0; a < 12; a++ ) {
				out.push( flameSprite( a, cfg.c1, cfg.c2, cfg.c3 ) );
			}
		}
		return out;
	}

	/* ---------- the shared loop ---------- */

	var clients = [];
	var loopId = 0;

	function loop( now ) {
		loopId = 0;
		var any = false;
		clients.slice().forEach( function ( client ) {
			if ( client.running() ) {
				any = true;
				client.tick( now );
			}
		} );
		if ( any && ! loopId ) {
			loopId = requestAnimationFrame( loop );
		}
	}

	function wake() {
		if ( ! loopId && clients.some( function ( c ) {
			return c.running();
		} ) ) {
			loopId = requestAnimationFrame( loop );
		}
	}

	function register( client ) {
		if ( clients.indexOf( client ) < 0 ) {
			clients.push( client );
		}
		wake();
	}

	function unregister( client ) {
		var i = clients.indexOf( client );
		if ( i > -1 ) {
			clients.splice( i, 1 );
		}
		if ( ! clients.length && loopId ) {
			cancelAnimationFrame( loopId );
			loopId = 0;
		}
	}

	/* ---------- one effect stack on one host ---------- */

	var reduceQuery = window.matchMedia ? window.matchMedia( '(prefers-reduced-motion: reduce)' ) : null;

	function listen( query, fn ) {
		if ( ! query ) {
			return function () {};
		}
		if ( query.addEventListener ) {
			query.addEventListener( 'change', fn );
			return function () {
				query.removeEventListener( 'change', fn );
			};
		}
		query.addListener( fn );
		return function () {
			query.removeListener( fn );
		};
	}

	// cfg: { stack, quality, layers: [ cfg | null, x3 ], seed }
	// opts: { now } test hook for the clock.
	function create( host, cfg, opts ) {
		opts = opts || {};
		var clock = opts.now || function () {
			return window.performance.now();
		};
		var cleanup = [];
		var releaseHost = Fx.claimHost( host );
		var layerEl = document.createElement( 'div' );
		layerEl.className = 'framify-ef framify-ef--' + cfg.stack;
		layerEl.setAttribute( 'aria-hidden', 'true' );
		var canvas = document.createElement( 'canvas' );
		canvas.className = 'framify-ef__canvas';
		layerEl.appendChild( canvas );
		Fx.insertLayer( host, layerEl, false, ORGANIC_LAYERS );
		var ctx = canvas.getContext( '2d' );

		var inst = {
			W: 0,
			H: 0,
			bw: 0,
			bh: 0,
			level: 0,
			t: 0,
			last: 0,
			frames: 0,
			visible: ! ( 'IntersectionObserver' in window ),
			still: !! ( reduceQuery && reduceQuery.matches ),
			governor: Core.newGovernor(),
			layers: [],
			planned: [ 0, 0 ]
		};
		var seed = cfg.seed >>> 0;
		var dead = false;
		var registered = false;

		cfg.layers.forEach( function ( layerCfg, i ) {
			inst.layers.push( layerCfg ? {
				cfg: layerCfg,
				sprites: spritesFor( layerCfg ),
				glow: 'flames' === layerCfg.type ? glowSprite( layerCfg.c2 ) : null,
				pool: [],
				out: {},
				rnd: Core.mulberry32( seed + 97 * ( i + 1 ) )
			} : null );
		} );

		function ref() {
			return Core.refOf( inst.W, inst.H );
		}

		// Counts follow the host's area, density and the governor level.
		function replan() {
			var counts = Core.planCounts( inst.layers.map( function ( l ) {
				return l && inst.W > 0 && inst.H > 0 ? l.cfg : null;
			} ), inst.W, inst.H, Core.LEVELS[ inst.level ].count );
			inst.layers.forEach( function ( l, i ) {
				if ( ! l ) {
					return;
				}
				while ( l.pool.length > counts[ i ] ) {
					l.pool.pop();
				}
				while ( l.pool.length < counts[ i ] ) {
					l.pool.push( Core.initParticle( Core.newParticle(), l.cfg, l.rnd, ref(), true ) );
				}
				if ( 'cloud' === l.cfg.type ) {
					// Far puffs first, so near ones paint over them.
					l.pool.sort( function ( a, b ) {
						return a.z - b.z;
					} );
				}
			} );
			inst.planned = [ inst.W, inst.H ];
		}

		function resizeBacking() {
			var b = Core.chooseBacking( inst.W, inst.H, window.devicePixelRatio || 1, cfg.quality, inst.level );
			// Reallocating clears the canvas, so only do it for a real change.
			if ( Math.abs( b.bw - inst.bw ) > 8 || Math.abs( b.bh - inst.bh ) > 8 || ! inst.bw ) {
				inst.bw = canvas.width = b.bw;
				inst.bh = canvas.height = b.bh;
				// Resizing clears the bitmap; refill it now, not a frame later.
				return true;
			}
			return false;
		}

		function paint() {
			if ( ! inst.bw || ! inst.W ) {
				return;
			}
			ctx.setTransform( 1, 0, 0, 1, 0, 0 );
			ctx.clearRect( 0, 0, inst.bw, inst.bh );
			ctx.setTransform( inst.bw / inst.W, 0, 0, inst.bh / inst.H, 0, 0 );
			ctx.imageSmoothingEnabled = true;
			if ( 'imageSmoothingQuality' in ctx ) {
				ctx.imageSmoothingQuality = 'low';
			}
			var r = ref();
			inst.layers.forEach( function ( l ) {
				if ( ! l ) {
					return;
				}
				var flames = 'flames' === l.cfg.type;
				ctx.globalCompositeOperation = flames ? 'lighter' : 'source-over';
				if ( flames ) {
					var gw = l.cfg.ew / 100 * inst.W * 1.6 + r * 0.1;
					ctx.globalAlpha = 0.3 * l.cfg.opacity;
					ctx.drawImage( l.glow, l.cfg.ox / 100 * inst.W - gw / 2, inst.H - gw * 0.3, gw, gw * 0.6 );
				}
				var out = l.out;
				for ( var i = 0; i < l.pool.length; i++ ) {
					Core.pose( l.pool[ i ], l.cfg, inst.W, inst.H, r, inst.t, out );
					if ( out.a < 0.01 || out.x + out.w / 2 < 0 || out.x - out.w / 2 > inst.W || out.y + out.h / 2 < 0 || out.y - out.h / 2 > inst.H ) {
						continue;
					}
					var spr = l.sprites[ 'smoke' === l.cfg.type ? out.v * 4 + out.stage : ( flames ? out.stage : out.v ) ];
					ctx.globalAlpha = out.a;
					if ( out.rot ) {
						ctx.save();
						ctx.translate( out.x, out.y );
						ctx.rotate( out.rot );
						ctx.drawImage( spr, -out.w / 2, -out.h / 2, out.w, out.h );
						ctx.restore();
					} else {
						ctx.drawImage( spr, out.x - out.w / 2, out.y - out.h / 2, out.w, out.h );
					}
				}
			} );
			ctx.globalAlpha = 1;
			ctx.globalCompositeOperation = 'source-over';
			inst.frames++;
		}

		function step( dt ) {
			dt = Math.min( dt, Core.DT_MAX );
			inst.t += dt;
			var r = ref();
			inst.layers.forEach( function ( l ) {
				if ( l ) {
					for ( var i = 0; i < l.pool.length; i++ ) {
						Core.advance( l.pool[ i ], dt, l.cfg, l.rnd, r, inst.W );
					}
				}
			} );
		}

		function setLevel( level ) {
			inst.level = level;
			if ( resizeBacking() ) {
				paint();
			}
			replan();
		}

		var client = {
			running: function () {
				return inst.visible && ! inst.still && ! document.hidden && inst.W > 0 && inst.H > 0 && ! dead;
			},
			tick: function ( now ) {
				var interval = Core.frameInterval( cfg.quality, inst.level );
				var gap = now - inst.last;
				if ( interval && gap < interval - 2 ) {
					return;
				}
				var first = ! inst.last;
				inst.last = now;
				var t0 = clock();
				step( first ? 0 : gap / 1000 );
				paint();
				var level = Core.governorStep( inst.governor, clock() - t0, first ? 0 : gap, interval || 16.7 );
				if ( level >= 0 ) {
					setLevel( level );
				}
			}
		};

		// Start or stop the shared loop to match the current conditions.
		function sync() {
			if ( dead ) {
				return;
			}
			if ( client.running() ) {
				if ( ! registered ) {
					registered = true;
					inst.last = 0;
					register( client );
				} else {
					wake();
				}
			} else if ( registered ) {
				registered = false;
				unregister( client );
			}
		}

		// A single static frame (reduced motion, or a host that is not running).
		function drawStill() {
			var saved = inst.t;
			inst.t = STILL_TIME;
			paint();
			inst.t = saved;
		}

		function measure( quiet ) {
			var w = layerEl.clientWidth;
			var h = layerEl.clientHeight;
			var changed = w !== inst.W || h !== inst.H;
			inst.W = w;
			inst.H = h;
			if ( ! changed ) {
				return;
			}
			var cleared = resizeBacking();
			var was = inst.planned;
			if ( ! was[ 0 ] || Math.abs( w - was[ 0 ] ) > was[ 0 ] * 0.15 || Math.abs( h - was[ 1 ] ) > was[ 1 ] * 0.15 ) {
				replan();
			}
			if ( quiet ) {
				return;
			}
			if ( inst.still ) {
				drawStill();
			} else if ( cleared || ! registered ) {
				paint();
			}
		}

		measure( true );
		replan();
		if ( inst.still ) {
			drawStill();
		} else {
			paint();
		}

		var raf = 0;
		if ( 'ResizeObserver' in window ) {
			var observer = new ResizeObserver( function () {
				cancelAnimationFrame( raf );
				raf = requestAnimationFrame( function () {
					measure();
					sync();
				} );
			} );
			observer.observe( host );
			cleanup.push( function () {
				observer.disconnect();
			} );
		}
		cleanup.push( function () {
			cancelAnimationFrame( raf );
		} );

		cleanup.push( Fx.watchVisible( host, function ( visible ) {
			inst.visible = visible;
			sync();
		} ) );

		var onHidden = function () {
			sync();
		};
		document.addEventListener( 'visibilitychange', onHidden );
		cleanup.push( function () {
			document.removeEventListener( 'visibilitychange', onHidden );
		} );

		cleanup.push( listen( reduceQuery, function () {
			inst.still = !! reduceQuery.matches;
			if ( inst.still ) {
				drawStill();
			}
			sync();
		} ) );

		sync();

		inst.api = {
			stats: function () {
				return {
					frames: inst.frames,
					running: registered,
					level: inst.level,
					backing: [ inst.bw, inst.bh ],
					particles: inst.layers.reduce( function ( n, l ) {
						return n + ( l ? l.pool.length : 0 );
					}, 0 ),
					still: inst.still,
					visible: inst.visible,
					canvas: canvas
				};
			},
			destroy: function () {
				if ( dead ) {
					return;
				}
				dead = true;
				if ( registered ) {
					registered = false;
					unregister( client );
				}
				cleanup.forEach( function ( fn ) {
					fn();
				} );
				canvas.width = canvas.height = 0;
				if ( layerEl.parentNode ) {
					layerEl.parentNode.removeChild( layerEl );
				}
				releaseHost();
			}
		};
		return inst.api;
	}

	window.FramifyEffects = { create: create };

	/* ---------- Elementor handler ---------- */

	function hashOf( text ) {
		var h = 2166136261;
		for ( var i = 0; i < text.length; i++ ) {
			h = Math.imul( h ^ text.charCodeAt( i ), 16777619 );
		}
		return h >>> 0;
	}

	window.addEventListener( 'elementor/frontend/init', function () {
		var Base = elementorModules.frontend.handlers.Base;

		var BackgroundEffects = Base.extend( Fx.extend( Fx.editorMixin( Base, Core.PREFIX ), {

			getConstructorID: function () {
				return 'FramifyBackgroundEffects';
			},

			onInit: function () {
				Base.prototype.onInit.apply( this, arguments );
				this.watchModel();
				this.setup();
			},

			// Density is the one responsive control: a phone can carry fewer
			// particles.
			density: function ( n ) {
				return Fx.readResponsive( this, Core.PREFIX + n + '_density', 50, 0, 100 );
			},

			// One string for all layers' densities on this device.
			densitySignature: function () {
				var self = this;
				var out = [];
				for ( var n = 1; n <= Core.LAYERS; n++ ) {
					out.push( self.density( n ) );
				}
				return out.join();
			},

			setup: function () {
				var self = this;
				var stack = Core.readStack( window.FramifyColor.settings( this ), function ( n ) {
					return self.density( n );
				} );
				if ( ! stack.layers.some( Boolean ) ) {
					return;
				}
				stack.seed = hashOf( String( this.$element.data( 'id' ) || 'framify' ) );
				var fx = this.fx = {
					engine: create( Fx.hostOf( this ), stack ),
					density: this.densitySignature(),
					cleanup: []
				};
				// An editor device switch changes the responsive density
				// without the element changing size.
				var raf = 0;
				var onResize = function () {
					cancelAnimationFrame( raf );
					raf = requestAnimationFrame( function () {
						if ( self.fx === fx && self.densitySignature() !== fx.density ) {
							self.rebuild();
						}
					} );
				};
				window.addEventListener( 'resize', onResize );
				fx.cleanup.push( function () {
					cancelAnimationFrame( raf );
					window.removeEventListener( 'resize', onResize );
				} );
			},

			teardown: function () {
				var fx = this.fx;
				if ( ! fx ) {
					return;
				}
				fx.cleanup.forEach( function ( fn ) {
					fn();
				} );
				fx.engine.destroy();
				this.fx = null;
			}
		} ) );

		// null skin: containers and sections fire
		// "frontend/element_ready/container" / ".../section".
		elementorFrontend.elementsHandler.attachHandler( 'container', BackgroundEffects, null );
		elementorFrontend.elementsHandler.attachHandler( 'section', BackgroundEffects, null );
	} );
}() );
