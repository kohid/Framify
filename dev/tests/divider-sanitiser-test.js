/**
 * Dev-only unit test of the Shape Divider SVG sanitiser
 * (FramifyOrganicShape.svgGeometry in assets/framify-elementor.js), run with
 * plain node: node dev/tests/divider-sanitiser-test.js
 *
 * The script is loaded into a vm context with a tiny DOMParser stand-in (a
 * few lines of XML tag parsing: elements, attributes, comments, CDATA; no
 * entities, no namespaces), enough for the DOM calls svgGeometry makes
 * (documentElement, localName, getAttribute, children,
 * getElementsByTagName( 'parsererror' )). Real browsers are checked in the
 * editor; this pins the rules: geometry only, transforms and viewBox
 * applied, everything else dropped.
 */
'use strict';

var fs = require( 'fs' );
var path = require( 'path' );
var vm = require( 'vm' );

function Node( name, attrs ) {
	this.localName = name;
	this.attrs = attrs;
	this.children = [];
}
Node.prototype.getAttribute = function ( n ) {
	return Object.prototype.hasOwnProperty.call( this.attrs, n ) ? this.attrs[ n ] : null;
};

function MiniDOMParser() {}
MiniDOMParser.prototype.parseFromString = function ( text ) {
	var stack = [ new Node( '#document', {} ) ];
	var errors = 0;
	var re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|(<)/g;
	var m;
	while ( ( m = re.exec( text ) ) ) {
		if ( m[ 1 ] ) {
			var open = stack.pop();
			if ( ! open || open.localName !== m[ 1 ].replace( /^.*:/, '' ) ) {
				errors++;
			}
		} else if ( m[ 2 ] ) {
			var attrs = {};
			( m[ 3 ] || '' ).replace( /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, function ( all, k, a, b ) {
				attrs[ k ] = undefined !== a ? a : b;
			} );
			var node = new Node( m[ 2 ].replace( /^.*:/, '' ), attrs );
			stack[ stack.length - 1 ].children.push( node );
			if ( ! m[ 4 ] ) {
				stack.push( node );
			}
		} else if ( m[ 6 ] ) {
			errors++;
		}
	}
	if ( 1 !== stack.length || 1 !== stack[ 0 ].children.length ) {
		errors++;
	}
	return {
		documentElement: stack[ 0 ].children[ 0 ] || null,
		getElementsByTagName: function () {
			return { length: errors };
		}
	};
};

var hooks = [];
var context = {
	console: console,
	Math: Math,
	DOMParser: MiniDOMParser,
	addEventListener: function ( name ) {
		hooks.push( name );
	}
};
context.window = context;
vm.createContext( context );
vm.runInContext( fs.readFileSync( path.join( __dirname, '../../assets/framify-elementor.js' ), 'utf8' ), context );

var Shape = context.FramifyOrganicShape;
var failures = 0;
function check( label, ok ) {
	console.log( ( ok ? 'PASS ' : 'FAIL ' ) + label );
	if ( ! ok ) {
		failures++;
	}
}
function nums( d ) {
	return ( d.match( /-?\d*\.?\d+(?:e[-+]?\d+)?/gi ) || [] ).map( Number );
}
// Bounds of all end / control points of an M / L / C path.
function bounds( d ) {
	var n = nums( d );
	var xs = n.filter( function ( v, i ) {
		return 0 === i % 2;
	} );
	var ys = n.filter( function ( v, i ) {
		return 1 === i % 2;
	} );
	return [ Math.min.apply( null, xs ), Math.min.apply( null, ys ), Math.max.apply( null, xs ), Math.max.apply( null, ys ) ].map( function ( v ) {
		return Math.round( v * 100 ) / 100;
	} );
}

check( 'FramifyOrganicShape is exposed with the sanitiser and tracer', !! Shape && 'function' === typeof Shape.svgGeometry && 'function' === typeof Shape.parseSvgShape && 'function' === typeof Shape.traceCustom && 'function' === typeof Shape.parseCustom );
check( 'loading the script only registers the Elementor init listener', 1 === hooks.length && 'elementor/frontend/init' === hooks[ 0 ] );

// A hostile document: script, event handlers, style, image, use,
// foreignObject (with a rect inside), defs, text; plus real geometry.
var hostile = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1000 100" onload="window.pwned=1">'
	+ '<script>window.pwned = 2</script>'
	+ '<style>path{fill:red}</style>'
	+ '<image href="x.png" width="1000" height="100" onerror="window.pwned=3"/>'
	+ '<defs><rect id="hidden" x="0" y="0" width="999" height="99"/></defs>'
	+ '<use href="#hidden" xlink:href="#hidden"/>'
	+ '<foreignObject width="100" height="100"><rect x="5" y="5" width="7" height="7"/></foreignObject>'
	+ '<text x="10" y="10">hi</text>'
	+ '<path d="M0 0H1000V40Q500 90 0 40Z" onclick="window.pwned=4"/>'
	+ '<g transform="translate(100 10) scale(2)"><polygon points="0,0 10,0 10,10"/><circle cx="50" cy="5" r="5"/></g>'
	+ '</svg>';
