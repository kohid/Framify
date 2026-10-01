/**
 * Framify - Elementor Floating Shapes (frontend + editor preview)
 *
 * Builds a layer of small inline SVG shapes (including a pointy-top
 * hexagon) inside a Container or legacy Section and lets CSS drift them
 * across it (assets/framify-shapes.css).
 * Each shape gets its own random numbers as custom properties; the script
 * only builds, measures and re-rolls, it never animates frame by frame.
 *
 * - Depth: each shape draws one depth value that sets its size, opacity and
 *   speed together (near = bigger, brighter, a little faster), so the field
 *   reads as layered instead of as random noise.
 * - The field starts full (negative delays) and never visibly repeats: at
 *   the end of every pass, while the shape is invisible, it gets a new lane,
 *   type, style and colour.
 * - Paused off-screen; a still scatter for prefers-reduced-motion.
 * - Settings reach the page only as data: colours via setAttribute, shapes
 *   drawn with createElementNS, no markup from settings is ever parsed.
 * - A missing setting means empty, not default (see the settings note
 *   below): switches are on only when 'yes', a missing colour is cleared.
 * - Also publishes window.FramifyFx, the helpers Floating Text
 *   (assets/framify-text.js) shares with this module.
 *
 * File: assets/framify-shapes.js
 */
