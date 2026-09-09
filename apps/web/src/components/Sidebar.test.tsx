import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

describe('Sidebar keeper switch', () => {
  const STORAGE_KEY = 'equipment-ledger:keeper';

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(STORAGE_KEY, 'Priya Patel');
  });

  it('clears the pinned keeper from localStorage when Switch is clicked', () => {
    // jsdom throws "Not implemented: navigation" if window.location.reload actually runs,
    // so it's stubbed here — this test asserts the localStorage side effect only. A full
    // assertion that the picker re-renders after reload isn't practical in jsdom, since a
    // real reload re-executes the whole page rather than re-running React effects; the
    // clear-then-reload approach relies on KeeperGate's own mount-time localStorage read,
    // which is covered separately by KeeperGate.test.tsx.
    const reloadSpy = jest.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });

    render(<Sidebar />);
    expect(screen.getByText('Priya Patel')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Switch'));

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
