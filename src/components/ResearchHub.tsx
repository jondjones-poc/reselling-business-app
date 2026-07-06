import React from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import ResearchEbayFeed from './ResearchEbayFeed';
import ResearchTagSellThrough from './ResearchTagSellThrough';
import ResearchSellerSolds from './ResearchSellerSolds';
import ResearchInFashion from './ResearchInFashion';
import ResearchResellerVideos from './ResearchResellerVideos';
import './BrandResearch.css';

type HubView =
  | 'feed'
  | 'tag-sell-through'
  | 'seller-listings'
  | 'in-fashion'
  | 'reseller-videos';

function normalizeView(raw: string | null): HubView {
  if (raw === 'tag-sell-through') return 'tag-sell-through';
  if (raw === 'seller-listings' || raw === 'seller-solds') return 'seller-listings';
  if (raw === 'in-fashion') return 'in-fashion';
  if (raw === 'reseller-videos') return 'reseller-videos';
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
          to="/research?view=seller-listings"
          role="tab"
          aria-selected={view === 'seller-listings'}
          className={() => `research-tab${view === 'seller-listings' ? ' active' : ''}`}
        >
          Seller Listing
        </NavLink>
        <NavLink
          to="/research?view=in-fashion"
          role="tab"
          aria-selected={view === 'in-fashion'}
          className={() => `research-tab${view === 'in-fashion' ? ' active' : ''}`}
        >
          In fashion
        </NavLink>
        <NavLink
          to="/research?view=reseller-videos"
          role="tab"
          aria-selected={view === 'reseller-videos'}
          className={() => `research-tab${view === 'reseller-videos' ? ' active' : ''}`}
        >
          Reseller Videos
        </NavLink>
        <NavLink
          to="/research?view=tag-sell-through"
          role="tab"
          aria-selected={view === 'tag-sell-through'}
          className={() => `research-tab${view === 'tag-sell-through' ? ' active' : ''}`}
        >
          Tag sell-through rate
        </NavLink>
      </nav>

      {view === 'feed' && <ResearchEbayFeed />}
      {view === 'tag-sell-through' && <ResearchTagSellThrough />}
      {view === 'seller-listings' && <ResearchSellerSolds />}
      {view === 'in-fashion' && <ResearchInFashion />}
      {view === 'reseller-videos' && <ResearchResellerVideos />}
    </div>
  );
};

export default ResearchHub;
