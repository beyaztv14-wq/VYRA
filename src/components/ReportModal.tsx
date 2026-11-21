import React, { useState } from 'react';
import { Flag, X } from 'lucide-react';
import { apiFetch } from '../api';

interface ReportModalProps {
  targetType: 'user' | 'post' | 'shot' | 'stream' | 'channel' | 'message';
  targetId: string;
  targetLabel: string;
  onClose: () => void;
}

const REASONS = [
  'Spam veya yanıltıcı içerik',
  'Nefret söylemi veya taciz',
  'Şiddet veya tehlikeli içerik',
  'Çıplaklık veya 16+ yaş politikası ihlali',
  'Taklit hesap veya telif ihlali',
];

export const ReportModal: React.FC<ReportModalProps> = ({ targetType, targetId, targetLabel, onClose }) => {
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          targetType,
          targetId,
          reason: details.trim() ? `${reason} — ${details.trim()}` : reason,
        }),
      });
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-zinc-900 dark:text-white font-display font-bold text-base">
            <Flag className="w-4 h-4 text-red-500" />
            <span>Şikâyet Bildir</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-zinc-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {done ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              <strong>{targetLabel}</strong> hakkındaki bildiriminiz kaydedildi ve moderasyon kuyruğuna alındı.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full min-h-[46px] rounded-2xl bg-[#7C3AED] text-white text-sm font-semibold"
            >
              Tamam
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Hedef: {targetLabel}
            </p>
            <div className="space-y-2">
              {REASONS.map((r) => (
                <label
                  key={r}
                  className="flex items-center gap-3 p-3 rounded-2xl border border-zinc-200 dark:border-[#232631] cursor-pointer text-sm text-zinc-800 dark:text-zinc-200"
                >
                  <input
                    type="radio"
                    name="reason"
                    checked={reason === r}
                    onChange={() => setReason(r)}
                    className="accent-[#7C3AED]"
                  />
                  <span>{r}</span>
                </label>
              ))}
            </div>
            <textarea
              rows={2}
              placeholder="Ek açıklama (isteğe bağlı)"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              className="w-full p-3 rounded-2xl bg-zinc-50 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] text-sm text-zinc-900 dark:text-white resize-none"
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[46px] rounded-2xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold"
            >
              {submitting ? 'Gönderiliyor...' : 'Şikâyeti Gönder'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