var geo = Shape.svgGeometry( hostile );
check( 'hostile document: geometry found, box = the root viewBox', geo && geo.box && 0 === geo.box.x && 1000 === geo.box.w && 100 === geo.box.h );
check( 'hostile document: output is only M / L / C / Z and numbers', geo && /^[MLCZ0-9 .\-e]+$/.test( geo.d ) );
check( 'hostile document: no markup, attribute or script text survives', geo && ! /pwned|script|href|style|image|<|=|\(/i.test( geo.d ) );
var subpaths = geo ? geo.d.split( 'M' ).length - 1 : 0;
check( 'hostile document: exactly 3 shapes (path, polygon, circle); defs / use / foreignObject / text / image dropped', 3 === subpaths );
check( 'hostile document: one part per source shape (painted apart), joined into d', geo && 3 === geo.parts.length && geo.parts.join( ' ' ) === geo.d );
check( 'hostile document: nothing from the defs rect (999) or the foreignObject rect (5..12)', geo && -1 === geo.d.indexOf( '999' ) && -1 === geo.d.indexOf( 'M5 5' ) );

// Transforms: translate(100 10) scale(2) on the group.
var poly = Shape.svgGeometry( '<svg viewBox="0 0 200 100"><g transform="translate(100 10) scale(2)"><polygon points="0,0 10,0 10,10"/></g></svg>' );
check( 'group transform applied to a polygon: (0,0)(10,0)(10,10) -> (100,10)(120,10)(120,30)', poly && 'M100 10L120 10L120 30Z' === poly.d );
var circ = Shape.svgGeometry( '<svg viewBox="0 0 200 100"><g transform="translate(100 10) scale(2)"><circle cx="50" cy="5" r="5"/></g></svg>' );
check( 'circle converted to cubics with the transform: centre (200,20), r 10 -> bounds (190,10)-(210,30)', circ && /^M[^M]*Z$/.test( circ.d ) && -1 === circ.d.indexOf( 'A' ) && '190,10,210,30' === bounds( circ.d ).join( ',' ) );
var nested = Shape.svgGeometry( '<svg viewBox="0 0 100 100"><g transform="translate(10 0)"><g transform="rotate(90)"><rect x="0" y="0" width="20" height="10" transform="translate(0 -10)"/></g></g></svg>' );
// rect (0,-10)-(20,0) after its own translate; rotate(90): (x,y) -> (-y,x)
// gives (0,0)-(10,20); the outer translate(10 0) moves it to (10,0)-(20,20).
check( 'nested transforms compose outer-first (translate, rotate 90, element translate)', nested && '10,0,20,20' === bounds( nested.d ).join( ',' ) );
var mat = Shape.svgGeometry( '<svg viewBox="0 0 100 100"><path transform="matrix(1 0 0 -1 0 100)" d="m0 0 l10 0 v10z"/></svg>' );
check( 'matrix() and relative path commands: m0 0 l10 0 v10 z flipped by matrix(1 0 0 -1 0 100)', mat && 'M0 100L10 100L10 90Z' === mat.d );
var skew = Shape.svgGeometry( '<svg viewBox="0 0 100 100"><line x1="0" y1="10" x2="0" y2="20" transform="skewX(45)"/></svg>' );
check( 'skewX(45) shifts x by y', skew && 'M10 10L20 20' === skew.d );
var arc = Shape.svgGeometry( '<svg viewBox="0 0 100 100"><path d="M0 50a50 50 0 0150-50"/></svg>' );
check( 'packed arc flags read and converted to one cubic ending at (50,0)', arc && /^M0 50C[^C]*50 0$/.test( arc.d ) );
var rounded = Shape.svgGeometry( '<svg viewBox="0 0 100 100"><rect width="100" height="50" rx="10"/></svg>' );
check( 'rounded rect -> cubic corners inside its box', rounded && '0,0,100,50' === bounds( rounded.d ).join( ',' ) && -1 === rounded.d.indexOf( 'A' ) );
var quad = Shape.svgGeometry( '<svg viewBox="0 0 100 100"><path d="M0 0Q50 100 100 0T200 0"/></svg>' );
check( 'Q / T converted to cubics (2 C segments)', quad && 2 === quad.d.split( 'C' ).length - 1 );

// Rejections.
check( 'a path with a non-path character is dropped', null === Shape.svgGeometry( '<svg viewBox="0 0 10 10"><path d="M0 0L10 0;alert(1)"/></svg>' ) );
check( 'a bad transform drops only that element', null === Shape.svgGeometry( '<svg viewBox="0 0 10 10"><rect width="5" height="5" transform="url(javascript:alert(1))"/></svg>' ) );
check( 'percent sizes are dropped (no guessed geometry)', null === Shape.svgGeometry( '<svg viewBox="0 0 10 10"><rect width="50%" height="5"/></svg>' ) );
check( 'display="none" elements are skipped', null === Shape.svgGeometry( '<svg viewBox="0 0 10 10"><rect width="5" height="5" display="none"/></svg>' ) );
check( 'not an svg root -> false (the caller falls back to the Custom-shape regex)', false === Shape.svgGeometry( '<path d="M0 0L1 1"/>' ) && false === Shape.svgGeometry( '<svg><rect width="1" height="1"></svg>' ) );
check( 'no viewBox: width / height give the box, else null (measured later)', ( function () {
	var a = Shape.svgGeometry( '<svg width="300" height="60"><rect width="5" height="5"/></svg>' );
	var b = Shape.svgGeometry( '<svg width="100%"><rect width="5" height="5"/></svg>' );
	return a && 300 === a.box.w && 60 === a.box.h && b && null === b.box;
}() ) );
check( 'oversized input is refused', false === Shape.svgGeometry( '<svg viewBox="0 0 1 1">' + new Array( 200002 ).join( ' ' ) + '</svg>' ) );

console.log( failures ? '\n' + failures + ' FAILED' : '\nALL PASSED' );
process.exit( failures ? 1 : 0 );
