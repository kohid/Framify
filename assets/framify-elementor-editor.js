/**
 * Framify - Elementor editor panel
 *
 * Float on Containers runs only on a nested container (the frontend CSS
 * gates it on .e-child, which Elementor derives from the model's isInner).
 * When a Container's panel opens, the whole panel (#elementor-panel) gets
 * .framify-float-off for a top-level container, and
 * framify-elementor-editor.css hides the Float section and its controls.
 * The class sits on the panel, not on the editor page view, because a tab
 * switch replaces that page view (checked in Elementor 4.2.4); opening any
 * other element clears it, so widgets keep their Float section. If this
 * cannot run, the Float switch's description tells the user instead.
 *
 * Shape Divider is the inverse: top-level containers only (the frontend
 * script ignores .e-child), so a nested container's panel gets
 * .framify-divider-off, which hides that section the same way.
 *
 * File: assets/framify-elementor-editor.js
 */
( function () {
	'use strict';

	var OTHER_TYPES = [ 'widget', 'section', 'column' ];

	function isNested( model, view ) {
		if ( model && model.get( 'isInner' ) ) {
			return true;
		}
		return !! ( view && view.$el && view.$el.hasClass( 'e-child' ) );
	}

	function setOff( off ) {
		var panel = elementor.getPanelView ? elementor.getPanelView() : null;
		if ( panel && panel.$el ) {
			panel.$el.toggleClass( 'framify-float-off', off );
		}
	}

	function setDividerOff( off ) {
		var panel = elementor.getPanelView ? elementor.getPanelView() : null;
		if ( panel && panel.$el ) {
			panel.$el.toggleClass( 'framify-divider-off', off );
		}
	}

	function onOpen( panel, model, view ) {
		setOff( ! isNested( model, view ) );
		setDividerOff( isNested( model, view ) );
	}

	function onOther() {
		setOff( false );
		setDividerOff( false );
	}

	function init() {
		var i;
		if ( window.elementor && elementor.hooks ) {
			elementor.hooks.addAction( 'panel/open_editor/container', onOpen );
			for ( i = 0; i < OTHER_TYPES.length; i++ ) {
				elementor.hooks.addAction( 'panel/open_editor/' + OTHER_TYPES[ i ], onOther );
			}
		}
	}

	if ( window.elementor && elementor.hooks ) {
		init();
	} else {
		window.addEventListener( 'elementor/init', init );
	}
}() );
