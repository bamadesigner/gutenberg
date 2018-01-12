/**
 * External dependencies
 */
import {
	filter,
	find,
	findIndex,
	flow,
	groupBy,
	includes,
	pick,
	some,
	sortBy,
	isEmpty,
} from 'lodash';
import { connect } from 'react-redux';

/**
 * WordPress dependencies
 */
import { __, _n, sprintf } from '@wordpress/i18n';
import { Component, compose } from '@wordpress/element';
import {
	TabPanel,
	TabbableContainer,
	withInstanceId,
	withSpokenMessages,
	withContext,
} from '@wordpress/components';
import { getCategories, getBlockTypes, isReusableBlock } from '@wordpress/blocks';
import { keycodes } from '@wordpress/utils';

/**
 * Internal dependencies
 */
import './style.scss';

import { getBlocks, getRecentlyUsedBlocks, getReusableBlocks } from '../../store/selectors';
import { fetchReusableBlocks } from '../../store/actions';
import { default as InserterGroup } from './group';
import BlockPreview from '../block-preview';

export const searchBlocks = ( blocks, searchTerm ) => {
	const normalizedSearchTerm = searchTerm.toLowerCase().trim();
	const matchSearch = ( string ) => string.toLowerCase().indexOf( normalizedSearchTerm ) !== -1;

	return blocks.filter( ( block ) =>
		matchSearch( block.title ) || some( block.keywords, matchSearch )
	);
};

/**
 * Module constants
 */
const ARROWS = pick( keycodes, [ 'UP', 'DOWN', 'LEFT', 'RIGHT' ] );

export class InserterMenu extends Component {
	constructor() {
		super( ...arguments );
		this.nodes = {};
		this.state = {
			filterValue: '',
			tab: 'recent',
			selectedBlock: null,
		};
		this.filter = this.filter.bind( this );
		this.searchBlocks = this.searchBlocks.bind( this );
		this.getBlocksForTab = this.getBlocksForTab.bind( this );
		this.sortBlocks = this.sortBlocks.bind( this );
		this.bindReferenceNode = this.bindReferenceNode.bind( this );
		this.selectBlock = this.selectBlock.bind( this );

		this.tabScrollTop = { recent: 0, blocks: 0, embeds: 0 };
		this.switchTab = this.switchTab.bind( this );
		this.previewBlock = this.previewBlock.bind( this );
	}

	componentDidMount() {
		this.props.fetchReusableBlocks();
	}

	componentDidUpdate( prevProps, prevState ) {
		const searchResults = this.searchBlocks( this.getBlockTypes() );
		// Announce the blocks search results to screen readers.
		if ( this.state.filterValue && !! searchResults.length ) {
			this.props.debouncedSpeak( sprintf( _n(
				'%d result found',
				'%d results found',
				searchResults.length
			), searchResults.length ), 'assertive' );
		} else if ( this.state.filterValue ) {
			this.props.debouncedSpeak( __( 'No results.' ), 'assertive' );
		}

		if ( this.state.tab !== prevState.tab ) {
			this.tabContainer.scrollTop = this.tabScrollTop[ this.state.tab ];
		}
	}

	isDisabledBlock( blockType ) {
		return blockType.useOnce && find( this.props.blocks, ( { name } ) => blockType.name === name );
	}

	bindReferenceNode( nodeName ) {
		return ( node ) => this.nodes[ nodeName ] = node;
	}

	filter( event ) {
		this.setState( {
			filterValue: event.target.value,
		} );
	}

	/**
	 * Sets the currently hovered block as selected to preview it.
	 *
	 * @param   {Object} block Block object.
	 */
	previewBlock( block ) {
		this.setState( { selectedBlock: block } );
	}

	selectBlock( block ) {
		return () => {
			this.props.onSelect( block.name, block.initialAttributes );
			this.setState( {
				filterValue: '',
			} );
		};
	}

