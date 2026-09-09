import '@testing-library/jest-dom';
import { render, screen, act } from '@testing-library/react';
import { ToastProvider, useToast } from './ToastProvider';

function TestConsumer({ message }: { message: string }) {
  const { showToast } = useToast();
  return (
    <button type="button" onClick={() => showToast(message)}>
      Trigger
    </button>
  );
}

describe('ToastProvider', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows a toast with the given message when showToast is called', () => {
    render(
      <ToastProvider>
        <TestConsumer message="Issued to worker-1" />
      </ToastProvider>,
    );

    expect(screen.queryByText('Issued to worker-1')).not.toBeInTheDocument();

    act(() => {
      screen.getByText('Trigger').click();
    });

    expect(screen.getByText('Issued to worker-1')).toBeInTheDocument();
  });

  it('auto-dismisses the toast after the timeout elapses', () => {
    render(
      <ToastProvider>
        <TestConsumer message="Reservation created" />
      </ToastProvider>,
    );

    act(() => {
      screen.getByText('Trigger').click();
    });
    expect(screen.getByText('Reservation created')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(4000);
    });

    expect(screen.queryByText('Reservation created')).not.toBeInTheDocument();
  });
});
