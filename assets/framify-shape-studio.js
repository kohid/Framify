/**
 * Framify - Shape studio (Elementor editor window).
 *
 * Opened by the "Draw or upload a shape" button on the Uploaded tab of the
 * Organic Shape / Deco Blob Shape pickers. Tabs: Draw (pen tools and
 * freehand), Generate (seeded dot-grid patterns, see framify-dot-shapes.js),
 * Upload SVG, My shapes (download / delete). Saving posts only path data to
 * the server, which re-validates it and writes a clean SVG into
 * uploads/framify-shapes. The pickers are built by PHP, so a new shape needs
 * an editor reload to appear.
 */
( function () {
	'use strict';

	var DATA = window.framifyShapeStudio;
	var MAX_SIZE = 2000;
	var MIN_BOX = 880;
	var MARK = '#e5367a';
	var HANDLE_LINE = '#9aa4b8';
	var context = 'framify_org_shape';
	var showTab = function () {};
	var modal = null;

	if ( ! DATA ) {
		return;
	}

	function el( tag, cls, text ) {
		var node = document.createElement( tag );
		if ( cls ) {
			node.className = cls;
		}
		if ( text ) {
			node.textContent = text;
		}
		return node;
	}

	function post( action, fields ) {
		var body = new FormData();
		body.append( 'action', action );
		body.append( 'nonce', DATA.nonce );
		Object.keys( fields ).forEach( function ( key ) {
			body.append( key, fields[ key ] );
		} );
		return fetch( DATA.ajaxUrl, { method: 'POST', credentials: 'same-origin', body: body } ).then( function ( r ) {
			return r.json();
		} );
	}

	/* ---------- freehand -> smooth closed path ---------- */

	// Drop points closer than `gap` px to the previous kept one.
	function thin( pts, gap ) {
		var out = [ pts[ 0 ] ];
		for ( var i = 1; i < pts.length; i++ ) {
			var last = out[ out.length - 1 ];
			if ( Math.hypot( pts[ i ][ 0 ] - last[ 0 ], pts[ i ][ 1 ] - last[ 1 ] ) >= gap ) {
				out.push( pts[ i ] );
			}
		}
		return out;
	}

	function thumbOf( shape ) {
		return 'data:image/svg+xml,' + encodeURIComponent( '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + shape.vb + '"><path fill="#69727d" d="' + shape.d + '"/></svg>' );
	}

	// Client-side preview of an uploaded SVG: its d attributes and viewBox.
	// The server repeats and enforces this; the file text is never rendered.
	function readSvg( text ) {
		var ds = [];
		var re = /\sd\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
		var m;
		while ( ( m = re.exec( text ) ) ) {
			ds.push( m[ 1 ] || m[ 2 ] || '' );
		}
		var d = ds.join( ' ' ).trim();
		if ( ! d || /[^MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]/.test( d ) ) {
			return null;
		}
		var vb = /viewBox\s*=\s*"([^"]*)"/i.exec( text );
		var parts = vb ? vb[ 1 ].trim().split( /[\s,]+/ ).map( Number ) : [];
		return { d: d, vb: 4 === parts.length && parts.every( isFinite ) && parts[ 2 ] > 0 && parts[ 3 ] > 0 ? parts.join( ' ' ) : '0 0 100 100' };
	}

	/* ---------- modal ---------- */

	function close() {
		if ( modal ) {
			modal.remove();
			modal = null;
		}
	}

	/* ---------- live refresh of the Shape pickers (no reload) ---------- */

	var LIB_CONTROLS = [ 'framify_org_shape_lib', 'framify_org_deco_shape_lib' ];

	// The editor keeps each element type's control definitions in its own
	// config; find our two picker definitions wherever this Elementor
	// version stores them.
	function findControls() {
		var found = [];
		var seen = new WeakSet();
		var visits = 0;
		function walk( o, depth ) {
			if ( ! o || 'object' !== typeof o || depth > 8 || seen.has( o ) || ++visits > 300000 ) {
				return;
			}
			seen.add( o );
			if ( LIB_CONTROLS.indexOf( o.name ) !== -1 && o.options && 'object' === typeof o.options ) {
				found.push( o );
			}
			Object.keys( o ).forEach( function ( key ) {
				try {
					walk( o[ key ], depth + 1 );
				} catch ( e ) {}
			} );
		}
		var ed = window.elementor || {};
		[ ed.config, ed.widgetsCache ].forEach( function ( root ) {
			walk( root, 0 );
		} );
		return found;
	}

	function previewLibrary() {
		var frame = window.elementor && window.elementor.$preview && window.elementor.$preview[ 0 ];
		var win = frame && frame.contentWindow;
		if ( win && win.framifyOrganic ) {
			win.framifyOrganic.library = win.framifyOrganic.library || {};
			return win.framifyOrganic.library;
		}
		return null;
	}

	// Re-render any open Shape picker so it shows the current options.
	function rerenderPickers() {
		var panel = window.elementor && window.elementor.getPanelView && window.elementor.getPanelView();
		var page = panel && panel.getCurrentPageView && panel.getCurrentPageView();
		if ( ! page || ! page.children ) {
			return;
		}
		var defs = findControls();
		page.children.each( function ( view ) {
			var cname = view.model && view.model.get && view.model.get( 'name' );
			if ( LIB_CONTROLS.indexOf( cname ) === -1 ) {
				return;
			}
			var def = defs.filter( function ( d ) {
				return d.name === cname;
			} )[ 0 ];
			if ( def ) {
				view.model.set( 'options', Object.assign( {}, def.options ) );
			}
			view.render();
		} );
	}

	function addShapeLive( shape ) {
		var defs = findControls();
		if ( ! defs.length ) {
			return false;
		}
		defs.forEach( function ( def ) {
			def.options[ shape.id ] = { title: shape.title, image: shape.thumb };
			if ( ! def.default ) {
				def.default = shape.id;
			}
		} );
		var lib = previewLibrary();
		if ( lib ) {
			lib[ shape.id ] = shape.svg;
		}
		rerenderPickers();
		var panel = window.elementor.getPanelView().$el[ 0 ];
		return !! ( panel && panel.querySelector( 'input[value="' + shape.id + '"]' ) );
	}

	function removeShapeLive( id ) {
		findControls().forEach( function ( def ) {
			delete def.options[ id ];
		} );
		var lib = previewLibrary();
		if ( lib ) {
			delete lib[ id ];
		}
		rerenderPickers();
	}

	// Pick the new shape on the element being edited, on the Uploaded tab.
	function applyShape( id ) {
		var panel = window.elementor.getPanelView();
		var page = panel.getCurrentPageView();
		var view = page && page.getOption && page.getOption( 'editedElementView' );
		var container = view && view.getContainer && view.getContainer();
		if ( ! container || ! window.$e ) {
			return false;
		}
		var settings = {};
		settings[ context + '_source' ] = 'library';
		settings[ context + '_lib' ] = id;
		window.$e.run( 'document/elements/settings', { container: container, settings: settings } );
		return true;
	}

	// The "Saved" screen: a message and Done / Add another (or Reload editor
	// when the pickers could not be refreshed live).
	function doneView( body, live, text, again ) {
		body.appendChild( el( 'p', 'framify-studio__done', text ) );
		var row = el( 'div', 'framify-studio__row' );
		if ( live ) {
			var closeB = el( 'button', 'framify-studio__btn framify-studio__btn--primary', 'Done' );
			closeB.type = 'button';
			closeB.addEventListener( 'click', close );
			row.appendChild( closeB );
			var another = el( 'button', 'framify-studio__btn', 'Add another' );
			another.type = 'button';
			another.addEventListener( 'click', again );
			row.appendChild( another );
		} else {
			var reload = el( 'button', 'framify-studio__btn framify-studio__btn--primary', 'Reload editor' );
			reload.type = 'button';
			reload.addEventListener( 'click', function () {
				window.location.reload();
			} );
			row.appendChild( reload );
		}
		body.appendChild( row );
	}

	// A saved shape joins the studio's own list (My shapes, the slot count).
	function remember( shape ) {
		DATA.shapes.push( { id: shape.id, title: shape.title, thumb: shape.thumb, svg: shape.svg, source: 'user' } );
	}

	function saved( body, shape, again ) {
		body.innerHTML = '';
		var live = false;
		var applied = false;
		try {
			live = shape && addShapeLive( shape );
			applied = live && applyShape( shape.id );
		} catch ( e ) {
			live = false;
		}
		if ( shape ) {
			remember( shape );
		}
		var done = live ?
			( applied ? 'Saved and applied to this element.' : 'Saved. It is now on the Uploaded tab.' ) :
			'Saved. Save your page, then reload the editor to pick it on the Uploaded tab.';
		doneView( body, live, done, again );
	}

	// A batch finished after the person left the Generate tab (or closed the
	// studio): the shapes are saved, so put them in the pickers and the list,
	// but do not draw over the tab now showing or change the element.
	function savedQuietly( shapes ) {
		try {
			shapes.forEach( addShapeLive );
		} catch ( e ) {
			// The pickers catch up on the next editor load.
		}
		shapes.forEach( remember );
	}

	// Several shapes at once (the Generate tab). The first is applied to the
	// element so there is something to see; all of them are on the Uploaded
	// tab. `failure` is a note when only part of the batch was saved.
	function savedMany( body, shapes, again, failure ) {
		body.innerHTML = '';
		var live = shapes.length > 0;
		var applied = false;
		try {
			shapes.forEach( function ( shape ) {
				live = addShapeLive( shape ) && live;
			} );
			applied = live && applyShape( shapes[ 0 ].id );
		} catch ( e ) {
			live = false;
		}
		shapes.forEach( remember );
		var text = 'Saved ' + shapes.length + ( 1 === shapes.length ? ' shape. ' : ' shapes. ' );
		if ( live ) {
			text += applied ? 'The first one is applied to this element; all are on the Uploaded tab.' : 'They are on the Uploaded tab.';
		} else {
			text += 'Save your page, then reload the editor to pick them on the Uploaded tab.';
		}
		doneView( body, live, failure ? text + ' ' + failure : text, again );
	}

	function nameField( value ) {
		var wrap = el( 'label', 'framify-studio__field' );
		wrap.appendChild( el( 'span', '', 'Name' ) );
		var input = el( 'input' );
		input.type = 'text';
		input.maxLength = 60;
		input.placeholder = 'My shape';
		input.value = value || '';
		wrap.appendChild( input );
		wrap.input = input;
		return wrap;
	}

	function status() {
		return el( 'p', 'framify-studio__msg' );
	}


	/* ---------- vector model (anchor points with bezier handles) ---------- */

	// model = { paths: [ { closed, nodes: [ { x, y, hin, hout, smooth } ] } ] }
	// hin / hout are absolute [x, y] handle positions, or null (a corner).

	function clone( model ) {
		return JSON.parse( JSON.stringify( model ) );
	}

	function dist( a, b ) {
		return Math.hypot( a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ] );
	}

	function num( v ) {
		return Math.round( v * 10 ) / 10;
	}

	// The 4 control points of the segment from node a to node b.
	function ctrl( a, b ) {
		var p0 = [ a.x, a.y ];
		var p3 = [ b.x, b.y ];
		return [ p0, a.hout || p0, b.hin || p3, p3 ];
	}

	// Index pairs of a path's segments (the closing one only when closed).
	function segments( path ) {
		var n = path.nodes.length;
		var out = [];
		for ( var i = 0; i < n - 1; i++ ) {
			out.push( [ i, i + 1 ] );
		}
		if ( path.closed && n > 2 ) {
			out.push( [ n - 1, 0 ] );
		}
		return out;
	}

	function bez( c, t ) {
		var u = 1 - t;
		var w = [ u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t ];
		return [
			w[ 0 ] * c[ 0 ][ 0 ] + w[ 1 ] * c[ 1 ][ 0 ] + w[ 2 ] * c[ 2 ][ 0 ] + w[ 3 ] * c[ 3 ][ 0 ],
			w[ 0 ] * c[ 0 ][ 1 ] + w[ 1 ] * c[ 1 ][ 1 ] + w[ 2 ] * c[ 2 ][ 1 ] + w[ 3 ] * c[ 3 ][ 1 ]
		];
	}

	// SVG path data. tf maps a canvas point; close forces Z on every path
	// (what gets saved: a shape is always filled).
	function pathD( model, tf, close ) {
		var d = '';
		model.paths.forEach( function ( path ) {
			if ( path.nodes.length < 2 ) {
				return;
			}
			var q = tf( path.nodes[ 0 ].x, path.nodes[ 0 ].y );
			d += 'M' + num( q[ 0 ] ) + ' ' + num( q[ 1 ] );
			var segs = segments( path );
			if ( close && ! path.closed && path.nodes.length > 2 ) {
				segs.push( [ path.nodes.length - 1, 0 ] );
			}
			segs.forEach( function ( sg ) {
				var c = ctrl( path.nodes[ sg[ 0 ] ], path.nodes[ sg[ 1 ] ] ).map( function ( pt ) {
					return tf( pt[ 0 ], pt[ 1 ] );
				} );
				d += 'C' + num( c[ 1 ][ 0 ] ) + ' ' + num( c[ 1 ][ 1 ] ) + ' ' + num( c[ 2 ][ 0 ] ) + ' ' + num( c[ 2 ][ 1 ] ) + ' ' + num( c[ 3 ][ 0 ] ) + ' ' + num( c[ 3 ][ 1 ] );
			} );
			if ( close || path.closed ) {
				d += 'Z';
			}
		} );
		return d;
	}

	// Nearest point on any segment: { pi, si (segment index), t, d }.
	function nearestOnPath( model, pt ) {
		var best = null;
		model.paths.forEach( function ( path, pi ) {
			segments( path ).forEach( function ( sg, si ) {
				var c = ctrl( path.nodes[ sg[ 0 ] ], path.nodes[ sg[ 1 ] ] );
				for ( var i = 0; i <= 40; i++ ) {
					var t = i / 40;
					var dd = dist( bez( c, t ), pt );
					if ( ! best || dd < best.d ) {
						best = { pi: pi, si: si, t: t, d: dd };
					}
				}
			} );
		} );
		return best;
	}

	// de Casteljau split of a segment at t; null handles stay straight.
	function insertNode( path, si, t ) {
		var sg = segments( path )[ si ];
		var a = path.nodes[ sg[ 0 ] ];
		var b = path.nodes[ sg[ 1 ] ];
		var c = ctrl( a, b );
		var lerp = function ( p, q ) {
			return [ p[ 0 ] + ( q[ 0 ] - p[ 0 ] ) * t, p[ 1 ] + ( q[ 1 ] - p[ 1 ] ) * t ];
		};
		var p01 = lerp( c[ 0 ], c[ 1 ] );
		var p12 = lerp( c[ 1 ], c[ 2 ] );
		var p23 = lerp( c[ 2 ], c[ 3 ] );
		var p012 = lerp( p01, p12 );
		var p123 = lerp( p12, p23 );
		var mid = lerp( p012, p123 );
		var curved = !! ( a.hout || b.hin );
		var node = { x: mid[ 0 ], y: mid[ 1 ], hin: curved ? p012 : null, hout: curved ? p123 : null, smooth: curved };
		a.hout = curved ? p01 : null;
		b.hin = curved ? p23 : null;
		var at = sg[ 1 ] === 0 ? path.nodes.length : sg[ 1 ];
		path.nodes.splice( at, 0, node );
		return at;
	}

	// Smooth handles from the neighbours' direction (a corner turned smooth).
	function autoHandles( path, i ) {
		var n = path.nodes.length;
		var node = path.nodes[ i ];
		var prev = path.nodes[ i - 1 ] || ( path.closed ? path.nodes[ n - 1 ] : null );
		var next = path.nodes[ i + 1 ] || ( path.closed ? path.nodes[ 0 ] : null );
		var a = prev || node;
		var b = next || node;
		var vx = b.x - a.x;
		var vy = b.y - a.y;
		var vl = Math.hypot( vx, vy ) || 1;
		var reach = Math.min( prev ? dist( [ prev.x, prev.y ], [ node.x, node.y ] ) : 1e9, next ? dist( [ next.x, next.y ], [ node.x, node.y ] ) : 1e9 ) / 3;
		if ( ! isFinite( reach ) || reach > 1e8 ) {
			reach = 20;
		}
		node.hout = [ node.x + vx / vl * reach, node.y + vy / vl * reach ];
		node.hin = [ node.x - vx / vl * reach, node.y - vy / vl * reach ];
		node.smooth = true;
	}

	// Freehand points -> closed path of smooth nodes (Catmull-Rom handles).
	function nodesFromStroke( pts ) {
		var n = pts.length;
		return pts.map( function ( p, i ) {
			var a = pts[ ( i - 1 + n ) % n ];
			var b = pts[ ( i + 1 ) % n ];
			return {
				x: p[ 0 ], y: p[ 1 ],
				hin: [ p[ 0 ] - ( b[ 0 ] - a[ 0 ] ) / 6, p[ 1 ] - ( b[ 1 ] - a[ 1 ] ) / 6 ],
				hout: [ p[ 0 ] + ( b[ 0 ] - a[ 0 ] ) / 6, p[ 1 ] + ( b[ 1 ] - a[ 1 ] ) / 6 ],
				smooth: true
			};
		} );
	}

	// model -> { d, vb } with the longer side scaled to 100. frame keeps the
	// whole canvas (its aspect ratio and margins) instead of cropping to the
	// drawing.
	function modelToShape( model, w, h, frame ) {
		var usable = { paths: model.paths.filter( function ( p ) {
			return p.nodes.length >= 3;
		} ) };
		if ( ! usable.paths.length ) {
			return null;
		}
		var minX = 0, minY = 0, maxX = w, maxY = h;
		if ( ! frame ) {
			minX = minY = Infinity;
			maxX = maxY = -Infinity;
			usable.paths.forEach( function ( path ) {
				var segs = segments( path );
				if ( ! path.closed ) {
					segs.push( [ path.nodes.length - 1, 0 ] );
				}
				segs.forEach( function ( sg ) {
					var c = ctrl( path.nodes[ sg[ 0 ] ], path.nodes[ sg[ 1 ] ] );
					for ( var i = 0; i <= 24; i++ ) {
						var q = bez( c, i / 24 );
						minX = Math.min( minX, q[ 0 ] );
						maxX = Math.max( maxX, q[ 0 ] );
						minY = Math.min( minY, q[ 1 ] );
						maxY = Math.max( maxY, q[ 1 ] );
					}
				} );
			} );
		}
		var bw = Math.max( maxX - minX, 1 );
		var bh = Math.max( maxY - minY, 1 );
		var k = 100 / Math.max( bw, bh );
		var d = pathD( usable, function ( x, y ) {
			return [ ( x - minX ) * k, ( y - minY ) * k ];
		}, true );
		return { d: d, vb: '0 0 ' + num( bw * k ) + ' ' + num( bh * k ) };
	}

	/* ---------- icons (static markup, no user data) ---------- */

	var NIB = '<path d="M12 3l5 6.5-3 8.5h-4L7 9.5z"/><path d="M12 13v8"/><circle cx="12" cy="10.5" r="1.2"/>';
	var ICONS = {
		pen: NIB,
		select: '<path d="M6 3.5l12 8.2-5.6 1.4L9.6 19z"/>',
		add: NIB.replace( 'M12 3l5 6.5-3 8.5h-4L7 9.5z', 'M11 3l4.5 6-2.8 8H9L6 9z' ) + '<path d="M18 15v6M15 18h6"/>',
		delete: NIB.replace( 'M12 3l5 6.5-3 8.5h-4L7 9.5z', 'M11 3l4.5 6-2.8 8H9L6 9z' ) + '<path d="M15 18h6"/>',
		convert: '<path d="M4.5 17.5L12 6.5l7.5 11"/><circle cx="12" cy="6.5" r="1.6"/>',
		free: '<path d="M3.5 15.5c2.6-8 4.6 5 7.5-1.5s5-6.5 9.5-2"/>',
		undo: '<path d="M8.5 5L4.5 9l4 4"/><path d="M4.5 9h9a6 6 0 0 1 0 12h-4"/>',
		clear: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
		link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
		unlink: '<path d="M9.5 6.5l1-1a4 4 0 0 1 5.7 5.7L15 12.4"/><path d="M14.5 17.5l-1 1a4 4 0 0 1-5.7-5.7L9 11.6"/><path d="M4 4l16 16"/>',
		image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3L16 12l4 4"/>',
		nib: '<path d="M12 3l5 6.5-3 8.5h-4L7 9.5z"/><path d="M12 13v8"/>'
	};

	function icon( name, size ) {
		var span = el( 'span', 'framify-studio__icon' );
		span.innerHTML = '<svg viewBox="0 0 24 24" width="' + ( size || 20 ) + '" height="' + ( size || 20 ) + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[ name ] + '</svg>';
		return span;
	}

	var TOOLS = [
		[ 'pen', 'Pen', 'P', 'Click to place a corner point. Click and drag to pull curve handles. Click the first point to close the shape, or press Enter to finish an open path.' ],
		[ 'select', 'Select', 'V', 'Drag a point to move it, or drag a handle to bend the curve. Hold Alt while dragging a handle to break it from its twin.' ],
		[ 'add', 'Add point', '=', 'Click on a line to add a point there.' ],
		[ 'delete', 'Delete point', '-', 'Click a point to remove it, or select one and press Delete.' ],
		[ 'convert', 'Convert point', 'C', 'Click a curve point to make it a corner, or a corner to make it smooth. Click and drag a corner to pull its handles out.' ],
		[ 'free', 'Freehand', 'B', 'Draw an outline with the mouse, finger or pen. It becomes editable points.' ]
	];

	// Snap `pt` to the nearest 45 degrees around `from` (Shift = straight).
	function constrain( from, pt ) {
		var dx = pt[ 0 ] - from[ 0 ];
		var dy = pt[ 1 ] - from[ 1 ];
		var len = Math.hypot( dx, dy );
		var step = Math.PI / 4;
		var a = Math.round( Math.atan2( dy, dx ) / step ) * step;
		return [ from[ 0 ] + Math.cos( a ) * len, from[ 1 ] + Math.sin( a ) * len ];
	}

	function section( title, note ) {
		var s = el( 'section', 'framify-studio__section' );
		s.appendChild( el( 'h3', 'framify-studio__h', title ) );
		if ( note ) {
			s.appendChild( el( 'p', 'framify-studio__note', note ) );
		}
		return s;
	}

	function switchField( label, checked ) {
		var wrap = el( 'label', 'framify-studio__switch' );
		var input = el( 'input' );
		input.type = 'checkbox';
		input.checked = !! checked;
		wrap.appendChild( input );
		wrap.appendChild( el( 'span', 'framify-studio__track' ) );
		wrap.appendChild( el( 'span', 'framify-studio__switch-label', label ) );
		wrap.input = input;
		return wrap;
	}

	function sizeField( label, value ) {
		var wrap = el( 'label', 'framify-studio__size' );
		wrap.appendChild( el( 'span', '', label ) );
		var input = el( 'input' );
		input.type = 'number';
		input.min = 100;
		input.max = MAX_SIZE;
		input.step = 10;
		input.value = value;
		wrap.appendChild( input );
		wrap.appendChild( el( 'em', '', 'px' ) );
		wrap.input = input;
		return wrap;
	}

	function drawTab( body ) {
		var W = 340;
		var H = 340;
		var model = { paths: [] };
		var history = [];
		var tool = 'pen';
		var sel = null;      // { pi, ni }
		var active = -1;     // path being built with the pen
		var drag = null;
		var stroke = null;   // freehand stroke in progress
		var hover = null;    // pen rubber-band target
		var shift = false;
		var linked = false;
		var ratio = 1;
		var ref = { img: null, show: true, opacity: 0.4, fit: 'contain' };

		var layout = el( 'div', 'framify-studio__draw' );
		var rail = el( 'div', 'framify-studio__rail' );
		var stageWrap = el( 'div', 'framify-studio__stagewrap' );
		var stage = el( 'div', 'framify-studio__stage' );
		var sheet = el( 'div', 'framify-studio__sheet' );
		var canvas = el( 'canvas', 'framify-studio__canvas' );
		canvas.tabIndex = 0;
		var ctx = canvas.getContext( '2d' );
		var inspector = el( 'aside', 'framify-studio__inspector' );
		var bar = el( 'div', 'framify-studio__status' );
		var hint = el( 'span', 'framify-studio__hint' );
		var readout = el( 'span', 'framify-studio__readout' );
		var msg = status();
		var name = nameField();

		/* --- geometry helpers: model units are canvas pixels (W x H) --- */

		function sc() {
			var r = canvas.getBoundingClientRect();
			return r.width ? W / r.width : 1;
		}

		function point( e ) {
			var r = canvas.getBoundingClientRect();
			return [ ( e.clientX - r.left ) * W / r.width, ( e.clientY - r.top ) * H / r.height ];
		}

		// Sharp on any screen: the backing store follows the displayed size
		// and the device pixel ratio; drawing code stays in canvas units.
		function backing() {
			var r = canvas.getBoundingClientRect();
			var dpr = window.devicePixelRatio || 1;
			var bw = Math.max( 1, Math.round( r.width * dpr ) );
			var bh = Math.max( 1, Math.round( r.height * dpr ) );
			if ( canvas.width !== bw || canvas.height !== bh ) {
				canvas.width = bw;
				canvas.height = bh;
			}
			ctx.setTransform( bw / W, 0, 0, bh / H, 0, 0 );
		}

		function applySize() {
			canvas.style.width = W + 'px';
			canvas.style.aspectRatio = W + ' / ' + H;
			canvas.dataset.w = W;
			canvas.dataset.h = H;
			fitBox();
		}

		// The window grows with the canvas (CSS caps it to the screen; the
		// stage scrolls).
		function fitBox() {
			var box = body.closest( '.framify-studio__box' );
			if ( box ) {
				box.style.width = Math.max( MIN_BOX, W + 372 ) + 'px';
			}
		}

		function record() {
			history.push( { model: clone( model ), active: active } );
			if ( history.length > 60 ) {
				history.shift();
			}
		}

		function undo() {
			if ( history.length ) {
				var prev = history.pop();
				model = prev.model;
				// Back to the path the pen was building, so the next click
				// continues it instead of starting a new one.
				active = model.paths[ prev.active ] && ! model.paths[ prev.active ].closed ? prev.active : -1;
				sel = active >= 0 ? { pi: active, ni: model.paths[ active ].nodes.length - 1 } : null;
				paint();
			}
		}

		function hitNode( pt ) {
			var r = 9 * sc();
			var best = null;
			model.paths.forEach( function ( path, pi ) {
				path.nodes.forEach( function ( n, ni ) {
					var dd = dist( [ n.x, n.y ], pt );
					if ( dd <= r && ( ! best || dd < best.d ) ) {
						best = { pi: pi, ni: ni, d: dd };
					}
				} );
			} );
			return best;
		}

		function hitHandle( pt ) {
			if ( ! sel ) {
				return null;
			}
			var n = model.paths[ sel.pi ] && model.paths[ sel.pi ].nodes[ sel.ni ];
			var r = 8 * sc();
			if ( n && n.hout && dist( n.hout, pt ) <= r ) {
				return 'hout';
			}
			if ( n && n.hin && dist( n.hin, pt ) <= r ) {
				return 'hin';
			}
			return null;
		}

		/* --- painting --- */

		function drawRef() {
			if ( ! ref.img || ! ref.show ) {
				return;
			}
			var iw = ref.img.naturalWidth;
			var ih = ref.img.naturalHeight;
			var dw = W, dh = H, dx = 0, dy = 0;
			if ( 'stretch' !== ref.fit ) {
				var k = 'cover' === ref.fit ? Math.max( W / iw, H / ih ) : Math.min( W / iw, H / ih );
				dw = iw * k;
				dh = ih * k;
				dx = ( W - dw ) / 2;
				dy = ( H - dh ) / 2;
			}
			ctx.save();
			ctx.globalAlpha = ref.opacity;
			ctx.drawImage( ref.img, dx, dy, dw, dh );
			ctx.restore();
		}

		function paint() {
			backing();
			var s = sc();
			ctx.clearRect( 0, 0, W, H );
			// The tracing image is a guide only: it is drawn here and never
			// reaches the saved shape (modelToShape reads the model alone).
			drawRef();
			var ident = function ( x, y ) {
				return [ x, y ];
			};
			var filled = pathD( model, ident, true );
			if ( filled ) {
				ctx.fillStyle = 'rgba(47,91,255,.10)';
				ctx.fill( new Path2D( filled ) );
			}
			ctx.lineWidth = 1.5 * s;
			ctx.lineJoin = 'round';
			ctx.strokeStyle = MARK;
			var open = pathD( model, ident, false );
			if ( open ) {
				ctx.stroke( new Path2D( open ) );
			}
			if ( stroke && stroke.length > 1 ) {
				ctx.beginPath();
				stroke.forEach( function ( p, i ) {
					ctx[ i ? 'lineTo' : 'moveTo' ]( p[ 0 ], p[ 1 ] );
				} );
				ctx.stroke();
			}
			// Rubber band from the last pen point to the cursor.
			var act = model.paths[ active ];
			if ( 'pen' === tool && act && act.nodes.length && hover && ! drag ) {
				var last = act.nodes[ act.nodes.length - 1 ];
				ctx.save();
				ctx.setLineDash( [ 5 * s, 4 * s ] );
				ctx.lineWidth = 1.2 * s;
				ctx.beginPath();
				ctx.moveTo( last.x, last.y );
				ctx.lineTo( hover[ 0 ], hover[ 1 ] );
				ctx.stroke();
				ctx.restore();
			}
			// Handles for the selected point (and the pen's last point).
			var show = [];
			if ( sel ) {
				show.push( sel );
			}
			if ( 'pen' === tool && active >= 0 && act ) {
				show.push( { pi: active, ni: act.nodes.length - 1 } );
			}
			show.forEach( function ( h ) {
				var n = model.paths[ h.pi ] && model.paths[ h.pi ].nodes[ h.ni ];
				if ( ! n ) {
					return;
				}
				[ n.hin, n.hout ].forEach( function ( hd ) {
					if ( ! hd ) {
						return;
					}
					ctx.lineWidth = 1 * s;
					ctx.strokeStyle = HANDLE_LINE;
					ctx.beginPath();
					ctx.moveTo( n.x, n.y );
					ctx.lineTo( hd[ 0 ], hd[ 1 ] );
					ctx.stroke();
					ctx.fillStyle = '#fff';
					ctx.strokeStyle = MARK;
					ctx.lineWidth = 1.3 * s;
					ctx.beginPath();
					ctx.arc( hd[ 0 ], hd[ 1 ], 3 * s, 0, 6.2832 );
					ctx.fill();
					ctx.stroke();
				} );
			} );
			// Anchors: small squares for corners, circles for curve points.
			model.paths.forEach( function ( path, pi ) {
				path.nodes.forEach( function ( n, ni ) {
					var on = sel && sel.pi === pi && sel.ni === ni;
					var r = 3.4 * s;
					ctx.fillStyle = on ? MARK : '#fff';
					ctx.strokeStyle = MARK;
					ctx.lineWidth = 1.3 * s;
					ctx.beginPath();
					if ( n.smooth || n.hin || n.hout ) {
						ctx.arc( n.x, n.y, r, 0, 6.2832 );
					} else {
						ctx.rect( n.x - r, n.y - r, r * 2, r * 2 );
					}
					ctx.fill();
					ctx.stroke();
				} );
			} );
		}

		function removeNode( pi, ni ) {
			var path = model.paths[ pi ];
			path.nodes.splice( ni, 1 );
			if ( path.nodes.length < 2 ) {
				model.paths.splice( pi, 1 );
				if ( active === pi ) {
					active = -1;
				} else if ( active > pi ) {
					active--;
				}
			}
			sel = null;
		}

		/* --- pointer input --- */

		canvas.addEventListener( 'pointerdown', function ( e ) {
			canvas.focus();
			canvas.setPointerCapture( e.pointerId );
			shift = e.shiftKey;
			var pt = point( e );
			var hit = hitNode( pt );
			drag = null;

			if ( 'free' === tool ) {
				stroke = [ pt ];
				return;
			}

			if ( 'pen' === tool ) {
				var act = model.paths[ active ];
				if ( act && hit && hit.pi === active && 0 === hit.ni && act.nodes.length >= 3 ) {
					record();
					act.closed = true;
					active = -1;
					sel = null;
					paint();
					return;
				}
				// Shift: a straight segment at 0, 45 or 90 degrees from the
				// last point, with no curve handles.
				var straight = e.shiftKey && act && act.nodes.length;
				if ( straight ) {
					var prev = act.nodes[ act.nodes.length - 1 ];
					pt = constrain( [ prev.x, prev.y ], pt );
				}
				record();
				if ( ! act ) {
					model.paths.push( { closed: false, nodes: [] } );
					active = model.paths.length - 1;
					act = model.paths[ active ];
				}
				var node = { x: pt[ 0 ], y: pt[ 1 ], hin: null, hout: null, smooth: false };
				act.nodes.push( node );
				sel = { pi: active, ni: act.nodes.length - 1 };
				if ( ! straight ) {
					drag = { type: 'pull', node: node };
				}
				paint();
				return;
			}

			if ( 'select' === tool ) {
				var which = hitHandle( pt );
				if ( which ) {
					record();
					drag = { type: 'handle', which: which };
				} else if ( hit ) {
					record();
					sel = { pi: hit.pi, ni: hit.ni };
					var picked = model.paths[ hit.pi ].nodes[ hit.ni ];
					drag = { type: 'move', grab: pt, origin: [ picked.x, picked.y ] };
				} else {
					sel = null;
				}
				paint();
				return;
			}

			if ( 'add' === tool ) {
				var near = nearestOnPath( model, pt );
				if ( near && near.d <= 10 * sc() && near.t > 0.01 && near.t < 0.99 ) {
					record();
					var path = model.paths[ near.pi ];
					sel = { pi: near.pi, ni: insertNode( path, near.si, near.t ) };
				}
				paint();
				return;
			}

			if ( 'delete' === tool ) {
				if ( hit ) {
					record();
					removeNode( hit.pi, hit.ni );
				}
				paint();
				return;
			}

			if ( 'convert' === tool && hit ) {
				record();
				var cp = model.paths[ hit.pi ];
				var cn = cp.nodes[ hit.ni ];
				sel = { pi: hit.pi, ni: hit.ni };
				if ( cn.hin || cn.hout ) {
					cn.hin = cn.hout = null;
					cn.smooth = false;
				} else {
					drag = { type: 'pull', node: cn, auto: { path: cp, index: hit.ni } };
				}
				paint();
			}
		} );

		canvas.addEventListener( 'pointermove', function ( e ) {
			shift = e.shiftKey;
			var pt = point( e );
			readout.textContent = 'x ' + Math.round( pt[ 0 ] ) + '   y ' + Math.round( pt[ 1 ] ) + '   ' + W + ' × ' + H;
			if ( stroke ) {
				stroke.push( pt );
				paint();
				return;
			}
			if ( ! drag ) {
				var act = model.paths[ active ];
				if ( 'pen' === tool && act && act.nodes.length ) {
					var last = act.nodes[ act.nodes.length - 1 ];
					hover = e.shiftKey ? constrain( [ last.x, last.y ], pt ) : pt;
					paint();
				}
				return;
			}
			if ( 'pull' === drag.type ) {
				var n = drag.node;
				if ( dist( [ n.x, n.y ], pt ) > 3 * sc() ) {
					n.hout = pt;
					n.hin = [ 2 * n.x - pt[ 0 ], 2 * n.y - pt[ 1 ] ];
					n.smooth = true;
					drag.pulled = true;
				}
			} else if ( 'move' === drag.type ) {
				var node = model.paths[ sel.pi ].nodes[ sel.ni ];
				var target = [ drag.origin[ 0 ] + pt[ 0 ] - drag.grab[ 0 ], drag.origin[ 1 ] + pt[ 1 ] - drag.grab[ 1 ] ];
				if ( e.shiftKey ) {
					target = constrain( drag.origin, target );
				}
				var dx = target[ 0 ] - node.x;
				var dy = target[ 1 ] - node.y;
				node.x += dx;
				node.y += dy;
				[ node.hin, node.hout ].forEach( function ( hd ) {
					if ( hd ) {
						hd[ 0 ] += dx;
						hd[ 1 ] += dy;
					}
				} );
			} else if ( 'handle' === drag.type ) {
				var hn = model.paths[ sel.pi ].nodes[ sel.ni ];
				var other = 'hout' === drag.which ? 'hin' : 'hout';
				if ( e.altKey ) {
					hn.smooth = false;
				}
				hn[ drag.which ] = e.shiftKey ? constrain( [ hn.x, hn.y ], pt ) : pt;
				if ( hn.smooth && hn[ other ] ) {
					var len = dist( hn[ other ], [ hn.x, hn.y ] );
					var dir = [ hn.x - hn[ drag.which ][ 0 ], hn.y - hn[ drag.which ][ 1 ] ];
					var dl = Math.hypot( dir[ 0 ], dir[ 1 ] ) || 1;
					hn[ other ] = [ hn.x + dir[ 0 ] / dl * len, hn.y + dir[ 1 ] / dl * len ];
				}
			}
			paint();
		} );

		function end() {
			if ( stroke ) {
				var pts = thin( stroke, 6 * sc() );
				stroke = null;
				if ( pts.length >= 3 ) {
					record();
					model.paths.push( { closed: true, nodes: nodesFromStroke( pts ) } );
				}
			} else if ( drag && drag.auto && ! drag.pulled ) {
				autoHandles( drag.auto.path, drag.auto.index );
			}
			drag = null;
			paint();
		}
		canvas.addEventListener( 'pointerup', end );
		canvas.addEventListener( 'pointercancel', end );
		canvas.addEventListener( 'pointerleave', function () {
			hover = null;
			paint();
		} );
		canvas.addEventListener( 'dblclick', function () {
			active = -1;
			paint();
		} );

		/* --- keyboard --- */

		function setShift( on ) {
			if ( on !== shift ) {
				shift = on;
				hint.textContent = shift ? 'Shift: lines snap to 0°, 45° and 90°.' : toolHint();
				hint.classList.toggle( 'is-shift', shift );
			}
		}
		var onKey = function ( e ) {
			if ( ! modal || ! layout.isConnected ) {
				document.removeEventListener( 'keydown', onKey, true );
				document.removeEventListener( 'keyup', onKey, true );
				return;
			}
			if ( 'Shift' === e.key ) {
				setShift( 'keydown' === e.type );
				if ( hover && active >= 0 ) {
					paint();
				}
				return;
			}
			if ( 'keydown' !== e.type ) {
				return;
			}
			var typing = /^(INPUT|TEXTAREA|SELECT)$/.test( e.target.tagName ) && 'range' !== e.target.type;
			if ( ( e.ctrlKey || e.metaKey ) && 'z' === e.key.toLowerCase() && ! typing ) {
				e.preventDefault();
				undo();
			} else if ( ( 'Delete' === e.key || 'Backspace' === e.key ) && sel && ! typing ) {
				e.preventDefault();
				record();
				removeNode( sel.pi, sel.ni );
				paint();
			} else if ( ( 'Enter' === e.key || 'Escape' === e.key ) && ! typing ) {
				active = -1;
				hover = null;
				if ( 'Escape' === e.key ) {
					sel = null;
				}
				paint();
			} else if ( ! typing && ! e.ctrlKey && ! e.metaKey && ! e.altKey ) {
				TOOLS.forEach( function ( def ) {
					if ( def[ 2 ].toLowerCase() === e.key.toLowerCase() ) {
						pick( def[ 0 ] );
					}
				} );
			}
		};
		document.addEventListener( 'keydown', onKey, true );
		document.addEventListener( 'keyup', onKey, true );

		/* --- tool rail --- */

		var toolButtons = {};
		function toolHint() {
			return TOOLS.filter( function ( def ) {
				return def[ 0 ] === tool;
			} )[ 0 ][ 3 ];
		}
		function pick( id ) {
			tool = id;
			if ( 'pen' !== id ) {
				active = -1;
				hover = null;
			}
			Object.keys( toolButtons ).forEach( function ( k ) {
				toolButtons[ k ].classList.toggle( 'is-active', k === tool );
				toolButtons[ k ].setAttribute( 'aria-pressed', k === tool ? 'true' : 'false' );
			} );
			hint.textContent = shift ? 'Shift: lines snap to 0°, 45° and 90°.' : toolHint();
			canvas.dataset.tool = tool;
			paint();
		}
		TOOLS.forEach( function ( def ) {
			var b = el( 'button', 'framify-studio__tool' );
			b.type = 'button';
			b.setAttribute( 'aria-label', def[ 1 ] );
			b.dataset.label = def[ 1 ] + '  ·  ' + def[ 2 ].toUpperCase();
			b.appendChild( icon( def[ 0 ] ) );
			b.addEventListener( 'click', function () {
				pick( def[ 0 ] );
			} );
			toolButtons[ def[ 0 ] ] = b;
			rail.appendChild( b );
		} );
		rail.appendChild( el( 'span', 'framify-studio__rule' ) );
		function railAction( label, ic, fn ) {
			var b = el( 'button', 'framify-studio__tool' );
			b.type = 'button';
			b.setAttribute( 'aria-label', label );
			b.dataset.label = label;
			b.appendChild( icon( ic ) );
			b.addEventListener( 'click', fn );
			rail.appendChild( b );
		}
		railAction( 'Undo', 'undo', undo );
		railAction( 'Clear', 'clear', function () {
			record();
			model = { paths: [] };
			sel = null;
			active = -1;
			paint();
		} );

		/* --- inspector: canvas size --- */

		var sizeSec = section( 'Canvas' );
		var wField = sizeField( 'W', W );
		var hField = sizeField( 'H', H );
		var linkB = el( 'button', 'framify-studio__link' );
		linkB.type = 'button';
		function paintLink() {
			linkB.innerHTML = '';
			linkB.appendChild( icon( linked ? 'link' : 'unlink', 16 ) );
			linkB.setAttribute( 'aria-pressed', linked ? 'true' : 'false' );
			linkB.setAttribute( 'aria-label', linked ? 'Width and height linked. Click to unlink.' : 'Width and height unlinked. Click to link.' );
			linkB.title = linked ? 'Linked: width and height keep their ratio' : 'Unlinked: width and height change separately';
			linkB.classList.toggle( 'is-on', linked );
		}
		paintLink();
		linkB.addEventListener( 'click', function () {
			linked = ! linked;
			ratio = W / H;
			paintLink();
		} );
		var sizeRow = el( 'div', 'framify-studio__sizes' );
		sizeRow.appendChild( wField );
		sizeRow.appendChild( linkB );
		sizeRow.appendChild( hField );
		sizeSec.appendChild( sizeRow );

		function clampSize( v, fallback ) {
			return Math.min( MAX_SIZE, Math.max( 100, parseInt( v, 10 ) || fallback ) );
		}
		// Change the canvas size; the drawing scales with it. `which` is the
		// field the user edited, so a linked pair follows it.
		function resize( which ) {
			var nw = clampSize( wField.input.value, W );
			var nh = clampSize( hField.input.value, H );
			if ( linked ) {
				if ( 'h' === which ) {
					nw = clampSize( Math.round( nh * ratio ), W );
					nh = clampSize( Math.round( nw / ratio ), H );
				} else {
					nh = clampSize( Math.round( nw / ratio ), H );
					nw = clampSize( Math.round( nh * ratio ), W );
				}
			}
			wField.input.value = nw;
			hField.input.value = nh;
			if ( nw === W && nh === H ) {
				return;
			}
			var fx = nw / W;
			var fy = nh / H;
			var scale = function ( pt ) {
				return pt ? [ pt[ 0 ] * fx, pt[ 1 ] * fy ] : pt;
			};
			model.paths.forEach( function ( path ) {
				path.nodes.forEach( function ( n ) {
					n.x *= fx;
					n.y *= fy;
					n.hin = scale( n.hin );
					n.hout = scale( n.hout );
				} );
			} );
			history = [];
			W = nw;
			H = nh;
			if ( ! linked ) {
				ratio = W / H;
			}
			applySize();
			paint();
		}
		wField.input.addEventListener( 'change', function () {
			resize( 'w' );
		} );
		hField.input.addEventListener( 'change', function () {
			resize( 'h' );
		} );
		var frame = switchField( 'Keep the canvas frame', false );
		sizeSec.appendChild( frame );
		sizeSec.appendChild( el( 'p', 'framify-studio__note', 'Off: the saved shape is cropped to your drawing. On: it keeps the canvas proportions and margins.' ) );

		/* --- inspector: tracing image (never saved) --- */

		var refSec = section( 'Tracing image', 'A guide to trace over. It is never part of the saved shape.' );
		var file = el( 'input' );
		file.type = 'file';
		file.accept = 'image/*';
		file.hidden = true;
		var drop = el( 'button', 'framify-studio__drop' );
		drop.type = 'button';
		drop.appendChild( icon( 'image', 22 ) );
		drop.appendChild( el( 'span', '', 'Choose an image to trace' ) );
		drop.addEventListener( 'click', function () {
			file.click();
		} );
		var refTools = el( 'div', 'framify-studio__reftools' );
		refTools.hidden = true;
		var refShow = switchField( 'Show image', true );
		var opacityRow = el( 'label', 'framify-studio__range' );
		opacityRow.appendChild( el( 'span', '', 'Opacity' ) );
		var opacity = el( 'input' );
		opacity.type = 'range';
		opacity.min = 5;
		opacity.max = 100;
		opacity.value = 40;
		var opacityVal = el( 'output', '', '40%' );
		opacityRow.appendChild( opacity );
		opacityRow.appendChild( opacityVal );
		var fitRow = el( 'div', 'framify-studio__seg' );
		var fitButtons = {};
		[ [ 'contain', 'Fit' ], [ 'cover', 'Fill' ], [ 'stretch', 'Stretch' ] ].forEach( function ( f ) {
			var b = el( 'button', '', f[ 1 ] );
			b.type = 'button';
			b.addEventListener( 'click', function () {
				ref.fit = f[ 0 ];
				Object.keys( fitButtons ).forEach( function ( k ) {
					fitButtons[ k ].classList.toggle( 'is-active', k === ref.fit );
				} );
				paint();
			} );
			fitButtons[ f[ 0 ] ] = b;
			fitRow.appendChild( b );
		} );
		fitButtons.contain.classList.add( 'is-active' );
		var refRow = el( 'div', 'framify-studio__row' );
		var match = el( 'button', 'framify-studio__btn', 'Match canvas' );
		var drop2 = el( 'button', 'framify-studio__btn framify-studio__btn--quiet', 'Remove' );
		match.type = drop2.type = 'button';
		match.addEventListener( 'click', function () {
			if ( ! ref.img ) {
				return;
			}
			var k = Math.min( 1, 800 / Math.max( ref.img.naturalWidth, ref.img.naturalHeight ) );
			wField.input.value = Math.round( ref.img.naturalWidth * k );
			hField.input.value = Math.round( ref.img.naturalHeight * k );
			var was = linked;
			linked = false;
			resize( 'w' );
			linked = was;
			ratio = W / H;
		} );
		drop2.addEventListener( 'click', function () {
			ref.img = null;
			file.value = '';
			refTools.hidden = true;
			drop.hidden = false;
			paint();
		} );
		refRow.appendChild( match );
		refRow.appendChild( drop2 );
		refTools.appendChild( refShow );
		refTools.appendChild( opacityRow );
		refTools.appendChild( fitRow );
		refTools.appendChild( refRow );
		refShow.input.addEventListener( 'change', function () {
			ref.show = refShow.input.checked;
			paint();
		} );
		opacity.addEventListener( 'input', function () {
			ref.opacity = opacity.value / 100;
			opacityVal.textContent = opacity.value + '%';
			paint();
		} );
		file.addEventListener( 'change', function () {
			var f = file.files && file.files[ 0 ];
			if ( ! f ) {
				return;
			}
			if ( f.size > 20 * 1024 * 1024 ) {
				msg.textContent = 'That image is over 20 MB.';
				return;
			}
			var reader = new FileReader();
			reader.onload = function () {
				var img = new Image();
				img.onload = function () {
					ref.img = img;
					ref.show = true;
					refShow.input.checked = true;
					refTools.hidden = false;
					drop.hidden = true;
					msg.textContent = '';
					paint();
				};
				img.onerror = function () {
					msg.textContent = 'That file is not an image the browser can open.';
				};
				img.src = String( reader.result );
			};
			reader.readAsDataURL( f );
		} );
		refSec.appendChild( file );
		refSec.appendChild( drop );
		refSec.appendChild( refTools );

		/* --- inspector: save --- */

		var saveSec = section( 'Save' );
		saveSec.appendChild( name );
		var save = el( 'button', 'framify-studio__btn framify-studio__btn--primary', 'Save shape' );
		save.type = 'button';
		save.addEventListener( 'click', function () {
			var shape = modelToShape( model, W, H, frame.input.checked );
			if ( ! shape ) {
				msg.textContent = 'Draw a closed outline with at least 3 points first.';
				return;
			}
			msg.textContent = 'Saving...';
			post( 'framify_shape_save', { name: name.input.value, d: shape.d, vb: shape.vb } ).then( function ( res ) {
				if ( res && res.success ) {
					saved( body, res.data, function () {
						showTab( 0 );
					} );
				} else {
					msg.textContent = ( res && res.data && res.data.message ) || 'Could not save.';
				}
			} ).catch( function () {
				msg.textContent = 'Could not save.';
			} );
		} );
		saveSec.appendChild( save );
		saveSec.appendChild( msg );

		inspector.appendChild( sizeSec );
		inspector.appendChild( refSec );
		inspector.appendChild( saveSec );

		/* --- assemble --- */

		sheet.appendChild( canvas );
		stage.appendChild( sheet );
		bar.appendChild( hint );
		bar.appendChild( readout );
		stageWrap.appendChild( stage );
		stageWrap.appendChild( bar );
		layout.appendChild( rail );
		layout.appendChild( stageWrap );
		layout.appendChild( inspector );
		body.appendChild( layout );

		hint.textContent = toolHint();
		readout.textContent = W + ' × ' + H;
		canvas.dataset.tool = 'pen';
		toolButtons.pen.classList.add( 'is-active' );
		toolButtons.pen.setAttribute( 'aria-pressed', 'true' );
		applySize();
		if ( window.ResizeObserver ) {
			new ResizeObserver( function () {
				paint();
			} ).observe( canvas );
		}
		paint();
	}

	/* ---------- Generate tab: seeded dot-grid shapes ---------- */

	// Index of the Generate tab in open()'s list (right after Draw). Only used
	// from inside that tab, which exists only when the generator is loaded.
	var GENERATE_TAB = 1;
	// Remembered between visits, so "Add another" returns to the same settings.
	var genMemory = null;

	function rangeField( label, min, max, value, fmt ) {
		var wrap = el( 'label', 'framify-studio__range' );
		wrap.appendChild( el( 'span', '', label ) );
		var input = el( 'input' );
		input.type = 'range';
		input.min = min;
		input.max = max;
		input.value = value;
		var out = el( 'output', '', fmt ? fmt( value ) : String( value ) );
		input.addEventListener( 'input', function () {
			out.textContent = fmt ? fmt( input.value ) : input.value;
		} );
		wrap.appendChild( input );
		wrap.appendChild( out );
		wrap.input = input;
		return wrap;
	}

	function userShapeCount() {
		return DATA.shapes.filter( function ( shape ) {
			return 'user' === shape.source;
		} ).length;
	}

	function generateTab( body ) {
		var Dots = window.FramifyDotShapes;
		var L = Dots.LIMITS;
		var opts = genMemory || Dots.normalise( { seed: Dots.randomSeed() } );
		var shapes = [];
		var ticks = [];
		var frame = 0;
		var fields = {};
		var cap = DATA.maxUser || 100;

		var layout = el( 'div', 'framify-studio__draw framify-studio__draw--gen' );
		var stageWrap = el( 'div', 'framify-studio__stagewrap' );
		var stage = el( 'div', 'framify-studio__stage framify-studio__stage--tiles' );
		var tiles = el( 'div', 'framify-studio__variants' );
		var bar = el( 'div', 'framify-studio__status' );
		var hint = el( 'span', 'framify-studio__hint', 'Tick the shapes to keep. Dots are round when your element has the same proportions as the ratio.' );
		var readout = el( 'span', 'framify-studio__readout' );
		var inspector = el( 'aside', 'framify-studio__inspector' );
		var msg = status();
		var name = nameField( 'Dots' );
		var save = el( 'button', 'framify-studio__btn framify-studio__btn--primary' );
		save.type = 'button';
		var room = el( 'p', 'framify-studio__note' );

		function readoutText() {
			var picked = ticks.filter( Boolean ).length;
			readout.textContent = picked + ' of ' + shapes.length + ' selected';
			save.textContent = 'Save ' + picked + ( 1 === picked ? ' shape' : ' shapes' );
			save.disabled = ! picked;
		}

		function kb( bytes ) {
			return ( bytes / 1000 ).toFixed( 1 ) + ' KB';
		}

		function renderTiles() {
			while ( tiles.firstChild ) {
				tiles.removeChild( tiles.firstChild );
			}
			shapes.forEach( function ( shape, i ) {
				var card = el( 'label', 'framify-studio__variant ' + ( ticks[ i ] ? 'is-on' : 'is-off' ) );
				var box = el( 'input' );
				box.type = 'checkbox';
				box.checked = ticks[ i ];
				box.addEventListener( 'change', function () {
					ticks[ i ] = box.checked;
					card.classList.toggle( 'is-on', box.checked );
					card.classList.toggle( 'is-off', ! box.checked );
					readoutText();
				} );
				var img = el( 'img' );
				img.alt = '';
				img.src = thumbOf( shape );
				var vb = shape.vb.split( ' ' );
				img.style.aspectRatio = vb[ 2 ] + ' / ' + vb[ 3 ];
				card.appendChild( box );
				card.appendChild( el( 'span', 'framify-studio__tick' ) );
				card.appendChild( img );
				card.appendChild( el( 'span', 'framify-studio__caption', '#' + ( i + 1 ) + '  ' + shape.count + ' dots  ' + kb( shape.d.length ) ) );
				tiles.appendChild( card );
			} );
			readoutText();
		}

		// One frame after the last change: every control feeds this, so
		// dragging a slider regenerates once per frame, not per event.
		function refresh() {
			cancelAnimationFrame( frame );
			frame = requestAnimationFrame( function () {
				opts = Dots.normalise( opts );
				genMemory = opts;
				shapes = Dots.generateSet( opts );
				ticks = shapes.map( function () {
					return true;
				} );
				renderTiles();
			} );
		}

		function bind( field, key ) {
			field.input.addEventListener( 'input', function () {
				opts[ key ] = +field.input.value;
				if ( ( 'min' === key && opts.min > opts.max ) || ( 'max' === key && opts.max < opts.min ) ) {
					// Keep the two size ends in order.
					var other = 'min' === key ? 'max' : 'min';
					opts[ other ] = opts[ key ];
					fields[ other ].input.value = opts[ key ];
					fields[ other ].input.dispatchEvent( new Event( 'input' ) );
					return;
				}
				refresh();
			} );
			return field;
		}

		function range( key, label, fmt ) {
			fields[ key ] = bind( rangeField( label, L[ key ][ 0 ], L[ key ][ 1 ], opts[ key ], fmt ), key );
			return fields[ key ];
		}
		function pct( v ) {
			return v + '%';
		}

		/* inspector */
		var patternSec = section( 'Pattern' );
		patternSec.appendChild( range( 'dots', 'Dots' ) );
		patternSec.appendChild( range( 'variations', 'Variations' ) );
		patternSec.appendChild( range( 'cols', 'Columns' ) );
		var ratioRow = el( 'div', 'framify-studio__seg framify-studio__seg--4' );
		var ratioButtons = {};
		Object.keys( Dots.RATIOS ).forEach( function ( key ) {
			var b = el( 'button', '', key );
			b.type = 'button';
			b.setAttribute( 'aria-label', 'Ratio ' + key );
			b.addEventListener( 'click', function () {
				opts.ratio = key;
				Object.keys( ratioButtons ).forEach( function ( k ) {
					ratioButtons[ k ].classList.toggle( 'is-active', k === key );
				} );
				refresh();
			} );
			ratioButtons[ key ] = b;
			ratioRow.appendChild( b );
		} );
		ratioButtons[ opts.ratio ].classList.add( 'is-active' );
		patternSec.appendChild( ratioRow );

		var dotsSec = section( 'Dots' );
		dotsSec.appendChild( range( 'min', 'Smallest', pct ) );
		dotsSec.appendChild( range( 'max', 'Largest', pct ) );
		dotsSec.appendChild( range( 'steps', 'Sizes' ) );
		dotsSec.appendChild( range( 'runs', 'Runs' ) );
		var invert = switchField( 'Invert (dots become holes)', opts.invert );
		invert.input.addEventListener( 'change', function () {
			opts.invert = invert.input.checked;
			refresh();
		} );
		dotsSec.appendChild( invert );
		dotsSec.appendChild( el( 'p', 'framify-studio__note', 'Runs groups dots into horizontal clusters. Invert shows your image around the dots instead of through them.' ) );

		var seedSec = section( 'Seed' );
		var seedRow = el( 'div', 'framify-studio__seedrow' );
		var seedInput = el( 'input' );
		seedInput.type = 'number';
		seedInput.min = 0;
		seedInput.max = 4294967295;
		seedInput.value = opts.seed;
		seedInput.setAttribute( 'aria-label', 'Seed' );
		seedInput.addEventListener( 'input', function () {
			opts.seed = ( +seedInput.value ) >>> 0;
			refresh();
		} );
		var shuffle = el( 'button', 'framify-studio__btn', 'Shuffle' );
		shuffle.type = 'button';
		shuffle.addEventListener( 'click', function () {
			opts.seed = Dots.randomSeed();
			seedInput.value = opts.seed;
			refresh();
		} );
		seedRow.appendChild( seedInput );
		seedRow.appendChild( shuffle );
		seedSec.appendChild( seedRow );
		seedSec.appendChild( el( 'p', 'framify-studio__note', 'The same seed and settings always give the same shapes.' ) );

		var saveSec = section( 'Save' );
		saveSec.appendChild( name );
		saveSec.appendChild( save );
		saveSec.appendChild( room );
		saveSec.appendChild( msg );

		function updateRoom() {
			room.textContent = 'Library: ' + userShapeCount() + ' of ' + cap + ' shapes used.';
		}

		save.addEventListener( 'click', function () {
			var picks = shapes.map( function ( shape, i ) {
				return { index: i, shape: shape };
			} ).filter( function ( pick ) {
				return ticks[ pick.index ];
			} );
			var base = name.input.value.trim();
			var left = cap - userShapeCount();
			updateRoom();
			if ( ! picks.length ) {
				msg.textContent = 'Tick at least one shape.';
				return;
			}
			if ( ! base ) {
				msg.textContent = 'Give the shapes a name.';
				return;
			}
			if ( picks.length > left ) {
				msg.textContent = 'Only ' + Math.max( 0, left ) + ' free slots left. Untick some, or delete shapes in My shapes.';
				return;
			}
			save.disabled = true;
			var done = [];
			var failure = '';
			var chain = Promise.resolve();
			// One at a time, so the server's name de-duplication cannot race.
			picks.forEach( function ( pick, n ) {
				chain = chain.then( function () {
					if ( failure ) {
						return null;
					}
					msg.textContent = 'Saving ' + ( n + 1 ) + ' of ' + picks.length + '...';
					return post( 'framify_shape_save', { name: 1 === picks.length ? base : base + ' ' + ( pick.index + 1 ), d: pick.shape.d, vb: pick.shape.vb } ).then( function ( res ) {
						if ( res && res.success ) {
							done.push( res.data );
						} else {
							failure = ( res && res.data && res.data.message ) || 'Could not save.';
						}
					} );
				} );
			} );
			chain.catch( function () {
				failure = failure || 'Could not save.';
			} ).then( function () {
				save.disabled = false;
				if ( done.length ) {
					// Next time start from fresh shapes, not the ones just saved.
					opts.seed = Dots.randomSeed();
					genMemory = opts;
				}
				if ( done.length && ( ! modal || ! layout.isConnected ) ) {
					savedQuietly( done );
				} else if ( done.length ) {
					savedMany( body, done, function () {
						showTab( GENERATE_TAB );
					}, failure ? 'Saved ' + done.length + ' of ' + picks.length + ': ' + failure : '' );
				} else {
					msg.textContent = failure || 'Could not save.';
					readoutText();
				}
			} );
		} );

		/* assemble */
		stage.appendChild( tiles );
		bar.appendChild( hint );
		bar.appendChild( readout );
		stageWrap.appendChild( stage );
		stageWrap.appendChild( bar );
		inspector.appendChild( patternSec );
		inspector.appendChild( dotsSec );
		inspector.appendChild( seedSec );
		inspector.appendChild( saveSec );
		layout.appendChild( stageWrap );
		layout.appendChild( inspector );
		body.appendChild( layout );
		var box = body.closest( '.framify-studio__box' );
		if ( box ) {
			box.style.width = MIN_BOX + 'px';
		}
		updateRoom();
		refresh();
	}

	function uploadTab( body ) {
		var msg = status();
		var name = nameField();
		var preview = el( 'img', 'framify-studio__preview' );
		preview.alt = '';
		preview.hidden = true;
		var shape = null;
		var file = el( 'input' );
		file.type = 'file';
		file.accept = '.svg,image/svg+xml';
		file.addEventListener( 'change', function () {
			var f = file.files && file.files[ 0 ];
			shape = null;
			preview.hidden = true;
			if ( ! f ) {
				return;
			}
			if ( f.size > 50000 ) {
				msg.textContent = 'That file is over 50 KB.';
				return;
			}
			var reader = new FileReader();
			reader.onload = function () {
				shape = readSvg( String( reader.result ) );
				if ( ! shape ) {
					msg.textContent = 'No usable <path> found. Convert shapes and strokes to paths in your design tool first.';
					return;
				}
				shape.text = String( reader.result );
				msg.textContent = '';
				preview.src = thumbOf( shape );
				preview.hidden = false;
				if ( ! name.input.value ) {
					name.input.value = f.name.replace( /\.svg$/i, '' ).replace( /[-_]+/g, ' ' );
				}
			};
			reader.readAsText( f );
		} );
		body.appendChild( el( 'p', 'framify-studio__hint', 'Choose an .svg made of <path> elements. Only the path data and viewBox are kept; colours, strokes and transforms are ignored.' ) );
		body.appendChild( file );
		body.appendChild( preview );
		body.appendChild( name );
		var save = el( 'button', 'framify-studio__btn framify-studio__btn--primary', 'Save shape' );
		save.type = 'button';
		save.addEventListener( 'click', function () {
			if ( ! shape ) {
				msg.textContent = 'Choose an SVG first.';
				return;
			}
			msg.textContent = 'Saving...';
			post( 'framify_shape_save', { name: name.input.value, svg: shape.text } ).then( function ( res ) {
				if ( res && res.success ) {
					saved( body, res.data, function () {
						showTab( 0 );
					} );
				} else {
					msg.textContent = ( res && res.data && res.data.message ) || 'Could not save.';
				}
			} ).catch( function () {
				msg.textContent = 'Could not save.';
			} );
		} );
		body.appendChild( save );
		body.appendChild( msg );
	}

	function download( shape ) {
		var blob = new Blob( [ shape.svg ], { type: 'image/svg+xml' } );
		var a = el( 'a' );
		a.href = URL.createObjectURL( blob );
		a.download = shape.id.replace( /^lib_(u_)?/, '' ) + '.svg';
		document.body.appendChild( a );
		a.click();
		a.remove();
		setTimeout( function () {
			URL.revokeObjectURL( a.href );
		}, 1000 );
	}

	function mineTab( body ) {
		var msg = status();
		var list = el( 'div', 'framify-studio__list' );
		var any = false;
		DATA.shapes.forEach( function ( shape ) {
			any = true;
			var row = el( 'div', 'framify-studio__item' );
			var img = el( 'img' );
			img.src = shape.thumb;
			img.alt = '';
			row.appendChild( img );
			row.appendChild( el( 'span', '', shape.title + ( 'user' === shape.source ? '' : ' (plugin)' ) ) );
			var dl = el( 'button', 'framify-studio__btn', 'Download' );
			dl.type = 'button';
			dl.title = 'Save the .svg; put it in the plugin\'s assets/shapes folder to ship it with the plugin';
			dl.addEventListener( 'click', function () {
				download( shape );
			} );
			row.appendChild( dl );
			if ( 'user' === shape.source ) {
				var del = el( 'button', 'framify-studio__btn framify-studio__btn--danger', 'Delete' );
				del.type = 'button';
				del.addEventListener( 'click', function () {
					if ( ! window.confirm( 'Delete "' + shape.title + '"? Elements using it fall back to the default shape.' ) ) {
						return;
					}
					post( 'framify_shape_delete', { id: shape.id } ).then( function ( res ) {
						if ( res && res.success ) {
							row.remove();
							DATA.shapes = DATA.shapes.filter( function ( sh ) {
								return sh.id !== shape.id;
							} );
							try {
								removeShapeLive( shape.id );
								msg.textContent = 'Deleted.';
							} catch ( e ) {
								msg.textContent = 'Deleted. Reload the editor to refresh the pickers.';
							}
						} else {
							msg.textContent = ( res && res.data && res.data.message ) || 'Could not delete.';
						}
					} );
				} );
				row.appendChild( del );
			}
			list.appendChild( row );
		} );
		if ( ! any ) {
			body.appendChild( el( 'p', 'framify-studio__hint', 'No shapes yet. Draw or upload one.' ) );
		}
		body.appendChild( list );
		body.appendChild( msg );
	}

	function open( prefix ) {
		close();
		context = 'string' === typeof prefix ? prefix : 'framify_org_shape';
		modal = el( 'div', 'framify-studio' );
		var box = el( 'div', 'framify-studio__box' );
		box.setAttribute( 'role', 'dialog' );
		box.setAttribute( 'aria-label', 'Shape studio' );
		var head = el( 'div', 'framify-studio__head' );
		var brand = el( 'div', 'framify-studio__brand' );
		brand.appendChild( icon( 'nib', 18 ) );
		brand.appendChild( el( 'strong', '', 'Shape studio' ) );
		head.appendChild( brand );
		var x = el( 'button', 'framify-studio__x', '\u00d7' );
		x.type = 'button';
		x.setAttribute( 'aria-label', 'Close' );
		x.addEventListener( 'click', close );
		var tabs = el( 'div', 'framify-studio__tabs' );
		var body = el( 'div', 'framify-studio__body' );
		var defs = [ [ 'Draw', drawTab ], [ 'Upload SVG', uploadTab ], [ 'My shapes', mineTab ] ];
		// The Generate tab needs the generator script; without it the tab is
		// simply absent.
		if ( window.FramifyDotShapes ) {
			defs.splice( GENERATE_TAB, 0, [ 'Generate', generateTab ] );
		}
		var buttons = defs.map( function ( def, i ) {
			var b = el( 'button', 'framify-studio__tab', def[ 0 ] );
			b.type = 'button';
			b.addEventListener( 'click', function () {
				show( i );
			} );
			tabs.appendChild( b );
			return b;
		} );
		function show( i ) {
			box.style.width = '';
			buttons.forEach( function ( b, j ) {
				b.classList.toggle( 'is-active', i === j );
			} );
			body.innerHTML = '';
			defs[ i ][ 1 ]( body );
		}
		head.appendChild( tabs );
		head.appendChild( x );
		box.appendChild( head );
		box.appendChild( body );
		modal.appendChild( box );
		modal.addEventListener( 'mousedown', function ( e ) {
			if ( e.target === modal ) {
				close();
			}
		} );
		document.body.appendChild( modal );
		showTab = show;
		show( 0 );
	}

	function ready() {
		if ( window.elementor && window.elementor.channels && window.elementor.channels.editor ) {
			[ 'framify_org_shape', 'framify_org_deco_shape' ].forEach( function ( prefix ) {
				window.elementor.channels.editor.on( 'framify:shapeStudio:' + prefix, function () {
					open( prefix );
				} );
			} );
		}
	}

	if ( window.elementor && window.elementor.on ) {
		window.elementor.on( 'preview:loaded', ready );
	}
	ready();
}() );
