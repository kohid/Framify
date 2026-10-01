/**
 * Framify - Elementor Shape Divider (frontend + editor preview)
 *
 * A Top and / or Bottom divider on a top-level Container: an absolutely
 * positioned svg (viewBox 0 0 100 100, preserveAspectRatio none) at the
 * container's edge, width % centred and height px from CSS, filled with one
 * colour, pointer-events none.
 *
 * - Source: pasted SVG code or path data, or an SVG from the Media Library
 *   (fetched only when same-origin). Both go through
 *   FramifyOrganicShape.parseSvgShape (framify-elementor.js): geometry only,
 *   rebuilt as path data, transforms and the root viewBox applied; the SVG
 *   itself is never inserted.
 * - Orientation (Elementor's convention, so its users' art behaves the
 *   same): the art is drawn for the TOP edge, i.e. the side of its box that
 *   touches the container edge is the art's top. Bottom turns the whole
 *   divider round (rotate 180deg, which also mirrors it, like Elementor).
 *   Flip horizontally mirrors the svg; Upside down flips it within its
 *   strip, so the art's BOTTOM then touches the container edge.
 * - Liquid ripple: FramifyOrganicShape.traceCustom with the container-edge
 *   side pinned (art top, or art bottom when upside down) plus both ends
 *   (left / right), so the divider never opens a gap on the container edge
 *   or at its sides while the free edge moves. Loop / In view / Hover; a
 *   small rAF loop per divider. Reduced motion = the exact static shape.
 * - Stacking: z-index 0, inserted after Elementor's background children and
 *   any Floating Shapes / Text background layer, so it paints above the
 *   background, a Framify fill / deco (-1) and those layers, and below the
 *   content (tree order). Bring to front = z-index 2, as Elementor's own.
 * - Top-level only: a nested container (.e-child) is ignored; the editor
 *   script hides the section for one.
 *
 * Settings follow the Elementor module rule: published pages drop empty
 * values, so a switch is on only when 'yes' === value and a missing colour
 * is cleared (white, like Elementor's divider fill).
 *
 * File: assets/framify-divider.js
 */
