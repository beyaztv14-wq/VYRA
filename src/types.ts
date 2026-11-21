export interface User {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  bio: string;
  is_private: number;
  created_at: string;
}

export interface Post {
  id: string;
  user_id: string;
  caption: string;
  media_url: string;
  media_type: 'image' | 'video' | 'none';
  is_shot: boolean;
  hashtags: string[];
  created_at: string;
  author: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string;
    is_private: boolean;
  };
  likesCount: number;
  commentsCount: number;
  savesCount: number;
  liked: boolean;
  saved: boolean;
}

export interface CommentItem {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  content: string;
  created_at: string;
}

export interface DirectMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  media_url: string;
  media_type: 'image' | 'video' | 'none';
  is_read: number;
  deleted_by_sender: number;
  created_at: string;
}

export interface Conversation {
  peer: User;
  lastMessage: DirectMessage | null;
  unreadCount: number;
}

export interface GroupItem {
  id: string;
  name: string;
  description: string;
  avatar_url: string;
  creator_id: string;
  created_at: string;
  membersCount: number;
  myRole: 'admin' | 'member' | null;
}

export interface GroupMember {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  role: 'admin' | 'member';
  joined_at: string;
}

export interface GroupMessage {
  id: string;
  group_id: string;
  sender_id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  content: string;
  media_url: string;
  media_type: 'image' | 'video' | 'none';
  created_at: string;
}

export interface ChannelItem {
  id: string;
  name: string;
  handle: string;
  description: string;
  avatar_url: string;
  owner_id: string;
  owner_username: string;
  owner_display_name: string;
  comments_enabled: number;
  created_at: string;
  followersCount: number;
  isFollowing: number;
}

export interface ChannelPost {
  id: string;
  channel_id: string;
  author_id: string;
  author_username: string;
  author_display_name: string;
  author_avatar_url: string;
  content: string;
  media_url: string;
  media_type: 'image' | 'video' | 'none';
  is_announcement: number;
  commentsCount: number;
  created_at: string;
}

export interface LiveStreamItem {
  id: string;
  host_id: string;
  host_username: string;
  host_display_name: string;
  host_avatar_url: string;
  title: string;
  status: 'live' | 'ended';
  room_name: string;
  guest_id: string | null;
  started_at: string;
  viewerCount: number;
}

export interface LiveChatMessage {
  id: string;
  stream_id: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  content: string;
  created_at: string;
}
