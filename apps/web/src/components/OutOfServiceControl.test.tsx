import '@testing-library/jest-dom';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OutOfServiceControl } from './OutOfServiceControl';
import { apiFetch } from '../lib/api';

jest.mock('../lib/api', () => ({
  apiFetch: jest.fn(),
  newIdempotencyKey: jest.requireActual('../lib/api').newIdempotencyKey,
  getCurrentKeeper: jest.fn(() => null),
}));

function Harness() {
  const [status, setStatus] = useState<'IN_STORE' | 'ISSUED' | 'OUT_OF_SERVICE'>('IN_STORE');
  return (
    <OutOfServiceControl
      assetId="DRILL-001"
      status={status}
      onDone={() => setStatus((s) => (s === 'IN_STORE' ? 'OUT_OF_SERVICE' : 'IN_STORE'))}
    />
  );
}

describe('OutOfServiceControl consecutive transitions', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockReset();
    (apiFetch as jest.Mock).mockResolvedValue({});
  });

  it('supports taking out of service then bringing back into service, without a remount', async () => {
    render(<Harness />);

    // Take out of service.
    fireEvent.click(screen.getByText('Take out of service'));
    fireEvent.click(screen.getByText('Confirm take out of service'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/assets/DRILL-001/out-of-service', expect.anything());

    // Component re-renders (still mounted, not remounted) now showing "bring back".
    await waitFor(() => expect(screen.getByText('Bring back into service')).toBeInTheDocument());
    const bringBackButton = screen.getByText('Bring back into service') as HTMLButtonElement;
    expect(bringBackButton).not.toBeDisabled();

    fireEvent.click(bringBackButton);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/assets/DRILL-001/back-in-service', expect.anything());

    const firstKey = JSON.parse((apiFetch as jest.Mock).mock.calls[0][1].body).idempotencyKey;
    const secondKey = JSON.parse((apiFetch as jest.Mock).mock.calls[1][1].body).idempotencyKey;
    expect(secondKey).not.toBe(firstKey);

    // Back to "Take out of service" and it's actionable again (submitting state was reset).
    await waitFor(() => expect(screen.getByText('Take out of service')).toBeInTheDocument());
    expect(screen.getByText('Take out of service')).not.toBeDisabled();
  });
});