( function () {
	'use strict';

	var PREFIX = 'framify_org_dv_';
	var SIDES = [ 'top', 'bottom' ];
	// Width / Height are CSS (selectors): no rebuild for them.
	var CSS_KEYS = [ PREFIX + 'top_width', PREFIX + 'top_height', PREFIX + 'bottom_width', PREFIX + 'bottom_height' ];
	var SVG_NS = 'http://www.w3.org/2000/svg';
	var DEFAULT_COLOR = '#FFFFFF';
	var TRIGGERS = { loop: 1, inview: 1, hover: 1 };
	// Full rest -> ripple -> rest cycle of the loop, and the spring of
	// hover / in view (the Organic Shape defaults).
	var LOOP_MS = 5000;
	var SPRING_MS = 1500;
	var SPRING_PERIOD = 0.45;
	var FETCH_MAX = 200000;
	// Liquid shows the traced 0-100 box minus 4 units at each end: the trace
	// is a Catmull-Rom curve through ~96 points, so where a band meets the
	// divider's ends it rounds the corners over about one point spacing
	// (a visible curl on a wide container). The ends are pinned, so what is
	// cut is still; the strip clips it (and it is off-screen anyway at a
	// Width over 100%).
	var LIQUID_VIEWBOX = '4 0 92 100';
	var AFTER = '.framify-fs, .framify-ft, .framify-dv, .framify-organic__deco, .framify-organic__fill, .framify-organic__grain';
	// One request per file per page, shared by every divider using it.
	var fetched = {};

	function svgEl( name, attrs ) {
		var el = document.createElementNS( SVG_NS, name );
		Object.keys( attrs ).forEach( function ( k ) {
			el.setAttribute( k, attrs[ k ] );
		} );
		return el;
	}

	// The absolute URL when it is on this site's origin, else null.
	function sameOrigin( url ) {
		try {
			var u = new URL( url, window.location.href );
			return u.origin === window.location.origin && /^https?:$/.test( u.protocol ) ? u.href : null;
		} catch ( e ) {
			return null;
		}
	}

	// The file's text, or '' (not found, redirected off-site, too large).
	function fetchText( url ) {
		if ( ! fetched[ url ] ) {
			fetched[ url ] = window.fetch( url, { credentials: 'same-origin' } ).then( function ( r ) {
				return r.ok && sameOrigin( r.url || url ) ? r.text() : '';
			} ).then( function ( text ) {
				return text.length > FETCH_MAX ? '' : text;
			} ).catch( function () {
				return '';
			} ).then( function ( text ) {
				if ( ! text ) {
					delete fetched[ url ];
				}
				return text;
			} );
		}
		return fetched[ url ];
	}

	// The traced paths are Catmull-Rom curves through points on the pinned
	// edge, so at the corners they overshoot a few units past it (a small
	// horn sticking out over the neighbouring section). They are M / C / Z
	// only, so their numbers alternate x, y: clamping every x into 0-100
	// and every y to the pinned side keeps each curve on the box side of
	// those lines (a cubic stays inside its control points' hull), without
	// changing the path structure the morph relies on.
	function clampTraced( d, pinBottom ) {
		var i = 0;
		return d.replace( /-?\d*\.?\d+/g, function ( n ) {
			var v = parseFloat( n );
			var clamped = 0 === i++ % 2 ? Math.min( 100, Math.max( 0, v ) ) : ( pinBottom ? Math.min( 100, v ) : Math.max( 0, v ) );
			return clamped === v ? n : clamped.toFixed( 2 );
		} );
	}

	// traceCustom joins its parts (each "M... Z") with a space.
	function splitParts( d ) {
		return d.split( /\s+(?=M)/ );
	}

	function readSide( s, side, amounts ) {
		var k = PREFIX + side + '_';
		var source = s[ k + 'source' ];
		if ( 'code' !== source && 'media' !== source ) {
			return null;
		}
		var media = s[ k + 'media' ];
		return {
			side: side,
			source: source,
			code: 'code' === source ? String( s[ k + 'svg' ] || '' ) : '',
			url: 'media' === source && media && 'object' === typeof media ? String( media.url || '' ) : '',
			color: s[ k + 'color' ] || DEFAULT_COLOR,
			flip: 'yes' === s[ k + 'flip' ],
			upside: 'yes' === s[ k + 'upside' ],
			front: 'yes' === s[ k + 'front' ],
			liquid: 'liquid' === s[ k + 'motion' ],
			trigger: TRIGGERS[ s[ k + 'trigger' ] ] ? s[ k + 'trigger' ] : 'loop',
			amount: amounts[ s[ k + 'amount' ] ] ? s[ k + 'amount' ] : 'normal'
		};
	}

	window.addEventListener( 'elementor/frontend/init', function () {
		var Shape = window.FramifyOrganicShape;
		var Fx = window.FramifyFx;
		if ( ! Shape || ! Fx ) {
			return;
		}
		var Base = elementorModules.frontend.handlers.Base;
		var reduceQuery = window.matchMedia ? window.matchMedia( '(prefers-reduced-motion: reduce)' ) : null;

		var ShapeDivider = Base.extend( Fx.extend( Fx.editorMixin( Base, PREFIX, CSS_KEYS ), {

			getConstructorID: function () {
				return 'FramifyShapeDivider';
			},

			onInit: function () {
				Base.prototype.onInit.apply( this, arguments );
				this.watchModel();
				this.setup();
			},

			setup: function () {
				var self = this;
				var el = this.$element[ 0 ];
				// Top-level containers only (Elementor sets e-child from the
				// model's isInner, in PHP and in the editor view alike).
				if ( el.classList.contains( 'e-child' ) ) {
					return;
				}
				var s = this.getElementSettings();
				var sides = SIDES.map( function ( side ) {
					return readSide( s, side, Shape.CUSTOM_AMOUNT );
				} ).filter( Boolean );
				if ( ! sides.length ) {
					return;
				}
				var fx = this.fx = { el: el, cleanup: [] };
				fx.cleanup.push( Fx.claimHost( el ) );
				sides.forEach( function ( o ) {
					if ( 'code' === o.source ) {
						self.draw( fx, o, o.code );
						return;
					}
					var url = o.url ? sameOrigin( o.url ) : null;
					if ( ! url ) {
						self.warn( o, o.url ? 'Framify: Shape Divider SVG is not on this site; not loaded.' : '' );
						return;
					}
					fetchText( url ).then( function ( text ) {
						// Torn down or rebuilt while loading.
						if ( self.fx === fx ) {
							self.draw( fx, o, text );
						}
					} );
				} );
				if ( reduceQuery && reduceQuery.addEventListener ) {
					var onPref = function () {
						self.rebuild();
					};
					reduceQuery.addEventListener( 'change', onPref );
					fx.cleanup.push( function () {
						reduceQuery.removeEventListener( 'change', onPref );
					} );
				}
			},

			// Editor only, once per side and message.
			warn: function ( o, message ) {
				var key = o.side + '|' + message;
				if ( message && elementorFrontend.isEditMode() && this.warned !== key ) {
					this.warned = key;
					window.console.warn( message );
				}
			},

			draw: function ( fx, o, text ) {
				var shape = Shape.parseSvgShape( text );
				if ( ! shape ) {
					this.warn( o, 'Framify: Shape Divider (' + o.side + ') has no usable shape.' );
					return;
				}
				var wrap = document.createElement( 'div' );
				wrap.className = 'framify-dv framify-dv--' + o.side + ( o.flip ? ' framify-dv--flip' : '' ) + ( o.upside ? ' framify-dv--upside' : '' ) + ( o.front ? ' framify-dv--front' : '' );
				wrap.setAttribute( 'aria-hidden', 'true' );
				var traced = null;
				if ( o.liquid && ! ( reduceQuery && reduceQuery.matches ) ) {
					// The container-edge side (the art's top, or its bottom
					// when upside down) and both ends stay put.
					traced = Shape.traceCustom( shape, shape.box, o.amount, [ o.upside ? 'bottom' : 'top', 'left', 'right' ] );
					if ( traced ) {
						traced = { rest: clampTraced( traced.rest, o.upside ), hover: clampTraced( traced.hover, o.upside ) };
					} else {
						this.warn( o, 'Framify: Shape Divider (' + o.side + ') could not be traced; shown static.' );
					}
				}
				// One path per source shape (static) or traced part (Liquid),
				// all in one colour: overlapping shapes never cut holes in
				// each other through opposite windings.
				var rest = traced ? splitParts( traced.rest ) : ( shape.parts || [ shape.d ] );
				var hover = traced ? splitParts( traced.hover ) : null;
				if ( hover && hover.length !== rest.length ) {
					rest = [ traced.rest ];
					hover = [ traced.hover ];
				}
				var svg = svgEl( 'svg', { viewBox: traced ? LIQUID_VIEWBOX : '0 0 100 100', preserveAspectRatio: 'none', focusable: 'false' } );
				var paths = rest.map( function ( d ) {
					var path = svgEl( 'path', { d: d } );
					if ( ! traced ) {
						path.setAttribute( 'transform', Shape.customTransform( shape.box ) );
					}
					// A CSS value only: an invalid colour is simply ignored.
					path.style.fill = o.color;
					svg.appendChild( path );
					return path;
				} );
				wrap.appendChild( svg );

				Fx.insertLayer( fx.el, wrap, false, AFTER );
				fx.cleanup.push( function () {
					wrap.remove();
				} );
				if ( traced ) {
					this.move( fx, o.trigger, paths, rest.map( Shape.parsePath ), hover.map( Shape.parsePath ) );
				}
			},

			// One divider's motion: value 0 = rest, 1 = full ripple.
			move: function ( fx, trigger, paths, rest, hover ) {
				var el = fx.el;
				var st = { value: 0, raf: 0 };
				var render = function () {
					for ( var i = 0; i < paths.length; i++ ) {
						paths[ i ].setAttribute( 'd', Shape.blendPath( rest[ i ], hover[ i ], st.value ) );
					}
				};
				var spring = Shape.elastic( SPRING_PERIOD );
				var animate = function ( target ) {
					var from = st.value;
					var start = null;
					cancelAnimationFrame( st.raf );
					var step = function ( now ) {
						if ( null === start ) {
							start = now;
						}
						var t = Math.min( 1, ( now - start ) / SPRING_MS );
						st.value = from + ( target - from ) * spring( t );
						render();
						st.raf = t < 1 ? requestAnimationFrame( step ) : 0;
					};
					st.raf = requestAnimationFrame( step );
				};
				fx.cleanup.push( function () {
					cancelAnimationFrame( st.raf );
				} );

				if ( 'hover' === trigger ) {
					var enter = function () {
						animate( 1 );
					};
					var leave = function () {
						animate( 0 );
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
				if ( 'inview' === trigger ) {
					var once = new IntersectionObserver( function ( entries ) {
						if ( entries[ entries.length - 1 ].isIntersecting ) {
							once.disconnect();
							animate( 1 );
						}
					}, { threshold: 0.35 } );
					once.observe( el );
					fx.cleanup.push( function () {
						once.disconnect();
					} );
					return;
				}
				// Loop: a smooth swing between rest and ripple while on screen;
				// the phase is kept across pauses so it resumes where it was.
				var phase = 0;
				var last = null;
				var tick = function ( now ) {
					phase += null === last ? 0 : Math.min( 100, now - last );
					last = now;
					st.value = 0.5 - 0.5 * Math.cos( 2 * Math.PI * phase / LOOP_MS );
					render();
					st.raf = requestAnimationFrame( tick );
				};
				fx.cleanup.push( Fx.watchVisible( el, function ( visible ) {
					cancelAnimationFrame( st.raf );
					last = null;
					st.raf = visible ? requestAnimationFrame( tick ) : 0;
				} ) );
			},

			teardown: function () {
				var fx = this.fx;
				if ( ! fx ) {
					return;
				}
				this.fx = null;
				fx.cleanup.forEach( function ( fn ) {
					fn();
				} );
			}
		} ) );

		// null skin: containers fire "frontend/element_ready/container".
		elementorFrontend.elementsHandler.attachHandler( 'container', ShapeDivider, null );
	} );
}() );
