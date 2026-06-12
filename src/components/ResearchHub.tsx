import React from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import ResearchEbayFeed from './ResearchEbayFeed';
import ResearchTagSellThrough from './ResearchTagSellThrough';
import ResearchSellerSolds from './ResearchSellerSolds';
import Research from './Research';
import './BrandResearch.css';

type HubView = 'feed' | 'tag-sell-through' | 'seller-solds' | 'offline';

function normalizeView(raw: string | null): HubView {
  if (raw === 'tag-sell-through') return 'tag-sell-through';
  if (raw === 'seller-solds') return 'seller-solds';
  if (raw === 'offline') return raw;
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
          to="/research?view=tag-sell-through"
          role="tab"
          aria-selected={view === 'tag-sell-through'}
          className={() => `research-tab${view === 'tag-sell-through' ? ' active' : ''}`}
        >
          Tag sell-through rate
        </NavLink>
        <NavLink
          to="/research?view=seller-solds"
          role="tab"
          aria-selected={view === 'seller-solds'}
          className={() => `research-tab${view === 'seller-solds' ? ' active' : ''}`}
        >
          Seller Solds
        </NavLink>
        <NavLink
          to="/research?view=offline"
          role="tab"
          aria-selected={view === 'offline'}
          className={() => `research-tab${view === 'offline' ? ' active' : ''}`}
        >
          Brand offline research
        </NavLink>
      </nav>

      {view === 'feed' && <ResearchEbayFeed />}
      {view === 'tag-sell-through' && <ResearchTagSellThrough />}
      {view === 'seller-solds' && <ResearchSellerSolds />}
      {view === 'offline' && <Research forcedView="offline" />}
    </div>
  );
};

export default ResearchHub;