	getStaticBlockTypes() {
		const { blockTypes } = this.props;

		// If all block types disabled, return empty set
		if ( ! blockTypes ) {
			return [];
		}

		// Block types that are marked as private should not appear in the inserter
		return getBlockTypes().filter( ( block ) => {
			if ( block.isPrivate ) {
				return false;
			}

			// Block types defined as either `true` or array:
			//  - True: Allow
			//  - Array: Check block name within whitelist
			return (
				! Array.isArray( blockTypes ) ||
				includes( blockTypes, block.name )
			);
		} );
	}

	getReusableBlockTypes() {
		const { reusableBlocks } = this.props;

		// Display reusable blocks that we've fetched in the inserter
		return reusableBlocks.map( ( reusableBlock ) => ( {
			name: 'core/block',
			initialAttributes: {
				ref: reusableBlock.id,
			},
			title: reusableBlock.title,
			icon: 'layout',
			category: 'reusable-blocks',
		} ) );
	}

	getBlockTypes() {
		return [
			...this.getStaticBlockTypes(),
			...this.getReusableBlockTypes(),
		];
	}

	searchBlocks( blockTypes ) {
		return searchBlocks( blockTypes, this.state.filterValue );
	}

	getBlocksForTab( tab ) {
		const blockTypes = this.getBlockTypes();
		// if we're searching, use everything, otherwise just get the blocks visible in this tab
		if ( this.state.filterValue ) {
			return blockTypes;
		}

		let predicate;
		switch ( tab ) {
			case 'recent':
				return filter( this.props.recentlyUsedBlocks,
					( { name } ) => find( blockTypes, { name } ) );

			case 'blocks':
				predicate = ( block ) => block.category !== 'embed' && block.category !== 'reusable-blocks';
				break;

			case 'embeds':
				predicate = ( block ) => block.category === 'embed';
				break;

			case 'saved':
				predicate = ( block ) => block.category === 'reusable-blocks';
				break;
		}

		return filter( blockTypes, predicate );
	}

	sortBlocks( blockTypes ) {
		if ( 'recent' === this.state.tab && ! this.state.filterValue ) {
			return blockTypes;
		}

		const getCategoryIndex = ( item ) => {
			return findIndex( getCategories(), ( category ) => category.slug === item.category );
		};

		return sortBy( blockTypes, getCategoryIndex );
	}

	groupByCategory( blockTypes ) {
		return groupBy( blockTypes, ( blockType ) => blockType.category );
	}

	getVisibleBlocksByCategory( blockTypes ) {
		return flow(
			this.searchBlocks,
			this.sortBlocks,
			this.groupByCategory
		)( blockTypes );
	}

	renderBlocks( blockTypes, separatorSlug ) {
		const { instanceId } = this.props;
		const labelledBy = separatorSlug === undefined ? null : `editor-inserter__separator-${ separatorSlug }-${ instanceId }`;
		const blockTypesInfo = blockTypes.map( ( blockType ) => (
			{ ...blockType, disabled: this.isDisabledBlock( blockType ) }
		) );

		return (
			<InserterGroup
				blockTypes={ blockTypesInfo }
				labelledBy={ labelledBy }
				bindReferenceNode={ this.bindReferenceNode }
				selectBlock={ this.selectBlock }
				onHover={ this.previewBlock }
			/>
		);
	}

	renderCategory( category, blockTypes ) {
		const { instanceId } = this.props;
		return blockTypes && (
			<div key={ category.slug }>
				<div
					className="editor-inserter__separator"
					id={ `editor-inserter__separator-${ category.slug }-${ instanceId }` }
					aria-hidden="true"
				>
					{ category.title }
				</div>
				{ this.renderBlocks( blockTypes, category.slug ) }
			</div>
		);
	}

	renderCategories( visibleBlocksByCategory ) {
		if ( isEmpty( visibleBlocksByCategory ) ) {
			return (
				<span className="editor-inserter__no-results">
					{ __( 'No blocks found' ) }
				</span>
			);
		}

		return getCategories().map(
			( category ) => this.renderCategory( category, visibleBlocksByCategory[ category.slug ] )
		);
	}

	switchTab( tab ) {
		// store the scrollTop of the tab switched from
		this.tabScrollTop[ this.state.tab ] = this.tabContainer.scrollTop;
		this.setState( { tab } );
	}