( function () {
	'use strict';

	var SVG_NS = 'http://www.w3.org/2000/svg';
	var PREFIX = 'framify_fs_';
	var MAX_COUNT = 60;
	var ALL_SHAPES = [ 'square', 'circle', 'triangle', 'star', 'diagonal', 'plus', 'x', 'hexagon' ];
	var DIRECTIONS = [ 'up', 'down', 'left', 'right' ];
	// Seconds for one pass across the band, before the per-shape spread.
	// 'custom' has no fixed entry here: it reads a responsive duration
	// control instead (see readDuration()).
	var SPEED = { slow: 20, normal: 12, fast: 7 };
	// Used only when every palette slot is empty, so the layer never draws
	// invisible shapes.
	var FALLBACK_COLOR = '#F69216';
	// Leading children that are Elementor's own background layers (and the
	// editor's handles); the background layer goes after them so it paints
	// above a background overlay. See the stacking note in the CSS.
	var BACKGROUND_CHILD = '.elementor-element-overlay, .elementor-background-overlay, .elementor-background-video-container, .elementor-background-slideshow, .elementor-motion-effects-container';

	/* ---------- shared helpers (window.FramifyFx) ----------
	 *
	 * The pieces Floating Shapes and Floating Text genuinely share: settings
	 * readers, the palette / random-hue colour, the responsive slider reader,
	 * the host + layer mounting that decides stacking, the off-screen
	 * observer and the editor sync (panel changes + settings model). Exposed
	 * on window so assets/framify-text.js (which depends on this script's
	 * handle) reuses them instead of carrying a second copy that could drift.
	 */

	// How settings arrive: published pages get Elementor's
	// get_frontend_settings(), which KEEPS control defaults but DROPS any
	// null or '' value; the editor sends the model's values, with '' for an
	// off switch or a cleared colour. So a missing key means "empty", never
	// "default": switches are on only when 'yes' === value, and a missing
	// colour is a cleared one. Fallbacks below are only for selects and
	// sliders, whose defaults are non-empty and so always present anyway.
	function pick( s, key, def ) {
		var v = s[ key ];
		return undefined === v || null === v || '' === v ? def : v;
	}

	function size( s, key, def ) {
		var v = s[ key ];
		var n = v && '' !== v.size ? parseFloat( v.size ) : NaN;
		return isNaN( n ) ? def : n;
	}

	function clamp( n, lo, hi ) {
		return Math.min( hi, Math.max( lo, n ) );
	}

	function rand( lo, hi ) {
		return lo + Math.random() * ( hi - lo );
	}

	function any( list ) {
		return list[ Math.floor( Math.random() * list.length ) ];
	}

	// Palette / random-hue colours for any module using the colour_mode,
	// color_1..5, saturation and lightness controls under its prefix.
	// A missing slot is an empty slot: published data-settings keep defaults
	// but drop '' values, so a missing colour is one the user cleared (the
	// editor sends '' for it). Falling back to the slot's default here would
	// bring a cleared colour back on the live page only. Global Colours are
	// disabled on these controls, so there is no __globals__ to resolve.
	function readColors( s, prefix ) {
		var colors = [];
		for ( var i = 1; i <= 5; i++ ) {
			var c = s[ prefix + 'color_' + i ];
			if ( 'string' === typeof c && c ) {
				colors.push( c );
			}
		}
		return {
			random: 'random' === s[ prefix + 'color_mode' ],
			colors: colors.length ? colors : [ FALLBACK_COLOR ],
			saturation: clamp( size( s, prefix + 'saturation', 70 ), 0, 100 ),
			lightness: clamp( size( s, prefix + 'lightness', 60 ), 0, 100 )
		};
	}

	function pickColor( o ) {
		if ( o.random ) {
			return 'hsl(' + Math.floor( Math.random() * 360 ) + ', ' + o.saturation + '%, ' + o.lightness + '%)';
		}
		return any( o.colors );
	}

	// A responsive slider for the current device. getCurrentDeviceSetting
	// walks up the breakpoints, but a device the user never touched can
	// still hold an empty slider object, which it accepts as a value; in that
	// case walk up ourselves, ending at desktop and then the default.
	function readResponsive( handler, key, def, lo, hi ) {
		var s = handler.getElementSettings();
		var n = NaN;
		try {
			var v = handler.getCurrentDeviceSetting( key );
			n = v && '' !== v.size ? parseFloat( v.size ) : NaN;
			if ( isNaN( n ) && elementorFrontend.breakpoints ) {
				var devices = elementorFrontend.breakpoints.getActiveBreakpointsList( { largeToSmall: true, withDesktop: true } );
				for ( var i = devices.indexOf( elementorFrontend.getCurrentDeviceMode() ); i > 0 && isNaN( n ); i-- ) {
					n = size( s, key + '_' + devices[ i ], NaN );
				}
			}
		} catch ( e ) {
			n = NaN;
		}
		if ( isNaN( n ) ) {
			n = size( s, key, def );
		}
		return clamp( n, lo, hi );
	}

	// Positioning context + isolation for the host, shared by every Framify
	// layer on the element and reference-counted, so removing one layer
	// never strips the position another layer still relies on. Returns the
	// release function.
	function claimHost( el ) {
		var h = el.framifyFxHost;
		if ( ! h ) {
			h = el.framifyFxHost = { n: 0, relative: 'static' === window.getComputedStyle( el ).position };
			if ( h.relative ) {
				el.style.position = 'relative';
			}
			el.classList.add( 'framify-fs-host' );
		}
		h.n++;
		var released = false;
		return function () {
			if ( released ) {
				return;
			}
			released = true;
			if ( --h.n > 0 ) {
				return;
			}
			el.classList.remove( 'framify-fs-host' );
			if ( h.relative ) {
				el.style.position = '';
			}
			el.framifyFxHost = null;
		};
	}

	// The element a handler's layer lives in. Containers and Sections: the
	// element itself. Spacer: the element that paints its Advanced >
	// Background, the direct .elementor-widget-container child ("common"
	// controls), or the widget element itself when Optimized Markup drops
	// that wrapper ("common-optimized"). Same rule as paintHost() in
	// framify-elementor.js, so Organic Shape and these layers share a host.
	function hostOf( handler ) {
		var el = handler.$element[ 0 ];
		if ( 'spacer' !== handler.getWidgetType() ) {
			return el;
		}
		for ( var c = el.firstElementChild; c; c = c.nextElementSibling ) {
			if ( c.classList.contains( 'elementor-widget-container' ) ) {
				return c;
			}
		}
		return el;
	}

	// Overlay layers go last. Background layers go after Elementor's own
	// background children (see the stacking note in the CSS) and after any
	// extra leading children named by `after`, so a later layer can sit
	// above an earlier one in tree order while staying below the content.
	function insertLayer( el, layer, overlay, after ) {
		if ( overlay ) {
			el.appendChild( layer );
			return;
		}
		var skip = BACKGROUND_CHILD + ( after ? ', ' + after : '' );
		var before = el.firstElementChild;
		while ( before && before.matches( skip ) ) {
			before = before.nextElementSibling;
		}
		el.insertBefore( layer, before );
	}

	/* ---------- Image widget: the photo frame ----------
	 *
	 * On the Image widget a layer covering the whole widget would put shapes
	 * and words around a narrow centred photo too, so each layer goes into a
	 * frame matching the img's offset box instead (left / top / width /
	 * height in px within the widget, re-measured on a resize of the widget
	 * or the img, the img's load (lazy-load, srcset swap) and a window
	 * resize, which also covers an editor device switch).
	 *
	 * Stacking inside the widget (isolated by claimHost): Organic Shape's
	 * deco blob (z-index 0, first child) < the Behind frame (z-index 0,
	 * inserted after the deco and Elementor's overlay, so later in tree
	 * order) < the img (z-index 1; .framify-fx-photo makes it positioned
	 * even without Organic Shape) < the image grain layer (2) < the Over
	 * frame (3). The layers keep their own classes inside a frame, so text
	 * still paints above shapes (tree order behind, 6 vs 5 over).
	 *
	 * Over frame and Organic Shape: the frame copies the img's inline
	 * clip-path, transform and transform-origin. The objectBoundingBox clip
	 * resolves against the frame's box, which IS the img's box, so the frame
	 * is cut to the very same moving shape (inset included) and zooms with
	 * the photo; without a clip on the img it is the plain photo rectangle.
	 * The copy runs when framify-elementor.js calls el.framifyFxPhoto.sync(),
	 * after every Organic render() and teardown, so a rebuild's new clip id
	 * and a toggle off are picked up at once, with no polling loop.
	 *
	 * Frames are shared (reference-counted) by Floating Shapes and Floating
	 * Text: one Behind and one Over frame per widget at most. photoFrame()
	 * returns { el, release } or null when the handler is not on an Image
	 * widget (or it has no img), in which case the caller keeps hostOf().
	 */
	var PHOTO_AFTER = '.framify-organic__deco';

	// node's offset box position inside host, summing the offsetParent
	// chain (an offset box ignores transforms, so the img's zoom never moves
	// the frame). null when host is not in the chain (e.g. display none).
	function offsetIn( node, host ) {
		var x = 0;
		var y = 0;
		var n = node;
		while ( n && n !== host ) {
			x += n.offsetLeft;
			y += n.offsetTop;
			n = n.offsetParent;
			if ( n && n !== host ) {
				x += n.clientLeft;
				y += n.clientTop;
			}
		}
		return n ? { x: x, y: y } : null;
	}

	function photoState( host ) {
		var st = { n: 0, img: null, frames: {}, raf: 0 };
		var observer = 'ResizeObserver' in window ? new ResizeObserver( function () {
			st.schedule();
		} ) : null;
		var onChange = function () {
			st.schedule();
		};
		st.releaseHost = claimHost( host );
		host.classList.add( 'framify-fx-photo' );

		st.schedule = function () {
			cancelAnimationFrame( st.raf );
			st.raf = requestAnimationFrame( st.measure );
		};

		// Also swaps the observed img when the widget re-rendered its markup.
		st.measure = function () {
			var img = host.querySelector( 'img' );
			if ( img !== st.img ) {
				if ( st.img ) {
					st.img.removeEventListener( 'load', onChange );
					if ( observer ) {
						observer.unobserve( st.img );
					}
				}
				st.img = img;
				if ( img ) {
					img.addEventListener( 'load', onChange );
					if ( observer ) {
						observer.observe( img );
					}
				}
			}
			var at = img ? offsetIn( img, host ) : null;
			if ( ! at ) {
				return;
			}
			Object.keys( st.frames ).forEach( function ( k ) {
				var fs = st.frames[ k ].node.style;
				fs.left = at.x + 'px';
				fs.top = at.y + 'px';
				fs.width = img.offsetWidth + 'px';
				fs.height = img.offsetHeight + 'px';
			} );
			st.sync();
		};

		// Called by the Organic Shape handler on every render: only string
		// copies, and only when they differ.
		st.sync = function () {
			var f = st.frames.over;
			if ( ! f ) {
				return;
			}
			if ( ! st.img || ! st.img.isConnected ) {
				st.measure();
				return;
			}
			var from = st.img.style;
			var to = f.node.style;
			var clip = from.clipPath || from.webkitClipPath || '';
			if ( to.clipPath !== clip ) {
				to.clipPath = clip;
				to.webkitClipPath = clip;
			}
			if ( to.transform !== from.transform ) {
				to.transform = from.transform;
			}
			if ( to.transformOrigin !== from.transformOrigin ) {
				to.transformOrigin = from.transformOrigin;
			}
		};

		st.stop = function () {
			cancelAnimationFrame( st.raf );
			if ( observer ) {
				observer.disconnect();
			}
			if ( st.img ) {
				st.img.removeEventListener( 'load', onChange );
			}
			window.removeEventListener( 'resize', onChange );
			host.classList.remove( 'framify-fx-photo' );
			st.releaseHost();
		};

		if ( observer ) {
			observer.observe( host );
		}
		window.addEventListener( 'resize', onChange );
		return st;
	}

	function photoFrame( handler, over ) {
		if ( 'image' !== handler.getWidgetType() ) {
			return null;
		}
		var host = handler.$element[ 0 ];
		if ( ! host.querySelector( 'img' ) ) {
			return null;
		}
		var st = host.framifyFxPhoto;
		if ( ! st ) {
			st = host.framifyFxPhoto = photoState( host );
		}
		var mode = over ? 'over' : 'behind';
		var f = st.frames[ mode ];
		if ( ! f ) {
			var node = document.createElement( 'div' );
			node.className = 'framify-fx-frame framify-fx-frame--' + mode;
			node.setAttribute( 'aria-hidden', 'true' );
			f = st.frames[ mode ] = { node: node, n: 0 };
		}
		// (Re)insert: an editor re-render can drop a frame that is still
		// referenced.
		if ( f.node.parentNode !== host ) {
			if ( over ) {
				host.appendChild( f.node );
			} else {
				insertLayer( host, f.node, false, PHOTO_AFTER );
			}
		}
		f.n++;
		st.n++;
		st.measure();
		var released = false;
		return {
			el: f.node,
			release: function () {
				if ( released ) {
					return;
				}
				released = true;
				if ( --f.n <= 0 ) {
					f.node.remove();
					delete st.frames[ mode ];
				}
				if ( --st.n <= 0 ) {
					st.stop();
					host.framifyFxPhoto = null;
				}
			}
		};
	}

	// Calls onChange( visible ) as the element enters / leaves the viewport.
	// Returns the cleanup function (a no-op without IntersectionObserver).
	function watchVisible( el, onChange ) {
		if ( ! ( 'IntersectionObserver' in window ) ) {
			return function () {};
		}
		var observer = new IntersectionObserver( function ( entries ) {
			onChange( entries[ entries.length - 1 ].isIntersecting );
		} );
		observer.observe( el );
		return function () {
			observer.disconnect();
		};
	}

	// Editor sync shared by the handlers: a debounced rebuild on panel
	// changes (onElementChange) AND on the element's settings model, since
	// undo/redo and $e settings commands change the model without a control
	// view and, with render_type none, without a re-render. `ignore` skips
	// prefixed keys that need no rebuild (CSS-only controls such as
	// typography): one key prefix or a list of them. A change to such a key
	// calls the handler's optional onStyleChange( key ) instead. The
	// handler provides setup() / teardown().
	function editorMixin( Base, prefix, ignore ) {
		var skip = ignore ? [].concat( ignore ) : [];
		function ignored( key ) {
			for ( var i = 0; i < skip.length; i++ ) {
				if ( 0 === key.indexOf( skip[ i ] ) ) {
					return true;
				}
			}
			return false;
		}
		function wants( key ) {
			return 0 === key.indexOf( prefix ) && ! ignored( key );
		}
		return {
			onElementChange: function ( name ) {
				if ( wants( name ) ) {
					this.scheduleRebuild();
				} else if ( ignored( name ) && this.onStyleChange ) {
					this.onStyleChange( name );
				}
			},

			// Sliders fire on every drag step; rebuild once they settle.
			scheduleRebuild: function () {
				var self = this;
				clearTimeout( this.rebuildTimer );
				this.rebuildTimer = setTimeout( function () {
					self.rebuild();
				}, 120 );
			},

			watchModel: function () {
				var model = this.isEdit && elementorFrontend.config.elements.data[ this.getModelCID() ];
				if ( ! model || ! model.on ) {
					return;
				}
				var self = this;
				this.modelListener = function ( changed ) {
					// A re-render replaces the element without always
					// destroying this handler; let a stale one drop out.
					if ( ! self.$element[ 0 ].isConnected ) {
						model.off( 'change', self.modelListener );
						self.teardown();
						return;
					}
					var keys = Object.keys( ( changed && changed.changed ) || {} );
					var style = '';
					for ( var i = 0; i < keys.length; i++ ) {
						if ( wants( keys[ i ] ) ) {
							self.scheduleRebuild();
							return;
						}
						if ( ! style && ignored( keys[ i ] ) ) {
							style = keys[ i ];
						}
					}
					if ( style && self.onStyleChange ) {
						self.onStyleChange( style );
					}
				};
				this.fxModel = model;
				model.on( 'change', this.modelListener );
			},

			onDestroy: function () {
				clearTimeout( this.rebuildTimer );
				if ( this.fxModel ) {
					this.fxModel.off( 'change', this.modelListener );
					this.fxModel = null;
				}
				this.teardown();
				Base.prototype.onDestroy.apply( this, arguments );
			},

			rebuild: function () {
				clearTimeout( this.rebuildTimer );
				this.teardown();
				this.setup();
			}
		};
	}

	function extend( target, source ) {
		Object.keys( source ).forEach( function ( k ) {
			target[ k ] = source[ k ];
		} );
		return target;
	}

	window.FramifyFx = {
		BACKGROUND_CHILD: BACKGROUND_CHILD,
		pick: pick,
		size: size,
		clamp: clamp,
		rand: rand,
		any: any,
		readColors: readColors,
		pickColor: pickColor,
		readResponsive: readResponsive,
		claimHost: claimHost,
		hostOf: hostOf,
		insertLayer: insertLayer,
		photoFrame: photoFrame,
		watchVisible: watchVisible,
		editorMixin: editorMixin,
		extend: extend
	};

	/* ---------- settings ---------- */

	function readOptions( s, customDuration ) {
		var shapes = s[ PREFIX + 'shapes' ];
		shapes = Array.isArray( shapes ) ? shapes.filter( function ( t ) {
			return -1 !== ALL_SHAPES.indexOf( t );
		} ) : [];
		var colors = readColors( s, PREFIX );
		var style = pick( s, PREFIX + 'style', 'mix' );
		var direction = pick( s, PREFIX + 'direction', 'up' );
		var area = pick( s, PREFIX + 'area', 'full' );
		return {
			layer: 'overlay' === s[ PREFIX + 'layer' ] ? 'overlay' : 'background',
			shapes: shapes.length ? shapes : ALL_SHAPES,
			style: -1 !== [ 'mix', 'solid', 'outline' ].indexOf( style ) ? style : 'mix',
			stroke: clamp( size( s, PREFIX + 'stroke', 2 ), 1, 8 ),
			random: colors.random,
			colors: colors.colors,
			saturation: colors.saturation,
			lightness: colors.lightness,
			area: -1 !== [ 'left', 'right' ].indexOf( area ) ? area : 'full',
			areaWidth: clamp( size( s, PREFIX + 'area_width', 35 ), 10, 90 ),
			maxSize: clamp( size( s, PREFIX + 'size', 48 ), 8, 200 ),
			opacity: clamp( size( s, PREFIX + 'opacity', 0.8 ), 0.1, 1 ),
			direction: -1 !== DIRECTIONS.indexOf( direction ) || 'random' === direction ? direction : 'up',
			// Custom reads the responsive duration the caller resolved
			// (readDuration(), same fallback chain as readCount()); every
			// other speed keeps its fixed constant.
			speed: 'custom' === s[ PREFIX + 'speed' ] ? clamp( customDuration || 12, 2, 60 ) : ( SPEED[ s[ PREFIX + 'speed' ] ] || SPEED.normal ),
			// Switcher: off is '' in the editor and missing on published
			// pages, so only an explicit 'yes' is on.
			spin: 'yes' === s[ PREFIX + 'spin' ]
		};
	}

	/* ---------- drawing (0-100 box, padded so strokes don't clip) ---------- */

	function svgEl( name, attrs ) {
		var el = document.createElementNS( SVG_NS, name );
		Object.keys( attrs ).forEach( function ( k ) {
			el.setAttribute( k, attrs[ k ] );
		} );
		return el;
	}

	function points( list ) {
		return list.map( function ( p ) {
			return p[ 0 ].toFixed( 2 ) + ',' + p[ 1 ].toFixed( 2 );
		} ).join( ' ' );
	}

	// 5-point star centred a touch low: its visual weight sits in the lower
	// arms, so this keeps it balanced while it spins about the box centre.
	var STAR = ( function () {
		var pts = [];
		for ( var i = 0; i < 10; i++ ) {
			var r = i % 2 ? 18 : 42;
			var a = -Math.PI / 2 + i * Math.PI / 5;
			pts.push( [ 50 + r * Math.cos( a ), 53 + r * Math.sin( a ) ] );
		}
		return points( pts );
	}() );

	// Equilateral, centroid near the box centre so it spins without wobble.
	var TRIANGLE = points( [ [ 50, 11 ], [ 88, 76.8 ], [ 12, 76.8 ] ] );

	// A plus with 20-unit arms; X is the same polygon turned 45 degrees.
	var CROSS = points( [
		[ 40, 14 ], [ 60, 14 ], [ 60, 40 ], [ 86, 40 ], [ 86, 60 ], [ 60, 60 ],
		[ 60, 86 ], [ 40, 86 ], [ 40, 60 ], [ 14, 60 ], [ 14, 40 ], [ 40, 40 ]
	] );

	// A unit vector from "from" toward "to"; falls back to (1,0) so a
	// degenerate pair never divides by zero.
	function unit( to, from ) {
		var dx = to[ 0 ] - from[ 0 ], dy = to[ 1 ] - from[ 1 ];
		var len = Math.sqrt( dx * dx + dy * dy ) || 1;
		return [ dx / len, dy / len ];
	}

	function fmt( p ) {
		return p[ 0 ].toFixed( 2 ) + ' ' + p[ 1 ].toFixed( 2 );
	}

	// Corners very slightly rounded (a small quadratic curve through each
	// original vertex), the same softened feel as the square's rx=6 corners:
	// cut each edge back by a fixed amount and bow through the true corner.
	function roundedPolygon( pts, t ) {
		var n = pts.length;
		var d = '';
		for ( var i = 0; i < n; i++ ) {
			var curr = pts[ i ];
			var prev = pts[ ( i - 1 + n ) % n ];
			var next = pts[ ( i + 1 ) % n ];
			var p1 = [ curr[ 0 ] + unit( prev, curr )[ 0 ] * t, curr[ 1 ] + unit( prev, curr )[ 1 ] * t ];
			var p2 = [ curr[ 0 ] + unit( next, curr )[ 0 ] * t, curr[ 1 ] + unit( next, curr )[ 1 ] * t ];
			d += ( 0 === i ? 'M' : ' L' ) + fmt( p1 ) + ' Q' + fmt( curr ) + ' ' + fmt( p2 );
		}
		return d + ' Z';
	}

	// Regular pointy-top hexagon, centred, radius 38 (same padding as the
	// circle: 12 to 88 vertically). Vertices at -90/-30/30/90/150/210 deg
	// put a point at the top and bottom, flats on the left/right.
	var HEXAGON = ( function () {
		var pts = [];
		for ( var i = 0; i < 6; i++ ) {
			var a = -Math.PI / 2 + i * Math.PI / 3;
			pts.push( [ 50 + 38 * Math.cos( a ), 50 + 38 * Math.sin( a ) ] );
		}
		return roundedPolygon( pts, 6 );
	}() );

	function lines( pairs, paint ) {
		var g = svgEl( 'g', paint );
		pairs.forEach( function ( p ) {
			g.appendChild( svgEl( 'line', { x1: p[ 0 ], y1: p[ 1 ], x2: p[ 2 ], y2: p[ 3 ] } ) );
		} );
		return g;
	}

	// Outlines use non-scaling strokes, so "Outline width" is real pixels at
	// every shape size and stays crisp.
	function drawShape( type, solid, color, o ) {
		var fill = { fill: color };
		var stroke = {
			fill: 'none',
			stroke: color,
			'stroke-width': o.stroke,
			'stroke-linecap': 'round',
			'stroke-linejoin': 'round',
			'vector-effect': 'non-scaling-stroke'
		};
		var paint = solid ? fill : stroke;
		var shape;
		switch ( type ) {
			case 'circle':
				shape = svgEl( 'circle', { cx: 50, cy: 50, r: 38 } );
				break;
			case 'triangle':
				shape = svgEl( 'polygon', { points: TRIANGLE } );
				break;
			case 'star':
				shape = svgEl( 'polygon', { points: STAR } );
				break;
			case 'diagonal':
				// A line has no fill: "solid" is a bold stroke instead.
				stroke[ 'stroke-width' ] = solid ? Math.max( o.stroke * 2, 6 ) : o.stroke;
				return lines( [ [ 20, 80, 80, 20 ] ], stroke );
			case 'plus':
			case 'x':
				if ( solid ) {
					shape = svgEl( 'polygon', { points: CROSS } );
				} else {
					var g = lines( [ [ 50, 16, 50, 84 ], [ 16, 50, 84, 50 ] ], stroke );
					if ( 'x' === type ) {
						g.setAttribute( 'transform', 'rotate(45 50 50)' );
					}
					return g;
				}
				if ( 'x' === type ) {
					shape.setAttribute( 'transform', 'rotate(45 50 50)' );
				}
				break;
			case 'hexagon':
				shape = svgEl( 'path', { d: HEXAGON } );
				break;
			default:
				shape = svgEl( 'rect', { x: 14, y: 14, width: 72, height: 72, rx: 6 } );
		}
		Object.keys( paint ).forEach( function ( k ) {
			shape.setAttribute( k, paint[ k ] );
		} );
		return shape;
	}

	function pickSolid( o ) {
		return 'solid' === o.style || ( 'mix' === o.style && Math.random() < 0.5 );
	}

	/* ---------- one shape ---------- */

	// Draw type, style and colour into the shape's svg (replacing any old one).
	function paint( item, o ) {
		var svg = item.svg;
		while ( svg.firstChild ) {
			svg.removeChild( svg.firstChild );
		}
		item.type = any( o.shapes );
		svg.appendChild( drawShape( item.type, pickSolid( o ), pickColor( o ), o ) );
		svg.setAttribute( 'data-shape', item.type );
		if ( o.spin ) {
			item.el.style.setProperty( '--fs-r0', Math.round( rand( 0, 360 ) ) + 'deg' );
		}
	}

	// Choose a lane and write where the pass starts and how far it travels.
	// Travel = band size + shape size, from just outside one edge to just
	// outside the other, read from the wrapper's --fs-w / --fs-h so a resize
	// only has to update two numbers on the wrapper.
	function route( item, o ) {
		var st = item.el.style;
		var px = item.size;
		var dir = 'random' === o.direction ? any( DIRECTIONS ) : o.direction;
		var lane = rand( 0, 100 ).toFixed( 2 ) + '%';
		var half = ( -px / 2 ) + 'px';
		var sway = rand( 6, 18 ).toFixed( 1 ) + 'px';
		var vertical = 'up' === dir || 'down' === dir;
		st.left = vertical ? lane : ( 'left' === dir ? '100%' : -px + 'px' );
		st.top = vertical ? ( 'up' === dir ? '100%' : -px + 'px' ) : lane;
		st.marginLeft = vertical ? half : '0px';
		st.marginTop = vertical ? '0px' : half;
		st.setProperty( '--fs-dx', vertical ? '0px' : 'calc(' + ( 'left' === dir ? -1 : 1 ) + 'px * (var(--fs-w) + ' + px + '))' );
		st.setProperty( '--fs-dy', vertical ? 'calc(' + ( 'up' === dir ? -1 : 1 ) + 'px * (var(--fs-h) + ' + px + '))' : '0px' );
		// Sway runs across the drift, never along it.
		st.setProperty( '--fs-sx', vertical ? sway : '0px' );
		st.setProperty( '--fs-sy', vertical ? '0px' : sway );
	}

	function makeItem( o, still ) {
		// Depth 0 = far (small, faint, slow), 1 = near. Squared so most
		// shapes sit in the background and only a few come close.
		var depth = Math.pow( Math.random(), 1.6 );
		var el = document.createElement( 'div' );
		var sway = document.createElement( 'div' );
		var svg = document.createElementNS( SVG_NS, 'svg' );
		el.className = 'framify-fs__shape';
		sway.className = 'framify-fs__sway';
		svg.setAttribute( 'viewBox', '0 0 100 100' );
		svg.setAttribute( 'focusable', 'false' );
		sway.appendChild( svg );
		el.appendChild( sway );

		var item = { el: el, svg: svg, size: Math.round( o.maxSize * ( 0.4 + 0.6 * depth ) ) };
		var opacity = o.opacity * ( 0.55 + 0.45 * depth );
		el.style.width = item.size + 'px';
		el.style.height = item.size + 'px';
		paint( item, o );

		if ( still ) {
			el.style.left = rand( 0, 100 ).toFixed( 2 ) + '%';
			el.style.top = rand( 0, 100 ).toFixed( 2 ) + '%';
			el.style.margin = ( -item.size / 2 ) + 'px 0 0 ' + ( -item.size / 2 ) + 'px';
			el.style.opacity = ( opacity * rand( 0.5, 1 ) ).toFixed( 3 );
			return item;
		}

		// Near shapes pass a little faster; the jitter keeps equal depths apart.
		// Together they stay within about +-40% of the base speed.
		var dur = o.speed * ( 1.3 - 0.5 * depth ) * rand( 0.85, 1.1 );
		var swayDur = rand( 3.5, 6.5 );
		el.style.setProperty( '--fs-o', opacity.toFixed( 3 ) );
		el.style.setProperty( '--fs-dur', dur.toFixed( 2 ) + 's' );
		el.style.setProperty( '--fs-delay', ( -rand( 0, dur ) ).toFixed( 2 ) + 's' );
		el.style.setProperty( '--fs-sd', swayDur.toFixed( 2 ) + 's' );
		el.style.setProperty( '--fs-sdelay', ( -rand( 0, swayDur ) ).toFixed( 2 ) + 's' );
		el.style.setProperty( '--fs-rot', o.spin ? Math.round( rand( 60, 200 ) * ( Math.random() < 0.5 ? -1 : 1 ) ) + 'deg' : '0deg' );
		route( item, o );
		return item;
	}

	/* ---------- Elementor handler ---------- */

	window.addEventListener( 'elementor/frontend/init', function () {
		var Base = elementorModules.frontend.handlers.Base;
		var reduceQuery = window.matchMedia ? window.matchMedia( '(prefers-reduced-motion: reduce)' ) : null;

		var FloatingShapes = Base.extend( extend( editorMixin( Base, PREFIX ), {

			// Explicit ID so this handler and FramifyOrganicShape can share
			// one container in the editor without colliding.
			getConstructorID: function () {
				return 'FramifyFloatingShapes';
			},

			onInit: function () {
				Base.prototype.onInit.apply( this, arguments );
				this.watchModel();
				this.setup();
			},

			// Count for the current device (see readResponsive()).
			readCount: function () {
				return Math.round( readResponsive( this, PREFIX + 'count', 18, 1, MAX_COUNT ) );
			},

			// Duration for the current device, only read when Speed is
			// Custom. Same fallback chain as readCount().
			readDuration: function () {
				return readResponsive( this, PREFIX + 'duration', 12, 2, 60 );
			},

			setup: function () {
				var s = this.getElementSettings();
				if ( 'yes' !== s[ PREFIX + 'enable' ] ) {
					return;
				}
				var self = this;
				var speedCustom = 'custom' === s[ PREFIX + 'speed' ];
				var duration = speedCustom ? this.readDuration() : null;
				var o = readOptions( s, duration );
				var el = hostOf( this );
				// Image widget: the layer lives in a frame over the photo's
				// box, so it is measured against the photo, not the widget.
				var frame = photoFrame( this, 'overlay' === o.layer );
				if ( frame ) {
					el = frame.el;
				}
				var still = !! ( reduceQuery && reduceQuery.matches );
				var count = this.readCount();
				var fx = this.fx = { el: el, count: count, speedCustom: speedCustom, duration: duration, cleanup: [] };

				var layer = document.createElement( 'div' );
				layer.className = 'framify-fs framify-fs--' + o.layer +
					( 'full' !== o.area ? ' framify-fs--' + o.area : '' ) +
					( o.spin ? '' : ' framify-fs--nospin' ) +
					( still ? ' framify-fs--still' : '' );
				layer.setAttribute( 'aria-hidden', 'true' );
				if ( 'full' !== o.area ) {
					layer.style.width = o.areaWidth + '%';
				}
				fx.layer = layer;

				// Positioning context only when the element has none; the
				// host class adds the isolation that keeps z-index local.
				var releaseHost = claimHost( el );
				insertLayer( el, layer, 'overlay' === o.layer );

				var items = [];
				for ( var i = 0; i < count; i++ ) {
					var item = makeItem( o, still );
					items.push( item );
					layer.appendChild( item.el );
				}

				fx.cleanup.push( function () {
					layer.remove();
					releaseHost();
					if ( frame ) {
						frame.release();
					}
				} );

				this.measure();

				// Re-roll a shape at the end of each pass, while it is invisible.
				if ( ! still ) {
					var onIteration = function ( e ) {
						if ( 'framify-fs-drift' !== e.animationName ) {
							return;
						}
						for ( var j = 0; j < items.length; j++ ) {
							if ( items[ j ].el === e.target ) {
								paint( items[ j ], o );
								route( items[ j ], o );
								return;
							}
						}
					};
					layer.addEventListener( 'animationiteration', onIteration );
					fx.cleanup.push( function () {
						layer.removeEventListener( 'animationiteration', onIteration );
					} );
					fx.cleanup.push( watchVisible( el, function ( visible ) {
						layer.classList.toggle( 'is-paused', ! visible );
					} ) );
				}

				this.watchSize();

				if ( reduceQuery ) {
					var onMotionPref = function () {
						self.rebuild();
					};
					if ( reduceQuery.addEventListener ) {
						reduceQuery.addEventListener( 'change', onMotionPref );
						fx.cleanup.push( function () {
							reduceQuery.removeEventListener( 'change', onMotionPref );
						} );
					}
				}
			},

			// Travel distances hang off these two numbers (see route()).
			measure: function () {
				var fx = this.fx;
				if ( ! fx ) {
					return;
				}
				fx.layer.style.setProperty( '--fs-w', Math.round( fx.layer.offsetWidth ) );
				fx.layer.style.setProperty( '--fs-h', Math.round( fx.layer.offsetHeight ) );
			},

			// Re-measure on resize, at most once a frame. A resize that crosses
			// a breakpoint with its own Count rebuilds instead.
			watchSize: function () {
				var self = this;
				var fx = this.fx;
				var raf = 0;
				var onResize = function () {
					cancelAnimationFrame( raf );
					raf = requestAnimationFrame( function () {
						if ( self.fx !== fx ) {
							return;
						}
						if ( self.readCount() !== fx.count || ( fx.speedCustom && self.readDuration() !== fx.duration ) ) {
							self.rebuild();
							return;
						}
						self.measure();
					} );
				};
				var observer = 'ResizeObserver' in window ? new ResizeObserver( onResize ) : null;
				if ( observer ) {
					observer.observe( fx.el );
				}
				// Device changes without a size change (e.g. the editor's
				// device switcher on a fixed-width element) still reach us.
				window.addEventListener( 'resize', onResize );
				fx.cleanup.push( function () {
					cancelAnimationFrame( raf );
					if ( observer ) {
						observer.disconnect();
					}
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
				this.fx = null;
			}
		} ) );

		// null skin: containers and sections fire
		// "frontend/element_ready/container" / ".../section", not "*.default".
		elementorFrontend.elementsHandler.attachHandler( 'container', FloatingShapes, null );
		elementorFrontend.elementsHandler.attachHandler( 'section', FloatingShapes, null );
		// A widget: default skin ("frontend/element_ready/spacer.default").
		elementorFrontend.elementsHandler.attachHandler( 'spacer', FloatingShapes );
		// Image widget: the layer goes in a photo frame (photoFrame()).
		elementorFrontend.elementsHandler.attachHandler( 'image', FloatingShapes );
	} );
}() );
