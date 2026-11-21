import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Lock,
  Unlock,
  LogOut,
  Moon,
  Sun,
  UserPlus,
  UserCheck,
  MessageSquare,
  Ban,
  Flag,
  Download,
  Check,
  X,
  Play,
} from 'lucide-react';
import { apiFetch, setStoredToken, uploadMediaFile } from '../api';
import { Avatar } from './Avatar';
import { ReportModal } from './ReportModal';
import { PWAInstallButton } from './PWAControls';
import type { Post, User } from '../types';

interface ProfileViewProps {
  currentUser: User;
  viewedUserId: string;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onUserUpdated: (user: User) => void;
  onLogout: () => void;
  onOpenChat: (userId: string) => void;
  onBackToMyProfile: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  currentUser,
  viewedUserId,
  theme,
  onToggleTheme,
  onUserUpdated,
  onLogout,
  onOpenChat,
  onBackToMyProfile,
}) => {
  const isOwn = viewedUserId === currentUser.id;
  const [profileUser, setProfileUser] = useState<User | null>(isOwn ? currentUser : null);
  const [stats, setStats] = useState({ followersCount: 0, followingCount: 0, postsCount: 0 });
  const [followStatus, setFollowStatus] = useState<'none' | 'accepted' | 'pending'>('none');
  const [posts, setPosts] = useState<Post[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<User[]>([]);

  // Edit form
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(currentUser.display_name);
  const [username, setUsername] = useState(currentUser.username);
  const [bio, setBio] = useState(currentUser.bio);
  const [isPrivate, setIsPrivate] = useState(Boolean(currentUser.is_private));
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement>(null);

  const loadProfile = async () => {
    const res = await apiFetch<{
      user: User;
      stats: { followersCount: number; followingCount: number; postsCount: number };
      followStatus: 'none' | 'accepted' | 'pending';
    }>(`/api/users/${viewedUserId}`);
    setProfileUser(res.user);
    setStats(res.stats);
    setFollowStatus(res.followStatus);

    const postsRes = await apiFetch<{ posts: Post[] }>(`/api/posts?mode=user&userId=${res.user.id}`);
    setPosts(postsRes.posts);

    if (isOwn) {
      setDisplayName(res.user.display_name);
      setUsername(res.user.username);
      setBio(res.user.bio);
      setIsPrivate(Boolean(res.user.is_private));
      const reqRes = await apiFetch<{ requests: any[] }>('/api/follow-requests');
      setRequests(reqRes.requests);
      const blkRes = await apiFetch<{ blockedUsers: User[] }>('/api/blocks');
      setBlockedUsers(blkRes.blockedUsers);
    }
  };

  useEffect(() => {
    loadProfile();
  }, [viewedUserId]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const up = await uploadMediaFile(file, file.name);
    const res = await apiFetch<{ user: User }>('/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify({ avatar_url: up.url }),
    });
    setProfileUser(res.user);
    onUserUpdated(res.user);
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError('');
    setSaving(true);
    try {
      const res = await apiFetch<{ user: User }>('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ display_name: displayName, username, bio, is_private: isPrivate }),
      });
      setProfileUser(res.user);
      onUserUpdated(res.user);
      setEditing(false);
    } catch (err: any) {
      setEditError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleFollow = async () => {
    if (!profileUser) return;
    const res = await apiFetch<{ status: 'none' | 'accepted' | 'pending' }>(`/api/users/${profileUser.id}/follow`, {
      method: 'POST',
    });
    setFollowStatus(res.status);
    loadProfile();
  };

  const handleFollowRequest = async (followerId: string, action: 'accept' | 'decline') => {
    await apiFetch(`/api/follow-requests/${followerId}`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    loadProfile();
  };

  const unblockUser = async (userId: string) => {
    await apiFetch(`/api/users/${userId}/block`, { method: 'POST' });
    loadProfile();
  };

  const blockCurrentProfile = async () => {
    if (!profileUser) return;
    await apiFetch(`/api/users/${profileUser.id}/block`, { method: 'POST' });
    onBackToMyProfile();
  };

  if (!profileUser) {
    return <div className="py-16 text-center text-sm text-zinc-500">Profil yükleniyor...</div>;
  }

  return (
    <div className="space-y-5">
      {!isOwn && (
        <button
          type="button"
          onClick={onBackToMyProfile}
          className="text-xs font-semibold text-[#7C3AED] dark:text-[#A78BFA]"
        >
          ← Kendi Profilime Dön
        </button>
      )}

      {/* Profile Header Card */}
      <section className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="relative shrink-0">
              <Avatar src={profileUser.avatar_url} name={profileUser.display_name} size="xl" />
              {isOwn && (
                <>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarUpload}
                  />
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-[#7C3AED] text-white flex items-center justify-center shadow"
                    aria-label="Profil fotoğrafını değiştir"
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-display font-bold text-xl text-zinc-900 dark:text-white truncate">
                  {profileUser.display_name}
                </h2>
                {Boolean(profileUser.is_private) && <Lock className="w-4 h-4 text-zinc-400 shrink-0" />}
              </div>
              <div className="text-sm text-zinc-500">@{profileUser.username}</div>
              {profileUser.bio && (
                <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{profileUser.bio}</p>
              )}
            </div>
          </div>

          {isOwn && (
            <button
              type="button"
              onClick={onToggleTheme}
              className="min-w-[44px] min-h-[44px] rounded-2xl border border-zinc-200 dark:border-[#232631] flex items-center justify-center text-zinc-700 dark:text-zinc-300 shrink-0"
              aria-label="Tema değiştir"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 pt-4 border-t border-zinc-100 dark:border-[#232631] text-center">
          <div>
            <div className="font-display font-bold text-lg text-zinc-900 dark:text-white tabular-nums">
              {stats.postsCount}
            </div>
            <div className="text-xs text-zinc-500">Gönderi</div>
          </div>
          <div>
            <div className="font-display font-bold text-lg text-zinc-900 dark:text-white tabular-nums">
              {stats.followersCount}
            </div>
            <div className="text-xs text-zinc-500">Takipçi</div>
          </div>
          <div>
            <div className="font-display font-bold text-lg text-zinc-900 dark:text-white tabular-nums">
              {stats.followingCount}
            </div>
            <div className="text-xs text-zinc-500">Takip</div>
          </div>
        </div>

        {/* Action Buttons */}
        {isOwn ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setEditing(!editing)}
                className="flex-1 min-h-[44px] px-4 rounded-2xl bg-zinc-100 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] text-xs font-semibold text-zinc-900 dark:text-white"
              >
                {editing ? 'Düzenlemeyi Kapat' : 'Profili & Gizliliği Düzenle'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStoredToken(null);
                  onLogout();
                }}
                className="min-h-[44px] px-4 rounded-2xl border border-red-500/30 text-red-500 text-xs font-semibold flex items-center gap-1.5"
              >
                <LogOut className="w-4 h-4" />
                <span>Çıkış</span>
              </button>
            </div>
            <PWAInstallButton />
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={toggleFollow}
              className={`flex-1 min-h-[44px] px-4 rounded-2xl text-xs font-semibold flex items-center justify-center gap-1.5 ${
                followStatus === 'none'
                  ? 'bg-[#7C3AED] text-white'
                  : 'bg-zinc-200 dark:bg-[#232631] text-zinc-900 dark:text-white'
              }`}
            >
              {followStatus === 'none' ? <UserPlus className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
              <span>
                {followStatus === 'accepted'
                  ? 'Takip Ediliyor'
                  : followStatus === 'pending'
                  ? 'İstek Gönderildi'
                  : 'Takip Et'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onOpenChat(profileUser.id)}
              className="min-h-[44px] px-4 rounded-2xl border border-zinc-200 dark:border-[#232631] text-xs font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Mesaj</span>
            </button>
            <button
              type="button"
              onClick={blockCurrentProfile}
              className="min-w-[44px] min-h-[44px] rounded-2xl border border-zinc-200 dark:border-[#232631] text-red-500 flex items-center justify-center"
              aria-label="Engelle"
            >
              <Ban className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="min-w-[44px] min-h-[44px] rounded-2xl border border-zinc-200 dark:border-[#232631] text-zinc-500 flex items-center justify-center"
              aria-label="Şikâyet et"
            >
              <Flag className="w-4 h-4" />
            </button>
          </div>
        )}
      </section>

      {/* Edit Profile Form */}
      {isOwn && editing && (
        <form
          onSubmit={saveProfile}
          className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-5 space-y-4"
        >
          <h3 className="font-display font-bold text-sm text-zinc-900 dark:text-white">Hesap Bilgileri</h3>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Görünen Ad</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full min-h-[44px] px-4 rounded-2xl bg-zinc-50 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] text-sm text-zinc-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Kullanıcı Adı</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full min-h-[44px] px-4 rounded-2xl bg-zinc-50 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] text-sm text-zinc-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Biyografi</label>
            <textarea
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full p-3.5 rounded-2xl bg-zinc-50 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] text-sm text-zinc-900 dark:text-white resize-none"
            />
          </div>
          <label className="flex items-center justify-between p-3.5 rounded-2xl bg-zinc-50 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] cursor-pointer">
            <div className="flex items-center gap-2.5">
              {isPrivate ? <Lock className="w-4 h-4 text-[#7C3AED]" /> : <Unlock className="w-4 h-4 text-zinc-400" />}
              <div>
                <div className="text-sm font-medium text-zinc-900 dark:text-white">Gizli Hesap</div>
                <div className="text-xs text-zinc-500">Yalnızca onayladığınız takipçiler gönderilerinizi görür</div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="w-5 h-5 accent-[#7C3AED]"
            />
          </label>
          {editError && <div className="text-xs text-red-500">{editError}</div>}
          <button
            type="submit"
            disabled={saving}
            className="w-full min-h-[46px] rounded-2xl bg-[#7C3AED] text-white text-sm font-semibold"
          >
            {saving ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
          </button>
        </form>
      )}

      {/* Pending Follow Requests (Own Private Account) */}
      {isOwn && requests.length > 0 && (
        <section className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-5 space-y-3">
          <h3 className="font-display font-bold text-sm text-zinc-900 dark:text-white">Takip İstekleri</h3>
          {requests.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Avatar src={r.avatar_url} name={r.display_name} size="sm" />
                <div>
                  <div className="text-sm font-medium text-zinc-900 dark:text-white">{r.display_name}</div>
                  <div className="text-xs text-zinc-500">@{r.username}</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleFollowRequest(r.id, 'accept')}
                  className="min-w-[40px] min-h-[40px] rounded-xl bg-[#7C3AED] text-white flex items-center justify-center"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleFollowRequest(r.id, 'decline')}
                  className="min-w-[40px] min-h-[40px] rounded-xl bg-zinc-200 dark:bg-[#232631] text-zinc-600 dark:text-zinc-300 flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Blocked Users */}
      {isOwn && blockedUsers.length > 0 && (
        <section className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-5 space-y-3">
          <h3 className="font-display font-bold text-sm text-zinc-900 dark:text-white">Engellenen Kullanıcılar</h3>
          {blockedUsers.map((b) => (
            <div key={b.id} className="flex items-center justify-between">
              <span className="text-sm text-zinc-800 dark:text-zinc-200">@{b.username}</span>
              <button
                type="button"
                onClick={() => unblockUser(b.id)}
                className="text-xs font-semibold text-[#7C3AED] dark:text-[#A78BFA]"
              >
                Engeli Kaldır
              </button>
            </div>
          ))}
        </section>
      )}

      {/* User Posts Grid */}
      <section className="space-y-3">
        <h3 className="font-display font-bold text-sm text-zinc-900 dark:text-white">Paylaşımlar</h3>
        {posts.length === 0 ? (
          <div className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-8 text-center text-xs text-zinc-500">
            {Boolean(profileUser.is_private) && !isOwn && followStatus !== 'accepted'
              ? 'Bu hesap gizli. Gönderileri görmek için takip isteği gönderin.'
              : 'Henüz paylaşım yok.'}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {posts.map((p) => (
              <div
                key={p.id}
                className="aspect-square rounded-2xl overflow-hidden bg-zinc-100 dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] relative"
              >
                {p.media_url ? (
                  p.media_type === 'video' ? (
                    <>
                      <video src={p.media_url} muted playsInline className="w-full h-full object-cover" />
                      <Play className="w-4 h-4 text-white absolute top-2 right-2 drop-shadow" />
                    </>
                  ) : (
                    <img src={p.media_url} alt={p.caption || 'Gönderi'} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  )
                ) : (
                  <div className="p-2.5 text-xs text-zinc-700 dark:text-zinc-300 line-clamp-5">{p.caption}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Download Standalone Single HTML + Supabase SQL + LiveKit Server Package */}
      {isOwn && (
        <section className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-5 space-y-3">
          <h3 className="font-display font-bold text-sm text-zinc-900 dark:text-white">
            Tek HTML & Supabase Dağıtım Paketi
          </h3>
          <p className="text-xs text-zinc-500 leading-relaxed">
            VYRA istemcisini harici bir Supabase + LiveKit projesinde tek HTML dosyası olarak barındırmak için hazırlanan dosyaları indirebilirsiniz.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href="/downloads/vyra-standalone.html"
              download="vyra-standalone.html"
              className="min-h-[42px] px-3.5 rounded-xl bg-zinc-100 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] text-xs font-semibold text-zinc-800 dark:text-zinc-200 inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>vyra-standalone.html</span>
            </a>
            <a
              href="/downloads/vyra-supabase-schema.sql"
              download="vyra-supabase-schema.sql"
              className="min-h-[42px] px-3.5 rounded-xl bg-zinc-100 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] text-xs font-semibold text-zinc-800 dark:text-zinc-200 inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Supabase SQL + RLS</span>
            </a>
            <a
              href="/downloads/vyra-livekit-server.js"
              download="vyra-livekit-server.js"
              className="min-h-[42px] px-3.5 rounded-xl bg-zinc-100 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] text-xs font-semibold text-zinc-800 dark:text-zinc-200 inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>LiveKit Token Server</span>
            </a>
          </div>
        </section>
      )}

      {reportOpen && (
        <ReportModal
          targetType="user"
          targetId={profileUser.id}
          targetLabel={`@${profileUser.username}`}
          onClose={() => setReportOpen(false)}
        />
      )}
    </div>
  );
};
