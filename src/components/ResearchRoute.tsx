import React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import ResearchHub from './ResearchHub';

/**
 * /research = Research hub (eBay feed default). Legacy /research?… analytics URLs redirect to /analytics.
 */
const ResearchRoute: React.FC = () => {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab');
  const brand = searchParams.get('brand');

  if (brand) {
    return <Navigate to={`/analytics?${searchParams.toString()}`} replace />;
  }
  if (
    searchParams.get('menswearCategoryId') ||
    searchParams.get('menswearBrandId') ||
    searchParams.get('clothingTypeId') ||
    searchParams.get('clothingTypeBrandId')
  ) {
    return <Navigate to={`/analytics?${searchParams.toString()}`} replace />;
  }

  // Legacy: eBay category stars lived under analytics menswear → Research hub
  const mcView = searchParams.get('mcView')?.trim().toLowerCase();
  if (mcView === 'ebay-niches' || mcView === 'ebay') {
    return <Navigate to="/research?view=category-research" replace />;
  }

  const analyticsTabs = new Set([
    'brand',
    'department',
    'menswear-categories',
    'clothing-types',
    'seasonal',
    'sourced',
    'item-views',
    'inventory-ageing',
  ]);
  if (tab && analyticsTabs.has(tab)) {
    return <Navigate to={`/analytics?${searchParams.toString()}`} replace />;
  }

  if (tab === 'offline') {
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    next.set('view', 'reseller-videos');
    return <Navigate to={`/research?${next.toString()}`} replace />;
  }
  if (tab === 'ai' || searchParams.get('view') === 'ai') {
    return <Navigate to="/" replace />;
  }
  if (tab === 'ebay-feed') {
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    const q = next.toString();
    return <Navigate to={q ? `/research?${q}` : '/research'} replace />;
  }
  if (tab === 'tag-sell-through') {
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    next.set('view', 'tag-sell-through');
    return <Navigate to={`/research?${next.toString()}`} replace />;
  }

  if (tab === 'feed') {
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    const q = next.toString();
    return <Navigate to={q ? `/research?${q}` : '/research'} replace />;
  }

  if (tab) {
    return <Navigate to={`/analytics?${searchParams.toString()}`} replace />;
  }

  return <ResearchHub />;
};

export default ResearchRoute;
