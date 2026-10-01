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

	var TOOLS = [
		[ 'pen', 'Pen', 'Click to place corner points. Click and drag to pull curve handles. Click the first point to close, or press Enter to finish an open path.' ],
		[ 'select', 'Select', 'Drag a point to move it, or drag a handle to bend the curve. Hold Alt while dragging a handle to break it from its twin.' ],
		[ 'add', 'Add point', 'Click on a line to add a point there.' ],
		[ 'delete', 'Delete point', 'Click a point to remove it (or select one and press Delete).' ],
		[ 'convert', 'Convert point', 'Click a curve point to make it a corner, or a corner to make it smooth. Click and drag a point to pull its handles out.' ],
		[ 'free', 'Freehand', 'Draw an outline with the mouse, finger or pen. It becomes editable points.' ]
	];

	function numberField( label, value ) {
		var wrap = el( 'label', 'framify-studio__size' );
		wrap.appendChild( el( 'span', '', label ) );
		var input = el( 'input' );
		input.type = 'number';
		input.min = 100;
		input.max = 900;
		input.step = 10;
		input.value = value;
		wrap.appendChild( input );
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
		var canvas = el( 'canvas', 'framify-studio__canvas' );
		canvas.tabIndex = 0;
		canvas.width = W;
		canvas.height = H;
		var ctx = canvas.getContext( '2d' );
		var msg = status();
		var name = nameField();
		var hint = el( 'p', 'framify-studio__hint' );

		function sc() {
			var r = canvas.getBoundingClientRect();
			return r.width ? canvas.width / r.width : 1;
		}

		function point( e ) {
			var r = canvas.getBoundingClientRect();
			return [ ( e.clientX - r.left ) * canvas.width / r.width, ( e.clientY - r.top ) * canvas.height / r.height ];
		}

		function record() {
			history.push( clone( model ) );
			if ( history.length > 60 ) {
				history.shift();
			}
		}

		function undo() {
			if ( history.length ) {
				model = history.pop();
				sel = null;
				active = -1;
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

		function paint() {
			var s = sc();
			ctx.clearRect( 0, 0, W, H );
			var ident = function ( x, y ) {
				return [ x, y ];
			};
			var filled = pathD( model, ident, true );
			if ( filled ) {
				ctx.fillStyle = 'rgba(105,114,125,.28)';
				ctx.fill( new Path2D( filled ) );
			}
			ctx.lineWidth = 1.6 * s;
			ctx.lineJoin = 'round';
			ctx.strokeStyle = '#d5008f';
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
			// Anchors; handles for the selected one (and the pen's last point).
			var show = [];
			if ( sel ) {
				show.push( sel );
			}
			if ( 'pen' === tool && active >= 0 && model.paths[ active ] ) {
				show.push( { pi: active, ni: model.paths[ active ].nodes.length - 1 } );
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
					ctx.strokeStyle = '#8a93a0';
					ctx.beginPath();
					ctx.moveTo( n.x, n.y );
					ctx.lineTo( hd[ 0 ], hd[ 1 ] );
					ctx.stroke();
					ctx.fillStyle = '#fff';
					ctx.strokeStyle = '#d5008f';
					ctx.beginPath();
					ctx.arc( hd[ 0 ], hd[ 1 ], 4 * s, 0, 6.2832 );
					ctx.fill();
					ctx.stroke();
				} );
			} );
			model.paths.forEach( function ( path, pi ) {
				path.nodes.forEach( function ( n, ni ) {
					var on = sel && sel.pi === pi && sel.ni === ni;
					var r = 4.5 * s;
					ctx.fillStyle = on ? '#d5008f' : '#fff';
					ctx.strokeStyle = '#d5008f';
					ctx.lineWidth = 1.6 * s;
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

		canvas.addEventListener( 'pointerdown', function ( e ) {
			canvas.focus();
			canvas.setPointerCapture( e.pointerId );
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
				record();
				if ( ! act ) {
					model.paths.push( { closed: false, nodes: [] } );
					active = model.paths.length - 1;
					act = model.paths[ active ];
				}
				var node = { x: pt[ 0 ], y: pt[ 1 ], hin: null, hout: null, smooth: false };
				act.nodes.push( node );
				sel = { pi: active, ni: act.nodes.length - 1 };
				drag = { type: 'pull', node: node };
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
					drag = { type: 'move', last: pt };
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
			var pt = point( e );
			if ( stroke ) {
				stroke.push( pt );
				paint();
				return;
			}
			if ( ! drag ) {
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
				var dx = pt[ 0 ] - drag.last[ 0 ];
				var dy = pt[ 1 ] - drag.last[ 1 ];
				node.x += dx;
				node.y += dy;
				[ node.hin, node.hout ].forEach( function ( hd ) {
					if ( hd ) {
						hd[ 0 ] += dx;
						hd[ 1 ] += dy;
					}
				} );
				drag.last = pt;
			} else if ( 'handle' === drag.type ) {
				var hn = model.paths[ sel.pi ].nodes[ sel.ni ];
				var other = 'hout' === drag.which ? 'hin' : 'hout';
				if ( e.altKey ) {
					hn.smooth = false;
				}
				hn[ drag.which ] = pt;
				if ( hn.smooth && hn[ other ] ) {
					var len = dist( hn[ other ], [ hn.x, hn.y ] );
					var dir = [ hn.x - pt[ 0 ], hn.y - pt[ 1 ] ];
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
		canvas.addEventListener( 'dblclick', function () {
			active = -1;
			paint();
		} );
		canvas.addEventListener( 'keydown', function ( e ) {
			if ( ( e.ctrlKey || e.metaKey ) && 'z' === e.key.toLowerCase() ) {
				e.preventDefault();
				undo();
			} else if ( ( 'Delete' === e.key || 'Backspace' === e.key ) && sel ) {
				e.preventDefault();
				record();
				removeNode( sel.pi, sel.ni );
				paint();
			} else if ( 'Enter' === e.key || 'Escape' === e.key ) {
				active = -1;
				if ( 'Escape' === e.key ) {
					sel = null;
				}
				paint();
			}
		} );

		// Toolbar.
		var bar = el( 'div', 'framify-studio__tools' );
		var toolButtons = {};
		TOOLS.forEach( function ( def ) {
			var b = el( 'button', 'framify-studio__tool', def[ 1 ] );
			b.type = 'button';
			b.title = def[ 2 ];
			b.addEventListener( 'click', function () {
				tool = def[ 0 ];
				active = tool === 'pen' ? active : -1;
				Object.keys( toolButtons ).forEach( function ( k ) {
					toolButtons[ k ].classList.toggle( 'is-active', k === tool );
				} );
				hint.textContent = def[ 2 ];
				canvas.dataset.tool = tool;
				paint();
			} );
			toolButtons[ def[ 0 ] ] = b;
			bar.appendChild( b );
		} );
		toolButtons.pen.classList.add( 'is-active' );
		hint.textContent = TOOLS[ 0 ][ 2 ];
		canvas.dataset.tool = 'pen';

		// Canvas size: the drawing is scaled with it, so resizing never
		// loses work.
		var wField = numberField( 'Width', W );
		var hField = numberField( 'Height', H );
		var frame = el( 'input' );
		frame.type = 'checkbox';
		var frameLabel = el( 'label', 'framify-studio__check' );
		frameLabel.appendChild( frame );
		frameLabel.appendChild( el( 'span', '', 'Keep the canvas frame (do not crop to the drawing)' ) );
		function resize() {
			var nw = Math.min( 900, Math.max( 100, parseInt( wField.input.value, 10 ) || W ) );
			var nh = Math.min( 900, Math.max( 100, parseInt( hField.input.value, 10 ) || H ) );
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
			canvas.width = W;
			canvas.height = H;
			paint();
		}
		wField.input.addEventListener( 'change', resize );
		hField.input.addEventListener( 'change', resize );
		var sizeRow = el( 'div', 'framify-studio__row' );
		sizeRow.appendChild( wField );
		sizeRow.appendChild( hField );

		body.appendChild( bar );
		body.appendChild( hint );
		body.appendChild( sizeRow );
		body.appendChild( canvas );
		body.appendChild( frameLabel );
		var row = el( 'div', 'framify-studio__row' );
		var undoB = el( 'button', 'framify-studio__btn', 'Undo' );
		var clear = el( 'button', 'framify-studio__btn', 'Clear' );
		undoB.type = clear.type = 'button';
		undoB.addEventListener( 'click', undo );
		clear.addEventListener( 'click', function () {
			record();
			model = { paths: [] };
			sel = null;
			active = -1;
			paint();
		} );
		row.appendChild( undoB );
		row.appendChild( clear );
		body.appendChild( row );
		body.appendChild( name );
		var save = el( 'button', 'framify-studio__btn framify-studio__btn--primary', 'Save shape' );
		save.type = 'button';
		save.addEventListener( 'click', function () {
			var shape = modelToShape( model, W, H, frame.checked );
			if ( ! shape ) {
				msg.textContent = 'Draw a closed outline with at least 3 points first.';
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
