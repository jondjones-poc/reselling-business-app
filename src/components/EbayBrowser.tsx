import React, { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import './EbayBrowser.css';

const EbayBrowser: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const soldUrl = searchParams.get('soldUrl');
  const activeUrl = searchParams.get('activeUrl');

  // Open both URLs in new windows when component mounts
  useEffect(() => {
    if (!soldUrl || !activeUrl) {
      navigate('/');
      return;
    }

    // Open sold URL in a new window
    const soldWindow = window.open(soldUrl, 'ebay-solds', 'width=800,height=600,left=0,top=0');
    
    // Open active URL in a new window, positioned to the right
    // Calculate screen dimensions for positioning
    const screenWidth = window.screen.width;
    const windowWidth = 800;
    const leftPosition = Math.max(0, (screenWidth - windowWidth * 2) / 2);
    
    const activeWindow = window.open(
      activeUrl, 
      'ebay-active', 
      `width=${windowWidth},height=600,left=${leftPosition + windowWidth},top=0`
    );

    // Focus on the first window
    if (soldWindow) {
      soldWindow.focus();
    }

    // Return to home after opening windows
    // Small delay to ensure windows open
    const timer = setTimeout(() => {
      navigate('/');
    }, 500);

    return () => {
      clearTimeout(timer);
    };
  }, [soldUrl, activeUrl, navigate]);

  return (
    <div className="ebay-browser-container">
      <div className="ebay-browser-loading">
        <div className="loading-content">
          <h2>Opening eBay Search Results</h2>
          <p>Two windows will open side-by-side:</p>
          <ul>
            <li>Left: Sold Listings</li>
            <li>Right: Active Listings</li>
          </ul>
          <p className="loading-note">If pop-ups are blocked, please allow them and try again.</p>
        </div>
      </div>
    </div>
  );
};

export default EbayBrowser;

