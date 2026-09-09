import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IssueReturnModal } from './IssueReturnModal';
import { apiFetch } from '../lib/api';

jest.mock('../lib/api', () => ({
  apiFetch: jest.fn(),
  newIdempotencyKey: jest.requireActual('../lib/api').newIdempotencyKey,
}));

const asset = {
  _id: 'DRILL-001',
  kind: 'drill',
  requiresCertification: null,
  status: 'IN_STORE' as const,
  currentHolderId: null,
  upcomingReservation: null,
};

describe('IssueReturnModal idempotency key', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockReset();
  });

  it('reuses the same idempotency key across a retry after a failed submit', async () => {
    (apiFetch as jest.Mock).mockRejectedValueOnce(new Error('network blip')).mockResolvedValueOnce({});

    render(<IssueReturnModal asset={asset} action="issue" onClose={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Worker ID'), { target: { value: 'worker-1' } });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));

    const firstKey = JSON.parse((apiFetch as jest.Mock).mock.calls[0][1].body).idempotencyKey;
    const secondKey = JSON.parse((apiFetch as jest.Mock).mock.calls[1][1].body).idempotencyKey;
    expect(firstKey).toBe(secondKey);
  });

  it('generates a new idempotency key for a new modal instance', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({});

    const { unmount } = render(<IssueReturnModal asset={asset} action="issue" onClose={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Worker ID'), { target: { value: 'worker-1' } });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const firstKey = JSON.parse((apiFetch as jest.Mock).mock.calls[0][1].body).idempotencyKey;
    unmount();

    render(<IssueReturnModal asset={asset} action="issue" onClose={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Worker ID'), { target: { value: 'worker-2' } });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    const secondKey = JSON.parse((apiFetch as jest.Mock).mock.calls[1][1].body).idempotencyKey;

    expect(secondKey).not.toBe(firstKey);
  });
});
