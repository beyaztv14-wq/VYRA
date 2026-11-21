import React, { useEffect, useRef, useState } from 'react';
import {
  Send,
  Image as ImageIcon,
  Trash2,
  Check,
  CheckCheck,
  Ban,
  Users,
  Megaphone,
  MessageSquare,
  Plus,
  ArrowLeft,
  Phone,
  PhoneOff,
  Shield,
  Pin,
  Settings,
  X,
} from 'lucide-react';
import { apiFetch, formatRelativeTime, uploadMediaFile } from '../api';
import { Avatar } from './Avatar';
import type {
  ChannelItem,
  ChannelPost,
  CommentItem,
  Conversation,
  DirectMessage,
  GroupItem,
  GroupMember,
  GroupMessage,
  User,
} from '../types';

interface MessagesViewProps {
  currentUser: User;
  initialSubTab?: 'dm' | 'groups' | 'channels';
  initialPeerId?: string | null;
  wsEvents: { event: string; payload: any } | null;
  sendWsMessage: (event: string, payload: any) => void;
  onOpenProfile: (userId: string) => void;
}

export const MessagesView: React.FC<MessagesViewProps> = ({
  currentUser,
  initialSubTab = 'dm',
  initialPeerId = null,
  wsEvents,
  sendWsMessage,
  onOpenProfile,
}) => {
  const [subTab, setSubTab] = useState<'dm' | 'groups' | 'channels'>(initialSubTab);

  // --- DM State ---
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activePeer, setActivePeer] = useState<User | null>(null);
  const [dmMessages, setDmMessages] = useState<DirectMessage[]>([]);
  const [dmText, setDmText] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [searchedUsers, setSearchedUsers] = useState<User[]>([]);

  // --- Group State ---
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [activeGroup, setActiveGroup] = useState<GroupItem | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [groupMessages, setGroupMessages] = useState<GroupMessage[]>([]);
  const [groupText, setGroupText] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [newGroupAvatar, setNewGroupAvatar] = useState('');
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [addMemberUsername, setAddMemberUsername] = useState('');

  // --- Group WebRTC Call State ---
  const [inGroupCall, setInGroupCall] = useState(false);
  const [remoteCallStreams, setRemoteCallStreams] = useState<{ userId: string; stream: MediaStream }[]>([]);
  const localCallStreamRef = useRef<MediaStream | null>(null);
  const localCallVideoRef = useRef<HTMLVideoElement>(null);
  const groupPeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());

  // --- Channel State ---
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [activeChannel, setActiveChannel] = useState<ChannelItem | null>(null);
  const [channelPosts, setChannelPosts] = useState<ChannelPost[]>([]);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [newChName, setNewChName] = useState('');
  const [newChHandle, setNewChHandle] = useState('');
  const [newChDesc, setNewChDesc] = useState('');
  const [newChComments, setNewChComments] = useState(true);
  const [chPostText, setChPostText] = useState('');
  const [chIsAnnouncement, setChIsAnnouncement] = useState(false);
  const [chMedia, setChMedia] = useState<{ url: string; mediaType: 'image' | 'video' } | null>(null);
  const [activeChComments, setActiveChComments] = useState<{ post: ChannelPost; list: CommentItem[] } | null>(null);
  const [chCommentInput, setChCommentInput] = useState('');

  const dmFileRef = useRef<HTMLInputElement>(null);
  const groupFileRef = useRef<HTMLInputElement>(null);
  const chFileRef = useRef<HTMLInputElement>(null);
  const groupAvatarFileRef = useRef<HTMLInputElement>(null);
  const dmBottomRef = useRef<HTMLDivElement>(null);
  const groupBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  const loadConversations = async () => {
    const res = await apiFetch<{ conversations: Conversation[] }>('/api/dm/conversations');
    setConversations(res.conversations);
  };

  const openDmChat = async (peerId: string) => {
    const res = await apiFetch<{ peer: User; messages: DirectMessage[] }>(`/api/dm/${peerId}`);
    setActivePeer(res.peer);
    setDmMessages(res.messages);
    loadConversations();
    setTimeout(() => dmBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
  };

  useEffect(() => {
    if (initialPeerId) {
      setSubTab('dm');
      openDmChat(initialPeerId);
    }
  }, [initialPeerId]);

  const loadGroups = async () => {
    const res = await apiFetch<{ groups: GroupItem[] }>('/api/groups');
    setGroups(res.groups);
  };

  const openGroup = async (group: GroupItem) => {
    setActiveGroup(group);
    const detail = await apiFetch<{ group: GroupItem; members: GroupMember[]; myRole: 'admin' | 'member' | null }>(
      `/api/groups/${group.id}`
    );
    setGroupMembers(detail.members);
    if (detail.myRole) {
      const msgs = await apiFetch<{ messages: GroupMessage[] }>(`/api/groups/${group.id}/messages`);
      setGroupMessages(msgs.messages);
      setTimeout(() => groupBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    } else {
      setGroupMessages([]);
    }
    setActiveGroup((prev) => (prev ? { ...prev, myRole: detail.myRole } : prev));
  };

  const loadChannels = async () => {
    const res = await apiFetch<{ channels: ChannelItem[] }>('/api/channels');
    setChannels(res.channels);
  };

  const openChannel = async (ch: ChannelItem) => {
    setActiveChannel(ch);
    const res = await apiFetch<{ posts: ChannelPost[] }>(`/api/channels/${ch.id}/posts`);
    setChannelPosts(res.posts);
  };

  useEffect(() => {
    loadConversations();
    loadGroups();
    loadChannels();
  }, []);

  useEffect(() => {
    if (!userSearch.trim()) {
      setSearchedUsers([]);
      return;
    }
    const t = window.setTimeout(async () => {
      const res = await apiFetch<{ users: User[] }>(`/api/explore?q=${encodeURIComponent(userSearch)}`);
      setSearchedUsers(res.users);
    }, 200);
    return () => window.clearTimeout(t);
  }, [userSearch]);

  // Real-time WebSocket updates
  useEffect(() => {
    if (!wsEvents) return;
    const { event, payload } = wsEvents;

    if (event === 'dm:new' && payload?.message) {
      const m: DirectMessage = payload.message;
      loadConversations();
      if (
        activePeer &&
        ((m.sender_id === activePeer.id && m.receiver_id === currentUser.id) ||
          (m.sender_id === currentUser.id && m.receiver_id === activePeer.id))
      ) {
        setDmMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        if (m.sender_id === activePeer.id) {
          apiFetch(`/api/dm/${activePeer.id}`).catch(() => {});
        }
        setTimeout(() => dmBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
      }
    } else if (event === 'dm:read' && payload?.readerId === activePeer?.id) {
      setDmMessages((prev) => prev.map((m) => (m.sender_id === currentUser.id ? { ...m, is_read: 1 } : m)));
    } else if (event === 'dm:deleted' && payload?.messageId) {
      setDmMessages((prev) => prev.filter((m) => m.id !== payload.messageId));
      loadConversations();
    } else if (event === 'group:message' && payload?.groupId === activeGroup?.id && payload?.message) {
      setGroupMessages((prev) =>
        prev.some((m) => m.id === payload.message.id) ? prev : [...prev, payload.message]
      );
      setTimeout(() => groupBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    } else if (event === 'channel:post' && payload?.channelId === activeChannel?.id && payload?.post) {
      setChannelPosts((prev) =>
        prev.some((p) => p.id === payload.post.id) ? prev : [payload.post, ...prev]
      );
    } else if (event === 'channel:comment' && activeChComments?.post.id === payload?.postId && payload?.comment) {
      setActiveChComments((prev) =>
        prev
          ? {
              ...prev,
              list: prev.list.some((c) => c.id === payload.comment.id)
                ? prev.list
                : [...prev.list, payload.comment],
            }
          : null
      );
    } else if (event === 'groupcall:peers' && payload?.groupId === activeGroup?.id && inGroupCall) {
      payload.peers.forEach((peerId: string) => createGroupPeerConnection(peerId, true));
    } else if (event === 'groupcall:peer-left' && payload?.groupId === activeGroup?.id) {
      const pc = groupPeersRef.current.get(payload.userId);
      if (pc) {
        pc.close();
        groupPeersRef.current.delete(payload.userId);
      }
      setRemoteCallStreams((prev) => prev.filter((r) => r.userId !== payload.userId));
    } else if (event === 'webrtc:signal' && payload?.groupId === activeGroup?.id && inGroupCall) {
      handleGroupWebRtcSignal(payload);
    }
  }, [wsEvents, activePeer?.id, activeGroup?.id, activeChannel?.id, inGroupCall]);

  // --- Group WebRTC Helpers ---
  const createGroupPeerConnection = (targetUserId: string, initiator: boolean) => {
    if (groupPeersRef.current.has(targetUserId)) return groupPeersRef.current.get(targetUserId)!;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    if (localCallStreamRef.current) {
      localCallStreamRef.current.getTracks().forEach((t) => pc.addTrack(t, localCallStreamRef.current!));
    }
    pc.onicecandidate = (e) => {
      if (e.candidate && activeGroup) {
        sendWsMessage('webrtc:signal', {
          targetUserId,
          groupId: activeGroup.id,
          signalType: 'ice',
          candidate: e.candidate,
        });
      }
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      setRemoteCallStreams((prev) => {
        if (prev.some((r) => r.userId === targetUserId)) {
          return prev.map((r) => (r.userId === targetUserId ? { userId: targetUserId, stream } : r));
        }
        return [...prev, { userId: targetUserId, stream }];
      });
    };
    groupPeersRef.current.set(targetUserId, pc);
    if (initiator && activeGroup) {
      pc.createOffer().then(async (offer) => {
        await pc.setLocalDescription(offer);
        sendWsMessage('webrtc:signal', {
          targetUserId,
          groupId: activeGroup.id,
          signalType: 'offer',
          sdp: offer,
        });
      });
    }
    return pc;
  };

  const handleGroupWebRtcSignal = async (payload: any) => {
    const pc = createGroupPeerConnection(payload.fromUserId, false);
    if (payload.signalType === 'offer' && payload.sdp && activeGroup) {
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendWsMessage('webrtc:signal', {
        targetUserId: payload.fromUserId,
        groupId: activeGroup.id,
        signalType: 'answer',
        sdp: answer,
      });
    } else if (payload.signalType === 'answer' && payload.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    } else if (payload.signalType === 'ice' && payload.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
    }
  };

  const startGroupCall = async () => {
    if (!activeGroup) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localCallStreamRef.current = stream;
      setInGroupCall(true);
      setTimeout(() => {
        if (localCallVideoRef.current) {
          localCallVideoRef.current.srcObject = stream;
          localCallVideoRef.current.play().catch(() => {});
        }
      }, 50);
      sendWsMessage('groupcall:join', { groupId: activeGroup.id });
    } catch {
      alert('Grup araması için kamera ve mikrofon izni gerekli.');
    }
  };

  const leaveGroupCall = () => {
    if (activeGroup) {
      sendWsMessage('groupcall:leave', { groupId: activeGroup.id });
    }
    groupPeersRef.current.forEach((pc) => pc.close());
    groupPeersRef.current.clear();
    if (localCallStreamRef.current) {
      localCallStreamRef.current.getTracks().forEach((t) => t.stop());
      localCallStreamRef.current = null;
    }
    setRemoteCallStreams([]);
    setInGroupCall(false);
  };

  useEffect(() => {
    return () => {
      groupPeersRef.current.forEach((pc) => pc.close());
      if (localCallStreamRef.current) {
        localCallStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // --- DM Actions ---
  const sendDm = async (e?: React.FormEvent, media?: { url: string; mediaType: 'image' | 'video' }) => {
    if (e) e.preventDefault();
    if (!activePeer) return;
    if (!dmText.trim() && !media) return;
    const content = dmText.trim();
    if (!media) setDmText('');
    const res = await apiFetch<{ message: DirectMessage }>(`/api/dm/${activePeer.id}`, {
      method: 'POST',
      body: JSON.stringify({
        content: media ? '' : content,
        mediaUrl: media?.url || '',
        mediaType: media?.mediaType || 'none',
      }),
    });
    setDmMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
    loadConversations();
    setTimeout(() => dmBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
  };

  const handleDmMedia = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const uploaded = await uploadMediaFile(file, file.name);
    await sendDm(undefined, uploaded);
    e.target.value = '';
  };

  const deleteDmMessage = async (msgId: string) => {
    await apiFetch(`/api/dm/message/${msgId}`, { method: 'DELETE' });
    setDmMessages((prev) => prev.filter((m) => m.id !== msgId));
  };

  const blockPeer = async () => {
    if (!activePeer) return;
    await apiFetch(`/api/users/${activePeer.id}/block`, { method: 'POST' });
    setActivePeer(null);
    loadConversations();
  };

  // --- Group Actions ---
  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    const res = await apiFetch<{ group: GroupItem }>('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ name: newGroupName, description: newGroupDesc, avatarUrl: newGroupAvatar }),
    });
    setShowCreateGroup(false);
    setNewGroupName('');
    setNewGroupDesc('');
    setNewGroupAvatar('');
    await loadGroups();
    openGroup(res.group);
  };

  const sendGroupMsg = async (e?: React.FormEvent, media?: { url: string; mediaType: 'image' | 'video' }) => {
    if (e) e.preventDefault();
    if (!activeGroup) return;
    if (!groupText.trim() && !media) return;
    const content = groupText.trim();
    if (!media) setGroupText('');
    const res = await apiFetch<{ message: GroupMessage }>(`/api/groups/${activeGroup.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content: media ? '' : content,
        mediaUrl: media?.url || '',
        mediaType: media?.mediaType || 'none',
      }),
    });
    setGroupMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
    setTimeout(() => groupBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
  };

  const addGroupMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGroup || !addMemberUsername.trim()) return;
    const found = await apiFetch<{ user: User }>(`/api/users/${addMemberUsername.trim().toLowerCase()}`);
    await apiFetch(`/api/groups/${activeGroup.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId: found.user.id, role: 'member' }),
    });
    setAddMemberUsername('');
    openGroup(activeGroup);
  };

  const toggleGroupAdmin = async (member: GroupMember) => {
    if (!activeGroup) return;
    await apiFetch(`/api/groups/${activeGroup.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId: member.id, role: member.role === 'admin' ? 'member' : 'admin' }),
    });
    openGroup(activeGroup);
  };

  // --- Channel Actions ---
  const createChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChName.trim()) return;
    const res = await apiFetch<{ channel: ChannelItem }>('/api/channels', {
      method: 'POST',
      body: JSON.stringify({
        name: newChName,
        handle: newChHandle || newChName,
        description: newChDesc,
        commentsEnabled: newChComments,
      }),
    });
    setShowCreateChannel(false);
    setNewChName('');
    setNewChHandle('');
    setNewChDesc('');
    await loadChannels();
    openChannel(res.channel);
  };

  const toggleFollowChannel = async (ch: ChannelItem) => {
    const res = await apiFetch<{ isFollowing: boolean; followersCount: number }>(`/api/channels/${ch.id}/follow`, {
      method: 'POST',
    });
    setChannels((prev) =>
      prev.map((c) =>
        c.id === ch.id ? { ...c, isFollowing: res.isFollowing ? 1 : 0, followersCount: res.followersCount } : c
      )
    );
    if (activeChannel?.id === ch.id) {
      setActiveChannel({ ...ch, isFollowing: res.isFollowing ? 1 : 0, followersCount: res.followersCount });
    }
  };

  const publishChannelPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChannel || (!chPostText.trim() && !chMedia)) return;
    const res = await apiFetch<{ post: ChannelPost }>(`/api/channels/${activeChannel.id}/posts`, {
      method: 'POST',
      body: JSON.stringify({
        content: chPostText.trim(),
        mediaUrl: chMedia?.url || '',
        mediaType: chMedia?.mediaType || 'none',
        isAnnouncement: chIsAnnouncement,
      }),
    });
    setChannelPosts((prev) => [res.post, ...prev]);
    setChPostText('');
    setChMedia(null);
    setChIsAnnouncement(false);
  };

  const openChComments = async (post: ChannelPost) => {
    const res = await apiFetch<{ comments: CommentItem[] }>(`/api/channels/posts/${post.id}/comments`);
    setActiveChComments({ post, list: res.comments });
  };

  const submitChComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChComments || !chCommentInput.trim()) return;
    const content = chCommentInput.trim();
    setChCommentInput('');
    const res = await apiFetch<{ comment: CommentItem }>(
      `/api/channels/posts/${activeChComments.post.id}/comments`,
      { method: 'POST', body: JSON.stringify({ content }) }
    );
    setActiveChComments((prev) => (prev ? { ...prev, list: [...prev.list, res.comment] } : null));
  };

  return (
    <div className="space-y-4">
      {/* Sub-navigation */}
      <div className="flex items-center gap-1 p-1 rounded-2xl bg-zinc-200/70 dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631]">
        {[
          { id: 'dm', label: 'Mesajlar', icon: MessageSquare },
          { id: 'groups', label: 'Gruplar', icon: Users },
          { id: 'channels', label: 'Kanallar', icon: Megaphone },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id as any)}
              className={`flex-1 min-h-[40px] rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                subTab === tab.id
                  ? 'bg-white dark:bg-[#232631] text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* --- TAB 1: DIRECT MESSAGES --- */}
      {subTab === 'dm' && (
        <div className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] overflow-hidden min-h-[520px] flex flex-col">
          {!activePeer ? (
            <div className="p-4 space-y-4">
              <input
                type="search"
                placeholder="Mesaj başlatmak için kullanıcı ara..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="w-full min-h-[44px] px-4 rounded-2xl bg-zinc-100 dark:bg-[#0D0E12] text-sm text-zinc-900 dark:text-white focus:outline-none"
              />

              {searchedUsers.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-zinc-500 px-1">Yeni Sohbet</div>
                  {searchedUsers.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => {
                        setUserSearch('');
                        openDmChat(u.id);
                      }}
                      className="w-full p-3 rounded-2xl hover:bg-zinc-100 dark:hover:bg-[#1E212B] flex items-center gap-3 text-left"
                    >
                      <Avatar src={u.avatar_url} name={u.display_name} size="md" />
                      <div>
                        <div className="font-display font-semibold text-sm text-zinc-900 dark:text-white">
                          {u.display_name}
                        </div>
                        <div className="text-xs text-zinc-500">@{u.username}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-1">
                <div className="text-xs font-semibold text-zinc-500 px-1">Sohbetler</div>
                {conversations.length === 0 ? (
                  <p className="py-12 text-center text-xs text-zinc-500">
                    Henüz özel mesajınız yok. Yukarıdan gerçek bir kullanıcı arayıp mesaj gönderebilirsiniz.
                  </p>
                ) : (
                  conversations.map((c) => (
                    <button
                      key={c.peer.id}
                      type="button"
                      onClick={() => openDmChat(c.peer.id)}
                      className="w-full p-3 rounded-2xl hover:bg-zinc-100 dark:hover:bg-[#1E212B] flex items-center justify-between gap-3 text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar src={c.peer.avatar_url} name={c.peer.display_name} size="md" />
                        <div className="min-w-0">
                          <div className="font-display font-semibold text-sm text-zinc-900 dark:text-white truncate">
                            {c.peer.display_name}
                          </div>
                          <div className="text-xs text-zinc-500 truncate">
                            {c.lastMessage
                              ? c.lastMessage.content || (c.lastMessage.media_type === 'video' ? 'Video' : 'Fotoğraf')
                              : `@${c.peer.username}`}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {c.lastMessage && (
                          <div className="text-[11px] text-zinc-400">
                            {formatRelativeTime(c.lastMessage.created_at)}
                          </div>
                        )}
                        {c.unreadCount > 0 && (
                          <span className="inline-flex mt-1 min-w-[20px] h-5 px-1.5 items-center justify-center rounded-full bg-[#7C3AED] text-white text-[11px] font-mono">
                            {c.unreadCount}
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-[560px]">
              {/* Chat Header */}
              <div className="px-4 py-3 border-b border-zinc-200 dark:border-[#232631] flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => setActivePeer(null)}
                    className="min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center text-zinc-600 dark:text-zinc-300"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenProfile(activePeer.id)}
                    className="flex items-center gap-2.5 text-left min-w-0"
                  >
                    <Avatar src={activePeer.avatar_url} name={activePeer.display_name} size="sm" />
                    <div className="min-w-0">
                      <div className="font-display font-semibold text-sm text-zinc-900 dark:text-white truncate">
                        {activePeer.display_name}
                      </div>
                      <div className="text-xs text-zinc-500 truncate">@{activePeer.username}</div>
                    </div>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={blockPeer}
                  className="min-h-[40px] px-3 rounded-xl text-xs font-medium text-red-500 hover:bg-red-500/10 flex items-center gap-1.5"
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span>Engelle</span>
                </button>
              </div>

              {/* Message List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {dmMessages.map((m) => {
                  const mine = m.sender_id === currentUser.id;
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm space-y-1.5 ${
                          mine
                            ? 'bg-[#7C3AED] text-white'
                            : 'bg-zinc-100 dark:bg-[#0D0E12] text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-[#232631]'
                        }`}
                      >
                        {m.media_url && m.media_type === 'image' && (
                          <img
                            src={m.media_url}
                            alt="Mesaj görseli"
                            referrerPolicy="no-referrer"
                            className="rounded-xl max-h-60 object-cover"
                          />
                        )}
                        {m.media_url && m.media_type === 'video' && (
                          <video src={m.media_url} controls playsInline className="rounded-xl max-h-60" />
                        )}
                        {m.content && <p className="break-words">{m.content}</p>}
                        <div className={`flex items-center justify-end gap-2 text-[10px] ${mine ? 'text-white/75' : 'text-zinc-400'}`}>
                          <span>{formatRelativeTime(m.created_at)}</span>
                          {mine && (
                            <>
                              {m.is_read ? <CheckCheck className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                              <button
                                type="button"
                                onClick={() => deleteDmMessage(m.id)}
                                className="hover:text-red-200"
                                aria-label="Mesajı sil"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={dmBottomRef} />
              </div>

              {/* Input */}
              <form onSubmit={(e) => sendDm(e)} className="p-3 border-t border-zinc-200 dark:border-[#232631] flex items-center gap-2">
                <input
                  ref={dmFileRef}
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={handleDmMedia}
                />
                <button
                  type="button"
                  onClick={() => dmFileRef.current?.click()}
                  className="min-w-[44px] min-h-[44px] rounded-2xl bg-zinc-100 dark:bg-[#0D0E12] text-zinc-600 dark:text-zinc-300 flex items-center justify-center"
                  aria-label="Fotoğraf veya video ekle"
                >
                  <ImageIcon className="w-5 h-5" />
                </button>
                <input
                  type="text"
                  placeholder="Mesaj yaz..."
                  value={dmText}
                  onChange={(e) => setDmText(e.target.value)}
                  className="flex-1 min-h-[44px] px-4 rounded-2xl bg-zinc-100 dark:bg-[#0D0E12] text-sm text-zinc-900 dark:text-white focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!dmText.trim()}
                  className="min-w-[44px] min-h-[44px] rounded-2xl bg-[#7C3AED] disabled:opacity-40 text-white flex items-center justify-center"
                  aria-label="Gönder"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* --- TAB 2: GROUPS --- */}
      {subTab === 'groups' && (
        <div className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] overflow-hidden min-h-[520px]">
          {!activeGroup ? (
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-bold text-sm text-zinc-900 dark:text-white">Topluluk Grupları</h2>
                <button
                  type="button"
                  onClick={() => setShowCreateGroup(true)}
                  className="min-h-[40px] px-3.5 rounded-xl bg-[#7C3AED] text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Grup Kur</span>
                </button>
              </div>

              {groups.length === 0 ? (
                <p className="py-12 text-center text-xs text-zinc-500">
                  Henüz grup oluşturulmadı. İlk grubu kurup arkadaşlarınızı davet edin.
                </p>
              ) : (
                <div className="space-y-2">
                  {groups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => openGroup(g)}
                      className="w-full p-3.5 rounded-2xl border border-zinc-200 dark:border-[#232631] hover:border-[#7C3AED]/60 flex items-center justify-between gap-3 text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar src={g.avatar_url} name={g.name} size="md" />
                        <div className="min-w-0">
                          <div className="font-display font-semibold text-sm text-zinc-900 dark:text-white truncate">
                            {g.name}
                          </div>
                          <div className="text-xs text-zinc-500 truncate">
                            {g.membersCount} üye{g.description ? ` · ${g.description}` : ''}
                          </div>
                        </div>
                      </div>
                      <span className="text-xs font-medium text-[#7C3AED] dark:text-[#A78BFA] shrink-0">
                        {g.myRole ? 'Aç' : 'İncele'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col h-[580px]">
              <div className="px-4 py-3 border-b border-zinc-200 dark:border-[#232631] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (inGroupCall) leaveGroupCall();
                      setActiveGroup(null);
                    }}
                    className="min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center text-zinc-500"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <Avatar src={activeGroup.avatar_url} name={activeGroup.name} size="sm" />
                  <div className="min-w-0">
                    <div className="font-display font-semibold text-sm text-zinc-900 dark:text-white truncate">
                      {activeGroup.name}
                    </div>
                    <div className="text-xs text-zinc-500">{groupMembers.length} üye</div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {activeGroup.myRole && (
                    <button
                      type="button"
                      onClick={inGroupCall ? leaveGroupCall : startGroupCall}
                      className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 ${
                        inGroupCall ? 'bg-red-600 text-white' : 'bg-[#7C3AED]/10 text-[#7C3AED] dark:text-[#A78BFA]'
                      }`}
                    >
                      {inGroupCall ? <PhoneOff className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
                      <span>{inGroupCall ? 'Aramadan Çık' : 'Grup Araması'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowGroupSettings(!showGroupSettings)}
                    className="min-w-[40px] min-h-[40px] rounded-xl border border-zinc-200 dark:border-[#232631] flex items-center justify-center text-zinc-600 dark:text-zinc-300"
                    aria-label="Grup bilgileri"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {inGroupCall && (
                <div className="p-3 bg-[#0D0E12] border-b border-[#232631] grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                    <video ref={localCallVideoRef} muted playsInline className="w-full h-full object-cover scale-x-[-1]" />
                    <span className="absolute bottom-1.5 left-2 text-[10px] text-white bg-black/60 px-1.5 py-0.5 rounded">
                      Siz
                    </span>
                  </div>
                  {remoteCallStreams.map((r) => (
                    <RemoteCallVideo key={r.userId} stream={r.stream} label={r.userId.slice(0, 6)} />
                  ))}
                </div>
              )}

              {showGroupSettings ? (
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <p className="text-xs text-zinc-500">{activeGroup.description || 'Açıklama yok.'}</p>
                  {activeGroup.myRole === 'admin' && (
                    <form onSubmit={addGroupMember} className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Kullanıcı adı ile üye ekle..."
                        value={addMemberUsername}
                        onChange={(e) => setAddMemberUsername(e.target.value)}
                        className="flex-1 min-h-[42px] px-3.5 rounded-xl bg-zinc-100 dark:bg-[#0D0E12] text-sm text-zinc-900 dark:text-white"
                      />
                      <button type="submit" className="min-h-[42px] px-4 rounded-xl bg-[#7C3AED] text-white text-xs font-semibold">
                        Ekle
                      </button>
                    </form>
                  )}
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-zinc-500">Üyeler</div>
                    {groupMembers.map((m) => (
                      <div key={m.id} className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-50 dark:bg-[#0D0E12]">
                        <div className="flex items-center gap-2.5">
                          <Avatar src={m.avatar_url} name={m.display_name} size="sm" />
                          <div>
                            <div className="text-sm font-medium text-zinc-900 dark:text-white">{m.display_name}</div>
                            <div className="text-xs text-zinc-500">
                              @{m.username} · {m.role === 'admin' ? 'Yönetici' : 'Üye'}
                            </div>
                          </div>
                        </div>
                        {activeGroup.myRole === 'admin' && m.id !== currentUser.id && (
                          <button
                            type="button"
                            onClick={() => toggleGroupAdmin(m)}
                            className="text-xs font-medium text-[#7C3AED] dark:text-[#A78BFA] flex items-center gap-1"
                          >
                            <Shield className="w-3.5 h-3.5" />
                            <span>{m.role === 'admin' ? 'Yöneticiliği Al' : 'Yönetici Yap'}</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : !activeGroup.myRole ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    {activeGroup.description || 'Bu grubun sohbetine ve aramalarına katılmak için üye olun.'}
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/groups/${activeGroup.id}/join`, { method: 'POST' });
                      openGroup(activeGroup);
                    }}
                    className="min-h-[46px] px-6 rounded-2xl bg-[#7C3AED] text-white text-sm font-semibold"
                  >
                    Gruba Katıl
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {groupMessages.map((m) => {
                      const mine = m.sender_id === currentUser.id;
                      return (
                        <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm space-y-1 ${
                              mine
                                ? 'bg-[#7C3AED] text-white'
                                : 'bg-zinc-100 dark:bg-[#0D0E12] text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-[#232631]'
                            }`}
                          >
                            {!mine && (
                              <div className="text-[11px] font-semibold text-[#7C3AED] dark:text-[#A78BFA]">
                                @{m.username}
                              </div>
                            )}
                            {m.media_url && m.media_type === 'image' && (
                              <img src={m.media_url} alt="Grup medyası" referrerPolicy="no-referrer" className="rounded-xl max-h-56" />
                            )}
                            {m.media_url && m.media_type === 'video' && (
                              <video src={m.media_url} controls playsInline className="rounded-xl max-h-56" />
                            )}
                            {m.content && <p className="break-words">{m.content}</p>}
                            <div className={`text-[10px] text-right ${mine ? 'text-white/75' : 'text-zinc-400'}`}>
                              {formatRelativeTime(m.created_at)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={groupBottomRef} />
                  </div>

                  <form onSubmit={(e) => sendGroupMsg(e)} className="p-3 border-t border-zinc-200 dark:border-[#232631] flex items-center gap-2">
                    <input
                      ref={groupFileRef}
                      type="file"
                      accept="image/*,video/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const up = await uploadMediaFile(file, file.name);
                        await sendGroupMsg(undefined, up);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => groupFileRef.current?.click()}
                      className="min-w-[44px] min-h-[44px] rounded-2xl bg-zinc-100 dark:bg-[#0D0E12] text-zinc-600 dark:text-zinc-300 flex items-center justify-center"
                    >
                      <ImageIcon className="w-5 h-5" />
                    </button>
                    <input
                      type="text"
                      placeholder="Gruba mesaj yaz..."
                      value={groupText}
                      onChange={(e) => setGroupText(e.target.value)}
                      className="flex-1 min-h-[44px] px-4 rounded-2xl bg-zinc-100 dark:bg-[#0D0E12] text-sm text-zinc-900 dark:text-white focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="min-w-[44px] min-h-[44px] rounded-2xl bg-[#7C3AED] text-white flex items-center justify-center"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </form>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* --- TAB 3: CHANNELS --- */}
      {subTab === 'channels' && (
        <div className="rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] overflow-hidden min-h-[520px]">
          {!activeChannel ? (
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-bold text-sm text-zinc-900 dark:text-white">Herkese Açık Kanallar</h2>
                <button
                  type="button"
                  onClick={() => setShowCreateChannel(true)}
                  className="min-h-[40px] px-3.5 rounded-xl bg-[#7C3AED] text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Kanal Aç</span>
                </button>
              </div>
              {channels.length === 0 ? (
                <p className="py-12 text-center text-xs text-zinc-500">
                  Henüz kanal açılmadı. Duyuru ve yayın kanalı oluşturabilirsiniz.
                </p>
              ) : (
                <div className="space-y-2">
                  {channels.map((ch) => (
                    <div
                      key={ch.id}
                      className="p-3.5 rounded-2xl border border-zinc-200 dark:border-[#232631] flex items-center justify-between gap-3"
                    >
                      <button
                        type="button"
                        onClick={() => openChannel(ch)}
                        className="flex items-center gap-3 min-w-0 text-left flex-1"
                      >
                        <Avatar src={ch.avatar_url} name={ch.name} size="md" />
                        <div className="min-w-0">
                          <div className="font-display font-semibold text-sm text-zinc-900 dark:text-white truncate">
                            {ch.name}
                          </div>
                          <div className="text-xs text-zinc-500 truncate">
                            @{ch.handle} · {ch.followersCount} takipçi
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleFollowChannel(ch)}
                        className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold shrink-0 ${
                          ch.isFollowing
                            ? 'bg-zinc-200 dark:bg-[#232631] text-zinc-800 dark:text-zinc-200'
                            : 'bg-[#7C3AED] text-white'
                        }`}
                      >
                        {ch.isFollowing ? 'Takip Ediliyor' : 'Takip Et'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="px-4 py-3 border-b border-zinc-200 dark:border-[#232631] flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => setActiveChannel(null)}
                    className="min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center text-zinc-500"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <div className="min-w-0">
                    <div className="font-display font-semibold text-sm text-zinc-900 dark:text-white truncate">
                      {activeChannel.name}
                    </div>
                    <div className="text-xs text-zinc-500 truncate">
                      @{activeChannel.handle} · {activeChannel.followersCount} takipçi
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {activeChannel.owner_id === currentUser.id && (
                    <button
                      type="button"
                      onClick={async () => {
                        const next = !activeChannel.comments_enabled;
                        await apiFetch(`/api/channels/${activeChannel.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ commentsEnabled: next }),
                        });
                        setActiveChannel({ ...activeChannel, comments_enabled: next ? 1 : 0 });
                        setChannels((prev) =>
                          prev.map((c) => (c.id === activeChannel.id ? { ...c, comments_enabled: next ? 1 : 0 } : c))
                        );
                      }}
                      className="min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-[#232631] text-xs font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      {activeChannel.comments_enabled ? 'Yorumlar Açık' : 'Yorumlar Kapalı'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleFollowChannel(activeChannel)}
                    className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold ${
                      activeChannel.isFollowing
                        ? 'bg-zinc-200 dark:bg-[#232631] text-zinc-800 dark:text-zinc-200'
                        : 'bg-[#7C3AED] text-white'
                    }`}
                  >
                    {activeChannel.isFollowing ? 'Takip Ediliyor' : 'Takip Et'}
                  </button>
                </div>
              </div>

              {/* Channel Owner Composer */}
              {activeChannel.owner_id === currentUser.id && (
                <form onSubmit={publishChannelPost} className="p-4 border-b border-zinc-200 dark:border-[#232631] space-y-3 bg-zinc-50 dark:bg-[#101218]">
                  <textarea
                    rows={2}
                    placeholder="Kanal takipçilerine gönderi veya duyuru paylaş..."
                    value={chPostText}
                    onChange={(e) => setChPostText(e.target.value)}
                    className="w-full p-3 rounded-2xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] text-sm text-zinc-900 dark:text-white resize-none"
                  />
                  {chMedia && (
                    <div className="text-xs text-[#7C3AED] flex items-center justify-between">
                      <span>Medya eklendi ({chMedia.mediaType})</span>
                      <button type="button" onClick={() => setChMedia(null)} className="text-red-500">
                        Kaldır
                      </button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <input
                        ref={chFileRef}
                        type="file"
                        accept="image/*,video/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const up = await uploadMediaFile(file, file.name);
                          setChMedia(up);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => chFileRef.current?.click()}
                        className="min-h-[38px] px-3 rounded-xl border border-zinc-200 dark:border-[#232631] text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5"
                      >
                        <ImageIcon className="w-4 h-4" />
                        <span>Medya</span>
                      </button>
                      <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={chIsAnnouncement}
                          onChange={(e) => setChIsAnnouncement(e.target.checked)}
                          className="accent-[#7C3AED]"
                        />
                        <span>Sabit Duyuru</span>
                      </label>
                    </div>
                    <button
                      type="submit"
                      className="min-h-[40px] px-4 rounded-xl bg-[#7C3AED] text-white text-xs font-semibold"
                    >
                      Yayınla
                    </button>
                  </div>
                </form>
              )}

              {/* Channel Posts */}
              <div className="p-4 space-y-3">
                {channelPosts.length === 0 ? (
                  <p className="py-8 text-center text-xs text-zinc-500">Bu kanalda henüz paylaşım yapılmadı.</p>
                ) : (
                  channelPosts.map((cp) => (
                    <div
                      key={cp.id}
                      className="p-4 rounded-2xl bg-zinc-50 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] space-y-2.5"
                    >
                      <div className="flex items-center justify-between text-xs text-zinc-500">
                        <span className="font-semibold text-zinc-900 dark:text-white">@{cp.author_username}</span>
                        <div className="flex items-center gap-2">
                          {cp.is_announcement ? (
                            <span className="text-[#7C3AED] dark:text-[#A78BFA] font-semibold flex items-center gap-1">
                              <Pin className="w-3 h-3" /> Duyuru
                            </span>
                          ) : null}
                          <span>{formatRelativeTime(cp.created_at)}</span>
                        </div>
                      </div>
                      {cp.media_url && cp.media_type === 'image' && (
                        <img src={cp.media_url} alt="Kanal görseli" referrerPolicy="no-referrer" className="rounded-xl max-h-72 object-cover" />
                      )}
                      {cp.media_url && cp.media_type === 'video' && (
                        <video src={cp.media_url} controls playsInline className="rounded-xl max-h-72" />
                      )}
                      {cp.content && <p className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">{cp.content}</p>}
                      {activeChannel.comments_enabled ? (
                        <button
                          type="button"
                          onClick={() => openChComments(cp)}
                          className="text-xs font-medium text-[#7C3AED] dark:text-[#A78BFA]"
                        >
                          Yorumlar ({cp.commentsCount})
                        </button>
                      ) : (
                        <span className="text-xs text-zinc-400">Yorumlar kapalı</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create Group Modal */}
      {showCreateGroup && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form
            onSubmit={createGroup}
            className="w-full max-w-md rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-base text-zinc-900 dark:text-white">Yeni Grup Oluştur</h3>
              <button type="button" onClick={() => setShowCreateGroup(false)} className="text-zinc-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              required
              placeholder="Grup adı"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              className="w-full min-h-[44px] px-4 rounded-2xl bg-zinc-100 dark:bg-[#0D0E12] text-sm text-zinc-900 dark:text-white"
            />
            <textarea
              rows={2}
              placeholder="Grup açıklaması"
              value={newGroupDesc}
              onChange={(e) => setNewGroupDesc(e.target.value)}
              className="w-full p-3.5 rounded-2xl bg-zinc-100 dark:bg-[#0D0E12] text-sm text-zinc-900 dark:text-white resize-none"
            />
            <div>
              <input
                ref={groupAvatarFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const up = await uploadMediaFile(file, file.name);
                  setNewGroupAvatar(up.url);
                }}
              />
              <button
                type="button"
                onClick={() => groupAvatarFileRef.current?.click()}
                className="min-h-[42px] px-4 rounded-xl border border-zinc-200 dark:border-[#232631] text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                {newGroupAvatar ? 'Grup Fotoğrafı Yüklendi ✓' : 'Grup Fotoğrafı Seç'}
              </button>
            </div>
            <button type="submit" className="w-full min-h-[46px] rounded-2xl bg-[#7C3AED] text-white text-sm font-semibold">
              Grubu Oluştur
            </button>
          </form>
        </div>
      )}

      {/* Create Channel Modal */}
      {showCreateChannel && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form
            onSubmit={createChannel}
            className="w-full max-w-md rounded-3xl bg-white dark:bg-[#15171E] border border-zinc-200 dark:border-[#232631] p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-base text-zinc-900 dark:text-white">Yeni Kanal Aç</h3>
              <button type="button" onClick={() => setShowCreateChannel(false)} className="text-zinc-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              required
              placeholder="Kanal adı"
              value={newChName}
              onChange={(e) => setNewChName(e.target.value)}
              className="w-full min-h-[44px] px-4 rounded-2xl bg-zinc-100 dark:bg-[#0D0E12] text-sm text-zinc-900 dark:text-white"
            />
            <input
              type="text"
              placeholder="Kısa ad (ör. teknoloji_tr)"
              value={newChHandle}
              onChange={(e) => setNewChHandle(e.target.value)}
              className="w-full min-h-[44px] px-4 rounded-2xl bg-zinc-100 dark:bg-[#0D0E12] text-sm text-zinc-900 dark:text-white"
            />
            <textarea
              rows={2}
              placeholder="Kanal açıklaması"
              value={newChDesc}
              onChange={(e) => setNewChDesc(e.target.value)}
              className="w-full p-3.5 rounded-2xl bg-zinc-100 dark:bg-[#0D0E12] text-sm text-zinc-900 dark:text-white resize-none"
            />
            <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={newChComments}
                onChange={(e) => setNewChComments(e.target.checked)}
                className="accent-[#7C3AED]"
              />
              <span>Takipçi yorumlarına izin ver</span>
            </label>
            <button type="submit" className="w-full min-h-[46px] rounded-2xl bg-[#7C3AED] text-white text-sm font-semibold">
              Kanalı Oluştur
            </button>
          </form>
        </div>
      )}

      {/* Channel Comments Drawer */}
      {activeChComments && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center">
          <div className="w-full sm:max-w-md h-[65vh] bg-white dark:bg-[#15171E] rounded-t-3xl sm:rounded-3xl border border-zinc-200 dark:border-[#232631] flex flex-col">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-[#232631] flex items-center justify-between">
              <span className="font-display font-semibold text-sm text-zinc-900 dark:text-white">Kanal Yorumları</span>
              <button type="button" onClick={() => setActiveChComments(null)} className="text-zinc-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {activeChComments.list.map((c) => (
                <div key={c.id} className="text-sm">
                  <span className="font-semibold text-zinc-900 dark:text-white">@{c.username}</span>{' '}
                  <span className="text-zinc-700 dark:text-zinc-300">{c.content}</span>
                </div>
              ))}
            </div>
            <form onSubmit={submitChComment} className="p-3 border-t border-zinc-200 dark:border-[#232631] flex gap-2">
              <input
                type="text"
                placeholder="Yorum yaz..."
                value={chCommentInput}
                onChange={(e) => setChCommentInput(e.target.value)}
                className="flex-1 min-h-[44px] px-4 rounded-2xl bg-zinc-100 dark:bg-[#0D0E12] text-sm text-zinc-900 dark:text-white"
              />
              <button type="submit" className="min-w-[44px] min-h-[44px] rounded-2xl bg-[#7C3AED] text-white flex items-center justify-center">
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const RemoteCallVideo: React.FC<{ stream: MediaStream; label: string }> = ({ stream, label }) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);
  return (
    <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
      <video ref={ref} playsInline className="w-full h-full object-cover" />
      <span className="absolute bottom-1.5 left-2 text-[10px] text-white bg-black/60 px-1.5 py-0.5 rounded">
        {label}
      </span>
    </div>
  );
};
