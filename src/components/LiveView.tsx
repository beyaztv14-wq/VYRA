import React, { useEffect, useRef, useState } from 'react';
import { Radio, Users, Send, RefreshCw, PhoneOff, UserPlus, Flag, Video } from 'lucide-react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { apiFetch } from '../api';
import { Avatar } from './Avatar';
import { ReportModal } from './ReportModal';
import type { LiveChatMessage, LiveStreamItem, User } from '../types';

interface LiveViewProps {
  currentUser: User;
  wsEvents: { event: string; payload: any } | null;
  sendWsMessage: (event: string, payload: any) => void;
}

export const LiveView: React.FC<LiveViewProps> = ({ currentUser, wsEvents, sendWsMessage }) => {
  const [streams, setStreams] = useState<LiveStreamItem[]>([]);
  const [activeStream, setActiveStream] = useState<LiveStreamItem | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [streamTitle, setStreamTitle] = useState('');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [chatMessages, setChatMessages] = useState<LiveChatMessage[]>([]);
  const [chatText, setChatText] = useState('');
  const [guestUsername, setGuestUsername] = useState('');
  const [guestInviteToast, setGuestInviteToast] = useState<{ streamId: string; title: string; hostId: string } | null>(null);
  const [isGuestPublishing, setIsGuestPublishing] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const hostVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const guestVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const livekitRoomRef = useRef<Room | null>(null);

  const loadActiveStreams = async () => {
    const res = await apiFetch<{ streams: LiveStreamItem[] }>('/api/live');
    setStreams(res.streams);
  };

  useEffect(() => {
    loadActiveStreams();
  }, []);

  const cleanupMediaAndPeers = () => {
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (livekitRoomRef.current) {
      livekitRoomRef.current.disconnect();
      livekitRoomRef.current = null;
    }
    setIsHost(false);
    setIsGuestPublishing(false);
  };

  useEffect(() => {
    return () => cleanupMediaAndPeers();
  }, []);

  // WebRTC Peer helper for real browser-to-browser streaming when LiveKit Cloud keys aren't configured
  const createPeer = (targetUserId: string, streamId: string, sendTracks: boolean) => {
    if (peersRef.current.has(targetUserId)) return peersRef.current.get(targetUserId)!;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    if (sendTracks && localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current!));
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendWsMessage('webrtc:signal', {
          targetUserId,
          streamId,
          signalType: 'ice',
          candidate: e.candidate,
        });
      }
    };
    pc.ontrack = (e) => {
      const incoming = e.streams[0];
      if (!incoming) return;
      if (isHost) {
        if (guestVideoRef.current) {
          guestVideoRef.current.srcObject = incoming;
          guestVideoRef.current.play().catch(() => {});
        }
      } else {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = incoming;
          remoteVideoRef.current.play().catch(() => {});
        }
      }
    };
    peersRef.current.set(targetUserId, pc);
    return pc;
  };

  useEffect(() => {
    if (!wsEvents) return;
    const { event, payload } = wsEvents;

    if (event === 'live:started' && payload?.stream) {
      setStreams((prev) => (prev.some((s) => s.id === payload.stream.id) ? prev : [payload.stream, ...prev]));
    } else if (event === 'live:ended' && payload?.streamId) {
      setStreams((prev) => prev.filter((s) => s.id !== payload.streamId));
      if (activeStream?.id === payload.streamId) {
        cleanupMediaAndPeers();
        setActiveStream(null);
      }
    } else if (event === 'live:viewers' && payload?.streamId) {
      setStreams((prev) =>
        prev.map((s) => (s.id === payload.streamId ? { ...s, viewerCount: payload.count } : s))
      );
      if (activeStream?.id === payload.streamId) {
        setActiveStream((prev) => (prev ? { ...prev, viewerCount: payload.count } : prev));
      }
    } else if (event === 'live:chat' && payload?.streamId === activeStream?.id && payload?.message) {
      setChatMessages((prev) =>
        prev.some((m) => m.id === payload.message.id) ? prev : [...prev, payload.message]
      );
    } else if (event === 'live:guest-invite' && payload?.streamId) {
      setGuestInviteToast(payload);
    } else if (event === 'live:viewer-joined' && isHost && activeStream && activeStream.id === payload?.streamId) {
      const currentStreamId = activeStream.id;
      const pc = createPeer(payload.viewerId, currentStreamId, true);
      pc.createOffer().then(async (offer) => {
        await pc.setLocalDescription(offer);
        sendWsMessage('webrtc:signal', {
          targetUserId: payload.viewerId,
          streamId: currentStreamId,
          signalType: 'offer',
          sdp: offer,
        });
      });
    } else if (event === 'webrtc:signal' && activeStream && activeStream.id === payload?.streamId) {
      const currentStreamId = activeStream.id;
      (async () => {
        const sendLocal = isHost || isGuestPublishing;
        const pc = createPeer(payload.fromUserId, currentStreamId, sendLocal);
        if (payload.signalType === 'offer' && payload.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendWsMessage('webrtc:signal', {
            targetUserId: payload.fromUserId,
            streamId: currentStreamId,
            signalType: 'answer',
            sdp: answer,
          });
        } else if (payload.signalType === 'answer' && payload.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        } else if (payload.signalType === 'ice' && payload.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
        }
      })();
    }
  }, [wsEvents, activeStream?.id, isHost, isGuestPublishing]);

  const tryConnectLiveKit = async (roomName: string, publish: boolean): Promise<boolean> => {
    try {
      const tokenRes = await apiFetch<{ configured: boolean; url?: string; token?: string }>('/api/livekit/token', {
        method: 'POST',
        body: JSON.stringify({ roomName, isHost: publish }),
      });
      if (!tokenRes.configured || !tokenRes.url || !tokenRes.token) return false;

      const room = new Room();
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
          track.attach(remoteVideoRef.current);
        }
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          document.body.appendChild(el);
        }
      });
      await room.connect(tokenRes.url, tokenRes.token);
      if (publish) {
        await room.localParticipant.enableCameraAndMicrophone();
      }
      livekitRoomRef.current = room;
      return true;
    } catch {
      return false;
    }
  };

  const startLiveStream = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: true,
      });
      localStreamRef.current = media;
      const res = await apiFetch<{ stream: LiveStreamItem }>('/api/live/start', {
        method: 'POST',
        body: JSON.stringify({ title: streamTitle.trim() || `${currentUser.display_name} Canlı Yayında` }),
      });
      setActiveStream(res.stream);
      setIsHost(true);
      setChatMessages([]);
      setTimeout(() => {
        if (hostVideoRef.current) {
          hostVideoRef.current.srcObject = media;
          hostVideoRef.current.play().catch(() => {});
        }
      }, 60);
      sendWsMessage('live:join', { streamId: res.stream.id });
      await tryConnectLiveKit(res.stream.room_name, true);
    } catch (err: any) {
      setErrorMsg(err.message || 'Kamera/mikrofon izni alınamadı.');
    }
  };

  const flipHostCamera = async () => {
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextFacing);
    if (!localStreamRef.current) return;
    const newMedia = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: nextFacing },
      audio: true,
    });
    const newVideoTrack = newMedia.getVideoTracks()[0];
    const oldVideoTrack = localStreamRef.current.getVideoTracks()[0];
    if (oldVideoTrack) {
      localStreamRef.current.removeTrack(oldVideoTrack);
      oldVideoTrack.stop();
    }
    localStreamRef.current.addTrack(newVideoTrack);
    peersRef.current.forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(newVideoTrack);
    });
    if (hostVideoRef.current) {
      hostVideoRef.current.srcObject = localStreamRef.current;
    }
  };

  const watchStream = async (stream: LiveStreamItem) => {
    setActiveStream(stream);
    setIsHost(false);
    const chatRes = await apiFetch<{ messages: LiveChatMessage[] }>(`/api/live/${stream.id}/chat`);
    setChatMessages(chatRes.messages);
    sendWsMessage('live:join', { streamId: stream.id });
    await tryConnectLiveKit(stream.room_name, false);
  };

  const leaveOrEndStream = async () => {
    if (!activeStream) return;
    if (isHost) {
      await apiFetch(`/api/live/${activeStream.id}/end`, { method: 'POST' });
    } else {
      sendWsMessage('live:leave', { streamId: activeStream.id });
    }
    cleanupMediaAndPeers();
    setActiveStream(null);
    loadActiveStreams();
  };

  const acceptGuestInvite = async () => {
    if (!guestInviteToast) return;
    const streamObj = streams.find((s) => s.id === guestInviteToast.streamId);
    const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStreamRef.current = media;
    setIsGuestPublishing(true);
    if (streamObj) {
      await watchStream(streamObj);
    }
    const pc = createPeer(guestInviteToast.hostId, guestInviteToast.streamId, true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendWsMessage('webrtc:signal', {
      targetUserId: guestInviteToast.hostId,
      streamId: guestInviteToast.streamId,
      signalType: 'offer',
      sdp: offer,
    });
    setGuestInviteToast(null);
  };

  const inviteGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStream || !guestUsername.trim()) return;
    try {
      await apiFetch(`/api/live/${activeStream.id}/invite-guest`, {
        method: 'POST',
        body: JSON.stringify({ username: guestUsername.trim() }),
      });
      setGuestUsername('');
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const sendLiveChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStream || !chatText.trim()) return;
    const content = chatText.trim();
    setChatText('');
    const res = await apiFetch<{ message: LiveChatMessage }>(`/api/live/${activeStream.id}/chat`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    setChatMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
  };

  if (activeStream) {
    return (
      <div className="space-y-4">
        <div className="relative rounded-3xl overflow-hidden bg-black border border-zinc-200 dark:border-[#232631] aspect-[9/14] sm:aspect-video max-h-[65vh] flex items-center justify-center">
          {isHost ? (
            <video
              ref={hostVideoRef}
              muted
              playsInline
              className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
            />
          ) : (
            <video ref={remoteVideoRef} playsInline autoPlay className="w-full h-full object-cover" />
          )}

          {/* Guest Co-host PiP */}
          <video
            ref={guestVideoRef}
            playsInline
            autoPlay
            className="w-28 h-40 object-cover rounded-2xl border border-white/20 absolute bottom-4 right-4 bg-black/50 empty:hidden"
          />

          {/* Top Bar */}
          <div className="absolute top-3 inset-x-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/65 backdrop-blur-sm text-white text-xs">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="font-semibold">CANLI</span>
              <span>·</span>
              <Users className="w-3.5 h-3.5" />
              <span className="font-mono tabular-nums">{activeStream.viewerCount}</span>
            </div>

            <div className="flex items-center gap-2">
              {isHost && (
                <button
                  type="button"
                  onClick={flipHostCamera}
                  className="min-w-[42px] min-h-[42px] rounded-xl bg-black/65 text-white flex items-center justify-center"
                  aria-label="Kamerayı çevir"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              )}
              {!isHost && (
                <button
                  type="button"
                  onClick={() => setReportOpen(true)}
                  className="min-w-[42px] min-h-[42px] rounded-xl bg-black/65 text-white flex items-center justify-center"
                  aria-label="Yayını şikâyet et"
                >
                  <Flag className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={leaveOrEndStream}
                className="min-h-[42px] px-3.5 rounded-xl bg-red-600 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <PhoneOff className="w-4 h-4" />
                <span>{isHost ? 'Yayını Bitir' : 'Ayrıl'}</span>
              </button>
            </div>
          </div>

          <div className="absolute bottom-3 left-3 right-36 px-3 py-2 rounded-xl bg-black/55 backdrop-blur-sm text-white">
            <div className="font-display font-semibold text-sm truncate">{activeStream.title}</div>
            <div className="text-xs text-zinc-300">@{activeStream.host_username}</div>
          </div>
        </div>

        {/* Host Guest Invite */}
        {isHost && (
          <form onSubmit={inviteGuest} className="flex gap-2">
            <input
              type="text"
              placeholder="Yayına konuk davet et (@kullaniciadi)"
              value={guestUsername}
              onChange={(e) => setGuestUsername(e.target.value)}
              className="flex-1 min-h-[44px] px-4 rounded-2xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] text-sm text-zinc-900 dark:text-white"
            />
            <button
              type="submit"
              className="min-h-[44px] px-4 rounded-2xl bg-[#7C3AED] text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <UserPlus className="w-4 h-4" />
              <span>Davet Et</span>
            </button>
          </form>
        )}

        {errorMsg && <div className="text-xs text-red-500">{errorMsg}</div>}

        {/* Live Chat */}
        <div className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] overflow-hidden">
          <div className="h-52 overflow-y-auto p-4 space-y-2">
            {chatMessages.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-6">Canlı sohbet mesajları burada görünür.</p>
            ) : (
              chatMessages.map((m) => (
                <div key={m.id} className="text-sm">
                  <span className="font-semibold text-[#7C3AED] dark:text-[#A78BFA]">@{m.username}</span>{' '}
                  <span className="text-zinc-800 dark:text-zinc-200">{m.content}</span>
                </div>
              ))
            )}
          </div>
          <form onSubmit={sendLiveChat} className="p-3 border-t border-zinc-200 dark:border-[#232631] flex gap-2">
            <input
              type="text"
              placeholder="Canlı yayına mesaj yaz..."
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              className="flex-1 min-h-[44px] px-4 rounded-2xl bg-zinc-100 dark:bg-[#0D0E12] text-sm text-zinc-900 dark:text-white"
            />
            <button
              type="submit"
              className="min-w-[44px] min-h-[44px] rounded-2xl bg-[#7C3AED] text-white flex items-center justify-center"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>

        {reportOpen && (
          <ReportModal
            targetType="stream"
            targetId={activeStream.id}
            targetLabel={activeStream.title}
            onClose={() => setReportOpen(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {guestInviteToast && (
        <div className="p-4 rounded-2xl bg-[#7C3AED] text-white flex items-center justify-between gap-3">
          <div className="text-xs font-medium">
            <strong>{guestInviteToast.title}</strong> yayınına konuk olarak davet edildiniz.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setGuestInviteToast(null)}
              className="min-h-[38px] px-3 rounded-xl bg-white/15 text-xs font-semibold"
            >
              Reddet
            </button>
            <button
              type="button"
              onClick={acceptGuestInvite}
              className="min-h-[38px] px-3 rounded-xl bg-white text-[#7C3AED] text-xs font-semibold"
            >
              Katıl
            </button>
          </div>
        </div>
      )}

      {/* Start Live Stream Card */}
      <form
        onSubmit={startLiveStream}
        className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-5 space-y-4"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-[#7C3AED]/10 text-[#7C3AED] dark:text-[#A78BFA] flex items-center justify-center">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display font-bold text-base text-zinc-900 dark:text-white">Canlı Yayın Başlat</h2>
            <p className="text-xs text-zinc-500">Telefon veya bilgisayar kameranızla anında yayına geçin</p>
          </div>
        </div>

        <input
          type="text"
          placeholder="Yayın başlığı (ör. İstanbul akşam sohbeti)"
          value={streamTitle}
          onChange={(e) => setStreamTitle(e.target.value)}
          className="w-full min-h-[46px] px-4 rounded-2xl bg-zinc-50 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] text-sm text-zinc-900 dark:text-white"
        />

        {errorMsg && <div className="text-xs text-red-500">{errorMsg}</div>}

        <button
          type="submit"
          className="w-full min-h-[48px] rounded-2xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-display font-semibold text-sm flex items-center justify-center gap-2"
        >
          <Video className="w-4 h-4" />
          <span>Canlı Yayına Geç</span>
        </button>
      </form>

      {/* Active Streams */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-sm text-zinc-900 dark:text-white">Şu An Yayında Olanlar</h3>
          <button
            type="button"
            onClick={loadActiveStreams}
            className="text-xs font-medium text-[#7C3AED] dark:text-[#A78BFA]"
          >
            Yenile
          </button>
        </div>

        {streams.length === 0 ? (
          <div className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-8 text-center text-xs text-zinc-500">
            Şu anda aktif canlı yayın yok. Gerçek kullanıcılar yayın başlattığında burada canlı olarak listelenir.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {streams.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => watchStream(s)}
                className="p-4 rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] hover:border-[#7C3AED] text-left space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar src={s.host_avatar_url} name={s.host_display_name} size="md" />
                    <div className="min-w-0">
                      <div className="font-display font-semibold text-sm text-zinc-900 dark:text-white truncate">
                        {s.title}
                      </div>
                      <div className="text-xs text-zinc-500 truncate">@{s.host_username}</div>
                    </div>
                  </div>
                  <div className="text-xs font-mono tabular-nums text-red-500 font-semibold shrink-0">
                    CANLI · {s.viewerCount}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
