-- VYRA — Supabase PostgreSQL Şeması, Güvenlik Politikaları (RLS) ve Storage
-- Supabase Dashboard > SQL Editor bölümüne yapıştırıp çalıştırın.
-- E-posta doğrulamasını kapatmak için: Authentication > Providers > Email > "Confirm email" seçeneğini KAPATIN.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. PROFİLLER
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_.]{3,24}$'),
  display_name TEXT NOT NULL,
  avatar_url TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  is_private BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. TAKİP & ENGEL & ŞİKÂYET
CREATE TABLE IF NOT EXISTS public.follows (
  follower_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id)
);

CREATE TABLE IF NOT EXISTS public.blocks (
  blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. GÖNDERİLER & VYRA SHOTS
CREATE TABLE IF NOT EXISTS public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  caption TEXT DEFAULT '',
  media_url TEXT DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'none' CHECK (media_type IN ('none', 'image', 'video')),
  is_shot BOOLEAN NOT NULL DEFAULT FALSE,
  hashtags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.post_likes (
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.post_saves (
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. ÖZEL MESAJLAR (DM)
CREATE TABLE IF NOT EXISTS public.direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT DEFAULT '',
  media_url TEXT DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'none',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_by_sender BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. GRUPLAR
CREATE TABLE IF NOT EXISTS public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.group_members (
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.group_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT DEFAULT '',
  media_url TEXT DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'none',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. KANALLAR
CREATE TABLE IF NOT EXISTS public.channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  comments_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.channel_followers (
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.channel_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT DEFAULT '',
  media_url TEXT DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'none',
  is_announcement BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.channel_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_post_id UUID NOT NULL REFERENCES public.channel_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. CANLI YAYINLAR
CREATE TABLE IF NOT EXISTS public.live_streams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'ended')),
  room_name TEXT NOT NULL UNIQUE,
  guest_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.live_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL REFERENCES public.live_streams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ROW LEVEL SECURITY (RLS) POLİTİKALARI
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_followers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_chat_messages ENABLE ROW LEVEL SECURITY;

-- Yardımcı engel kontrol fonksiyonu
CREATE OR REPLACE FUNCTION public.is_blocked(u1 UUID, u2 UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocks
    WHERE (blocker_id = u1 AND blocked_id = u2)
       OR (blocker_id = u2 AND blocked_id = u1)
  );
$$;

-- Profiles RLS
CREATE POLICY "Profiller görünür" ON public.profiles FOR SELECT USING (NOT public.is_blocked(auth.uid(), id));
CREATE POLICY "Kendi profilini ekle" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Kendi profilini güncelle" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Follows RLS
CREATE POLICY "Takipler okunabilir" ON public.follows FOR SELECT USING (true);
CREATE POLICY "Takip isteği gönder" ON public.follows FOR INSERT WITH CHECK (auth.uid() = follower_id AND NOT public.is_blocked(follower_id, following_id));
CREATE POLICY "Takip güncelle" ON public.follows FOR UPDATE USING (auth.uid() = following_id);
CREATE POLICY "Takipten çık" ON public.follows FOR DELETE USING (auth.uid() = follower_id OR auth.uid() = following_id);

-- Blocks & Reports RLS
CREATE POLICY "Kendi engellerini gör" ON public.blocks FOR SELECT USING (auth.uid() = blocker_id);
CREATE POLICY "Engelle" ON public.blocks FOR INSERT WITH CHECK (auth.uid() = blocker_id);
CREATE POLICY "Engeli kaldır" ON public.blocks FOR DELETE USING (auth.uid() = blocker_id);
CREATE POLICY "Şikâyet gönder" ON public.reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);

-- Posts RLS (Gizli hesap + Engel kontrolü)
CREATE POLICY "Gönderileri gör" ON public.posts FOR SELECT USING (
  NOT public.is_blocked(auth.uid(), user_id) AND (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = user_id AND p.is_private = FALSE) OR
    EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = auth.uid() AND f.following_id = user_id AND f.status = 'accepted')
  )
);
CREATE POLICY "Gönderi paylaş" ON public.posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Kendi gönderini sil" ON public.posts FOR DELETE USING (auth.uid() = user_id);

