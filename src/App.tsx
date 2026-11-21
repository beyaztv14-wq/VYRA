import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Home,
  Film,
  Search,
  MessageCircle,
  Radio,
  Plus,
  Sun,
  Moon,
  User as UserIcon,
} from 'lucide-react';
import { apiFetch, getStoredToken, setStoredToken } from './api';
import { AuthView } from './components/AuthView';
import { Avatar } from './components/Avatar';
import { CameraComposer } from './components/CameraComposer';
import { FeedView } from './components/FeedView';
import { ShotsView } from './components/ShotsView';
import { ExploreView } from './components/ExploreView';
import { MessagesView } from './components/MessagesView';
import { LiveView } from './components/LiveView';
import { ProfileView } from './components/ProfileView';
import { OfflineIndicator, PWAInstallButton } from './components/PWAControls';
import type { LiveStreamItem, Post, User } from './types';

type TabId = 'home' | 'shots' | 'explore' | 'messages' | 'live' | 'profile';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('vyra_theme');
    return saved === 'light' ? 'light' : 'dark';
  });

  const [composerOpen, setComposerOpen] = useState(false);
  const [composerShotMode, setComposerShotMode] = useState(false);
  const [viewedProfileId, setViewedProfileId] = useState<string | null>(null);
  const [chatPeerId, setChatPeerId] = useState<string | null>(null);
  const [messagesSubTab, setMessagesSubTab] = useState<'dm' | 'groups' | 'channels'>('dm');
  const [exploreTag, setExploreTag] = useState('');
  const [activeLiveStreams, setActiveLiveStreams] = useState<LiveStreamItem[]>([]);

  // Real-time WebSocket state
  const wsRef = useRef<WebSocket | null>(null);
  const [wsEvents, setWsEvents] = useState<{ event: string; payload: any; seq: number } | null>(null);
  const seqRef = useRef(0);

  // Sync theme with <html> class and mobile theme-color meta
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'dark' ? '#0D0E12' : '#F8F9FB');
    }
    localStorage.setItem('vyra_theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  // Bootstrap session
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setAuthChecked(true);
      return;
    }
    apiFetch<{ user: User }>('/api/auth/me')
      .then((res) => {
        setUser(res.user);
      })
      .catch(() => {
        setStoredToken(null);
      })
      .finally(() => setAuthChecked(true));
  }, []);

  // Connect WebSocket when authenticated
  useEffect(() => {
    if (!user) {
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    let closedByCleanup = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      const token = getStoredToken();
      if (!token) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data);
          seqRef.current += 1;
          setWsEvents({ event: parsed.event, payload: parsed.payload, seq: seqRef.current });
          if (parsed.event === 'live:started' || parsed.event === 'live:ended') {
            apiFetch<{ streams: LiveStreamItem[] }>('/api/live')
              .then((r) => setActiveLiveStreams(r.streams))
              .catch(() => {});
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        if (!closedByCleanup) {
          reconnectTimer = window.setTimeout(connect, 2500);
        }
      };
    };

    connect();
    apiFetch<{ streams: LiveStreamItem[] }>('/api/live')
      .then((r) => setActiveLiveStreams(r.streams))
      .catch(() => {});

    return () => {
      closedByCleanup = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [user?.id]);

  const sendWsMessage = useCallback((event: string, payload: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ event, payload }));
    }
  }, []);

  const openProfile = (userId: string) => {
    setViewedProfileId(userId);
    setActiveTab('profile');
  };

  const openChat = (peerId: string) => {
    setMessagesSubTab('dm');
    setChatPeerId(peerId);
    setActiveTab('messages');
  };

  const openHashtag = (tag: string) => {
    setExploreTag(tag);
    setActiveTab('explore');
  };

  const handlePostCreated = (post: Post) => {
    setActiveTab(post.is_shot ? 'shots' : 'home');
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F9FB] dark:bg-[#0D0E12] text-sm text-zinc-500">
        VYRA yükleniyor...
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <AuthView
          onAuthenticated={(u) => {
            setUser(u);
            setActiveTab('home');
          }}
        />
        <OfflineIndicator />
      </>
    );
  }

  const navItems: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'home', label: 'Akış', icon: Home },
    { id: 'shots', label: 'Shots', icon: Film },
    { id: 'explore', label: 'Keşfet', icon: Search },
    { id: 'messages', label: 'Mesajlar', icon: MessageCircle },
    { id: 'live', label: 'Canlı', icon: Radio },
  ];

  return (
    <div className="min-h-screen bg-[#F8F9FB] dark:bg-[#0D0E12] text-zinc-900 dark:text-zinc-100">
      {/* Mobile Compact Sticky Top Bar (<= 52px) */}
      <header className="lg:hidden sticky top-0 z-30 h-[52px] px-4 bg-white/90 dark:bg-[#0D0E12]/90 backdrop-blur-md border-b border-zinc-200 dark:border-[#232631] flex items-center justify-between">
        <button
          type="button"
          onClick={() => setActiveTab('home')}
          className="font-display font-extrabold text-xl tracking-tight text-zinc-900 dark:text-white whitespace-nowrap"
        >
          VYRA
        </button>

        <div className="flex items-center gap-1.5">
          <PWAInstallButton compact />
          <button
            type="button"
            onClick={toggleTheme}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-600 dark:text-zinc-300"
            aria-label="Tema değiştir"
          >
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button
            type="button"
            onClick={() => openProfile(user.id)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Profilim"
          >
            <Avatar src={user.avatar_url} name={user.display_name} size="sm" />
          </button>
        </div>
      </header>

      {/* Main Responsive Shell */}
      <div className="max-w-7xl mx-auto lg:grid lg:grid-cols-[240px_minmax(0,1fr)_280px] lg:gap-6 lg:px-6 lg:py-6">
        {/* Desktop Left Navigation Rail */}
        <aside className="hidden lg:flex flex-col justify-between sticky top-6 h-[calc(100vh-3rem)]">
          <div className="space-y-6">
            <div className="px-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setActiveTab('home')}
                className="font-display font-extrabold text-2xl tracking-tight text-zinc-900 dark:text-white"
              >
                VYRA
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                className="w-10 h-10 rounded-xl border border-zinc-200 dark:border-[#232631] flex items-center justify-center text-zinc-600 dark:text-zinc-300 hover:border-[#7C3AED]"
                aria-label="Tema değiştir"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>

            <nav className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (item.id === 'messages') setChatPeerId(null);
                      setActiveTab(item.id);
                    }}
                    className={`w-full min-h-[46px] px-3.5 rounded-2xl flex items-center gap-3 text-sm font-semibold transition-colors ${
                      active
                        ? 'bg-[#7C3AED] text-white'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-[#15171E] hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => openProfile(user.id)}
                className={`w-full min-h-[46px] px-3.5 rounded-2xl flex items-center gap-3 text-sm font-semibold transition-colors ${
                  activeTab === 'profile' && (viewedProfileId === user.id || !viewedProfileId)
                    ? 'bg-[#7C3AED] text-white'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-[#15171E] hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                <UserIcon className="w-5 h-5" />
                <span>Profil</span>
              </button>
            </nav>

            <button
              type="button"
              onClick={() => {
                setComposerShotMode(false);
                setComposerOpen(true);
              }}
              className="w-full min-h-[48px] rounded-2xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-display font-semibold text-sm flex items-center justify-center gap-2 shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>Yeni Paylaşım</span>
            </button>

            <PWAInstallButton />
          </div>

          <button
            type="button"
            onClick={() => openProfile(user.id)}
            className="p-3 rounded-2xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] flex items-center gap-3 text-left"
          >
            <Avatar src={user.avatar_url} name={user.display_name} size="md" />
            <div className="min-w-0">
              <div className="font-display font-semibold text-sm text-zinc-900 dark:text-white truncate">
                {user.display_name}
              </div>
              <div className="text-xs text-zinc-500 truncate">@{user.username}</div>
            </div>
          </button>
        </aside>

        {/* Center Main Content */}
        <main className="px-3.5 pt-4 pb-24 lg:p-0 max-w-2xl w-full mx-auto">
          {activeTab === 'home' && (
            <FeedView
              currentUser={user}
              wsEvents={wsEvents}
              onOpenComposer={() => {
                setComposerShotMode(false);
                setComposerOpen(true);
              }}
              onOpenProfile={openProfile}
              onOpenChat={openChat}
              onHashtagClick={openHashtag}
            />
          )}

          {activeTab === 'shots' && (
            <ShotsView
              wsEvents={wsEvents}
              onOpenShotComposer={() => {
                setComposerShotMode(true);
                setComposerOpen(true);
              }}
              onOpenProfile={openProfile}
            />
          )}

          {activeTab === 'explore' && (
            <ExploreView
              initialTag={exploreTag}
              onOpenProfile={openProfile}
              onOpenChat={openChat}
            />
          )}

          {activeTab === 'messages' && (
            <MessagesView
              currentUser={user}
              initialSubTab={messagesSubTab}
              initialPeerId={chatPeerId}
              wsEvents={wsEvents}
              sendWsMessage={sendWsMessage}
              onOpenProfile={openProfile}
            />
          )}

          {activeTab === 'live' && (
            <LiveView
              currentUser={user}
              wsEvents={wsEvents}
              sendWsMessage={sendWsMessage}
            />
          )}

          {activeTab === 'profile' && (
            <ProfileView
              currentUser={user}
              viewedUserId={viewedProfileId || user.id}
              theme={theme}
              onToggleTheme={toggleTheme}
              onUserUpdated={(u) => setUser(u)}
              onLogout={() => setUser(null)}
              onOpenChat={openChat}
              onBackToMyProfile={() => setViewedProfileId(user.id)}
            />
          )}
        </main>

        {/* Desktop Right Context Rail */}
        <aside className="hidden lg:block space-y-4 sticky top-6 h-fit">
          <div className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-sm text-zinc-900 dark:text-white">Canlı Yayınlar</h2>
              <button
                type="button"
                onClick={() => setActiveTab('live')}
                className="text-xs font-semibold text-[#7C3AED] dark:text-[#A78BFA]"
              >
                Tümü
              </button>
            </div>
            {activeLiveStreams.length === 0 ? (
              <p className="text-xs text-zinc-500 leading-relaxed">
                Şu anda aktif canlı yayın yok. Canlı sekmesinden yayın başlatabilirsiniz.
              </p>
            ) : (
              <div className="space-y-2.5">
                {activeLiveStreams.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActiveTab('live')}
                    className="w-full p-2.5 rounded-2xl bg-zinc-50 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] text-left flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-zinc-900 dark:text-white truncate">{s.title}</div>
                      <div className="text-[11px] text-zinc-500 truncate">@{s.host_username}</div>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-red-500 font-semibold shrink-0">
                      {s.viewerCount}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-5 space-y-2">
            <div className="font-display font-bold text-sm text-zinc-900 dark:text-white">VYRA</div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Your World. Your VYRA. Türkiye ve dünya için tasarlanmış gerçek zamanlı sosyal medya, kısa video ve canlı yayın ağı.
            </p>
          </div>
        </aside>
      </div>

      {/* Mobile Fixed Bottom Navigation Bar (5 Tabs, <= 60px) */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-[#0D0E12]/95 backdrop-blur-md border-t border-zinc-200 dark:border-[#232631] pb-safe">
        <div className="grid grid-cols-5 h-[58px] items-center">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.id === 'messages') setChatPeerId(null);
                  setActiveTab(item.id);
                }}
                className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-[#7C3AED] dark:text-[#A78BFA]' : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium tracking-tight">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Camera & Media Composer Modal */}
      {composerOpen && (
        <CameraComposer
          initialShotMode={composerShotMode}
          onClose={() => setComposerOpen(false)}
          onCreated={handlePostCreated}
        />
      )}

      <OfflineIndicator />
    </div>
  );
}
