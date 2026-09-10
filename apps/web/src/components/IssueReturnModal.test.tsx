import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IssueReturnModal } from './IssueReturnModal';
import { ToastProvider } from './ToastProvider';
import { apiFetch } from '../lib/api';

jest.mock('../lib/api', () => ({
  apiFetch: jest.fn(),
  newIdempotencyKey: jest.requireActual('../lib/api').newIdempotencyKey,
  getCurrentKeeper: jest.fn(() => null),
}));

const asset = {
  _id: 'DRILL-001',
  kind: 'drill',
  requiresCertification: null,
  status: 'IN_STORE' as const,
  currentHolderId: null,
  upcomingReservation: null,
  lastActivityAt: null,
};

const WORKERS = [
  { _id: 'worker-1', name: 'Worker One', certifications: [], currentlyHolding: [] },
  { _id: 'worker-2', name: 'Worker Two', certifications: [], currentlyHolding: [] },
  { _id: 'worker-9', name: 'Worker Nine', certifications: [], currentlyHolding: [] },
];

/**
 * The mocked apiFetch serves the `GET /workers` call the modal makes on mount from a fixed
 * worker list, and queues separate resolutions/rejections (in order) for every other call
 * (the movement submit), independent of when the workers fetch happens to land.
 */
function mockApiFetch() {
  const submitQueue: Array<() => Promise<unknown>> = [];
  (apiFetch as jest.Mock).mockReset();
  (apiFetch as jest.Mock).mockImplementation((path: string) => {
    if (path === '/workers') return Promise.resolve(WORKERS);
    const next = submitQueue.shift();
    return next ? next() : Promise.resolve({});
  });
  return {
    queueSubmitReject: (err: Error) => submitQueue.push(() => Promise.reject(err)),
    queueSubmitResolve: (value: unknown = {}) => submitQueue.push(() => Promise.resolve(value)),
  };
}

async function selectWorker(label: string) {
  const input = await screen.findByPlaceholderText('Select worker');
  fireEvent.focus(input);
  fireEvent.click(await screen.findByText(label));
}

describe('IssueReturnModal idempotency key', () => {
  it('reuses the same idempotency key across a retry after a failed submit', async () => {
    const { queueSubmitReject, queueSubmitResolve } = mockApiFetch();
    queueSubmitReject(new Error('network blip'));
    queueSubmitResolve();

    render(<IssueReturnModal asset={asset} action="issue" onClose={jest.fn()} />);
    await selectWorker('Worker One (worker-1)');
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/movements/issue', expect.anything()));

    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => {
      const calls = (apiFetch as jest.Mock).mock.calls.filter((c) => c[0] === '/movements/issue');
      expect(calls).toHaveLength(2);
    });

    const movementCalls = (apiFetch as jest.Mock).mock.calls.filter((c) => c[0] === '/movements/issue');
    const firstKey = JSON.parse(movementCalls[0][1].body).idempotencyKey;
    const secondKey = JSON.parse(movementCalls[1][1].body).idempotencyKey;
    expect(firstKey).toBe(secondKey);
  });

  it('generates a new idempotency key for a new modal instance', async () => {
    const { queueSubmitResolve } = mockApiFetch();
    queueSubmitResolve();
    queueSubmitResolve();

    const { unmount } = render(<IssueReturnModal asset={asset} action="issue" onClose={jest.fn()} />);
    await selectWorker('Worker One (worker-1)');
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/movements/issue', expect.anything()));
    unmount();

    render(<IssueReturnModal asset={asset} action="issue" onClose={jest.fn()} />);
    await selectWorker('Worker Two (worker-2)');
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => {
      const calls = (apiFetch as jest.Mock).mock.calls.filter((c) => c[0] === '/movements/issue');
      expect(calls).toHaveLength(2);
    });

    const movementCalls = (apiFetch as jest.Mock).mock.calls.filter((c) => c[0] === '/movements/issue');
    const firstKey = JSON.parse(movementCalls[0][1].body).idempotencyKey;
    const secondKey = JSON.parse(movementCalls[1][1].body).idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });
});