	renderTabView( tab ) {
		const blocksForTab = this.getBlocksForTab( tab );

		// If the Recent tab is selected, don't render category headers
		if ( 'recent' === tab ) {
			return this.renderBlocks( blocksForTab );
		}

		// If the Saved tab is selected and we have no results, display a friendly message
		if ( 'saved' === tab && blocksForTab.length === 0 ) {
			return (
				<p className="editor-inserter__no-tab-content-message">
					{ __( 'No saved blocks.' ) }
				</p>
			);
		}

		const visibleBlocksByCategory = this.getVisibleBlocksByCategory( blocksForTab );

		// If our results have only blocks from one category, don't render category headers
		const categories = Object.keys( visibleBlocksByCategory );
		if ( categories.length === 1 ) {
			const [ soleCategory ] = categories;
			return this.renderBlocks( visibleBlocksByCategory[ soleCategory ] );
		}

		return this.renderCategories( visibleBlocksByCategory );
	}

	// Passed to TabbableContainer, extending its event-handling logic
	eventToOffset( event ) {
		// If a tab (Recent, Blocks, …) is focused, pressing the down arrow
		// moves focus to the selected panel below.
		if (
			event.keyCode === keycodes.DOWN &&
			document.activeElement.getAttribute( 'role' ) === 'tab'
		) {
			return 1; // Move focus forward
		}

		// Prevent cases of focus being unexpectedly stolen up in the tree,
		// notably when using VisualEditorSiblingInserter, where focus is
		// moved to sibling blocks.
		if ( includes( ARROWS, event.keyCode ) ) {
			return 0; // Don't move focus, but prevent event propagation
		}

		// Implicit `undefined` return: let the event propagate
	}

	render() {
		const { instanceId } = this.props;
		const { selectedBlock } = this.state;
		const isSearching = this.state.filterValue;

		return (
			<TabbableContainer
				className="editor-inserter__menu"
				deep
				eventToOffset={ this.eventToOffset }
			>
				<label htmlFor={ `editor-inserter__search-${ instanceId }` } className="screen-reader-text">
					{ __( 'Search for a block' ) }
				</label>
				<input
					id={ `editor-inserter__search-${ instanceId }` }
					type="search"
					placeholder={ __( 'Search for a block' ) }
					className="editor-inserter__search"
					onChange={ this.filter }
					ref={ this.bindReferenceNode( 'search' ) }
				/>
				{ ! isSearching &&
					<TabPanel className="editor-inserter__tabs" activeClass="is-active"
						onSelect={ this.switchTab }
						tabs={ [
							{
								name: 'recent',
								title: __( 'Recent' ),
								className: 'editor-inserter__tab',
							},
							{
								name: 'blocks',
								title: __( 'Blocks' ),
								className: 'editor-inserter__tab',
							},
							{
								name: 'embeds',
								title: __( 'Embeds' ),
								className: 'editor-inserter__tab',
							},
							{
								name: 'saved',
								title: __( 'Saved' ),
								className: 'editor-inserter__tab',
							},
						] }
					>
						{ ( tabKey ) => (
							<div ref={ ( ref ) => this.tabContainer = ref }>
								{ this.renderTabView( tabKey ) }
							</div>
						) }
					</TabPanel>
				}
				{ isSearching &&
					<div role="menu" className="editor-inserter__search-results">
						{ this.renderCategories( this.getVisibleBlocksByCategory( this.getBlockTypes() ) ) }
					</div>
				}
				{ selectedBlock && isReusableBlock( selectedBlock ) &&
					<BlockPreview name={ selectedBlock.name } attributes={ selectedBlock.initialAttributes } />
				}
			</TabbableContainer>
		);
	}
}

const connectComponent = connect(
	( state ) => {
		return {
			recentlyUsedBlocks: getRecentlyUsedBlocks( state ),
			blocks: getBlocks( state ),
			reusableBlocks: getReusableBlocks( state ),
		};
	},
	{ fetchReusableBlocks }
);

export default compose(
	connectComponent,
	withContext( 'editor' )( ( settings ) => pick( settings, 'blockTypes' ) ),
	withSpokenMessages,
	withInstanceId
)( InserterMenu );
