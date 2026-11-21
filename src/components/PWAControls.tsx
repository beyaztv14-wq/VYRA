import React, { useState } from 'react';
import { Download, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWA';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={
          compact
            ? 'min-h-[38px] px-3 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0'
            : 'w-full min-h-[44px] px-4 rounded-2xl bg-[#7C3AED]/10 border border-[#7C3AED]/30 text-[#7C3AED] dark:text-[#A78BFA] text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap hover:bg-[#7C3AED]/15 transition-colors'
        }
      >
        <Download className="w-3.5 h-3.5" />
        <span>Uygulamayı Yükle</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowGuide(true)}
          className={
            compact
              ? 'min-h-[38px] px-3 rounded-xl border border-zinc-200 dark:border-[#232631] text-xs font-medium text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5 whitespace-nowrap shrink-0'
              : 'w-full min-h-[44px] px-4 rounded-2xl border border-zinc-200 dark:border-[#232631] text-xs font-semibold text-zinc-800 dark:text-zinc-200 flex items-center justify-center gap-2'
          }
        >
          <Download className="w-3.5 h-3.5" />
          <span>Ana Ekrana Ekle</span>
        </button>

        {showGuide && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display font-bold text-base text-zinc-900 dark:text-white">
                  Ana Ekrana Ekle
                </h3>
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="min-w-[40px] min-h-[40px] -mr-2 flex items-center justify-center text-zinc-500"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
                1. Safari araç çubuğundaki <strong>Paylaş</strong> simgesine dokunun.
                <br />
                2. Aşağı kaydırıp <strong>Ana Ekrana Ekle</strong> seçeneğine dokunun.
              </p>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="w-full min-h-[44px] rounded-2xl bg-[#7C3AED] text-white text-xs font-semibold"
              >
                Tamam
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-[68px] lg:bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-amber-600 text-white text-xs font-medium shadow-lg flex items-center gap-2 whitespace-nowrap"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Çevrimdışı mod — Önbellekteki içerikler gösteriliyor</span>
    </div>
  );
};
