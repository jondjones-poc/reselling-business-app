import React from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import ResearchEbayFeed from './ResearchEbayFeed';
import ResearchTagSellThrough from './ResearchTagSellThrough';
import ResearchSellerSolds from './ResearchSellerSolds';
import ResearchInFashion from './ResearchInFashion';
import ResearchResellerVideos from './ResearchResellerVideos';
import EbayNicheExplorer from './EbayNicheExplorer';
import ResearchTopics from './ResearchTopics';
import './BrandResearch.css';

type HubView =
  | 'topics'
  | 'feed'
  | 'tag-sell-through'
  | 'seller-listings'
  | 'in-fashion'
  | 'reseller-videos'
  | 'category-research';

function normalizeView(raw: string | null): HubView {
  if (raw === 'topics') return 'topics';
  if (raw === 'tag-sell-through') return 'tag-sell-through';
  if (raw === 'seller-listings' || raw === 'seller-solds') return 'seller-listings';
  if (raw === 'in-fashion') return 'in-fashion';
  if (raw === 'reseller-videos') return 'reseller-videos';
  if (raw === 'category-research' || raw === 'ebay-niches' || raw === 'ebay-categories') {
    return 'category-research';
  }
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
          to="/research?view=topics"
          role="tab"
          aria-selected={view === 'topics'}
          className={() => `research-tab${view === 'topics' ? ' active' : ''}`}
        >
          Topics
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
          Trends
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
        <NavLink
          to="/research?view=category-research"
          role="tab"
          aria-selected={view === 'category-research'}
          className={() => `research-tab${view === 'category-research' ? ' active' : ''}`}
        >
          Category research
        </NavLink>
      </nav>

      {view === 'topics' && <ResearchTopics />}
      {view === 'feed' && <ResearchEbayFeed />}
      {view === 'tag-sell-through' && <ResearchTagSellThrough />}
      {view === 'seller-listings' && <ResearchSellerSolds />}
      {view === 'in-fashion' && <ResearchInFashion />}
      {view === 'reseller-videos' && <ResearchResellerVideos />}
      {view === 'category-research' && <EbayNicheExplorer />}
    </div>
  );
};

export default ResearchHub;
