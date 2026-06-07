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

  const analyticsTabs = new Set([
    'brand',
    'menswear-categories',
    'clothing-types',
    'seasonal',
    'sourced',
    'item-views',
  ]);
  if (tab && analyticsTabs.has(tab)) {
    return <Navigate to={`/analytics?${searchParams.toString()}`} replace />;
  }

  if (tab === 'offline') {
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    next.set('view', 'offline');
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
