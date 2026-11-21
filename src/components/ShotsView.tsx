import React, { useEffect, useRef, useState } from 'react';
import { Heart, MessageCircle, Bookmark, Share2, Volume2, VolumeX, Plus, Send, X, Flag, ChevronUp, ChevronDown } from 'lucide-react';
import { apiFetch, formatRelativeTime } from '../api';
import { Avatar } from './Avatar';
import { ReportModal } from './ReportModal';
import type { CommentItem, Post } from '../types';

interface ShotsViewProps {
  wsEvents: { event: string; payload: any } | null;
  onOpenShotComposer: () => void;
  onOpenProfile: (userId: string) => void;
}

export const ShotsView: React.FC<ShotsViewProps> = ({ wsEvents, onOpenShotComposer, onOpenProfile }) => {
  const [shots, setShots] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [commentsShot, setCommentsShot] = useState<Post | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentText, setCommentText] = useState('');
  const [reportTarget, setReportTarget] = useState<{ id: string; label: string } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  const loadShots = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ posts: Post[] }>('/api/posts?mode=shots');
      setShots(res.posts);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShots();
  }, []);

  useEffect(() => {
    if (!wsEvents) return;
    if (wsEvents.event === 'post:created' && wsEvents.payload?.post?.is_shot) {
      setShots((prev) =>
        prev.some((s) => s.id === wsEvents.payload.post.id) ? prev : [wsEvents.payload.post, ...prev]
      );
    } else if (wsEvents.event === 'post:liked' && wsEvents.payload?.postId) {
      setShots((prev) =>
        prev.map((s) => (s.id === wsEvents.payload.postId ? { ...s, likesCount: wsEvents.payload.likesCount } : s))
      );
    } else if (wsEvents.event === 'post:commented' && wsEvents.payload?.postId) {
      setShots((prev) =>
        prev.map((s) =>
          s.id === wsEvents.payload.postId ? { ...s, commentsCount: wsEvents.payload.commentsCount } : s
        )
      );
    }
  }, [wsEvents]);

  useEffect(() => {
    videoRefs.current.forEach((vid, idx) => {
      if (!vid) return;
      vid.muted = muted;
      if (idx === activeIndex) {
        vid.play().catch(() => {});
      } else {
        vid.pause();
      }
    });
  }, [activeIndex, muted, shots.length]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el || el.clientHeight === 0) return;
    const idx = Math.round(el.scrollTop / el.clientHeight);
    if (idx !== activeIndex) setActiveIndex(idx);
  };

  const scrollToShot = (idx: number) => {
    const el = containerRef.current;
    if (!el || idx < 0 || idx >= shots.length) return;
    el.scrollTo({ top: idx * el.clientHeight, behavior: 'smooth' });
  };

  const toggleLike = async (shot: Post) => {
    setShots((prev) =>
      prev.map((s) =>
        s.id === shot.id ? { ...s, liked: !s.liked, likesCount: s.likesCount + (s.liked ? -1 : 1) } : s
      )
    );
    const res = await apiFetch<{ liked: boolean; likesCount: number }>(`/api/posts/${shot.id}/like`, {
      method: 'POST',
    });
    setShots((prev) =>
      prev.map((s) => (s.id === shot.id ? { ...s, liked: res.liked, likesCount: res.likesCount } : s))
    );
  };

  const toggleSave = async (shot: Post) => {
    setShots((prev) =>
      prev.map((s) =>
        s.id === shot.id ? { ...s, saved: !s.saved, savesCount: s.savesCount + (s.saved ? -1 : 1) } : s
      )
    );
    const res = await apiFetch<{ saved: boolean; savesCount: number }>(`/api/posts/${shot.id}/save`, {
      method: 'POST',
    });
    setShots((prev) =>
      prev.map((s) => (s.id === shot.id ? { ...s, saved: res.saved, savesCount: res.savesCount } : s))
    );
  };

  const openComments = async (shot: Post) => {
    setCommentsShot(shot);
    const res = await apiFetch<{ comments: CommentItem[] }>(`/api/posts/${shot.id}/comments`);
    setComments(res.comments);
  };

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentsShot || !commentText.trim()) return;
    const content = commentText.trim();
    setCommentText('');
    const res = await apiFetch<{ comment: CommentItem; commentsCount: number }>(
      `/api/posts/${commentsShot.id}/comments`,
      { method: 'POST', body: JSON.stringify({ content }) }
    );
    setComments((prev) => [...prev, res.comment]);
    setShots((prev) =>
      prev.map((s) => (s.id === commentsShot.id ? { ...s, commentsCount: res.commentsCount } : s))
    );
  };

  const shareShot = async (shot: Post) => {
    const url = `${window.location.origin}/?shot=${shot.id}`;
    if (navigator.share) {
      await navigator.share({ title: `VYRA Shot — @${shot.author.username}`, url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(url).catch(() => {});
    }
  };

  if (loading) {
    return <div className="py-20 text-center text-sm text-zinc-500">VYRA Shots yükleniyor...</div>;
  }

  if (shots.length === 0) {
    return (
      <div className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-10 text-center space-y-4">
        <h2 className="font-display font-bold text-lg text-zinc-900 dark:text-white">VYRA Shots</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">
          Henüz dikey kısa video yüklenmedi. Kameranızla ilk VYRA Shot videosunu kaydedip paylaşın.
        </p>
        <button
          type="button"
          onClick={onOpenShotComposer}
          className="min-h-[46px] px-5 rounded-2xl bg-[#7C3AED] text-white text-xs font-semibold inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>Shot Yükle</span>
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-display font-bold text-sm text-zinc-900 dark:text-white">
          VYRA Shots · {activeIndex + 1} / {shots.length}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMuted(!muted)}
            className="min-w-[44px] min-h-[44px] rounded-2xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] flex items-center justify-center text-zinc-700 dark:text-zinc-300"
            aria-label={muted ? 'Sesi aç' : 'Sesi kapat'}
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onOpenShotComposer}
            className="min-h-[44px] px-4 rounded-2xl bg-[#7C3AED] text-white text-xs font-semibold flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Shot Ekle</span>
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-[calc(100vh-14.5rem)] min-h-[480px] max-h-[760px] overflow-y-scroll snap-y snap-mandatory no-scrollbar rounded-3xl bg-black border border-zinc-200 dark:border-[#232631]"
      >
        {shots.map((shot, idx) => (
          <div key={shot.id} className="relative h-full w-full snap-start flex items-center justify-center bg-black">
            <video
              ref={(el) => {
                videoRefs.current[idx] = el;
              }}
              src={shot.media_url}
              loop
              playsInline
              muted={muted}
              onClick={(e) => {
                const v = e.currentTarget;
                if (v.paused) v.play().catch(() => {});
                else v.pause();
              }}
              className="w-full h-full object-contain cursor-pointer"
            />

            {/* Measured contrast scrim */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

            {/* Desktop up/down navigation */}
            <div className="hidden sm:flex flex-col gap-2 absolute top-4 right-4 z-10">
              <button
                type="button"
                disabled={idx === 0}
                onClick={() => scrollToShot(idx - 1)}
                className="w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center disabled:opacity-30"
                aria-label="Önceki video"
              >
                <ChevronUp className="w-5 h-5" />
              </button>
              <button
                type="button"
                disabled={idx === shots.length - 1}
                onClick={() => scrollToShot(idx + 1)}
                className="w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center disabled:opacity-30"
                aria-label="Sonraki video"
              >
                <ChevronDown className="w-5 h-5" />
              </button>
            </div>

            {/* Right Action Column */}
            <div className="absolute right-3 bottom-6 flex flex-col items-center gap-3 z-10">
              <button
                type="button"
                onClick={() => toggleLike(shot)}
                className="min-w-[48px] min-h-[48px] rounded-2xl bg-black/45 backdrop-blur-sm text-white flex flex-col items-center justify-center gap-0.5"
              >
                <Heart className={`w-5 h-5 ${shot.liked ? 'fill-rose-500 text-rose-500' : ''}`} />
                <span className="text-[11px] font-mono tabular-nums">{shot.likesCount}</span>
              </button>

              <button
                type="button"
                onClick={() => openComments(shot)}
                className="min-w-[48px] min-h-[48px] rounded-2xl bg-black/45 backdrop-blur-sm text-white flex flex-col items-center justify-center gap-0.5"
              >
                <MessageCircle className="w-5 h-5" />
                <span className="text-[11px] font-mono tabular-nums">{shot.commentsCount}</span>
              </button>

              <button
                type="button"
                onClick={() => toggleSave(shot)}
                className="min-w-[48px] min-h-[48px] rounded-2xl bg-black/45 backdrop-blur-sm text-white flex flex-col items-center justify-center gap-0.5"
              >
                <Bookmark className={`w-5 h-5 ${shot.saved ? 'fill-[#A78BFA] text-[#A78BFA]' : ''}`} />
                <span className="text-[11px] font-mono tabular-nums">{shot.savesCount}</span>
              </button>

              <button
                type="button"
                onClick={() => shareShot(shot)}
                className="min-w-[48px] min-h-[48px] rounded-2xl bg-black/45 backdrop-blur-sm text-white flex items-center justify-center"
                aria-label="Paylaş"
              >
                <Share2 className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => setReportTarget({ id: shot.id, label: `@${shot.author.username} Shot videosu` })}
                className="min-w-[44px] min-h-[44px] rounded-2xl bg-black/45 backdrop-blur-sm text-zinc-300 flex items-center justify-center"
                aria-label="Şikâyet et"
              >
                <Flag className="w-4 h-4" />
              </button>
            </div>

            {/* Bottom Author & Caption */}
            <div className="absolute left-4 right-20 bottom-6 text-white z-10">
              <button
                type="button"
                onClick={() => onOpenProfile(shot.author.id)}
                className="flex items-center gap-2.5 text-left"
              >
                <Avatar src={shot.author.avatar_url} name={shot.author.display_name} size="sm" />
                <div>
                  <div className="font-display font-semibold text-sm">{shot.author.display_name}</div>
                  <div className="text-xs text-zinc-300">@{shot.author.username}</div>
                </div>
              </button>
              {shot.caption && <p className="mt-2.5 text-sm text-zinc-100 line-clamp-3">{shot.caption}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Comments Sheet */}
      {commentsShot && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center">
          <div className="w-full sm:max-w-md h-[70vh] bg-white dark:bg-[#15171E] rounded-t-3xl sm:rounded-3xl border border-zinc-200 dark:border-[#232631] flex flex-col">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-[#232631] flex items-center justify-between">
              <span className="font-display font-semibold text-sm text-zinc-900 dark:text-white">
                Shot Yorumları
              </span>
              <button
                type="button"
                onClick={() => setCommentsShot(null)}
                className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-zinc-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {comments.length === 0 ? (
                <p className="text-center text-xs text-zinc-500 py-8">Henüz yorum yok.</p>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-2.5">
                    <Avatar src={c.avatar_url} name={c.display_name} size="sm" />
                    <div>
                      <div className="text-xs">
                        <span className="font-semibold text-zinc-900 dark:text-white">@{c.username}</span>{' '}
                        <span className="text-zinc-500">{formatRelativeTime(c.created_at)}</span>
                      </div>
                      <p className="text-sm text-zinc-800 dark:text-zinc-200">{c.content}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <form onSubmit={submitComment} className="p-3 border-t border-zinc-200 dark:border-[#232631] flex gap-2">
              <input
                type="text"
                placeholder="Yorum yaz..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                className="flex-1 min-h-[44px] px-4 rounded-2xl bg-zinc-100 dark:bg-[#0D0E12] text-sm text-zinc-900 dark:text-white focus:outline-none"
              />
              <button
                type="submit"
                className="min-w-[44px] min-h-[44px] rounded-2xl bg-[#7C3AED] text-white flex items-center justify-center"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}

      {reportTarget && (
        <ReportModal
          targetType="shot"
          targetId={reportTarget.id}
          targetLabel={reportTarget.label}
          onClose={() => setReportTarget(null)}
        />
      )}
    </div>
  );
};
