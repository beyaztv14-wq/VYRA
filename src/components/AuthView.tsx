import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, ShieldCheck, ArrowRight, Copy, Check } from 'lucide-react';
import { apiFetch, setStoredToken } from '../api';
import type { User } from '../types';

interface AuthViewProps {
  onAuthenticated: (user: User, token: string) => void;
}

export const AuthView: React.FC<AuthViewProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [issuedRecovery, setIssuedRecovery] = useState<{ code: string; user: User; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await apiFetch<{ token: string; user: User }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        });
        setStoredToken(res.token);
        onAuthenticated(res.user, res.token);
      } else if (mode === 'register') {
        const res = await apiFetch<{ token: string; user: User; recoveryCode: string }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ username, displayName, password }),
        });
        setStoredToken(res.token);
        setIssuedRecovery({ code: res.recoveryCode, user: res.user, token: res.token });
      } else {
        const res = await apiFetch<{ ok: boolean; newRecoveryCode: string }>('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ username, recoveryCode, newPassword }),
        });
        setSuccessMsg(`Şifreniz güncellendi. Yeni kurtarma kodunuz: ${res.newRecoveryCode}`);
        setMode('login');
        setPassword('');
        setRecoveryCode('');
        setNewPassword('');
      }
    } catch (err: any) {
      setError(err.message || 'Bir hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  if (issuedRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center p-5 bg-[#F8F9FB] dark:bg-[#0D0E12]">
        <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-7 shadow-xl">
          <div className="w-12 h-12 rounded-2xl bg-[#7C3AED]/10 text-[#7C3AED] dark:text-[#A78BFA] flex items-center justify-center mb-5">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-display font-bold tracking-tight text-zinc-900 dark:text-white">
            Hesabınız Hazır
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
            E-posta doğrulaması gerekmez. Şifrenizi unutursanız hesabınızı kurtarmak için aşağıdaki tek seferlik kurtarma kodunu güvenli bir yere kaydedin.
          </p>
          <div className="mt-5 p-4 rounded-2xl bg-zinc-100 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] flex items-center justify-between gap-3">
            <code className="font-mono text-lg font-semibold tracking-widest text-zinc-900 dark:text-white">
              {issuedRecovery.code}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(issuedRecovery.code);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="min-h-[44px] px-3 rounded-xl bg-white dark:bg-[#1E212B] border border-zinc-200 dark:border-[#2C303E] text-xs font-medium flex items-center gap-1.5 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-[#252936] transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Kopyalandı' : 'Kopyala'}</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => onAuthenticated(issuedRecovery.user, issuedRecovery.token)}
            className="mt-6 w-full min-h-[48px] rounded-2xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-display font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
          >
            <span>VYRA’ya Gir</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-[#F8F9FB] dark:bg-[#0D0E12]">
      {/* Left Brand Panel on Desktop */}
      <div className="hidden lg:flex flex-col justify-between p-14 bg-[#111319] text-white border-r border-[#232631]">
        <div>
          <div className="font-display font-extrabold text-3xl tracking-tight text-white">VYRA</div>
          <p className="mt-2 text-sm text-zinc-400">Your World. Your VYRA.</p>
        </div>

        <div className="max-w-lg">
          <h1 className="font-display text-4xl xl:text-5xl font-bold tracking-tight leading-[1.1] text-balance text-white">
            Gerçek insanlar, anlık akış ve canlı bağlantılar.
          </h1>
          <p className="mt-5 text-base text-zinc-400 leading-relaxed">
            Fotoğraf ve kısa video paylaşımları, uçtan uca gerçek zamanlı sohbetler, topluluk grupları, duyuru kanalları ve mobil kameradan doğrudan canlı yayın tek platformda.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-6 pt-8 border-t border-white/10 text-sm">
            <div>
              <div className="font-display font-bold text-white">VYRA Shots</div>
              <div className="mt-1 text-zinc-400 text-xs">Dikey kısa video akışı</div>
            </div>
            <div>
              <div className="font-display font-bold text-white">Canlı Yayın</div>
              <div className="mt-1 text-zinc-400 text-xs">Konuklu mobil yayın</div>
            </div>
            <div>
              <div className="font-display font-bold text-white">Gruplar & Kanallar</div>
              <div className="mt-1 text-zinc-400 text-xs">Anlık topluluk alanı</div>
            </div>
          </div>
        </div>

        <div className="text-xs text-zinc-500">16+ · Türkiye & Global · Şifreli Oturum</div>
      </div>

      {/* Right Auth Form */}
      <div className="flex flex-col justify-center items-center p-5 sm:p-10">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8">
            <div className="font-display font-extrabold text-3xl tracking-tight text-zinc-900 dark:text-white">VYRA</div>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Your World. Your VYRA.</p>
          </div>

          <div className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-6 sm:p-8 shadow-sm">
            <div className="flex items-center gap-1 p-1 rounded-2xl bg-zinc-100 dark:bg-[#0D0E12] mb-6">
              <button
                type="button"
                onClick={() => { setMode('login'); setError(''); }}
                className={`flex-1 min-h-[40px] rounded-xl text-xs font-semibold transition-colors ${
                  mode === 'login'
                    ? 'bg-white dark:bg-[#1E212B] text-zinc-900 dark:text-white shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                Giriş Yap
              </button>
              <button
                type="button"
                onClick={() => { setMode('register'); setError(''); }}
                className={`flex-1 min-h-[40px] rounded-xl text-xs font-semibold transition-colors ${
                  mode === 'register'
                    ? 'bg-white dark:bg-[#1E212B] text-zinc-900 dark:text-white shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                Kayıt Ol
              </button>
              <button
                type="button"
                onClick={() => { setMode('forgot'); setError(''); }}
                className={`flex-1 min-h-[40px] rounded-xl text-xs font-semibold transition-colors ${
                  mode === 'forgot'
                    ? 'bg-white dark:bg-[#1E212B] text-zinc-900 dark:text-white shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                Şifre Sıfırla
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                  Kullanıcı Adı
                </label>
                <input
                  type="text"
                  required
                  autoComplete="username"
                  placeholder="ör. emre_istanbul"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full min-h-[46px] px-4 rounded-2xl bg-zinc-50 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-[#7C3AED]"
                />
              </div>

              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                    Görünen Ad
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Adınız veya takma adınız"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full min-h-[46px] px-4 rounded-2xl bg-zinc-50 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-[#7C3AED]"
                  />
                </div>
              )}

              {mode !== 'forgot' ? (
                <div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                    Şifre
                  </label>
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      placeholder="En az 6 karakter"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full min-h-[46px] pl-4 pr-12 rounded-2xl bg-zinc-50 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-[#7C3AED]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      aria-label="Şifreyi göster veya gizle"
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                      Kurtarma Kodu
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        placeholder="Kayıt sırasında verilen 12 haneli kod"
                        value={recoveryCode}
                        onChange={(e) => setRecoveryCode(e.target.value)}
                        className="w-full min-h-[46px] pl-10 pr-4 rounded-2xl bg-zinc-50 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] text-sm font-mono text-zinc-900 dark:text-white focus:outline-none focus:border-[#7C3AED]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                      Yeni Şifre
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      placeholder="Yeni şifreniz"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full min-h-[46px] px-4 rounded-2xl bg-zinc-50 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-[#7C3AED]"
                    />
                  </div>
                </>
              )}

              {error && (
                <div className="p-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400">
                  {error}
                </div>
              )}

              {successMsg && (
                <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-300">
                  {successMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[48px] rounded-2xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 text-white font-display font-semibold text-sm transition-colors flex items-center justify-center gap-2"
              >
                {loading
                  ? 'İşleniyor...'
                  : mode === 'login'
                  ? 'Giriş Yap'
                  : mode === 'register'
                  ? 'Hesap Oluştur (E-posta Onaysız)'
                  : 'Şifreyi Güncelle'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
