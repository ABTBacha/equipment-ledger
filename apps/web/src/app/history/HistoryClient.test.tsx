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

  it('does not leak current-time upcomingReservation/lastActivityAt into a historical snapshot', async () => {
    (apiFetch as jest.Mock).mockImplementation((path: string) => {
      if (path === '/assets') {
        return Promise.resolve([
          {
            _id: 'DRILL-001',
            kind: 'drill',
            requiresCertification: null,
            upcomingReservation: { workerId: 'worker-1', startAt: new Date().toISOString() },
            lastActivityAt: new Date().toISOString(),
          },
        ]);
      }
      return Promise.resolve({ asOf: new Date().toISOString(), assets: {} });
    });

    render(<HistoryClient />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/store'));

    const row = await screen.findByText('DRILL-001');
    const cells = row.closest('tr')?.querySelectorAll('td') ?? [];
    // Upcoming reservation and Last activity columns must show the empty placeholder,
    // never the current-time values that came back on the /assets response.
    const cellText = Array.from(cells).map((c) => c.textContent);
    expect(cellText.filter((t) => t === '—').length).toBeGreaterThanOrEqual(2);
    expect(cellText.some((t) => t?.includes('worker-1'))).toBe(false);
  });

  it('shows an inline error and stops the loading skeleton when the initial /assets fetch fails', async () => {
    (apiFetch as jest.Mock).mockImplementation((path: string) => {
      if (path === '/assets') {
        return Promise.reject(new Error('network down'));
      }
      return Promise.resolve({ asOf: new Date().toISOString(), assets: {} });
    });

    render(<HistoryClient />);

    expect(await screen.findByText('network down')).toBeInTheDocument();
    expect(screen.queryByText('No rows to show.')).toBeInTheDocument();
  });
});
