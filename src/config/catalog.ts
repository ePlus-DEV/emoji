export type CatalogBrowseMode = 'scroll' | 'pagination';

export const catalogConfig = {
  /**
   * `scroll`: append the next batch automatically near the end of the grid.
   * `pagination`: show Previous / page numbers / Next and render one page at a time.
   */
  mode: 'scroll' as CatalogBrowseMode,

  /** Number of emoji rendered per batch/page. */
  pageSize: 48,

  /** How early infinite scroll starts loading the next batch. */
  scrollRootMargin: '700px 0px'
} as const;
