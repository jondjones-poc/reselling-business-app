import React from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import EbaySearch from './EbaySearch';
import ScoutingItemsToSource from './ScoutingItemsToSource';
import './BrandResearch.css';

type ScoutingView = 'scout' | 'source';

function normalizeView(raw: string | null): ScoutingView {
  if (raw === 'source') return 'source';
  return 'scout';
}

const ScoutingRoute: React.FC = () => {
  const [searchParams] = useSearchParams();
  const view = normalizeView(searchParams.get('view'));

  return (
    <div className="research-page-container scouting-route">
      <nav className="research-tabs" role="tablist" aria-label="Scouting sections">
        <NavLink
          to="/"
          role="tab"
          aria-selected={view === 'scout'}
          className={() => `research-tab${view === 'scout' ? ' active' : ''}`}
        >
          Scout
        </NavLink>
        <NavLink
          to="/?view=source"
          role="tab"
          aria-selected={view === 'source'}
          className={() => `research-tab${view === 'source' ? ' active' : ''}`}
        >
          Items To Source
        </NavLink>
      </nav>

      {view === 'scout' && <EbaySearch />}
      {view === 'source' && <ScoutingItemsToSource />}
    </div>
  );
};

export default ScoutingRoute;
