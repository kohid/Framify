/**
 * Framify - Global Colour resolver (shared by Organic Shape, Floating
 * Shapes / Text and the Shape Divider).
 *
 * A colour control linked to a Global Colour keeps its value only in
 * __globals__, which never reaches the handler's settings. This puts the
 * resolved colour back into a copy of the settings:
 *   - published page: PHP writes data-framify-globals='{"control":"id"}' on
 *     the element (framify_globals_attribute);
 *   - editor: the element model's __globals__ ('globals/colors?id=...'), so a
 *     link made or removed in the panel applies without a reload.
 * The id resolves through Elementor's --e-global-color-{id} custom property.
 */
( function ( window ) {
	'use strict';

	var VAR = '--e-global-color-';

	function idOf( ref ) {
		var m = /[?&]id=([^&]+)/.exec( ref || '' );
		return m ? decodeURIComponent( m[ 1 ] ) : '';
	}

	// control key -> global colour id, for this element.
	function links( handler ) {
		var map = {};
		var el = handler.$element && handler.$element[ 0 ];
		var editing = window.elementorFrontend && window.elementorFrontend.isEditMode && window.elementorFrontend.isEditMode();
		try {
			if ( editing && handler.getEditSettings ) {
				// The model is the truth in the editor (the server markup is stale).
				var g = handler.getEditSettings( '__globals__' );
				if ( g && 'object' === typeof g ) {
					Object.keys( g ).forEach( function ( key ) {
						var id = idOf( g[ key ] );
						if ( id ) {
							map[ key ] = id;
						}
					} );
				}
			} else if ( el && el.getAttribute( 'data-framify-globals' ) ) {
				var o = JSON.parse( el.getAttribute( 'data-framify-globals' ) );
				Object.keys( o ).forEach( function ( key ) {
					map[ key ] = String( o[ key ] );
				} );
			}
		} catch ( e ) {
			return {};
		}
		return map;
	}

	// handler.getElementSettings() with linked colours resolved.
	function settings( handler ) {
		var s = handler.getElementSettings();
		var map = links( handler );
		var keys = Object.keys( map );
		var el = handler.$element && handler.$element[ 0 ];
		if ( ! keys.length || ! el ) {
			return s;
		}
		var out = {};
		Object.keys( s ).forEach( function ( key ) {
			out[ key ] = s[ key ];
		} );
		var cs = window.getComputedStyle( el );
		keys.forEach( function ( key ) {
			var v = cs.getPropertyValue( VAR + map[ key ] ).trim();
			if ( v ) {
				out[ key ] = v;
			}
		} );
		return out;
	}

	window.FramifyColor = { settings: settings };
}( window ) );
