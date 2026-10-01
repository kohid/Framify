/**
 * Framify - Elementor Floating Text (frontend + editor preview)
 *
 * Words and short phrases from a list appear one at a time inside a
 * Container or legacy Section, hold, and leave again, like quiet margin
 * notes. A fixed number of slots each run their own loop:
 *
 *   pick a line nobody is showing -> render it unseen and measure it ->
 *   find a spot that overlaps no visible word -> IN -> HOLD -> OUT -> gap
 *
 * - Motion runs through the Web Animations API (plus a few pausable timers
 *   for typewriter and scramble), so every running piece can be paused
 *   off-screen and resumed exactly where it stopped.
 * - Reuses window.FramifyFx from assets/framify-shapes.js (settings
 *   readers, palette colour, responsive reader, host + layer mounting,
 *   visibility observer, editor sync); this script's handle depends on it.
 * - Security: words reach the page only through textContent, colours
 *   only through style properties; nothing from settings is parsed as
 *   markup.
 * - Settings follow the Elementor module rule (see framify-shapes.js):
 *   switches are on only when 'yes', a missing colour is cleared, select
 *   and slider fallbacks equal the PHP defaults.
 *
 * File: assets/framify-text.js
 */
( function () {
	'use strict';

	var Fx = window.FramifyFx;
	if ( ! Fx ) {
		return;
	}

	var PREFIX = 'framify_ft_';
	var MAX_COUNT = 20;
	var MAX_LINES = 200;
	var MAX_CHARS = 120;
	var ANIMATIONS = [ 'fade', 'drift', 'typewriter', 'blur', 'pop', 'rise', 'cascade', 'flip', 'wave', 'scramble' ];
	var DIRECTIONS = [ 'up', 'down', 'left', 'right' ];
	// In / out transition seconds per speed; 'custom' reads a responsive
	// slider instead (readDuration()).
	var SPEED = { slow: 1.8, normal: 1.2, fast: 0.7 };
	var SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	var EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
	var EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';
	// Reduced motion keeps words on screen longer: fewer changes to notice.
	var REDUCED_HOLD = 1.6;
	var STROKE = !! ( window.CSS && CSS.supports && CSS.supports( '-webkit-text-stroke-width', '1px' ) );

	var pick = Fx.pick, size = Fx.size, clamp = Fx.clamp, rand = Fx.rand, any = Fx.any;
	var warnedEmpty = false;
	// Cap on waiting for a web font before the first words are measured.
	var FONT_WAIT = 1500;
	// Joining scripts (Arabic, Devanagari and the other Indic blocks):
	// letters split into spans lose their joined forms, so such words
	// always animate whole (letter animations fall back to fade).
	var JOINING = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u0DFF\uFB50-\uFDFF\uFE70-\uFEFF]/;
	var LETTER_ANIMS = [ 'typewriter', 'cascade', 'wave', 'scramble' ];
	// CSS-only controls (Elementor writes their CSS): the editor sync skips
	// these key prefixes and only re-measures the holding words.
	var CSS_KEYS = [ 'framify_ft_typography', 'framify_ft_bg_color', 'framify_ft_bg_opacity', 'framify_ft_border', 'framify_ft_radius', 'framify_ft_text_shadow', 'framify_ft_padding' ];
	var BG_MODES = [ 'fixed', 'palette' ];
	// Contrast text on a From-palette chip: whichever of DARK_TEXT and
	// LIGHT_TEXT has the higher WCAG contrast ratio against the chip colour
	// (ties go dark). A chip colour that cannot be parsed falls back to
	// CHIP_FALLBACK.
	var DARK_TEXT = '#1E1E1E';
	var LIGHT_TEXT = '#FFFFFF';
	var CHIP_FALLBACK = '#F69216';
	var segmenter = window.Intl && Intl.Segmenter ? new Intl.Segmenter( undefined, { granularity: 'grapheme' } ) : null;

	// User-perceived characters: keeps a combining accent with its letter
	// and a ZWJ emoji sequence in one piece. Array.from (code points) is
	// the fallback where Intl.Segmenter is missing.
	function graphemes( text ) {
		if ( segmenter ) {
			return Array.from( segmenter.segment( text ), function ( s ) {
				return s.segment;
			} );
		}
		return Array.from( text );
	}

	// One word's font size in px, uniform in [min, max]: max is the
	// Typography size for the current breakpoint, min the Min font size
	// (NaN when empty = 75% of max). A word never exceeds the Typography
	// size: a min above max is capped to max (tablet / mobile inherit the
	// desktop min, which can exceed their smaller Typography size), and the
	// low end never drops under 4px. Pure (bar Math.random) so it can be
	// checked on its own.
	function wordSize( maxPx, minPx ) {
		var hi = maxPx > 0 ? maxPx : 28;
		var lo = minPx > 0 ? Math.min( minPx, hi ) : hi * 0.75;
		lo = Math.max( 4, lo );
		hi = Math.max( lo, hi );
		return lo + Math.random() * ( hi - lo );
	}

	/* ---------- chip colours ---------- */

	// '#rgb', '#rgba', '#rrggbb', '#rrggbbaa', 'rgb()' / 'rgba()' and
	// 'hsl()' / 'hsla()' (comma or space syntax) -> { r, g, b, a } with
	// channels 0-255 and alpha 0-1, or null when it is none of those.
	function parseColor( value ) {
		var v = 'string' === typeof value ? value.trim().toLowerCase() : '';
		var m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec( v );
		if ( m ) {
			var h = m[ 1 ].length < 6 ? m[ 1 ].replace( /./g, '$&$&' ) : m[ 1 ];
			return {
				r: parseInt( h.substr( 0, 2 ), 16 ),
				g: parseInt( h.substr( 2, 2 ), 16 ),
				b: parseInt( h.substr( 4, 2 ), 16 ),
				a: 8 === h.length ? parseInt( h.substr( 6, 2 ), 16 ) / 255 : 1
			};
		}
		m = /^(rgb|hsl)a?\(\s*(-?[\d.]+)(deg)?(?:\s*,\s*|\s+)([\d.]+)(%?)(?:\s*,\s*|\s+)([\d.]+)(%?)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/.exec( v );
		if ( ! m ) {
			return null;
		}
		var a = undefined === m[ 8 ] ? 1 : clamp( parseFloat( m[ 8 ] ) / ( m[ 9 ] ? 100 : 1 ), 0, 1 );
		var x = parseFloat( m[ 2 ] ), y = parseFloat( m[ 4 ] ), z = parseFloat( m[ 6 ] );
		if ( isNaN( x ) || isNaN( y ) || isNaN( z ) || isNaN( a ) ) {
			return null;
		}
		if ( 'rgb' === m[ 1 ] ) {
			if ( m[ 3 ] ) {
				return null;
			}
			var unit = function ( n, pct ) {
				return clamp( pct ? n * 2.55 : n, 0, 255 );
			};
			return { r: unit( x, false ), g: unit( y, m[ 5 ] ), b: unit( z, m[ 7 ] ), a: a };
		}
		// hsl: s and l are percentages whether or not the % was written.
		var s = clamp( y, 0, 100 ) / 100, l = clamp( z, 0, 100 ) / 100;
		var k = s * Math.min( l, 1 - l );
		var f = function ( n ) {
			var t = ( n + ( ( ( x % 360 ) + 360 ) % 360 ) / 30 ) % 12;
			return ( l - k * Math.max( -1, Math.min( t - 3, 9 - t, 1 ) ) ) * 255;
		};
		return { r: f( 0 ), g: f( 8 ), b: f( 4 ), a: a };
	}

	// WCAG 2 relative luminance of a parsed colour (alpha ignored).
	function luminance( c ) {
		var ch = function ( v ) {
			v /= 255;
			return v <= 0.03928 ? v / 12.92 : Math.pow( ( v + 0.055 ) / 1.055, 2.4 );
		};
		return 0.2126 * ch( c.r ) + 0.7152 * ch( c.g ) + 0.0722 * ch( c.b );
	}

	// WCAG contrast ratio of two relative luminances.
	function contrastRatio( a, b ) {
		return ( Math.max( a, b ) + 0.05 ) / ( Math.min( a, b ) + 0.05 );
	}

	// DARK_TEXT or LIGHT_TEXT, whichever contrasts more with the colour.
	function contrastText( c ) {
		var l = luminance( c );
		var dark = contrastRatio( l, luminance( parseColor( DARK_TEXT ) ) );
		var light = contrastRatio( l, luminance( parseColor( LIGHT_TEXT ) ) );
		return dark >= light ? DARK_TEXT : LIGHT_TEXT;
	}

	// A From-palette chip: its background (an rgba() built from the parsed
	// colour, so nothing from settings reaches the style unparsed) and the
	// contrast text colour.
	function chipColors( value ) {
		var c = parseColor( value ) || parseColor( CHIP_FALLBACK );
		return {
			bg: 'rgba(' + Math.round( c.r ) + ', ' + Math.round( c.g ) + ', ' + Math.round( c.b ) + ', ' + +c.a.toFixed( 3 ) + ')',
			text: contrastText( c )
		};
	}

	/* ---------- settings ---------- */

	// One line per entry, whitespace collapsed, duplicates dropped, capped
	// at MAX_LINES lines of MAX_CHARS characters.
	function readWords( s ) {
		var raw = s[ PREFIX + 'words' ];
		var out = [];
		if ( 'string' !== typeof raw ) {
			return out;
		}
		raw.split( /\r?\n/ ).forEach( function ( line ) {
			var t = graphemes( line.replace( /\s+/g, ' ' ).trim() ).slice( 0, MAX_CHARS ).join( '' ).trim();
			if ( t && -1 === out.indexOf( t ) && out.length < MAX_LINES ) {
				out.push( t );
			}
		} );
		return out;
	}

	function readOptions( s, customDuration, reduce ) {
		var style = pick( s, PREFIX + 'style', 'solid' );
		var tilt = pick( s, PREFIX + 'tilt', 'none' );
		var animation = pick( s, PREFIX + 'animation', 'fade' );
		var direction = pick( s, PREFIX + 'direction', 'up' );
		var area = pick( s, PREFIX + 'area', 'full' );
		var speed = s[ PREFIX + 'speed' ];
		var bg = pick( s, PREFIX + 'bg_mode', 'none' );
		var o = Fx.readColors( s, PREFIX );
		o.bg = -1 !== BG_MODES.indexOf( bg ) ? bg : 'none';
		o.layer = 'overlay' === s[ PREFIX + 'layer' ] ? 'overlay' : 'background';
		o.area = -1 !== [ 'left', 'right' ].indexOf( area ) ? area : 'full';
		o.areaWidth = clamp( size( s, PREFIX + 'area_width', 35 ), 10, 90 );
		o.style = -1 !== [ 'solid', 'outline', 'mix' ].indexOf( style ) ? style : 'solid';
		o.stroke = clamp( size( s, PREFIX + 'stroke', 1 ), 0.5, 4 );
		o.opacity = clamp( size( s, PREFIX + 'opacity', 0.35 ), 0.1, 1 );
		o.tilt = -1 !== [ 'slight', 'vertical' ].indexOf( tilt ) ? tilt : 'none';
		o.animation = 'random' === animation || -1 !== ANIMATIONS.indexOf( animation ) ? animation : 'fade';
		o.direction = 'random' === direction || -1 !== DIRECTIONS.indexOf( direction ) ? direction : 'up';
		o.hold = clamp( size( s, PREFIX + 'hold', 2.5 ), 0.5, 10 ) * 1000;
		o.transition = ( 'custom' === speed ? clamp( customDuration || 1.2, 0.3, 10 ) : ( SPEED[ speed ] || SPEED.normal ) ) * 1000;
		o.gap = clamp( size( s, PREFIX + 'gap', 0.6 ), 0, 5 ) * 1000;
		o.reduce = reduce;
		if ( reduce ) {
			// Only fades: no travel, no letter effects, words appear whole.
			o.animation = 'fade';
			o.hold *= REDUCED_HOLD;
		}
		return o;
	}

	/* ---------- pausable clock ----------
	 * Every timer and animation of a layer goes through these, so pausing
	 * off-screen freezes the whole choreography and resuming continues it.
	 */

	function later( fx, ms, fn ) {
		var t = { fn: fn, remaining: Math.max( 0, ms ), id: 0, start: 0 };
		fx.timers.push( t );
		if ( ! fx.paused ) {
			arm( fx, t );
		}
		return t;
	}

	function arm( fx, t ) {
		t.start = Date.now();
		t.id = setTimeout( function () {
			drop( fx.timers, t );
			if ( ! fx.dead ) {
				t.fn();
			}
		}, t.remaining );
	}

	function drop( list, item ) {
		var i = list.indexOf( item );
		if ( -1 !== i ) {
			list.splice( i, 1 );
		}
	}

	// Web Animation tracked on the layer (for pause) and on the word (so
	// endless ones, like the wave's bob, are cancelled with the word).
	function play( fx, w, el, frames, opts, done ) {
		var a = el.animate( frames, Fx.extend( { fill: 'both' }, opts ) );
		fx.anims.push( a );
		w.anims.push( a );
		a.onfinish = function () {
			drop( fx.anims, a );
			if ( ! fx.dead && done ) {
				done();
			}
		};
		a.oncancel = function () {
			drop( fx.anims, a );
		};
		if ( fx.paused ) {
			a.pause();
		}
		return a;
	}

	function setPaused( fx, paused ) {
		if ( fx.paused === paused ) {
			return;
		}
		fx.paused = paused;
		fx.layer.classList.toggle( 'is-paused', paused );
		fx.timers.forEach( function ( t ) {
			if ( paused ) {
				clearTimeout( t.id );
				t.remaining = Math.max( 0, t.remaining - ( Date.now() - t.start ) );
			} else {
				arm( fx, t );
			}
		} );
		fx.anims.forEach( function ( a ) {
			if ( paused ) {
				a.pause();
			} else {
				a.play();
			}
		} );
	}

	/* ---------- one word ---------- */

	function span( cls ) {
		var el = document.createElement( 'span' );
		el.className = cls;
		return el;
	}

	function perLetter( anim ) {
		return 'typewriter' === anim || 'cascade' === anim || 'wave' === anim || 'scramble' === anim;
	}

	// Render the line unseen, with its look decided, ready to be measured.
	function build( fx, line ) {
		var o = fx.o;
		var anim = 'random' === o.animation ? any( ANIMATIONS ) : o.animation;
		if ( -1 !== LETTER_ANIMS.indexOf( anim ) && JOINING.test( line ) ) {
			anim = 'fade';
		}
		var word = span( 'framify-ft__word is-measuring framify-ft__word--' + anim );
		// wp-exclude-emoji: WordPress's emoji script (a MutationObserver on
		// the body) would swap emoji for <img> after the word was measured.
		// It skips children carrying the class, so it goes on the mask, the
		// word's only child; scramble writes nodeValue (no childList
		// mutation) for the same reason.
		var mask = span( 'framify-ft__mask wp-exclude-emoji' );
		var text = span( 'framify-ft__text' );
		var w = { line: line, anim: anim, el: word, mask: mask, text: text, letters: [], anims: [], tilt: '' };

		word.setAttribute( 'data-anim', anim );
		if ( perLetter( anim ) ) {
			graphemes( line ).forEach( function ( ch ) {
				var c = span( 'framify-ft__ch' );
				c.textContent = ch;
				w.letters.push( c );
				text.appendChild( c );
			} );
		} else {
			text.textContent = line;
		}
		mask.appendChild( text );
		word.appendChild( mask );

		var color = Fx.pickColor( o );
		if ( 'palette' === o.bg ) {
			// The chip wears the word's colour; the text (and an outline's
			// stroke, which is currentColor) takes the contrast colour.
			var chip = chipColors( color );
			word.style.setProperty( '--ft-bg', chip.bg );
			word.style.color = chip.text;
		} else {
			word.style.color = color;
		}
		var outline = STROKE && ( 'outline' === o.style || ( 'mix' === o.style && Math.random() < 0.5 ) );
		if ( outline ) {
			word.classList.add( 'framify-ft__word--outline' );
			word.style.setProperty( '--ft-stroke', o.stroke + 'px' );
		}
		// Max opacity (x0.75-1 jitter). Without a chip it dims the text (on
		// the mask); cycle() moves it to the whole chip when the word is
		// dressed, so the text is then full strength inside the chip.
		w.alpha = +( o.opacity * rand( 0.75, 1 ) ).toFixed( 3 );
		mask.style.opacity = w.alpha;

		w.angle = 0;
		if ( 'slight' === o.tilt ) {
			w.angle = rand( 2, 6 ) * ( Math.random() < 0.5 ? -1 : 1 );
		} else if ( 'vertical' === o.tilt && Math.random() < 0.5 ) {
			w.angle = -90;
		}
		if ( w.angle ) {
			w.tilt = 'rotate(' + w.angle.toFixed( 2 ) + 'deg)';
			word.style.transform = w.tilt;
		}
		fx.layer.appendChild( word );
		// Size: the word's computed font size here, before any inline size,
		// is the Typography size for the current breakpoint (Elementor's
		// CSS on this class) = the maximum. The final size goes inline on
		// the word itself (the chip), so the chip's em padding / radius and
		// the mask, text, caret and letters (1em, inherited) all scale with
		// it; px padding stays px. Read per word, so a typography change in
		// the editor reaches every new word without a rebuild.
		var maxPx = parseFloat( window.getComputedStyle( word ).fontSize );
		word.style.fontSize = wordSize( maxPx, fx.minPx ).toFixed( 2 ) + 'px';
		return w;
	}

	function overlaps( a, b, m ) {
		return a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
	}

	// Find a spot inside the band that clears every visible word. The box
	// is the word's rotated bounding box, stretched along the drift path
	// for Drift, so the word stays clear for its whole life.
	function place( fx, w ) {
		var word = w.el;
		var bw = fx.layer.clientWidth;
		var bh = fx.layer.clientHeight;
		var ww = word.offsetWidth;
		var wh = word.offsetHeight;
		if ( ! bw || ! bh || ! ww ) {
			return false;
		}
		// Fixed box: typewriter and scramble change the letters, and a
		// tilted word must keep rotating about the same centre.
		word.style.width = ww + 'px';
		word.style.height = wh + 'px';

		var rad = w.angle * Math.PI / 180;
		var c = Math.abs( Math.cos( rad ) ), s = Math.abs( Math.sin( rad ) );
		var bx = ww * c + wh * s;
		var by = ww * s + wh * c;
		w.dx = 0;
		w.dy = 0;
		if ( 'drift' === w.anim ) {
			var dir = 'random' === fx.o.direction ? any( DIRECTIONS ) : fx.o.direction;
			var dist = rand( 40, 80 );
			w.dx = 'left' === dir ? -dist : ( 'right' === dir ? dist : 0 );
			w.dy = 'up' === dir ? -dist : ( 'down' === dir ? dist : 0 );
		}
		var rw = bx + Math.abs( w.dx );
		var rh = by + Math.abs( w.dy );
		var pad = Math.max( 8, Math.min( bw, bh ) * 0.04 );
		var margin = Math.max( 10, wh * 0.25 );

		for ( var i = 0; i < 12; i++ ) {
			var r = {
				x: bw - 2 * pad > rw ? rand( pad, bw - pad - rw ) : ( bw - rw ) / 2,
				y: bh - 2 * pad > rh ? rand( pad, bh - pad - rh ) : ( bh - rh ) / 2,
				w: rw,
				h: rh
			};
			var clear = true;
			for ( var j = 0; j < fx.visible.length && clear; j++ ) {
				clear = ! overlaps( r, fx.visible[ j ].rect, margin );
			}
			if ( clear ) {
				w.rect = r;
				// Centre of the word at the start of its path.
				var cx = r.x + ( w.dx < 0 ? -w.dx : 0 ) + bx / 2;
				var cy = r.y + ( w.dy < 0 ? -w.dy : 0 ) + by / 2;
				word.style.left = ( cx - ww / 2 ).toFixed( 1 ) + 'px';
				word.style.top = ( cy - wh / 2 ).toFixed( 1 ) + 'px';
				return true;
			}
		}
		return false;
	}

	function willChange( w, value ) {
		w.text.style.willChange = value;
	}

	// A word that shows a box of its own (a background, or a border from
	// the CSS-only controls). Undressed words never animate the word
	// element's opacity, so they look exactly as before chips existed.
	function dressed( fx, el ) {
		if ( 'none' !== fx.o.bg ) {
			return true;
		}
		var cs = window.getComputedStyle( el );
		return ( parseFloat( cs.borderTopWidth ) || 0 ) + ( parseFloat( cs.borderRightWidth ) || 0 ) +
			( parseFloat( cs.borderBottomWidth ) || 0 ) + ( parseFloat( cs.borderLeftWidth ) || 0 ) > 0;
	}

	// The chip stays still while the text animates inside it; it only
	// fades, between 0 and its Max opacity (w.alpha). In: over the first
	// half of the entrance (<= 450 ms). Out: over the last 60% of the exit,
	// so it ends with the text; with `done` (the typewriter, whose exit has
	// no fixed length) a short fade after it.
	function chipFade( fx, w, show, done ) {
		var t = fx.o.transition;
		var ms = done ? 250 : ( show ? Math.min( t * 0.5, 450 ) : t * 0.6 );
		play( fx, w, w.el, show ? [ { opacity: 0 }, { opacity: w.alpha } ] : [ { opacity: w.alpha }, { opacity: 0 } ], {
			duration: ms,
			delay: show || done ? 0 : t * 0.4,
			easing: show ? 'ease-out' : 'ease-in'
		}, done );
	}

	// End a word's hold now (its box grew into a neighbour or out of the
	// band): run the hold timer's callback early.
	function leaveEarly( fx, w ) {
		var t = w.holdTimer;
		if ( ! t || -1 === fx.timers.indexOf( t ) ) {
			return;
		}
		clearTimeout( t.id );
		drop( fx.timers, t );
		t.fn();
	}

	/* ---------- animations: in( fx, w, done ) / out( fx, w, done ) ---------- */

	function fadeIn( fx, w, ms, done ) {
		play( fx, w, w.text, [ { opacity: 0 }, { opacity: 1 } ], { duration: ms, easing: 'ease-out' }, done );
	}

	function fadeOut( fx, w, done ) {
		play( fx, w, w.text, [ { opacity: 1 }, { opacity: 0 } ], { duration: fx.o.transition, easing: 'ease-in-out' }, done );
	}

	// Show the text box at once; the letters do the entrance.
	function showText( w ) {
		w.text.style.opacity = '1';
	}

	function lettersIn( fx, w, frames, done ) {
		var n = w.letters.length;
		var t = fx.o.transition;
		var stagger = n > 1 ? Math.min( 40, ( t * 0.6 ) / ( n - 1 ) ) : 0;
		var each = Math.max( t - stagger * ( n - 1 ), t * 0.35 );
		showText( w );
		w.letters.forEach( function ( c, i ) {
			play( fx, w, c, frames, { duration: each, delay: i * stagger, easing: EASE_OUT }, i === n - 1 ? done : null );
		} );
	}

	function lettersOut( fx, w, frames, done ) {
		var n = w.letters.length;
		var t = fx.o.transition;
		var stagger = n > 1 ? Math.min( 40, ( t * 0.6 ) / ( n - 1 ) ) : 0;
		var each = Math.max( t - stagger * ( n - 1 ), t * 0.35 );
		w.letters.forEach( function ( c, i ) {
			// Reverse order: the last letter leaves first.
			play( fx, w, c, frames, { duration: each, delay: ( n - 1 - i ) * stagger, easing: 'ease-in' }, 0 === i ? done : null );
		} );
	}

	var RUN = {
		fade: {
			in: function ( fx, w, done ) {
				fadeIn( fx, w, fx.o.transition, done );
			},
			out: fadeOut
		},

		// Travels 40-80px over its whole life (in + hold + out) while
		// fading in and out; the tilt rides along in the same transform.
		drift: {
			in: function ( fx, w, done ) {
				var o = fx.o;
				play( fx, w, w.el, [
					{ transform: 'translate(0px, 0px) ' + w.tilt },
					{ transform: 'translate(' + w.dx.toFixed( 1 ) + 'px, ' + w.dy.toFixed( 1 ) + 'px) ' + w.tilt }
				], { duration: o.transition * 2 + w.hold, easing: 'linear' } );
				fadeIn( fx, w, o.transition, done );
			},
			out: fadeOut
		},

		blur: {
			in: function ( fx, w, done ) {
				play( fx, w, w.text, [
					{ opacity: 0, filter: 'blur(12px)' },
					{ opacity: 1, filter: 'blur(0px)' }
				], { duration: fx.o.transition, easing: EASE_OUT }, done );
			},
			out: function ( fx, w, done ) {
				play( fx, w, w.text, [
					{ opacity: 1, filter: 'blur(0px)' },
					{ opacity: 0, filter: 'blur(12px)' }
				], { duration: fx.o.transition, easing: 'ease-in' }, done );
			}
		},

		pop: {
			in: function ( fx, w, done ) {
				play( fx, w, w.text, [
					{ opacity: 0, transform: 'scale(0.6)' },
					{ opacity: 1, transform: 'scale(1.06)', offset: 0.65 },
					{ opacity: 1, transform: 'scale(1)' }
				], { duration: fx.o.transition, easing: 'ease-out' }, done );
			},
			out: function ( fx, w, done ) {
				play( fx, w, w.text, [
					{ opacity: 1, transform: 'scale(1)' },
					{ opacity: 0, transform: 'scale(0.9)' }
				], { duration: fx.o.transition, easing: 'ease-in' }, done );
			}
		},

		// Slides up out of a clip box, and back down into it.
		rise: {
			in: function ( fx, w, done ) {
				play( fx, w, w.text, [
					{ opacity: 1, transform: 'translateY(110%)' },
					{ opacity: 1, transform: 'translateY(0)' }
				], { duration: fx.o.transition, easing: EASE_OUT }, done );
			},
			out: function ( fx, w, done ) {
				play( fx, w, w.text, [
					{ opacity: 1, transform: 'translateY(0)' },
					{ opacity: 1, transform: 'translateY(110%)' }
				], { duration: fx.o.transition, easing: 'cubic-bezier(0.55, 0, 0.78, 0)' }, done );
			}
		},

		flip: {
			in: function ( fx, w, done ) {
				play( fx, w, w.text, [
					{ opacity: 0, transform: 'perspective(600px) rotateX(90deg)' },
					{ opacity: 1, transform: 'perspective(600px) rotateX(0deg)' }
				], { duration: fx.o.transition, easing: EASE_OUT }, done );
			},
			out: function ( fx, w, done ) {
				play( fx, w, w.text, [
					{ opacity: 1, transform: 'perspective(600px) rotateX(0deg)' },
					{ opacity: 0, transform: 'perspective(600px) rotateX(-90deg)' }
				], { duration: fx.o.transition, easing: 'ease-in' }, done );
			}
		},

		cascade: {
			in: function ( fx, w, done ) {
				lettersIn( fx, w, [
					{ opacity: 0, transform: 'translateY(0.35em)' },
					{ opacity: 1, transform: 'translateY(0)' }
				], done );
			},
			out: function ( fx, w, done ) {
				lettersOut( fx, w, [
					{ opacity: 1, transform: 'translateY(0)' },
					{ opacity: 0, transform: 'translateY(-0.35em)' }
				], done );
			}
		},

		// Letters bob on a staggered sine while the word is visible.
		wave: {
			in: function ( fx, w, done ) {
				var period = 1600;
				w.letters.forEach( function ( c, i ) {
					play( fx, w, c, [
						{ transform: 'translateY(-0.07em)' },
						{ transform: 'translateY(0.07em)' }
					], { duration: period / 2, delay: -( i * 110 ) % period, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' } );
				} );
				fadeIn( fx, w, fx.o.transition, done );
			},
			out: fadeOut
		},

		// Letters appear one by one behind a thin caret, then are erased.
		typewriter: {
			in: function ( fx, w, done ) {
				var n = w.letters.length;
				var step = clamp( fx.o.transition / n, 40, 110 );
				var caret = w.caret = span( 'framify-ft__caret' );
				w.letters.forEach( function ( c ) {
					c.style.display = 'none';
				} );
				w.text.insertBefore( caret, w.text.firstChild );
				showText( w );
				var i = 0;
				var type = function () {
					if ( i >= n ) {
						done();
						return;
					}
					w.letters[ i ].style.display = '';
					w.text.insertBefore( caret, w.letters[ i ].nextSibling );
					i++;
					later( fx, step * rand( 0.7, 1.3 ), type );
				};
				later( fx, step, type );
			},
			out: function ( fx, w, done ) {
				var n = w.letters.length;
				var step = clamp( ( fx.o.transition * 0.6 ) / n, 25, 70 );
				var i = n - 1;
				var erase = function () {
					if ( i < 0 ) {
						play( fx, w, w.text, [ { opacity: 1 }, { opacity: 0 } ], { duration: 200 }, done );
						return;
					}
					w.letters[ i ].style.display = 'none';
					w.text.insertBefore( w.caret, w.letters[ i ] );
					i--;
					later( fx, step, erase );
				};
				later( fx, step, erase );
			}
		},

		// Random characters resolve left to right into the word.
		scramble: {
			in: function ( fx, w, done ) {
				var n = w.letters.length;
				var tick = 45;
				var steps = Math.max( 1, Math.ceil( fx.o.transition / tick ) );
				var k = 0;
				var scramble = function () {
					var resolved = Math.floor( n * k / steps );
					w.letters.forEach( function ( c, i ) {
						var ch = w.chars[ i ];
						c.firstChild.nodeValue = i < resolved || ' ' === ch ? ch : SCRAMBLE_CHARS.charAt( Math.floor( Math.random() * SCRAMBLE_CHARS.length ) );
					} );
					if ( k >= steps ) {
						done();
						return;
					}
					k++;
					later( fx, tick, scramble );
				};
				w.chars = w.letters.map( function ( c ) {
					return c.textContent;
				} );
				scramble();
				fadeIn( fx, w, Math.min( fx.o.transition * 0.3, 300 ) );
			},
			out: fadeOut
		}
	};

	/* ---------- web fonts ---------- */

	function noop() {}

	// document.fonts.ready resolves at once when the Typography font has not
	// even been requested yet (no text uses it), so ask for it explicitly:
	// read the computed font of a hidden probe word and load that. Never
	// blocks for more than FONT_WAIT, and a failing font only means the
	// fallback is measured.
	function fontReady( fx ) {
		if ( ! document.fonts || ! document.fonts.load ) {
			return Promise.resolve();
		}
		var probe = span( 'framify-ft__word is-measuring' );
		var text = span( 'framify-ft__text' );
		text.textContent = fx.words[ 0 ];
		probe.appendChild( text );
		fx.layer.appendChild( probe );
		var cs = window.getComputedStyle( text );
		var font = cs.font || [ cs.fontStyle, cs.fontWeight, cs.fontSize, cs.fontFamily ].join( ' ' );
		probe.remove();
		var load;
		try {
			load = document.fonts.load( font, fx.words.slice( 0, 5 ).join( ' ' ) ).then( noop, noop );
		} catch ( e ) {
			load = Promise.resolve();
		}
		return Promise.race( [
			load,
			new Promise( function ( resolve ) {
				setTimeout( resolve, FONT_WAIT );
			} )
		] );
	}

	// Re-measure the words in HOLD (in / out ones are about to change
	// anyway) and keep each centred where it was. Runs after a late web
	// font and after any CSS-only change in the editor (typography,
	// padding, border...), since those change the word boxes. A word
	// whose box grew into an older visible word, or out of the band, leaves
	// early, so the no-overlap rule keeps holding.
	function refitHolding( fx ) {
		var grown = [];
		fx.visible.forEach( function ( w ) {
			if ( 'hold' !== w.phase ) {
				return;
			}
			var el = w.el;
			var oldW = el.offsetWidth, oldH = el.offsetHeight;
			el.style.width = '';
			el.style.height = '';
			var ww = el.offsetWidth, wh = el.offsetHeight;
			el.style.width = ww + 'px';
			el.style.height = wh + 'px';
			el.style.left = ( parseFloat( el.style.left ) + ( oldW - ww ) / 2 ).toFixed( 1 ) + 'px';
			el.style.top = ( parseFloat( el.style.top ) + ( oldH - wh ) / 2 ).toFixed( 1 ) + 'px';
			var rad = w.angle * Math.PI / 180;
			var c = Math.abs( Math.cos( rad ) ), s = Math.abs( Math.sin( rad ) );
			var dw = ( ww - oldW ) * c + ( wh - oldH ) * s;
			var dh = ( ww - oldW ) * s + ( wh - oldH ) * c;
			w.rect.x -= dw / 2;
			w.rect.y -= dh / 2;
			w.rect.w += dw;
			w.rect.h += dh;
			if ( dw > 0.5 || dh > 0.5 ) {
				grown.push( w );
			}
		} );
		var bw = fx.layer.clientWidth, bh = fx.layer.clientHeight;
		grown.forEach( function ( w ) {
			var r = w.rect;
			var bad = r.x < 0 || r.y < 0 || r.x + r.w > bw || r.y + r.h > bh;
			var i = fx.visible.indexOf( w );
			for ( var j = 0; j < i && ! bad; j++ ) {
				bad = overlaps( r, fx.visible[ j ].rect, 0 );
			}
			if ( bad ) {
				leaveEarly( fx, w );
			}
		} );
	}

	/* ---------- slots ---------- */

	// A line nobody is showing, avoiding the last few shown when possible.
	// With fewer free lines than slots the slot waits: a line is never on
	// screen twice at once.
	function pickLine( fx ) {
		var busy = fx.visible.map( function ( w ) {
			return w.line;
		} );
		var free = fx.words.filter( function ( l ) {
			return -1 === busy.indexOf( l );
		} );
		if ( ! free.length ) {
			return null;
		}
		var fresh = free.filter( function ( l ) {
			return -1 === fx.recent.indexOf( l );
		} );
		var line = any( fresh.length ? fresh : free );
		fx.recent.push( line );
		while ( fx.recent.length > Math.min( fx.count, Math.floor( fx.words.length / 2 ) ) ) {
			fx.recent.shift();
		}
		return line;
	}

	function removeWord( fx, w ) {
		drop( fx.visible, w );
		w.anims.slice().forEach( function ( a ) {
			a.cancel();
		} );
		w.el.remove();
	}

	function cycle( fx ) {
		if ( fx.dead ) {
			return;
		}
		var o = fx.o;
		var retry = function () {
			later( fx, 400 + o.gap, function () {
				cycle( fx );
			} );
		};
		var line = pickLine( fx );
		if ( null === line ) {
			retry();
			return;
		}
		var w = build( fx, line );
		if ( ! place( fx, w ) ) {
			w.el.remove();
			retry();
			return;
		}
		w.hold = o.hold;
		w.phase = 'in';
		fx.visible.push( w );
		w.el.classList.remove( 'is-measuring' );
		var anim = RUN[ w.anim ];
		willChange( w, 'transform, opacity' );
		// Decided once per word: a chip carries Max opacity as a whole
		// (text + background + border), the mask then stays at 1.
		w.chip = dressed( fx, w.el );
		if ( w.chip ) {
			w.mask.style.opacity = '';
			w.el.style.opacity = w.alpha;
			chipFade( fx, w, true );
		}
		anim.in( fx, w, function () {
			willChange( w, '' );
			w.phase = 'hold';
			w.holdTimer = later( fx, w.hold, function () {
				w.phase = 'out';
				willChange( w, 'transform, opacity' );
				var finish = function () {
					removeWord( fx, w );
					// A little jitter so the slots never fall into step.
					later( fx, o.gap + rand( 0, 300 ), function () {
						cycle( fx );
					} );
				};
				// w.chip, not re-read: a border added or removed in the editor
				// meanwhile must not change where the opacity lives mid-life.
				var chip = w.chip;
				var tail = chip && 'typewriter' === w.anim;
				anim.out( fx, w, tail ? function () {
					chipFade( fx, w, false, finish );
				} : finish );
				if ( chip && ! tail ) {
					chipFade( fx, w, false );
				}
			} );
		} );
	}

	/* ---------- Elementor handler ---------- */

	window.addEventListener( 'elementor/frontend/init', function () {
		var Base = elementorModules.frontend.handlers.Base;
		var reduceQuery = window.matchMedia ? window.matchMedia( '(prefers-reduced-motion: reduce)' ) : null;

		// CSS_KEYS are CSS that Elementor applies itself: no rebuild.
		var FloatingText = Base.extend( Fx.extend( Fx.editorMixin( Base, PREFIX, CSS_KEYS ), {

			getConstructorID: function () {
				return 'FramifyFloatingText';
			},

			// A CSS-only change (no rebuild) still changes the word boxes:
			// once Elementor has written the new CSS, re-measure the words
			// holding still. A newly picked font must also be requested, so
			// 'loadingdone' re-fits them again when it arrives.
			onStyleChange: function () {
				var self = this;
				clearTimeout( this.styleTimer );
				cancelAnimationFrame( this.styleFrame );
				this.styleTimer = setTimeout( function () {
					self.styleFrame = requestAnimationFrame( function () {
						if ( self.fx ) {
							fontReady( self.fx );
							refitHolding( self.fx );
						}
					} );
				}, 120 );
			},

			onInit: function () {
				Base.prototype.onInit.apply( this, arguments );
				this.watchModel();
				this.setup();
			},

			readCount: function () {
				return Math.round( Fx.readResponsive( this, PREFIX + 'count', 5, 1, MAX_COUNT ) );
			},

			readDuration: function () {
				return Fx.readResponsive( this, PREFIX + 'duration', 1.2, 0.3, 10 );
			},

			// Min font size for the current device (same fallback chain),
			// NaN when empty everywhere (wordSize() then uses 75% of max).
			readMinSize: function () {
				return Fx.readResponsive( this, PREFIX + 'min_size', NaN, 6, 200 );
			},

			deviceMode: function () {
				try {
					return elementorFrontend.getCurrentDeviceMode();
				} catch ( e ) {
					return '';
				}
			},

			setup: function () {
				var s = window.FramifyColor.settings( this );
				if ( 'yes' !== s[ PREFIX + 'enable' ] ) {
					return;
				}
				var words = readWords( s );
				if ( ! words.length ) {
					if ( this.isEdit && ! warnedEmpty ) {
						warnedEmpty = true;
						window.console.warn( 'Framify: Floating Text has no words.' );
					}
					return;
				}
				var self = this;
				var speedCustom = 'custom' === s[ PREFIX + 'speed' ];
				var duration = speedCustom ? this.readDuration() : null;
				var o = readOptions( s, duration, !! ( reduceQuery && reduceQuery.matches ) );
				var el = Fx.hostOf( this );
				// Image widget: a frame over the photo's box (shared with
				// Floating Shapes), so spots are measured against the photo.
				var frame = Fx.photoFrame( this, 'overlay' === o.layer );
				if ( frame ) {
					el = frame.el;
				}
				var count = this.readCount();
				var layer = document.createElement( 'div' );
				var fx = this.fx = {
					el: el, layer: layer, o: o, words: words, count: count,
					speedCustom: speedCustom, duration: duration,
					minPx: this.readMinSize(), device: this.deviceMode(),
					visible: [], recent: [], timers: [], anims: [], cleanup: [],
					paused: false, dead: false
				};

				// --chip: a Background mode is on (default pill padding and
				// radius in the CSS, the chip background from --ft-bg).
				layer.className = 'framify-ft framify-ft--' + o.layer + ( 'full' !== o.area ? ' framify-ft--' + o.area : '' ) + ( 'none' !== o.bg ? ' framify-ft--chip' : '' );
				layer.setAttribute( 'aria-hidden', 'true' );
				if ( 'full' !== o.area ) {
					layer.style.width = o.areaWidth + '%';
				}
				var releaseHost = Fx.claimHost( el );
				// Background: after a Floating Shapes layer, so words paint
				// above shapes and still below the content.
				Fx.insertLayer( el, layer, 'overlay' === o.layer, '.framify-fs' );

				fx.cleanup.push( function () {
					fx.dead = true;
					fx.timers.forEach( function ( t ) {
						clearTimeout( t.id );
					} );
					fx.timers.length = 0;
					fx.anims.slice().forEach( function ( a ) {
						a.cancel();
					} );
					fx.visible.length = 0;
					layer.remove();
					releaseHost();
					if ( frame ) {
						frame.release();
					}
				} );

				fx.cleanup.push( Fx.watchVisible( el, function ( visible ) {
					setPaused( fx, ! visible );
				} ) );

				// A web font that finishes later (or a typography change in
				// the editor) re-fits the words that are holding still.
				if ( document.fonts && document.fonts.addEventListener ) {
					var onFonts = function () {
						refitHolding( fx );
					};
					document.fonts.addEventListener( 'loadingdone', onFonts );
					fx.cleanup.push( function () {
						document.fonts.removeEventListener( 'loadingdone', onFonts );
					} );
				}

				// Measure only once the words' web font is in, or boxes and
				// spacing would be judged on the fallback font.
				fontReady( fx ).then( function () {
					if ( fx.dead ) {
						return;
					}
					// Stagger the first entrances across one word's cycle.
					var cycleMs = o.transition * 2 + o.hold + o.gap;
					for ( var i = 0; i < count; i++ ) {
						later( fx, i * ( cycleMs / count ) * rand( 0.75, 1 ) + rand( 100, 400 ), function () {
							cycle( fx );
						} );
					}
				} );

				this.watchSize();

				if ( reduceQuery && reduceQuery.addEventListener ) {
					var onMotionPref = function () {
						self.rebuild();
					};
					reduceQuery.addEventListener( 'change', onMotionPref );
					fx.cleanup.push( function () {
						reduceQuery.removeEventListener( 'change', onMotionPref );
					} );
				}
			},

			// Spots are measured against the live band size when each word
			// is placed, so a resize needs nothing, unless it crosses a
			// breakpoint. Any device change rebuilds: the size range (its
			// max is the Typography size of that breakpoint, its min the
			// responsive Min font size) changes with it, and words already
			// on screen carry their px size inline. Count / custom duration
			// are still compared too, in case the device mode is unknown.
			watchSize: function () {
				var self = this;
				var fx = this.fx;
				var raf = 0;
				var onResize = function () {
					cancelAnimationFrame( raf );
					raf = requestAnimationFrame( function () {
						if ( self.fx === fx && ( self.deviceMode() !== fx.device || self.readCount() !== fx.count || ( fx.speedCustom && self.readDuration() !== fx.duration ) ) ) {
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
				clearTimeout( this.styleTimer );
				cancelAnimationFrame( this.styleFrame );
				fx.cleanup.forEach( function ( fn ) {
					fn();
				} );
				this.fx = null;
			}
		} ) );

		elementorFrontend.elementsHandler.attachHandler( 'container', FloatingText, null );
		elementorFrontend.elementsHandler.attachHandler( 'section', FloatingText, null );
		elementorFrontend.elementsHandler.attachHandler( 'spacer', FloatingText );
		// Image widget: the layer goes in a photo frame (FramifyFx.photoFrame).
		elementorFrontend.elementsHandler.attachHandler( 'image', FloatingText );
	} );
}() );
