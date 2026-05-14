import React from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import ResearchEbayFeed from './ResearchEbayFeed';
import Research from './Research';
import './BrandResearch.css';

type HubView = 'feed' | 'offline' | 'ai';

function normalizeView(raw: string | null): HubView {
  if (raw === 'offline' || raw === 'ai') return raw;
  return 'feed';
}

const ResearchHub: React.FC = () => {
  const [searchParams] = useSearchParams();
  const view = normalizeView(searchParams.get('view'));

  return (
    <div className="research-page-container">
      <nav className="research-tabs" role="tablist" aria-label="Research sections">
        <NavLink
          to="/research"
          role="tab"
          aria-selected={view === 'feed'}
          className={() => `research-tab${view === 'feed' ? ' active' : ''}`}
        >
          eBay tag feed
        </NavLink>
        <NavLink
          to="/research?view=offline"
          role="tab"
          aria-selected={view === 'offline'}
          className={() => `research-tab${view === 'offline' ? ' active' : ''}`}
        >
          Brand offline research
        </NavLink>
        <NavLink
          to="/research?view=ai"
          role="tab"
          aria-selected={view === 'ai'}
          className={() => `research-tab${view === 'ai' ? ' active' : ''}`}
        >
          AI research
        </NavLink>
      </nav>

      {view === 'feed' && <ResearchEbayFeed />}
      {view === 'offline' && <Research forcedView="offline" />}
      {view === 'ai' && <Research forcedView="ai" />}
    </div>
  );
};

export default ResearchHub;
