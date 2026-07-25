/**
 * Identity constants, in their own module so the eagerly-imported manifest
 * barrel and the lazily-imported panel can share them without the panel
 * pulling the barrel (and every node definition) into its chunk.
 *
 * `PLUGIN_ID` is the key the host writes into the scene graph's
 * `installedPlugins`, so it is effectively persisted user data: changing it
 * silently uninstalls the plugin from every existing project.
 */

export const PLUGIN_ID = 'ovurrsl:warehouse'

export const CATALOG_PANEL_ID = 'ovurrsl:warehouse:catalog'

/** Prefix for every node kind this plugin contributes. */
export const KIND_PREFIX = 'warehouse:'
