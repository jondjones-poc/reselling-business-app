/* eslint-disable import/first -- jest.mock must run before App (and route modules) load */
jest.mock('react-qr-barcode-scanner', () => ({
  __esModule: true,
  default: function BarcodeScanner() {
    return null;
  },
}));

jest.mock('./components/Research', () => ({
  __esModule: true,
  default: function Research() {
    return null;
  },
}));

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

beforeEach(() => {
  window.localStorage.setItem('reseller-auth-token', 'granted');
});

test('renders main navigation', async () => {
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>
  );
  await waitFor(() => {
    expect(screen.getByRole('navigation', { name: /main/i })).toBeInTheDocument();
  });
  expect(screen.getByRole('link', { name: /research/i })).toBeInTheDocument();
});
