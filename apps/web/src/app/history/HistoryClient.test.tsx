import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HistoryClient } from './HistoryClient';
import { apiFetch } from '../../lib/api';

jest.mock('../../lib/api', () => ({
  apiFetch: jest.fn(),
}));

describe('HistoryClient', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockReset();
    (apiFetch as jest.Mock).mockImplementation((path: string) => {
      if (path === '/assets') {
        return Promise.resolve([{ _id: 'DRILL-001', kind: 'drill', requiresCertification: null }]);
      }
      return Promise.resolve({ asOf: new Date().toISOString(), assets: {} });
    });
  });

  it('loads asset metadata and the current store snapshot on mount', async () => {
    render(<HistoryClient />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/assets'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/store'));
  });

  it('fetches the store as of the selected timestamp using an ISO query param', async () => {
    render(<HistoryClient />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/assets'));

    fireEvent.change(screen.getByLabelText('As of'), { target: { value: '2026-08-01T12:00' } });

    const expectedIso = new Date('2026-08-01T12:00').toISOString();
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(`/store?asOf=${encodeURIComponent(expectedIso)}`);
    });
  });
});