-- Likes, Saves, Comments RLS
CREATE POLICY "Beğenileri gör" ON public.post_likes FOR SELECT USING (true);
CREATE POLICY "Beğen" ON public.post_likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Beğeni kaldır" ON public.post_likes FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Kayıtları gör" ON public.post_saves FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Kaydet" ON public.post_saves FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Kaydı kaldır" ON public.post_saves FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Yorumları gör" ON public.post_comments FOR SELECT USING (true);
CREATE POLICY "Yorum yap" ON public.post_comments FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Direct Messages RLS
CREATE POLICY "DM oku" ON public.direct_messages FOR SELECT USING (
  (auth.uid() = sender_id OR auth.uid() = receiver_id) AND NOT deleted_by_sender
);
CREATE POLICY "DM gönder" ON public.direct_messages FOR INSERT WITH CHECK (
  auth.uid() = sender_id AND NOT public.is_blocked(sender_id, receiver_id)
);
CREATE POLICY "DM okundu veya sil" ON public.direct_messages FOR UPDATE USING (
  auth.uid() = receiver_id OR auth.uid() = sender_id
);

-- Groups & Group Messages RLS
CREATE POLICY "Gruplar herkese görünür" ON public.groups FOR SELECT USING (true);
CREATE POLICY "Grup kur" ON public.groups FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Grup yöneticisi günceller" ON public.groups FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = id AND gm.user_id = auth.uid() AND gm.role = 'admin')
);

CREATE POLICY "Grup üyeleri görünür" ON public.group_members FOR SELECT USING (true);
CREATE POLICY "Gruba katıl" ON public.group_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Grup mesajlarını oku" ON public.group_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = group_id AND gm.user_id = auth.uid())
);
CREATE POLICY "Gruba mesaj yaz" ON public.group_messages FOR INSERT WITH CHECK (
  auth.uid() = sender_id AND EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = group_id AND gm.user_id = auth.uid())
);

-- Channels RLS
CREATE POLICY "Kanallar görünür" ON public.channels FOR SELECT USING (true);
CREATE POLICY "Kanal aç" ON public.channels FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Kanal takipçileri" ON public.channel_followers FOR SELECT USING (true);
CREATE POLICY "Kanal takip et" ON public.channel_followers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Kanal takipten çık" ON public.channel_followers FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Kanal gönderileri görünür" ON public.channel_posts FOR SELECT USING (true);
CREATE POLICY "Kanal yöneticisi paylaşır" ON public.channel_posts FOR INSERT WITH CHECK (
  auth.uid() = author_id AND EXISTS (SELECT 1 FROM public.channels c WHERE c.id = channel_id AND c.owner_id = auth.uid())
);
CREATE POLICY "Kanal yorumları görünür" ON public.channel_comments FOR SELECT USING (true);
CREATE POLICY "Kanal yorumu yaz" ON public.channel_comments FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Live Streams RLS
CREATE POLICY "Canlı yayınlar görünür" ON public.live_streams FOR SELECT USING (true);
CREATE POLICY "Yayın başlat" ON public.live_streams FOR INSERT WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Yayın bitir" ON public.live_streams FOR UPDATE USING (auth.uid() = host_id);
CREATE POLICY "Canlı sohbet oku" ON public.live_chat_messages FOR SELECT USING (true);
CREATE POLICY "Canlı sohbet yaz" ON public.live_chat_messages FOR INSERT WITH CHECK (auth.uid() = user_id);

-- STORAGE BUCKET & REALTIME
INSERT INTO storage.buckets (id, name, public) VALUES ('vyra-media', 'vyra-media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Medya herkese açık okuma" ON storage.objects FOR SELECT USING (bucket_id = 'vyra-media');
CREATE POLICY "Giriş yapan medya yükler" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'vyra-media' AND auth.role() = 'authenticated');

ALTER PUBLICATION supabase_realtime ADD TABLE public.posts, public.direct_messages, public.group_messages, public.channel_posts, public.live_streams, public.live_chat_messages;
