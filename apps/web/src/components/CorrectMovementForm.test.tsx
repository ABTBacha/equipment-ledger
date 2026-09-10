import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CorrectMovementForm } from './CorrectMovementForm';
import { ToastProvider } from './ToastProvider';
import { apiFetch } from '../lib/api';

jest.mock('../lib/api', () => ({
  apiFetch: jest.fn(),
  newIdempotencyKey: () => 'key-1',
  getCurrentKeeper: () => null,
}));

describe('CorrectMovementForm', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockReset();
    (apiFetch as jest.Mock).mockResolvedValue({});
  });

  const renderForm = (canCorrectDueAt = true) =>
    render(
      <ToastProvider>
        <CorrectMovementForm movementId="m1" canCorrectDueAt={canCorrectDueAt} onDone={() => {}} />
      </ToastProvider>,
    );

  it('corrects a mistyped due-back time on its own, without touching the time it happened', async () => {
    renderForm();

    fireEvent.change(screen.getByLabelText(/corrected due back/i), { target: { value: '2026-09-11T17:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));

    await waitFor(() => {
      const [, options] = (apiFetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.dueAt).toBe(new Date('2026-09-11T17:00').toISOString());
      expect(body.occurredAt).toBeUndefined();
    });
  });

  it('offers no due-back field for a movement that cannot have one', () => {
    renderForm(false);
    expect(screen.queryByLabelText(/corrected due back/i)).not.toBeInTheDocument();
  });

  it('refuses to submit an empty correction', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled();
  });

  it('refuses a corrected due-back time that lands before the issue, without calling the API', async () => {
    render(
      <ToastProvider>
        <CorrectMovementForm
          movementId="m1"
          canCorrectDueAt
          issuedAt="2026-08-01T09:00:00.000Z"
          onDone={() => {}}
        />
      </ToastProvider>,
    );

    fireEvent.change(screen.getByLabelText(/corrected due back/i), { target: { value: '2026-08-01T08:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));

    expect(await screen.findByText(/due back must be after/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
