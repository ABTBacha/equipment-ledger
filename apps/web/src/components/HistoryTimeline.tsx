'use client';

import { useState } from 'react';
import { CorrectMovementForm } from './CorrectMovementForm';
import { HistoryEntryView } from '../lib/types';

export function HistoryTimeline({ entries, onCorrected }: { entries: HistoryEntryView[]; onCorrected: () => void }) {
  const [correctingId, setCorrectingId] = useState<string | null>(null);

  return (
    <ul className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.movement._id} className="border border-hairline bg-surface p-4">
          <div className="flex justify-between items-start">
            <div>
              <div className="font-medium text-primary">{entry.movement.type}</div>
              <div className="text-sm text-muted font-mono">
                occurred {new Date(entry.movement.occurredAt).toLocaleString()}
              </div>
            </div>
            {!entry.correction && (
              <button
                type="button"
                onClick={() => setCorrectingId(entry.movement._id)}
                className="text-sm px-2 py-1 border border-hairline text-primary hover:bg-raised"
              >
                Correct this entry
              </button>
            )}
          </div>
          {entry.correction && (
            <div className="mt-2 pl-4 border-l-2 border-accent-amber text-sm">
              <div className="text-accent-amber font-medium">Corrected</div>
              <div className="text-primary font-mono">
                now recorded as occurring {new Date(entry.correction.occurredAt).toLocaleString()}
              </div>
              {entry.correction.reason && <div className="text-muted">{entry.correction.reason}</div>}
            </div>
          )}
          {correctingId === entry.movement._id && (
            <CorrectMovementForm
              movementId={entry.movement._id}
              onDone={() => {
                setCorrectingId(null);
                onCorrected();
              }}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
