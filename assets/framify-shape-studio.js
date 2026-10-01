/**
 * Framify - Shape studio (Elementor editor window).
 *
 * Opened by the "Draw or upload a shape" button on the Uploaded tab of the
 * Organic Shape / Deco Blob Shape pickers. Tabs: Draw (freehand outline),
 * Upload SVG, My shapes (download / delete). Saving posts only path data to
 * the server, which re-validates it and writes a clean SVG into
 * uploads/framify-shapes. The pickers are built by PHP, so a new shape needs
 * an editor reload to appear.
 */
( function () {
	'use strict';

	var DATA = window.framifyShapeStudio;
	var SIZE = 340;
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

	// Closed Catmull-Rom spline through the points, as cubic beziers.
	function smoothClosed( pts ) {
		var n = pts.length;
		var f = function ( v ) {
			return Math.round( v * 10 ) / 10;
		};
		var d = 'M' + f( pts[ 0 ][ 0 ] ) + ' ' + f( pts[ 0 ][ 1 ] );
		for ( var i = 0; i < n; i++ ) {
			var p0 = pts[ ( i - 1 + n ) % n ];
			var p1 = pts[ i ];
			var p2 = pts[ ( i + 1 ) % n ];
			var p3 = pts[ ( i + 2 ) % n ];
			d += 'C' + f( p1[ 0 ] + ( p2[ 0 ] - p0[ 0 ] ) / 6 ) + ' ' + f( p1[ 1 ] + ( p2[ 1 ] - p0[ 1 ] ) / 6 ) +
				' ' + f( p2[ 0 ] - ( p3[ 0 ] - p1[ 0 ] ) / 6 ) + ' ' + f( p2[ 1 ] - ( p3[ 1 ] - p1[ 1 ] ) / 6 ) +
				' ' + f( p2[ 0 ] ) + ' ' + f( p2[ 1 ] );
		}
		return d + 'Z';
	}

	// Strokes (arrays of [x, y]) -> { d, vb } scaled so the longer side is 100.
	function strokesToShape( strokes ) {
		var usable = strokes.filter( function ( s ) {
			return s.length >= 3;
		} ).map( function ( s ) {
			return thin( s, 6 );
		} ).filter( function ( s ) {
			return s.length >= 3;
		} );
		if ( ! usable.length ) {
			return null;
		}
		var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		usable.forEach( function ( s ) {
			s.forEach( function ( p ) {
				minX = Math.min( minX, p[ 0 ] );
				maxX = Math.max( maxX, p[ 0 ] );
				minY = Math.min( minY, p[ 1 ] );
				maxY = Math.max( maxY, p[ 1 ] );
			} );
		} );
		var w = Math.max( maxX - minX, 1 );
		var h = Math.max( maxY - minY, 1 );
		var k = 100 / Math.max( w, h );
		var d = usable.map( function ( s ) {
			return smoothClosed( s.map( function ( p ) {
				return [ ( p[ 0 ] - minX ) * k, ( p[ 1 ] - minY ) * k ];
			} ) );
		} ).join( ' ' );
		return { d: d, vb: '0 0 ' + Math.round( w * k * 10 ) / 10 + ' ' + Math.round( h * k * 10 ) / 10 };
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

	function saved( body ) {
		body.innerHTML = '';
		body.appendChild( el( 'p', 'framify-studio__done', 'Saved. Save your page, then reload the editor to pick it on the Uploaded tab.' ) );
		var reload = el( 'button', 'framify-studio__btn framify-studio__btn--primary', 'Reload editor' );
		reload.type = 'button';
		reload.addEventListener( 'click', function () {
			window.location.reload();
		} );
		body.appendChild( reload );
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
		return el( 'p', 'framify-studio__status' );
	}

	function drawTab( body ) {
		var strokes = [];
		var current = null;
		var canvas = el( 'canvas', 'framify-studio__canvas' );
		canvas.width = SIZE;
		canvas.height = SIZE;
		var ctx = canvas.getContext( '2d' );
		var msg = status();
		var name = nameField();

		function paint() {
			ctx.clearRect( 0, 0, SIZE, SIZE );
			var shape = strokesToShape( strokes.concat( current && current.length ? [ current ] : [] ) );
			if ( shape && ( ! current || ! current.length ) ) {
				// Finished: show the smoothed result.
				ctx.save();
				var k = SIZE / 100 * 0.9;
				ctx.translate( SIZE * 0.05, SIZE * 0.05 );
				ctx.scale( k, k );
				ctx.fillStyle = 'rgba(105,114,125,.35)';
				ctx.fill( new Path2D( shape.d ) );
				ctx.restore();
			}
			ctx.lineWidth = 2;
			ctx.lineJoin = 'round';
			ctx.lineCap = 'round';
			ctx.strokeStyle = '#d5008f';
			strokes.concat( current ? [ current ] : [] ).forEach( function ( s ) {
				ctx.beginPath();
				s.forEach( function ( p, i ) {
					ctx[ i ? 'lineTo' : 'moveTo' ]( p[ 0 ], p[ 1 ] );
				} );
				ctx.stroke();
			} );
		}

		function point( e ) {
			var r = canvas.getBoundingClientRect();
			return [ ( e.clientX - r.left ) * SIZE / r.width, ( e.clientY - r.top ) * SIZE / r.height ];
		}

		canvas.addEventListener( 'pointerdown', function ( e ) {
			canvas.setPointerCapture( e.pointerId );
			current = [ point( e ) ];
			paint();
		} );
		canvas.addEventListener( 'pointermove', function ( e ) {
			if ( current ) {
				current.push( point( e ) );
				paint();
			}
		} );
		function end() {
			if ( current ) {
				if ( current.length > 2 ) {
					strokes.push( current );
				}
				current = null;
				paint();
			}
		}
		canvas.addEventListener( 'pointerup', end );
		canvas.addEventListener( 'pointercancel', end );

		body.appendChild( el( 'p', 'framify-studio__hint', 'Draw an outline with the mouse, finger or pen. Each stroke closes itself and is smoothed. Draw several strokes for a multi-part shape.' ) );
		body.appendChild( canvas );
		var row = el( 'div', 'framify-studio__row' );
		var undo = el( 'button', 'framify-studio__btn', 'Undo' );
		var clear = el( 'button', 'framify-studio__btn', 'Clear' );
		undo.type = clear.type = 'button';
		undo.addEventListener( 'click', function () {
			strokes.pop();
			paint();
		} );
		clear.addEventListener( 'click', function () {
			strokes = [];
			paint();
		} );
		row.appendChild( undo );
		row.appendChild( clear );
		body.appendChild( row );
		body.appendChild( name );
		var save = el( 'button', 'framify-studio__btn framify-studio__btn--primary', 'Save shape' );
		save.type = 'button';
		save.addEventListener( 'click', function () {
			var shape = strokesToShape( strokes );
			if ( ! shape ) {
				msg.textContent = 'Draw an outline first.';
				return;
			}
			msg.textContent = 'Saving...';
			post( 'framify_shape_save', { name: name.input.value, d: shape.d, vb: shape.vb } ).then( function ( res ) {
				if ( res && res.success ) {
					saved( body );
				} else {
					msg.textContent = ( res && res.data && res.data.message ) || 'Could not save.';
				}
			} ).catch( function () {
				msg.textContent = 'Could not save.';
			} );
		} );
		body.appendChild( save );
		body.appendChild( msg );
		paint();
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
					saved( body );
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
							msg.textContent = 'Deleted. Reload the editor to refresh the pickers.';
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

	function open() {
		close();
		modal = el( 'div', 'framify-studio' );
		var box = el( 'div', 'framify-studio__box' );
		var head = el( 'div', 'framify-studio__head' );
		head.appendChild( el( 'strong', '', 'Shape studio' ) );
		var x = el( 'button', 'framify-studio__x', '×' );
		x.type = 'button';
		x.setAttribute( 'aria-label', 'Close' );
		x.addEventListener( 'click', close );
		head.appendChild( x );
		var tabs = el( 'div', 'framify-studio__tabs' );
		var body = el( 'div', 'framify-studio__body' );
		var defs = [ [ 'Draw', drawTab ], [ 'Upload SVG', uploadTab ], [ 'My shapes', mineTab ] ];
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
			buttons.forEach( function ( b, j ) {
				b.classList.toggle( 'is-active', i === j );
			} );
			body.innerHTML = '';
			defs[ i ][ 1 ]( body );
		}
		box.appendChild( head );
		box.appendChild( tabs );
		box.appendChild( body );
		modal.appendChild( box );
		modal.addEventListener( 'mousedown', function ( e ) {
			if ( e.target === modal ) {
				close();
			}
		} );
		document.body.appendChild( modal );
		show( 0 );
	}

	function ready() {
		if ( window.elementor && window.elementor.channels && window.elementor.channels.editor ) {
			window.elementor.channels.editor.on( 'framify:shapeStudio', open );
		}
	}

	if ( window.elementor && window.elementor.on ) {
		window.elementor.on( 'preview:loaded', ready );
	}
	ready();
}() );