describe('IssueReturnModal toast on success', () => {
  it('shows a toast with the expected message after a successful issue, when wrapped in a real ToastProvider', async () => {
    const { queueSubmitResolve } = mockApiFetch();
    queueSubmitResolve();

    render(
      <ToastProvider>
        <IssueReturnModal asset={asset} action="issue" onClose={jest.fn()} />
      </ToastProvider>,
    );

    await selectWorker('Worker Nine (worker-9)');
    fireEvent.click(screen.getByText('Confirm'));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/movements/issue', expect.anything()));
    expect(await screen.findByText('Issued to worker-9')).toBeInTheDocument();
  });
});

describe('IssueReturnModal due-back time', () => {
  it('sends the due-back time the keeper picked, as an instant', async () => {
    const { queueSubmitResolve } = mockApiFetch();
    queueSubmitResolve();

    render(
      <ToastProvider>
        <IssueReturnModal asset={asset} action="issue" onClose={() => {}} />
      </ToastProvider>,
    );
    await selectWorker('Worker One (worker-1)');

    fireEvent.change(screen.getByLabelText(/due back/i), { target: { value: '2026-09-11T17:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      const submit = (apiFetch as jest.Mock).mock.calls.find(([path]) => path === '/movements/issue');
      expect(submit).toBeDefined();
      const body = JSON.parse(submit![1].body);
      expect(body.dueAt).toBe(new Date('2026-09-11T17:00').toISOString());
    });
  });

  it('omits dueAt entirely when the keeper leaves it blank', async () => {
    const { queueSubmitResolve } = mockApiFetch();
    queueSubmitResolve();

    render(
      <ToastProvider>
        <IssueReturnModal asset={asset} action="issue" onClose={() => {}} />
      </ToastProvider>,
    );
    await selectWorker('Worker One (worker-1)');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      const submit = (apiFetch as jest.Mock).mock.calls.find(([path]) => path === '/movements/issue');
      expect(submit).toBeDefined();
      expect(JSON.parse(submit![1].body).dueAt).toBeUndefined();
    });
  });

  it('does not offer a due-back field when taking an asset back', async () => {
    mockApiFetch();
    render(
      <ToastProvider>
        <IssueReturnModal asset={asset} action="return" onClose={() => {}} />
      </ToastProvider>,
    );

    expect(screen.queryByLabelText(/due back/i)).not.toBeInTheDocument();
  });

  it('refuses to submit a due-back time that is before the issue time, without calling the API', async () => {
    const { queueSubmitResolve } = mockApiFetch();
    queueSubmitResolve();

    render(
      <ToastProvider>
        <IssueReturnModal asset={asset} action="issue" onClose={() => {}} />
      </ToastProvider>,
    );
    await selectWorker('Worker One (worker-1)');

    fireEvent.change(screen.getByLabelText(/occurred at/i), { target: { value: '2026-08-01T09:00' } });
    fireEvent.change(screen.getByLabelText(/due back/i), { target: { value: '2026-08-01T08:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/due back must be after/i)).toBeInTheDocument();
    expect((apiFetch as jest.Mock).mock.calls.filter(([path]) => path === '/movements/issue')).toHaveLength(0);
  });

  it('stops the due-back picker from offering a time before the issue time', async () => {
    mockApiFetch();
    render(
      <ToastProvider>
        <IssueReturnModal asset={asset} action="issue" onClose={() => {}} />
      </ToastProvider>,
    );

    fireEvent.change(screen.getByLabelText(/occurred at/i), { target: { value: '2026-08-01T09:00' } });
    expect(screen.getByLabelText(/due back/i)).toHaveAttribute('min', '2026-08-01T09:00');
  });
});
