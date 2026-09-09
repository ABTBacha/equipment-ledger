'use client';

import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { CertificationView } from '../lib/types';
import { useToast } from './ToastProvider';

/**
 * Certifications are worker attributes, not ledger events — nothing here writes a movement,
 * and removing one is not retroactive: a worker keeps any asset already in hand, and past
 * movements stand as the record of what happened. Only the next issue sees the change.
 *
 * Codes are unique per worker, so adding a code the worker already holds renews it: the API
 * upserts, and this form relabels itself to say so.
 */
export function CertificationEditor({
  workerId,
  certifications,
  onChanged,
}: {
  workerId: string;
  certifications: CertificationView[];
  onChanged: () => void;
}) {
  const { showToast } = useToast();
  const [code, setCode] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [removingCode, setRemovingCode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = Date.now();
  const isRenewal = certifications.some((c) => c.code === code.trim());

  const add = async () => {
    setError(null);
    const trimmed = code.trim();
    if (!trimmed || !expiresAt) {
      setError('Code and expiry are both required');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/workers/${workerId}/certifications/${encodeURIComponent(trimmed)}`, {
        method: 'PUT',
        body: JSON.stringify({ expiresAt: new Date(expiresAt).toISOString() }),
      });
      showToast(isRenewal ? `Renewed ${trimmed}` : `Added ${trimmed}`);
      setCode('');
      setExpiresAt('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (target: string) => {
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/workers/${workerId}/certifications/${encodeURIComponent(target)}`, { method: 'DELETE' });
      showToast(`Removed ${target}`);
      setRemovingCode(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {certifications.length === 0 ? (
        <p className="text-sm text-muted">No certifications held.</p>
      ) : (
        <ul className="space-y-1">
          {certifications.map((cert) => {
            const expired = new Date(cert.expiresAt).getTime() < now;
            return (
              <li key={cert.code} className="flex items-center gap-2 text-sm">
                <span className="font-mono text-primary">{cert.code}</span>
                <span className={expired ? 'text-accent-red font-medium' : 'text-muted'}>
                  {expired ? 'Expired' : 'Valid'} until {new Date(cert.expiresAt).toLocaleDateString()}
                </span>
                {removingCode === cert.code ? (
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setRemovingCode(null)}
                      disabled={submitting}
                      className="px-2 py-0.5 border border-hairline text-primary hover:bg-raised"
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(cert.code)}
                      disabled={submitting}
                      className="px-2 py-0.5 border border-hairline bg-accent-red text-base disabled:opacity-50"
                    >
                      Confirm removal
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setRemovingCode(cert.code);
                      setError(null);
                    }}
                    disabled={submitting}
                    className="px-2 py-0.5 border border-hairline text-muted hover:bg-raised hover:text-primary"
                  >
                    Remove {cert.code}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 border border-hairline bg-surface p-3">
        <div className="grid grid-cols-2 gap-3 mb-2">
          <div>
            <label className="block text-sm mb-1 text-muted" htmlFor="cert-code">
              Certification code
            </label>
            <input
              id="cert-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={submitting}
              className="border border-hairline bg-raised px-2 py-1 w-full text-primary"
            />
          </div>
          <div>
            <label className="block text-sm mb-1 text-muted" htmlFor="cert-expires">
              Expires
            </label>
            <input
              id="cert-expires"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              disabled={submitting}
              className="border border-hairline bg-raised px-2 py-1 w-full text-primary"
            />
          </div>
        </div>
        {error && <div className="text-sm text-accent-red mb-2">{error}</div>}
        <button
          type="button"
          onClick={add}
          disabled={submitting}
          className="px-3 py-1 border border-hairline bg-accent-blue text-base disabled:opacity-50"
        >
          {isRenewal ? 'Renew certification' : 'Add certification'}
        </button>
      </div>
    </div>
  );
}
