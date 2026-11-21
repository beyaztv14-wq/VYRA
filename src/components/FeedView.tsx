import React, { useEffect, useState } from 'react';
import { Heart, MessageCircle, Bookmark, Share2, MoreHorizontal, Trash2, Flag, Ban, Send, X, Plus } from 'lucide-react';
import { apiFetch, formatRelativeTime } from '../api';
import { Avatar } from './Avatar';
import { ReportModal } from './ReportModal';
import type { CommentItem, Post, User } from '../types';

interface FeedViewProps {
  currentUser: User;
  wsEvents: { event: string; payload: any } | null;
  onOpenComposer: () => void;
  onOpenProfile: (userId: string) => void;
  onOpenChat: (userId: string) => void;
  onHashtagClick: (tag: string) => void;
}

export const FeedView: React.FC<FeedViewProps> = ({
  currentUser,
  wsEvents,
  onOpenComposer,
  onOpenProfile,
  onOpenChat,
  onHashtagClick,
}) => {
  const [filter, setFilter] = useState<'all' | 'following' | 'saved'>('all');
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCommentsPost, setActiveCommentsPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentText, setCommentText] = useState('');
  const [menuPostId, setMenuPostId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{ id: string; label: string } | null>(null);
  const [shareToast, setShareToast] = useState('');

  const loadFeed = async (mode = filter) => {
    setLoading(true);
    try {
      const res = await apiFetch<{ posts: Post[] }>(`/api/posts?mode=${mode}`);
      setPosts(res.posts);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeed(filter);
  }, [filter]);

  useEffect(() => {
    if (!wsEvents) return;
    const { event, payload } = wsEvents;
    if (event === 'post:created' && payload?.post && !payload.post.is_shot && filter === 'all') {
      setPosts((prev) => {
        if (prev.some((p) => p.id === payload.post.id)) return prev;
        return [payload.post, ...prev];
      });
    } else if (event === 'post:deleted' && payload?.postId) {
      setPosts((prev) => prev.filter((p) => p.id !== payload.postId));
    } else if (event === 'post:liked' && payload?.postId) {
      setPosts((prev) =>
        prev.map((p) => (p.id === payload.postId ? { ...p, likesCount: payload.likesCount } : p))
      );
    } else if (event === 'post:commented' && payload?.postId) {
      setPosts((prev) =>
        prev.map((p) => (p.id === payload.postId ? { ...p, commentsCount: payload.commentsCount } : p))
      );
      if (activeCommentsPost?.id === payload.postId && payload.comment) {
        setComments((prev) =>
          prev.some((c) => c.id === payload.comment.id) ? prev : [...prev, payload.comment]
        );
      }
    }
  }, [wsEvents]);

  const toggleLike = async (post: Post) => {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? { ...p, liked: !p.liked, likesCount: p.likesCount + (p.liked ? -1 : 1) }
          : p
      )
    );
    try {
      const res = await apiFetch<{ liked: boolean; likesCount: number }>(`/api/posts/${post.id}/like`, {
        method: 'POST',
      });
      setPosts((prev) =>
        prev.map((p) => (p.id === post.id ? { ...p, liked: res.liked, likesCount: res.likesCount } : p))
      );
    } catch {
      loadFeed();
    }
  };

  const toggleSave = async (post: Post) => {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? { ...p, saved: !p.saved, savesCount: p.savesCount + (p.saved ? -1 : 1) }
          : p
      )
    );
    try {
      const res = await apiFetch<{ saved: boolean; savesCount: number }>(`/api/posts/${post.id}/save`, {
        method: 'POST',
      });
      setPosts((prev) =>
        prev.map((p) => (p.id === post.id ? { ...p, saved: res.saved, savesCount: res.savesCount } : p))
      );
    } catch {
      loadFeed();
    }
  };

  const openComments = async (post: Post) => {
    setActiveCommentsPost(post);
    setComments([]);
    const res = await apiFetch<{ comments: CommentItem[] }>(`/api/posts/${post.id}/comments`);
    setComments(res.comments);
  };

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCommentsPost || !commentText.trim()) return;
    const content = commentText.trim();
    setCommentText('');
    const res = await apiFetch<{ comment: CommentItem; commentsCount: number }>(
      `/api/posts/${activeCommentsPost.id}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({ content }),
      }
    );
    setComments((prev) => (prev.some((c) => c.id === res.comment.id) ? prev : [...prev, res.comment]));
    setPosts((prev) =>
      prev.map((p) => (p.id === activeCommentsPost.id ? { ...p, commentsCount: res.commentsCount } : p))
    );
  };

  const sharePost = async (post: Post) => {
    const shareData = {
      title: `VYRA — @${post.author.username}`,
      text: post.caption || 'VYRA üzerinden paylaşıldı',
      url: `${window.location.origin}/?post=${post.id}`,
    };
    if (navigator.share) {
      await navigator.share(shareData).catch(() => {});
    } else {
      await navigator.clipboard.writeText(shareData.url).catch(() => {});
      setShareToast('Bağlantı kopyalandı');
      setTimeout(() => setShareToast(''), 2000);
    }
  };

  const deletePost = async (postId: string) => {
    await apiFetch(`/api/posts/${postId}`, { method: 'DELETE' });
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    setMenuPostId(null);
  };

  const blockAuthor = async (userId: string) => {
    await apiFetch(`/api/users/${userId}/block`, { method: 'POST' });
    setPosts((prev) => prev.filter((p) => p.author.id !== userId));
    setMenuPostId(null);
  };

  return (
    <div className="space-y-4">
      {/* Segmented Feed Filter + Quick Post Trigger */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-2xl bg-zinc-200/70 dark:bg-[#15171E] border border-zinc-200/80 dark:border-[#232631]">
          {[
            { id: 'all', label: 'Akış' },
            { id: 'following', label: 'Takip' },
            { id: 'saved', label: 'Kaydedilenler' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id as any)}
              className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                filter === tab.id
                  ? 'bg-white dark:bg-[#232631] text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onOpenComposer}
          className="min-h-[44px] px-4 rounded-2xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Paylaş</span>
        </button>
      </div>

      {shareToast && (
        <div className="px-4 py-2.5 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-medium text-center">
          {shareToast}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-zinc-500">Akış yükleniyor...</div>
      ) : posts.length === 0 ? (
        <div className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-10 text-center space-y-3">
          <p className="font-display font-semibold text-base text-zinc-900 dark:text-white">
            {filter === 'following'
              ? 'Takip ettiğiniz kişilerden henüz gönderi yok'
              : filter === 'saved'
              ? 'Henüz kaydettiğiniz gönderi yok'
              : 'Henüz gönderi paylaşılmadı'}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">
            Kameranızla fotoğraf veya video çekip ilk gerçek VYRA gönderinizi paylaşabilirsiniz.
          </p>
          <button
            type="button"
            onClick={onOpenComposer}
            className="min-h-[44px] px-5 rounded-2xl bg-[#7C3AED] text-white text-xs font-semibold inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>İlk Gönderiyi Oluştur</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <article
              key={post.id}
              className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] overflow-hidden"
            >
              {/* Author Header */}
              <div className="px-4 py-3.5 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onOpenProfile(post.author.id)}
                  className="flex items-center gap-3 text-left min-w-0 min-h-[44px]"
                >
                  <Avatar src={post.author.avatar_url} name={post.author.display_name} size="md" />
                  <div className="min-w-0">
                    <div className="font-display font-semibold text-sm text-zinc-900 dark:text-white truncate">
                      {post.author.display_name}
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5 truncate">
                      <span>@{post.author.username}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatRelativeTime(post.created_at)}</span>
                    </div>
                  </div>
                </button>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMenuPostId(menuPostId === post.id ? null : post.id)}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                    aria-label="Gönderi seçenekleri"
                  >
                    <MoreHorizontal className="w-5 h-5" />
                  </button>
                  {menuPostId === post.id && (
                    <div className="absolute right-0 mt-1 w-48 rounded-2xl bg-white dark:bg-[#1C1F2A] border border-zinc-200 dark:border-[#2A2E3D] shadow-xl z-20 overflow-hidden">
                      {post.author.id !== currentUser.id && (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuPostId(null);
                            onOpenChat(post.author.id);
                          }}
                          className="w-full px-4 py-3 text-left text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-[#252936] flex items-center gap-2"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Mesaj Gönder</span>
                        </button>
                      )}
                      {post.author.id === currentUser.id ? (
                        <button
                          type="button"
                          onClick={() => deletePost(post.id)}
                          className="w-full px-4 py-3 text-left text-xs font-medium text-red-600 hover:bg-red-500/10 flex items-center gap-2"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Gönderiyi Sil</span>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setMenuPostId(null);
                              setReportTarget({ id: post.id, label: `@${post.author.username} gönderisi` });
                            }}
                            className="w-full px-4 py-3 text-left text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-[#252936] flex items-center gap-2"
                          >
                            <Flag className="w-3.5 h-3.5" />
                            <span>Şikâyet Et</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => blockAuthor(post.author.id)}
                            className="w-full px-4 py-3 text-left text-xs font-medium text-red-600 hover:bg-red-500/10 flex items-center gap-2"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            <span>Kullanıcıyı Engelle</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Media */}
              {post.media_url && post.media_type === 'image' && (
                <div className="bg-zinc-100 dark:bg-[#0D0E12] max-h-[540px] overflow-hidden flex items-center justify-center">
                  <img
                    src={post.media_url}
                    alt={post.caption || 'VYRA gönderisi'}
                    referrerPolicy="no-referrer"
                    className="w-full max-h-[540px] object-cover"
                  />
                </div>
              )}

              {post.media_url && post.media_type === 'video' && (
                <div className="bg-black max-h-[540px] flex items-center justify-center">
                  <video
                    src={post.media_url}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full max-h-[540px] object-contain"
                  />
                </div>
              )}

              {/* Caption & Hashtags */}
              {(post.caption || post.hashtags.length > 0) && (
                <div className="px-4 pt-3.5 pb-1 text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed whitespace-pre-wrap">
                  {post.caption}
                  {post.hashtags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-[#7C3AED] dark:text-[#A78BFA]">
                      {post.hashtags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => onHashtagClick(tag)}
                          className="hover:underline"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Action Bar */}
              <div className="px-2 py-2 flex items-center justify-between border-t border-zinc-100 dark:border-[#232631]/70 mt-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggleLike(post)}
                    className={`min-h-[44px] px-3 rounded-xl flex items-center gap-1.5 text-xs font-medium tabular-nums transition-colors ${
                      post.liked
                        ? 'text-rose-500'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    <Heart className={`w-5 h-5 ${post.liked ? 'fill-current' : ''}`} />
                    <span>{post.likesCount}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => openComments(post)}
                    className="min-h-[44px] px-3 rounded-xl flex items-center gap-1.5 text-xs font-medium tabular-nums text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                  >
                    <MessageCircle className="w-5 h-5" />
                    <span>{post.commentsCount}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => sharePost(post)}
                    className="min-h-[44px] px-3 rounded-xl flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                    aria-label="Paylaş"
                  >
                    <Share2 className="w-5 h-5" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => toggleSave(post)}
                  className={`min-w-[44px] min-h-[44px] px-3 rounded-xl flex items-center justify-center transition-colors ${
                    post.saved
                      ? 'text-[#7C3AED] dark:text-[#A78BFA]'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                  }`}
                  aria-label="Kaydet"
                >
                  <Bookmark className={`w-5 h-5 ${post.saved ? 'fill-current' : ''}`} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Comments Bottom Sheet / Modal */}
      {activeCommentsPost && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center">
          <div className="w-full sm:max-w-md h-[75vh] bg-white dark:bg-[#15171E] rounded-t-3xl sm:rounded-3xl border border-zinc-200 dark:border-[#232631] flex flex-col">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-[#232631] flex items-center justify-between">
              <span className="font-display font-semibold text-sm text-zinc-900 dark:text-white">
                Yorumlar ({activeCommentsPost.commentsCount})
              </span>
              <button
                type="button"
                onClick={() => setActiveCommentsPost(null)}
                className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-zinc-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {comments.length === 0 ? (
                <p className="text-center text-xs text-zinc-500 py-8">Henüz yorum yapılmadı. İlk yorumu yazın.</p>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-3">
                    <Avatar src={c.avatar_url} name={c.display_name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs flex items-center gap-1.5">
                        <span className="font-semibold text-zinc-900 dark:text-white">@{c.username}</span>
                        <span className="text-zinc-400">·</span>
                        <span className="text-zinc-500">{formatRelativeTime(c.created_at)}</span>
                      </div>
                      <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200 break-words">{c.content}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <form onSubmit={submitComment} className="p-3 border-t border-zinc-200 dark:border-[#232631] flex items-center gap-2">
              <input
                type="text"
                placeholder="Yorum ekle..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                className="flex-1 min-h-[44px] px-4 rounded-2xl bg-zinc-100 dark:bg-[#0D0E12] text-sm text-zinc-900 dark:text-white focus:outline-none"
              />
              <button
                type="submit"
                disabled={!commentText.trim()}
                className="min-w-[44px] min-h-[44px] rounded-2xl bg-[#7C3AED] disabled:opacity-40 text-white flex items-center justify-center"
                aria-label="Yorum gönder"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}

      {reportTarget && (
        <ReportModal
          targetType="post"
          targetId={reportTarget.id}
          targetLabel={reportTarget.label}
          onClose={() => setReportTarget(null)}
        />
      )}
    </div>
  );
};
