import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardClient } from './DashboardClient';
import { AssetSummary } from '../components/StoreGrid';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

jest.mock('../lib/api', () => ({
  apiFetch: jest.fn().mockResolvedValue([]),
  getCurrentKeeper: () => 'keeper-1',
  newIdempotencyKey: () => 'key-1',
}));

function asset(overrides: Partial<AssetSummary> = {}): AssetSummary {
  return {
    _id: 'DRILL-001',
    kind: 'drill',
    requiresCertification: null,
    status: 'IN_STORE',
    currentHolderId: null,
    upcomingReservation: null,
    lastActivityAt: null,
    ...overrides,
  };
}

describe('DashboardClient', () => {
  it('links each asset to its detail page', () => {
    render(<DashboardClient assets={[asset()]} />);
    expect(screen.getByRole('link', { name: 'DRILL-001' })).toHaveAttribute('href', '/assets/DRILL-001');
  });

  it('offers to take an in-store asset out of service', () => {
    render(<DashboardClient assets={[asset()]} />);
    expect(screen.getByRole('button', { name: 'Take out of service' })).toBeInTheDocument();
  });

  it('offers to take an issued asset out of service', () => {
    render(<DashboardClient assets={[asset({ status: 'ISSUED', currentHolderId: 'worker-1' })]} />);
    expect(screen.getByRole('button', { name: 'Take out of service' })).toBeInTheDocument();
  });

  it('offers to bring an out-of-service asset back, and does not offer to issue it', () => {
    render(<DashboardClient assets={[asset({ status: 'OUT_OF_SERVICE' })]} />);
    expect(screen.getByRole('button', { name: 'Bring back into service' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Issue' })).not.toBeInTheDocument();
  });

  it('can filter the table down to out-of-service assets', () => {
    render(<DashboardClient assets={[asset(), asset({ _id: 'SAW-002', status: 'OUT_OF_SERVICE' })]} />);
    expect(screen.getByRole('link', { name: 'DRILL-001' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Status filter'), { target: { value: 'OUT_OF_SERVICE' } });

    expect(screen.queryByRole('link', { name: 'DRILL-001' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'SAW-002' })).toBeInTheDocument();
  });
});
