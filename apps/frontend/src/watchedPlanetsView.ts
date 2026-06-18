export function nextWatchedPlanetsPageAfterToggle({
  currentPage,
  currentPagePlanetCount,
  wasWatched,
}: {
  currentPage: number;
  currentPagePlanetCount: number;
  wasWatched: boolean;
}): number {
  return wasWatched && currentPagePlanetCount === 1 && currentPage > 1
    ? currentPage - 1
    : currentPage;
}

export function watchedPlanetsPanelRange({
  page,
  pageSize,
  total,
}: {
  page: number;
  pageSize: number;
  total: number;
}): { start: number; end: number } {
  return {
    start: total === 0 ? 0 : (page - 1) * pageSize + 1,
    end: Math.min(total, page * pageSize),
  };
}
