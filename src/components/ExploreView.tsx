import React, { useEffect, useState } from 'react';
import { Search, Hash, UserPlus, MessageSquare, Play } from 'lucide-react';
import { apiFetch, formatRelativeTime } from '../api';
import { Avatar } from './Avatar';
import type { Post, User } from '../types';

interface ExploreViewProps {
  initialTag?: string;
  onOpenProfile: (userId: string) => void;
  onOpenChat: (userId: string) => void;
}

export const ExploreView: React.FC<ExploreViewProps> = ({ initialTag = '', onOpenProfile, onOpenChat }) => {
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState(initialTag);
  const [users, setUsers] = useState<User[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [hashtags, setHashtags] = useState<{ name: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSelectedTag(initialTag);
  }, [initialTag]);

  const loadExplore = async (q = query, tag = selectedTag) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (tag.trim()) params.set('tag', tag.trim());
      const res = await apiFetch<{ users: User[]; posts: Post[]; hashtags: { name: string; count: number }[] }>(
        `/api/explore?${params.toString()}`
      );
      setUsers(res.users);
      setPosts(res.posts);
      setHashtags(res.hashtags);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadExplore(query, selectedTag);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, selectedTag]);

  const followUser = async (userId: string) => {
    await apiFetch(`/api/users/${userId}/follow`, { method: 'POST' });
    onOpenProfile(userId);
  };

  return (
    <div className="space-y-6">
      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-zinc-400 absolute left-4 top-1/2 -translate-y-1/2" />
        <input
          type="search"
          placeholder="Kullanıcı, gönderi veya #etiket ara..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full min-h-[48px] pl-11 pr-4 rounded-2xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-[#7C3AED]"
        />
      </div>

      {/* Hashtags */}
      {hashtags.length > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-bold text-sm text-zinc-900 dark:text-white">Gündemdeki Etiketler</h2>
            {selectedTag && (
              <button
                type="button"
                onClick={() => setSelectedTag('')}
                className="text-xs font-medium text-[#7C3AED] dark:text-[#A78BFA]"
              >
                Filtreyi Temizle
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {hashtags.map((h) => (
              <button
                key={h.name}
                type="button"
                onClick={() => setSelectedTag(selectedTag === h.name ? '' : h.name)}
                className={`min-h-[38px] px-3.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                  selectedTag === h.name
                    ? 'bg-[#7C3AED] border-[#7C3AED] text-white'
                    : 'bg-white dark:bg-[#15171E] border-zinc-200 dark:border-[#232631] text-zinc-800 dark:text-zinc-200 hover:border-[#7C3AED]/60'
                }`}
              >
                <Hash className="w-3.5 h-3.5 opacity-70" />
                <span>{h.name.replace(/^#/, '')}</span>
                <span className="opacity-60 font-mono tabular-nums">{h.count}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Suggested / Found Accounts */}
      <section className="space-y-3">
        <h2 className="font-display font-bold text-sm text-zinc-900 dark:text-white">
          {query ? 'Eşleşen Kullanıcılar' : 'Önerilen Gerçek Hesaplar'}
        </h2>
        {loading && users.length === 0 ? (
          <div className="text-xs text-zinc-500">Aranıyor...</div>
        ) : users.length === 0 ? (
          <div className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-6 text-xs text-zinc-500">
            Henüz başka kullanıcı bulunamadı. İkinci bir cihazdan veya gizli sekmeden yeni bir hesap oluşturarak etkileşimi test edebilirsiniz.
          </div>
        ) : (
          <div className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] divide-y divide-zinc-100 dark:divide-[#232631]">
            {users.map((u) => (
              <div key={u.id} className="p-3.5 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onOpenProfile(u.id)}
                  className="flex items-center gap-3 min-w-0 text-left flex-1"
                >
                  <Avatar src={u.avatar_url} name={u.display_name} size="md" />
                  <div className="min-w-0">
                    <div className="font-display font-semibold text-sm text-zinc-900 dark:text-white truncate">
                      {u.display_name}
                    </div>
                    <div className="text-xs text-zinc-500 truncate">
                      @{u.username}
                      {u.bio ? ` · ${u.bio}` : ''}
                    </div>
                  </div>
                </button>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenChat(u.id)}
                    className="min-w-[44px] min-h-[44px] rounded-xl border border-zinc-200 dark:border-[#232631] flex items-center justify-center text-zinc-600 dark:text-zinc-300 hover:border-[#7C3AED]"
                    aria-label="Mesaj gönder"
                  >
                    <MessageSquare className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => followUser(u.id)}
                    className="min-h-[44px] px-3.5 rounded-xl bg-[#7C3AED] text-white text-xs font-semibold flex items-center gap-1.5"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Profil</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Popular Posts */}
      <section className="space-y-3">
        <h2 className="font-display font-bold text-sm text-zinc-900 dark:text-white">
          {selectedTag ? `${selectedTag} İçerikleri` : 'Popüler İçerikler'}
        </h2>
        {posts.length === 0 ? (
          <div className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-6 text-xs text-zinc-500">
            Gösterilecek herkese açık gönderi bulunamadı.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {posts.map((p) => (
              <div
                key={p.id}
                onClick={() => onOpenProfile(p.author.id)}
                className="cursor-pointer rounded-2xl overflow-hidden bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] flex flex-col"
              >
                {p.media_url ? (
                  <div className="relative aspect-square bg-black">
                    {p.media_type === 'video' ? (
                      <>
                        <video src={p.media_url} muted playsInline className="w-full h-full object-cover" />
                        <Play className="w-5 h-5 text-white absolute top-2.5 right-2.5 drop-shadow" />
                      </>
                    ) : (
                      <img
                        src={p.media_url}
                        alt={p.caption || 'Gönderi'}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                ) : (
                  <div className="aspect-square p-3.5 flex items-center justify-center text-xs text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-[#101218]">
                    <p className="line-clamp-5">{p.caption}</p>
                  </div>
                )}
                <div className="p-2.5 text-[11px] text-zinc-500 flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">@{p.author.username}</span>
                  <span className="font-mono tabular-nums shrink-0">{p.likesCount} beğeni</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
