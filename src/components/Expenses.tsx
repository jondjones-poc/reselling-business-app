import React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import ImageRemover from './ImageRemover';
import ListingImageRefresh from './ListingImageRefresh';
import Planner from './Planner';
import ReceiptScanner from './ReceiptScanner';
import CreateEbayListing from './CreateEbayListing';
import './Stock.css';

const Expenses: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  if (searchParams.get('tab') === 'projections') {
    return <Navigate to="/reporting?tab=projections" replace />;
  }

  // Profit Per Month moved to Reporting, where the other period views live.
  if (searchParams.get('tab') === 'profit-per-month') {
    return <Navigate to="/reporting?tab=profit-per-month" replace />;
  }

  // Expenses (ledger + Accountant Export) moved to its own Accounting page.
  if (searchParams.get('tab') === 'expenses') {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', 'expenses');
    return <Navigate to={{ pathname: '/accounting', search: `?${nextParams}` }} replace />;
  }

  if (!searchParams.get('tab')) {
    const defaultParams = new URLSearchParams(searchParams);
    defaultParams.set('tab', 'receipt-scanner');
    return <Navigate to={{ pathname: '/tools', search: `?${defaultParams}` }} replace />;
  }

  const expensesTab = searchParams.get('tab') === 'create-ebay-listing' ? 'create-ebay-listing' :
    searchParams.get('tab') === 'image-remover'
      ? 'image-remover'
      : searchParams.get('tab') === 'listing-image-refresh'
        ? 'listing-image-refresh'
        : searchParams.get('tab') === 'planner'
          ? 'planner'
          : 'receipt-scanner';

  const setExpensesTab = (
    next: 'create-ebay-listing' | 'image-remover' | 'listing-image-refresh' | 'planner' | 'receipt-scanner'
  ) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', next);
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <div className="stock-container">
      <nav className="expenses-tabs" role="tablist" aria-label="Tools sections">
        <button
          type="button"
          role="tab"
          id="expenses-tab-receipt-scanner"
          aria-selected={expensesTab === 'receipt-scanner'}
          aria-controls="expenses-panel-receipt-scanner"
          className={`expenses-tab${
            expensesTab === 'receipt-scanner' ? ' expenses-tab--active' : ''
          }`}
          onClick={() => setExpensesTab('receipt-scanner')}
        >
          Receipt Scanner
        </button>
        <button type="button" role="tab" id="expenses-tab-create-ebay-listing"
          aria-selected={expensesTab === 'create-ebay-listing'} aria-controls="expenses-panel-create-ebay-listing"
          className={`expenses-tab${expensesTab === 'create-ebay-listing' ? ' expenses-tab--active' : ''}`}
          onClick={() => setExpensesTab('create-ebay-listing')}>Create eBay Listing</button>
        <button
          type="button"
          role="tab"
          id="expenses-tab-planner"
          aria-selected={expensesTab === 'planner'}
          aria-controls="expenses-panel-planner"
          className={`expenses-tab${expensesTab === 'planner' ? ' expenses-tab--active' : ''}`}
          onClick={() => setExpensesTab('planner')}
        >
          Listing Planner
        </button>
        <button
          type="button"
          role="tab"
          id="expenses-tab-image-remover"
          aria-selected={expensesTab === 'image-remover'}
          aria-controls="expenses-panel-image-remover"
          className={`expenses-tab${
            expensesTab === 'image-remover' ? ' expenses-tab--active' : ''
          }`}
          onClick={() => setExpensesTab('image-remover')}
        >
          Listing Image Creator
        </button>
        <button
          type="button"
          role="tab"
          id="expenses-tab-listing-image-refresh"
          aria-selected={expensesTab === 'listing-image-refresh'}
          aria-controls="expenses-panel-listing-image-refresh"
          className={`expenses-tab${
            expensesTab === 'listing-image-refresh' ? ' expenses-tab--active' : ''
          }`}
          onClick={() => setExpensesTab('listing-image-refresh')}
        >
          Reupload Listing
        </button>
      </nav>

      {expensesTab === 'create-ebay-listing' ? (
        <div id="expenses-panel-create-ebay-listing" role="tabpanel" aria-labelledby="expenses-tab-create-ebay-listing"><CreateEbayListing /></div>
      ) : expensesTab === 'planner' ? (
        <div
          id="expenses-panel-planner"
          role="tabpanel"
          aria-labelledby="expenses-tab-planner"
        >
          <Planner />
        </div>
      ) : expensesTab === 'image-remover' ? (
        <div
          id="expenses-panel-image-remover"
          role="tabpanel"
          aria-labelledby="expenses-tab-image-remover"
        >
          <ImageRemover />
        </div>
      ) : expensesTab === 'listing-image-refresh' ? (
        <div
          id="expenses-panel-listing-image-refresh"
          role="tabpanel"
          aria-labelledby="expenses-tab-listing-image-refresh"
        >
          <ListingImageRefresh />
        </div>
      ) : (
        <div id="expenses-panel-receipt-scanner" role="tabpanel" aria-labelledby="expenses-tab-receipt-scanner">
          <ReceiptScanner />
        </div>
      )}
    </div>
  );
};

export default Expenses;
