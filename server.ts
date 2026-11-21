import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import { AccessToken } from 'livekit-server-sdk';
import { createServer as createViteServer } from 'vite';
import { db, uploadsDir, sanitizeUser } from './server/db.ts';

dotenv.config();

const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.createHash('sha256').update(process.cwd() + '_vyra_session_key').digest('hex');

const app = express();
app.use(express.json({ limit: '10mb' }));

// Static uploads with byte-range support for video seeking on Android Chrome
app.use('/uploads', express.static(uploadsDir, {
  acceptRanges: true,
  maxAge: '1d',
}));

// Static public assets (standalone HTML, SQL schema, etc.)
const publicDir = path.resolve(process.cwd(), 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}
app.use('/downloads', express.static(publicDir));

// Multer storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || (file.mimetype.startsWith('video/') ? '.mp4' : '.jpg');
    cb(null, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Yalnızca fotoğraf ve video dosyaları desteklenir.'));
    }
  },
});

interface AuthRequest extends express.Request {
  userId?: string;
}

function signToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

function authMiddleware(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Oturum açmanız gerekiyor.' });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(payload.userId);
    if (!exists) {
      res.status(401).json({ error: 'Kullanıcı bulunamadı.' });
      return;
    }
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Geçersiz veya süresi dolmuş oturum.' });
  }
}

function optionalAuth(req: AuthRequest, _res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET) as { userId: string };
      req.userId = payload.userId;
    } catch {
      // ignore
    }
  }
  next();
}

function isBlockedBetween(userA: string, userB: string): boolean {
  const row = db
    .prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
    .get(userA, userB, userB, userA);
  return Boolean(row);
}

function extractHashtags(text: string): string {
  const matches = text.match(/#[\p{L}\p{N}_]+/gu) || [];
  return Array.from(new Set(matches.map((t) => t.toLowerCase()))).join(',');
}

// --- WebSocket Real-Time & WebRTC Signaling Server ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const userSockets = new Map<string, Set<WebSocket>>();
const liveRooms = new Map<string, Map<string, WebSocket>>(); // streamId -> Map<userId, ws>
const groupCallRooms = new Map<string, Map<string, WebSocket>>(); // groupId -> Map<userId, ws>

function sendWs(ws: WebSocket, event: string, payload: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event, payload }));
  }
}

function broadcastAll(event: string, payload: any) {
  const data = JSON.stringify({ event, payload });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function sendToUser(userId: string, event: string, payload: any) {
  const set = userSockets.get(userId);
  if (!set) return;
  const data = JSON.stringify({ event, payload });
  set.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

function broadcastToLiveRoom(streamId: string, event: string, payload: any, excludeUserId?: string) {
  const room = liveRooms.get(streamId);
  if (!room) return;
  const data = JSON.stringify({ event, payload });
  room.forEach((ws, uid) => {
    if (uid !== excludeUserId && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function broadcastViewerCount(streamId: string) {
  const room = liveRooms.get(streamId);
  const count = room ? room.size : 0;
  broadcastAll('live:viewers', { streamId, count });
}

wss.on('connection', (ws, req) => {
  let authedUserId: string | null = null;
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const tokenParam = url.searchParams.get('token');
  if (tokenParam) {
    try {
      const payload = jwt.verify(tokenParam, JWT_SECRET) as { userId: string };
      authedUserId = payload.userId;
      if (!userSockets.has(authedUserId)) userSockets.set(authedUserId, new Set());
      userSockets.get(authedUserId)!.add(ws);
    } catch {
      // wait for auth msg
    }
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const { event, payload } = msg;

      if (event === 'auth' && payload?.token) {
        try {
          const decoded = jwt.verify(payload.token, JWT_SECRET) as { userId: string };
          authedUserId = decoded.userId;
          if (!userSockets.has(authedUserId)) userSockets.set(authedUserId, new Set());
          userSockets.get(authedUserId)!.add(ws);
          sendWs(ws, 'auth:ok', { userId: authedUserId });
        } catch {
          sendWs(ws, 'auth:error', { error: 'Geçersiz token' });
        }
        return;
      }

      if (!authedUserId) return;

      if (event === 'live:join' && payload?.streamId) {
        const streamId = String(payload.streamId);
        if (!liveRooms.has(streamId)) liveRooms.set(streamId, new Map());
        liveRooms.get(streamId)!.set(authedUserId, ws);
        broadcastViewerCount(streamId);
        const stream = db.prepare('SELECT host_id, guest_id FROM live_streams WHERE id = ?').get(streamId) as any;
        if (stream && stream.host_id !== authedUserId) {
          sendToUser(stream.host_id, 'live:viewer-joined', { streamId, viewerId: authedUserId });
        }
      }

      if (event === 'live:leave' && payload?.streamId) {
        const streamId = String(payload.streamId);
        const room = liveRooms.get(streamId);
        if (room) {
          room.delete(authedUserId);
          broadcastViewerCount(streamId);
        }
      }

      if (event === 'webrtc:signal' && payload?.targetUserId) {
        sendToUser(String(payload.targetUserId), 'webrtc:signal', {
          fromUserId: authedUserId,
          streamId: payload.streamId,
          groupId: payload.groupId,
          signalType: payload.signalType,
          sdp: payload.sdp,
          candidate: payload.candidate,
          role: payload.role,
        });
      }

      if (event === 'groupcall:join' && payload?.groupId) {
        const groupId = String(payload.groupId);
        const member = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, authedUserId);
        if (!member) return;
        if (!groupCallRooms.has(groupId)) groupCallRooms.set(groupId, new Map());
        const room = groupCallRooms.get(groupId)!;
        const existingPeers = Array.from(room.keys()).filter((id) => id !== authedUserId);
        room.set(authedUserId, ws);
        sendWs(ws, 'groupcall:peers', { groupId, peers: existingPeers });
        room.forEach((peerWs, peerId) => {
          if (peerId !== authedUserId) {
            sendWs(peerWs, 'groupcall:peer-joined', { groupId, userId: authedUserId });
          }
        });
      }

      if (event === 'groupcall:leave' && payload?.groupId) {
        const groupId = String(payload.groupId);
        const room = groupCallRooms.get(groupId);
        if (room) {
          room.delete(authedUserId);
          room.forEach((peerWs) => sendWs(peerWs, 'groupcall:peer-left', { groupId, userId: authedUserId }));
        }
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    if (!authedUserId) return;
    const set = userSockets.get(authedUserId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) userSockets.delete(authedUserId);
    }
    liveRooms.forEach((room, streamId) => {
      if (room.get(authedUserId!) === ws) {
        room.delete(authedUserId!);
        broadcastViewerCount(streamId);
      }
    });
    groupCallRooms.forEach((room, groupId) => {
      if (room.get(authedUserId!) === ws) {
        room.delete(authedUserId!);
        room.forEach((peerWs) => sendWs(peerWs, 'groupcall:peer-left', { groupId, userId: authedUserId }));
      }
    });
  });
});

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const rawUsername = String(req.body.username || '').trim().toLowerCase();
    const displayName = String(req.body.displayName || '').trim();
    const password = String(req.body.password || '');

    if (!/^[a-z0-9_.]{3,24}$/.test(rawUsername)) {
      res.status(400).json({ error: 'Kullanıcı adı 3-24 karakter olmalı ve yalnızca harf, rakam, nokta veya alt çizgi içermelidir.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Şifre en az 6 karakter olmalıdır.' });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(rawUsername);
    if (existing) {
      res.status(409).json({ error: 'Bu kullanıcı adı zaten alınmış.' });
      return;
    }

    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    const recoveryCode = crypto.randomBytes(6).toString('hex').toUpperCase();
    const recoveryCodeHash = await bcrypt.hash(recoveryCode, 10);
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, recovery_code_hash, avatar_url, bio, is_private, created_at)
       VALUES (?, ?, ?, ?, ?, '', '', 0, ?)`
    ).run(id, rawUsername, displayName || rawUsername, passwordHash, recoveryCodeHash, now);

    const user = sanitizeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    const token = signToken(id);
    res.status(201).json({ token, user, recoveryCode });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Kayıt başarısız.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const rawUsername = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(rawUsername) as any;
    if (!row) {
      res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
      return;
    }
    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
      return;
    }
    const token = signToken(row.id);
    res.json({ token, user: sanitizeUser(row) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Giriş başarısız.' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const rawUsername = String(req.body.username || '').trim().toLowerCase();
    const recoveryCode = String(req.body.recoveryCode || '').trim().toUpperCase();
    const newPassword = String(req.body.newPassword || '');

    if (newPassword.length < 6) {
      res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalıdır.' });
      return;
    }
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(rawUsername) as any;
    if (!row) {
      res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      return;
    }
    const ok = await bcrypt.compare(recoveryCode, row.recovery_code_hash);
    if (!ok) {
      res.status(401).json({ error: 'Kurtarma kodu hatalı.' });
      return;
    }
    const newHash = await bcrypt.hash(newPassword, 10);
    const nextRecovery = crypto.randomBytes(6).toString('hex').toUpperCase();
    const nextRecoveryHash = await bcrypt.hash(nextRecovery, 10);
    db.prepare('UPDATE users SET password_hash = ?, recovery_code_hash = ? WHERE id = ?').run(newHash, nextRecoveryHash, row.id);
    res.json({ ok: true, newRecoveryCode: nextRecovery });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Şifre sıfırlama başarısız.' });
  }
});

app.get('/api/auth/me', authMiddleware, (req: AuthRequest, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  res.json({ user: sanitizeUser(row) });
});

// --- UPLOAD ---
app.post('/api/upload', authMiddleware, upload.single('file'), (req: AuthRequest, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Dosya seçilmedi.' });
    return;
  }
  const mediaType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
  res.json({
    url: `/uploads/${req.file.filename}`,
    mediaType,
    size: req.file.size,
  });
});

// --- USERS & PROFILE & SAFETY ---
app.patch('/api/users/me', authMiddleware, (req: AuthRequest, res) => {
  try {
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId) as any;
    const nextUsername = req.body.username !== undefined ? String(req.body.username).trim().toLowerCase() : current.username;
    const nextDisplayName = req.body.display_name !== undefined ? String(req.body.display_name).trim() : current.display_name;
    const nextBio = req.body.bio !== undefined ? String(req.body.bio).slice(0, 240) : current.bio;
    const nextAvatar = req.body.avatar_url !== undefined ? String(req.body.avatar_url) : current.avatar_url;
    const nextPrivate = req.body.is_private !== undefined ? (req.body.is_private ? 1 : 0) : current.is_private;

    if (!/^[a-z0-9_.]{3,24}$/.test(nextUsername)) {
      res.status(400).json({ error: 'Geçersiz kullanıcı adı biçimi.' });
      return;
    }
    if (nextUsername !== current.username) {
      const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(nextUsername, req.userId);
      if (taken) {
        res.status(409).json({ error: 'Bu kullanıcı adı kullanılıyor.' });
        return;
      }
    }

    db.prepare(
      'UPDATE users SET username = ?, display_name = ?, bio = ?, avatar_url = ?, is_private = ? WHERE id = ?'
    ).run(nextUsername, nextDisplayName || nextUsername, nextBio, nextAvatar, nextPrivate, req.userId);

    const updated = sanitizeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId));
    res.json({ user: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users/:id', optionalAuth, (req: AuthRequest, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ? OR username = ?').get(req.params.id, req.params.id) as any;
  if (!row) {
    res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    return;
  }
  if (req.userId && isBlockedBetween(req.userId, row.id)) {
    res.status(403).json({ error: 'Bu profile erişilemiyor.' });
    return;
  }
  const followersCount = (db.prepare("SELECT COUNT(*) as c FROM follows WHERE following_id = ? AND status = 'accepted'").get(row.id) as any).c;
  const followingCount = (db.prepare("SELECT COUNT(*) as c FROM follows WHERE follower_id = ? AND status = 'accepted'").get(row.id) as any).c;
  const postsCount = (db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id = ?').get(row.id) as any).c;
  let followStatus = 'none';
  if (req.userId) {
    const f = db.prepare('SELECT status FROM follows WHERE follower_id = ? AND following_id = ?').get(req.userId, row.id) as any;
    if (f) followStatus = f.status;
  }
  res.json({
    user: sanitizeUser(row),
    stats: { followersCount, followingCount, postsCount },
    followStatus,
  });
});

app.post('/api/users/:id/follow', authMiddleware, (req: AuthRequest, res) => {
  const targetId = req.params.id;
  if (targetId === req.userId) {
    res.status(400).json({ error: 'Kendinizi takip edemezsiniz.' });
    return;
  }
  if (isBlockedBetween(req.userId!, targetId)) {
    res.status(403).json({ error: 'Engellenen kullanıcı takip edilemez.' });
    return;
  }
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId) as any;
  if (!target) {
    res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    return;
  }
  const existing = db.prepare('SELECT * FROM follows WHERE follower_id = ? AND following_id = ?').get(req.userId, targetId) as any;
  if (existing) {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.userId, targetId);
    res.json({ status: 'none' });
    return;
  }
  const status = target.is_private ? 'pending' : 'accepted';
  db.prepare('INSERT INTO follows (follower_id, following_id, status, created_at) VALUES (?, ?, ?, ?)').run(
    req.userId,
    targetId,
    status,
    new Date().toISOString()
  );
  sendToUser(targetId, 'follow:updated', { followerId: req.userId, status });
  res.json({ status });
});

app.get('/api/follow-requests', authMiddleware, (req: AuthRequest, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, f.created_at
       FROM follows f JOIN users u ON f.follower_id = u.id
       WHERE f.following_id = ? AND f.status = 'pending'
       ORDER BY f.created_at DESC`
    )
    .all(req.userId);
  res.json({ requests: rows });
});

app.post('/api/follow-requests/:followerId', authMiddleware, (req: AuthRequest, res) => {
  const action = req.body.action; // 'accept' | 'decline'
  if (action === 'accept') {
    db.prepare("UPDATE follows SET status = 'accepted' WHERE follower_id = ? AND following_id = ?").run(
      req.params.followerId,
      req.userId
    );
  } else {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.params.followerId, req.userId);
  }
  res.json({ ok: true });
});

app.post('/api/users/:id/block', authMiddleware, (req: AuthRequest, res) => {
  const targetId = req.params.id;
  if (targetId === req.userId) {
    res.status(400).json({ error: 'Kendinizi engelleyemezsiniz.' });
    return;
  }
  const existing = db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(req.userId, targetId);
  if (existing) {
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.userId, targetId);
    res.json({ blocked: false });
    return;
  }
  db.prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(
    req.userId,
    targetId,
    new Date().toISOString()
  );
  db.prepare('DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)').run(
    req.userId,
    targetId,
    targetId,
    req.userId
  );
  res.json({ blocked: true });
});

app.get('/api/blocks', authMiddleware, (req: AuthRequest, res) => {
  const rows = db
    .prepare('SELECT u.id, u.username, u.display_name, u.avatar_url FROM blocks b JOIN users u ON b.blocked_id = u.id WHERE b.blocker_id = ?')
    .all(req.userId);
  res.json({ blockedUsers: rows });
});

app.post('/api/reports', authMiddleware, (req: AuthRequest, res) => {
  const { targetType, targetId, reason } = req.body;
  if (!targetType || !targetId || !reason) {
    res.status(400).json({ error: 'Eksik şikâyet bilgisi.' });
    return;
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO reports (id, reporter_id, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    req.userId,
    String(targetType),
    String(targetId),
    String(reason).slice(0, 500),
    new Date().toISOString()
  );
  res.status(201).json({ ok: true, id });
});

// --- POSTS & VYRA SHOTS ---
function enrichPost(row: any, viewerId?: string) {
  const likesCount = (db.prepare('SELECT COUNT(*) as c FROM post_likes WHERE post_id = ?').get(row.id) as any).c;
  const commentsCount = (db.prepare('SELECT COUNT(*) as c FROM post_comments WHERE post_id = ?').get(row.id) as any).c;
  const savesCount = (db.prepare('SELECT COUNT(*) as c FROM post_saves WHERE post_id = ?').get(row.id) as any).c;
  const liked = viewerId ? Boolean(db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(row.id, viewerId)) : false;
  const saved = viewerId ? Boolean(db.prepare('SELECT 1 FROM post_saves WHERE post_id = ? AND user_id = ?').get(row.id, viewerId)) : false;
  return {
    id: row.id,
    user_id: row.user_id,
    caption: row.caption,
    media_url: row.media_url,
    media_type: row.media_type,
    is_shot: Boolean(row.is_shot),
    hashtags: row.hashtags ? row.hashtags.split(',').filter(Boolean) : [],
    created_at: row.created_at,
    author: {
      id: row.author_id,
      username: row.author_username,
      display_name: row.author_display_name,
      avatar_url: row.author_avatar_url || '',
      is_private: Boolean(row.author_is_private),
    },
    likesCount,
    commentsCount,
    savesCount,
    liked,
    saved,
  };
}

app.get('/api/posts', optionalAuth, (req: AuthRequest, res) => {
  const mode = String(req.query.mode || 'all'); // all | following | shots | saved | user
  const targetUserId = req.query.userId ? String(req.query.userId) : null;
  const viewerId = req.userId;

  let query = `
    SELECT p.*, u.id as author_id, u.username as author_username, u.display_name as author_display_name,
           u.avatar_url as author_avatar_url, u.is_private as author_is_private
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (mode === 'shots') {
    query += ' AND p.is_shot = 1';
  } else if (mode === 'all' || mode === 'following') {
    query += ' AND p.is_shot = 0';
  }

  if (mode === 'following' && viewerId) {
    query += ` AND (p.user_id = ? OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ? AND status = 'accepted'))`;
    params.push(viewerId, viewerId);
  }

  if (mode === 'saved' && viewerId) {
    query += ` AND p.id IN (SELECT post_id FROM post_saves WHERE user_id = ?)`;
    params.push(viewerId);
  }

  if (mode === 'user' && targetUserId) {
    query += ' AND p.user_id = ?';
    params.push(targetUserId);
  }

  if (viewerId) {
    query += ` AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
               AND p.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)`;
    params.push(viewerId, viewerId);
  }

  query += ' ORDER BY p.created_at DESC LIMIT 80';

  const rows = db.prepare(query).all(...params) as any[];
  const visible = rows.filter((r) => {
    if (!r.author_is_private) return true;
    if (!viewerId) return false;
    if (r.user_id === viewerId) return true;
    return Boolean(
      db.prepare("SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ? AND status = 'accepted'").get(viewerId, r.user_id)
    );
  });

  res.json({ posts: visible.map((r) => enrichPost(r, viewerId)) });
});

app.post('/api/posts', authMiddleware, (req: AuthRequest, res) => {
  const caption = String(req.body.caption || '').trim();
  const mediaUrl = String(req.body.mediaUrl || '');
  const mediaType = String(req.body.mediaType || 'none');
  const isShot = req.body.isShot ? 1 : 0;

  if (!caption && !mediaUrl) {
    res.status(400).json({ error: 'Metin veya medya eklemelisiniz.' });
    return;
  }
  if (isShot && mediaType !== 'video') {
    res.status(400).json({ error: 'VYRA Shots için video yüklemelisiniz.' });
    return;
  }

  const id = crypto.randomUUID();
  const hashtags = extractHashtags(caption);
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO posts (id, user_id, caption, media_url, media_type, is_shot, hashtags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, req.userId, caption, mediaUrl, mediaType, isShot, hashtags, now);

  const row = db
    .prepare(
      `SELECT p.*, u.id as author_id, u.username as author_username, u.display_name as author_display_name,
              u.avatar_url as author_avatar_url, u.is_private as author_is_private
       FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?`
    )
    .get(id);
  const post = enrichPost(row, req.userId);
  broadcastAll('post:created', { post });
  res.status(201).json({ post });
});

app.delete('/api/posts/:id', authMiddleware, (req: AuthRequest, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id) as any;
  if (!post) {
    res.status(404).json({ error: 'Gönderi bulunamadı.' });
    return;
  }
  if (post.user_id !== req.userId) {
    res.status(403).json({ error: 'Yalnızca kendi gönderinizi silebilirsiniz.' });
    return;
  }
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  broadcastAll('post:deleted', { postId: req.params.id });
  res.json({ ok: true });
});

app.post('/api/posts/:id/like', authMiddleware, (req: AuthRequest, res) => {
  const postId = req.params.id;
  const existing = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(postId, req.userId);
  if (existing) {
    db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(postId, req.userId);
  } else {
    db.prepare('INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)').run(
      postId,
      req.userId,
      new Date().toISOString()
    );
  }
  const count = (db.prepare('SELECT COUNT(*) as c FROM post_likes WHERE post_id = ?').get(postId) as any).c;
  broadcastAll('post:liked', { postId, likesCount: count });
  res.json({ liked: !existing, likesCount: count });
});

app.post('/api/posts/:id/save', authMiddleware, (req: AuthRequest, res) => {
  const postId = req.params.id;
  const existing = db.prepare('SELECT 1 FROM post_saves WHERE post_id = ? AND user_id = ?').get(postId, req.userId);
  if (existing) {
    db.prepare('DELETE FROM post_saves WHERE post_id = ? AND user_id = ?').run(postId, req.userId);
  } else {
    db.prepare('INSERT INTO post_saves (post_id, user_id, created_at) VALUES (?, ?, ?)').run(
      postId,
      req.userId,
      new Date().toISOString()
    );
  }
  const count = (db.prepare('SELECT COUNT(*) as c FROM post_saves WHERE post_id = ?').get(postId) as any).c;
  res.json({ saved: !existing, savesCount: count });
});

app.get('/api/posts/:id/comments', optionalAuth, (req: AuthRequest, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, u.username, u.display_name, u.avatar_url
       FROM post_comments c JOIN users u ON c.user_id = u.id
       WHERE c.post_id = ? ORDER BY c.created_at ASC`
    )
    .all(req.params.id);
  res.json({ comments: rows });
});

app.post('/api/posts/:id/comments', authMiddleware, (req: AuthRequest, res) => {
  const content = String(req.body.content || '').trim();
  if (!content) {
    res.status(400).json({ error: 'Yorum boş olamaz.' });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO post_comments (id, post_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    req.params.id,
    req.userId,
    content.slice(0, 1000),
    now
  );
  const comment = db
    .prepare(
      `SELECT c.*, u.username, u.display_name, u.avatar_url
       FROM post_comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?`
    )
    .get(id);
  const commentsCount = (db.prepare('SELECT COUNT(*) as c FROM post_comments WHERE post_id = ?').get(req.params.id) as any).c;
  broadcastAll('post:commented', { postId: req.params.id, comment, commentsCount });
  res.status(201).json({ comment, commentsCount });
});

// --- EXPLORE ---
app.get('/api/explore', optionalAuth, (req: AuthRequest, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const tag = String(req.query.tag || '').trim().toLowerCase();
  const viewerId = req.userId;

  let usersQuery = 'SELECT * FROM users WHERE 1=1';
  const userParams: any[] = [];
  if (q) {
    usersQuery += ' AND (LOWER(username) LIKE ? OR LOWER(display_name) LIKE ?)';
    userParams.push(`%${q}%`, `%${q}%`);
  }
  if (viewerId) {
    usersQuery += ` AND id != ? AND id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
                    AND id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)`;
    userParams.push(viewerId, viewerId, viewerId);
  }
  usersQuery += ' ORDER BY created_at DESC LIMIT 25';
  const users = db.prepare(usersQuery).all(...userParams).map(sanitizeUser);

  let postsQuery = `
    SELECT p.*, u.id as author_id, u.username as author_username, u.display_name as author_display_name,
           u.avatar_url as author_avatar_url, u.is_private as author_is_private,
           (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) as like_score
    FROM posts p JOIN users u ON p.user_id = u.id
    WHERE u.is_private = 0
  `;
  const postParams: any[] = [];
  if (q) {
    postsQuery += ' AND (LOWER(p.caption) LIKE ? OR LOWER(p.hashtags) LIKE ?)';
    postParams.push(`%${q}%`, `%${q}%`);
  }
  if (tag) {
    const normalizedTag = tag.startsWith('#') ? tag : `#${tag}`;
    postsQuery += ' AND LOWER(p.hashtags) LIKE ?';
    postParams.push(`%${normalizedTag}%`);
  }
  postsQuery += ' ORDER BY like_score DESC, p.created_at DESC LIMIT 40';
  const postRows = db.prepare(postsQuery).all(...postParams);
  const posts = postRows.map((r) => enrichPost(r, viewerId));

  // Real hashtags aggregated from real posts
  const allHashtagRows = db.prepare("SELECT hashtags FROM posts WHERE hashtags != ''").all() as { hashtags: string }[];
  const tagCounts = new Map<string, number>();
  allHashtagRows.forEach((r) => {
    r.hashtags.split(',').filter(Boolean).forEach((t) => {
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    });
  });
  const hashtags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));

  res.json({ users, posts, hashtags });
});

// --- DIRECT MESSAGES ---
app.get('/api/dm/conversations', authMiddleware, (req: AuthRequest, res) => {
  const uid = req.userId!;
  const rows = db
    .prepare(
      `SELECT DISTINCT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as peer_id
       FROM direct_messages
       WHERE (sender_id = ? OR receiver_id = ?) AND deleted_by_sender = 0`
    )
    .all(uid, uid, uid) as { peer_id: string }[];

  const conversations = rows
    .filter((r) => !isBlockedBetween(uid, r.peer_id))
    .map((r) => {
      const peer = sanitizeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.peer_id));
      const lastMsg = db
        .prepare(
          `SELECT * FROM direct_messages
           WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
             AND deleted_by_sender = 0
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(uid, r.peer_id, r.peer_id, uid);
      const unreadCount = (
        db
          .prepare('SELECT COUNT(*) as c FROM direct_messages WHERE sender_id = ? AND receiver_id = ? AND is_read = 0 AND deleted_by_sender = 0')
          .get(r.peer_id, uid) as any
      ).c;
      return { peer, lastMessage: lastMsg, unreadCount };
    })
    .filter((c) => c.peer !== null);

  res.json({ conversations });
});

app.get('/api/dm/:peerId', authMiddleware, (req: AuthRequest, res) => {
  const uid = req.userId!;
  const peerId = req.params.peerId;
  if (isBlockedBetween(uid, peerId)) {
    res.status(403).json({ error: 'Bu kullanıcı ile mesajlaşma engellenmiştir.' });
    return;
  }
  const peer = sanitizeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(peerId));
  if (!peer) {
    res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    return;
  }
  // Mark incoming messages as read
  const updated = db
    .prepare('UPDATE direct_messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 0')
    .run(peerId, uid);
  if (updated.changes > 0) {
    sendToUser(peerId, 'dm:read', { readerId: uid });
  }
  const messages = db
    .prepare(
      `SELECT * FROM direct_messages
       WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
         AND deleted_by_sender = 0
       ORDER BY created_at ASC LIMIT 200`
    )
    .all(uid, peerId, peerId, uid);
  res.json({ peer, messages });
});

app.post('/api/dm/:peerId', authMiddleware, (req: AuthRequest, res) => {
  const uid = req.userId!;
  const peerId = req.params.peerId;
  if (isBlockedBetween(uid, peerId)) {
    res.status(403).json({ error: 'Engellenmiş kullanıcıya mesaj gönderilemez.' });
    return;
  }
  const content = String(req.body.content || '').trim();
  const mediaUrl = String(req.body.mediaUrl || '');
  const mediaType = String(req.body.mediaType || 'none');
  if (!content && !mediaUrl) {
    res.status(400).json({ error: 'Mesaj içeriği boş olamaz.' });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO direct_messages (id, sender_id, receiver_id, content, media_url, media_type, is_read, deleted_by_sender, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)'
  ).run(id, uid, peerId, content, mediaUrl, mediaType, now);

  const message = db.prepare('SELECT * FROM direct_messages WHERE id = ?').get(id);
  sendToUser(peerId, 'dm:new', { message });
  sendToUser(uid, 'dm:new', { message });
  res.status(201).json({ message });
});

app.delete('/api/dm/message/:msgId', authMiddleware, (req: AuthRequest, res) => {
  const msg = db.prepare('SELECT * FROM direct_messages WHERE id = ?').get(req.params.msgId) as any;
  if (!msg) {
    res.status(404).json({ error: 'Mesaj bulunamadı.' });
    return;
  }
  if (msg.sender_id !== req.userId) {
    res.status(403).json({ error: 'Yalnızca kendi mesajınızı silebilirsiniz.' });
    return;
  }
  db.prepare('UPDATE direct_messages SET deleted_by_sender = 1 WHERE id = ?').run(msg.id);
  sendToUser(msg.receiver_id, 'dm:deleted', { messageId: msg.id });
  sendToUser(msg.sender_id, 'dm:deleted', { messageId: msg.id });
  res.json({ ok: true });
});

// --- GROUPS ---
app.get('/api/groups', authMiddleware, (req: AuthRequest, res) => {
  const rows = db
    .prepare(
      `SELECT g.*,
              (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as membersCount,
              (SELECT role FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = ?) as myRole
       FROM groups g
       ORDER BY g.created_at DESC`
    )
    .all(req.userId);
  res.json({ groups: rows });
});

app.post('/api/groups', authMiddleware, (req: AuthRequest, res) => {
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  const avatarUrl = String(req.body.avatarUrl || '');
  const memberIds: string[] = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];

  if (name.length < 2) {
    res.status(400).json({ error: 'Grup adı en az 2 karakter olmalıdır.' });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO groups (id, name, description, avatar_url, creator_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    name,
    description,
    avatarUrl,
    req.userId,
    now
  );
  db.prepare("INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)").run(id, req.userId, now);
  memberIds.forEach((mId) => {
    if (mId !== req.userId) {
      db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(
        id,
        mId,
        now
      );
    }
  });
  const group = db
    .prepare("SELECT g.*, (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as membersCount, 'admin' as myRole FROM groups g WHERE g.id = ?")
    .get(id);
  broadcastAll('group:updated', { group });
  res.status(201).json({ group });
});

app.get('/api/groups/:id', authMiddleware, (req: AuthRequest, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id) as any;
  if (!group) {
    res.status(404).json({ error: 'Grup bulunamadı.' });
    return;
  }
  const members = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, gm.role, gm.joined_at
       FROM group_members gm JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = ? ORDER BY gm.role ASC, gm.joined_at ASC`
    )
    .all(req.params.id);
  const myMember = members.find((m: any) => m.id === req.userId) as any;
  res.json({ group, members, myRole: myMember?.role || null });
});

app.post('/api/groups/:id/join', authMiddleware, (req: AuthRequest, res) => {
  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(req.params.id);
  if (!group) {
    res.status(404).json({ error: 'Grup bulunamadı.' });
    return;
  }
  db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(
    req.params.id,
    req.userId,
    new Date().toISOString()
  );
  res.json({ joined: true });
});

app.post('/api/groups/:id/members', authMiddleware, (req: AuthRequest, res) => {
  const me = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?').get(req.params.id, req.userId) as any;
  if (!me || me.role !== 'admin') {
    res.status(403).json({ error: 'Üye veya yönetici eklemek için grup yöneticisi olmalısınız.' });
    return;
  }
  const targetUserId = String(req.body.userId || '');
  const role = req.body.role === 'admin' ? 'admin' : 'member';
  const exists = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(req.params.id, targetUserId);
  if (exists) {
    db.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?').run(role, req.params.id, targetUserId);
  } else {
    db.prepare('INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
      req.params.id,
      targetUserId,
      role,
      new Date().toISOString()
    );
  }
  res.json({ ok: true });
});

app.patch('/api/groups/:id', authMiddleware, (req: AuthRequest, res) => {
  const me = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?').get(req.params.id, req.userId) as any;
  if (!me || me.role !== 'admin') {
    res.status(403).json({ error: 'Grup ayarlarını yalnızca yöneticiler düzenleyebilir.' });
    return;
  }
  const current = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id) as any;
  const name = req.body.name !== undefined ? String(req.body.name).trim() : current.name;
  const description = req.body.description !== undefined ? String(req.body.description).trim() : current.description;
  const avatarUrl = req.body.avatarUrl !== undefined ? String(req.body.avatarUrl) : current.avatar_url;
  db.prepare('UPDATE groups SET name = ?, description = ?, avatar_url = ? WHERE id = ?').run(name, description, avatarUrl, req.params.id);
  res.json({ ok: true });
});

app.get('/api/groups/:id/messages', authMiddleware, (req: AuthRequest, res) => {
  const member = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!member) {
    res.status(403).json({ error: 'Mesajları görmek için gruba katılmalısınız.' });
    return;
  }
  const messages = db
    .prepare(
      `SELECT gm.*, u.username, u.display_name, u.avatar_url
       FROM group_messages gm JOIN users u ON gm.sender_id = u.id
       WHERE gm.group_id = ? ORDER BY gm.created_at ASC LIMIT 200`
    )
    .all(req.params.id);
  res.json({ messages });
});

app.post('/api/groups/:id/messages', authMiddleware, (req: AuthRequest, res) => {
  const member = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!member) {
    res.status(403).json({ error: 'Mesaj göndermek için gruba katılmalısınız.' });
    return;
  }
  const content = String(req.body.content || '').trim();
  const mediaUrl = String(req.body.mediaUrl || '');
  const mediaType = String(req.body.mediaType || 'none');
  if (!content && !mediaUrl) {
    res.status(400).json({ error: 'Mesaj boş olamaz.' });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO group_messages (id, group_id, sender_id, content, media_url, media_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    req.params.id,
    req.userId,
    content,
    mediaUrl,
    mediaType,
    now
  );
  const message = db
    .prepare(
      `SELECT gm.*, u.username, u.display_name, u.avatar_url
       FROM group_messages gm JOIN users u ON gm.sender_id = u.id WHERE gm.id = ?`
    )
    .get(id);
  const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(req.params.id) as { user_id: string }[];
  members.forEach((m) => sendToUser(m.user_id, 'group:message', { groupId: req.params.id, message }));
  res.status(201).json({ message });
});

// --- CHANNELS ---
app.get('/api/channels', optionalAuth, (req: AuthRequest, res) => {
  const uid = req.userId || '';
  const channels = db
    .prepare(
      `SELECT c.*, u.username as owner_username, u.display_name as owner_display_name,
              (SELECT COUNT(*) FROM channel_followers cf WHERE cf.channel_id = c.id) as followersCount,
              EXISTS(SELECT 1 FROM channel_followers cf WHERE cf.channel_id = c.id AND cf.user_id = ?) as isFollowing
       FROM channels c JOIN users u ON c.owner_id = u.id
       ORDER BY c.created_at DESC`
    )
    .all(uid);
  res.json({ channels });
});

app.post('/api/channels', authMiddleware, (req: AuthRequest, res) => {
  const name = String(req.body.name || '').trim();
  const handle = String(req.body.handle || name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  const description = String(req.body.description || '').trim();
  const avatarUrl = String(req.body.avatarUrl || '');
  const commentsEnabled = req.body.commentsEnabled !== false ? 1 : 0;

  if (name.length < 2 || handle.length < 2) {
    res.status(400).json({ error: 'Kanal adı ve kısa adı en az 2 karakter olmalıdır.' });
    return;
  }
  const taken = db.prepare('SELECT id FROM channels WHERE handle = ?').get(handle);
  if (taken) {
    res.status(409).json({ error: 'Bu kanal kısa adı zaten kullanılıyor.' });
    return;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO channels (id, name, handle, description, avatar_url, owner_id, comments_enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, name, handle, description, avatarUrl, req.userId, commentsEnabled, now);
  db.prepare('INSERT INTO channel_followers (channel_id, user_id, joined_at) VALUES (?, ?, ?)').run(id, req.userId, now);

  const channel = db
    .prepare(
      `SELECT c.*, u.username as owner_username, u.display_name as owner_display_name,
              1 as followersCount, 1 as isFollowing
       FROM channels c JOIN users u ON c.owner_id = u.id WHERE c.id = ?`
    )
    .get(id);
  broadcastAll('channel:created', { channel });
  res.status(201).json({ channel });
});

app.post('/api/channels/:id/follow', authMiddleware, (req: AuthRequest, res) => {
  const existing = db.prepare('SELECT 1 FROM channel_followers WHERE channel_id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (existing) {
    db.prepare('DELETE FROM channel_followers WHERE channel_id = ? AND user_id = ?').run(req.params.id, req.userId);
  } else {
    db.prepare('INSERT INTO channel_followers (channel_id, user_id, joined_at) VALUES (?, ?, ?)').run(
      req.params.id,
      req.userId,
      new Date().toISOString()
    );
  }
  const followersCount = (db.prepare('SELECT COUNT(*) as c FROM channel_followers WHERE channel_id = ?').get(req.params.id) as any).c;
  res.json({ isFollowing: !existing, followersCount });
});

app.patch('/api/channels/:id', authMiddleware, (req: AuthRequest, res) => {
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id) as any;
  if (!ch || ch.owner_id !== req.userId) {
    res.status(403).json({ error: 'Yalnızca kanal yöneticisi düzenleyebilir.' });
    return;
  }
  const commentsEnabled = req.body.commentsEnabled !== undefined ? (req.body.commentsEnabled ? 1 : 0) : ch.comments_enabled;
  db.prepare('UPDATE channels SET comments_enabled = ? WHERE id = ?').run(commentsEnabled, req.params.id);
  res.json({ ok: true, comments_enabled: commentsEnabled });
});

app.get('/api/channels/:id/posts', optionalAuth, (req: AuthRequest, res) => {
  const posts = db
    .prepare(
      `SELECT cp.*, u.username as author_username, u.display_name as author_display_name, u.avatar_url as author_avatar_url,
              (SELECT COUNT(*) FROM channel_comments cc WHERE cc.channel_post_id = cp.id) as commentsCount
       FROM channel_posts cp JOIN users u ON cp.author_id = u.id
       WHERE cp.channel_id = ? ORDER BY cp.is_announcement DESC, cp.created_at DESC`
    )
    .all(req.params.id);
  res.json({ posts });
});

app.post('/api/channels/:id/posts', authMiddleware, (req: AuthRequest, res) => {
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id) as any;
  if (!ch || ch.owner_id !== req.userId) {
    res.status(403).json({ error: 'Yalnızca kanal yöneticisi gönderi paylaşabilir.' });
    return;
  }
  const content = String(req.body.content || '').trim();
  const mediaUrl = String(req.body.mediaUrl || '');
  const mediaType = String(req.body.mediaType || 'none');
  const isAnnouncement = req.body.isAnnouncement ? 1 : 0;

  if (!content && !mediaUrl) {
    res.status(400).json({ error: 'Gönderi içeriği boş olamaz.' });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO channel_posts (id, channel_id, author_id, content, media_url, media_type, is_announcement, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, req.params.id, req.userId, content, mediaUrl, mediaType, isAnnouncement, now);

  const post = db
    .prepare(
      `SELECT cp.*, u.username as author_username, u.display_name as author_display_name, u.avatar_url as author_avatar_url,
              0 as commentsCount
       FROM channel_posts cp JOIN users u ON cp.author_id = u.id WHERE cp.id = ?`
    )
    .get(id);
  broadcastAll('channel:post', { channelId: req.params.id, post });
  res.status(201).json({ post });
});

app.get('/api/channels/posts/:postId/comments', (_req, res) => {
  const comments = db
    .prepare(
      `SELECT cc.*, u.username, u.display_name, u.avatar_url
       FROM channel_comments cc JOIN users u ON cc.user_id = u.id
       WHERE cc.channel_post_id = ? ORDER BY cc.created_at ASC`
    )
    .all(_req.params.postId);
  res.json({ comments });
});

app.post('/api/channels/posts/:postId/comments', authMiddleware, (req: AuthRequest, res) => {
  const cp = db
    .prepare('SELECT cp.*, c.comments_enabled FROM channel_posts cp JOIN channels c ON cp.channel_id = c.id WHERE cp.id = ?')
    .get(req.params.postId) as any;
  if (!cp) {
    res.status(404).json({ error: 'Gönderi bulunamadı.' });
    return;
  }
  if (!cp.comments_enabled) {
    res.status(403).json({ error: 'Bu kanalda yorumlar kapatılmıştır.' });
    return;
  }
  const content = String(req.body.content || '').trim();
  if (!content) {
    res.status(400).json({ error: 'Yorum boş olamaz.' });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO channel_comments (id, channel_post_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    req.params.postId,
    req.userId,
    content,
    now
  );
  const comment = db
    .prepare('SELECT cc.*, u.username, u.display_name, u.avatar_url FROM channel_comments cc JOIN users u ON cc.user_id = u.id WHERE cc.id = ?')
    .get(id);
  broadcastAll('channel:comment', { postId: req.params.postId, comment });
  res.status(201).json({ comment });
});

// --- LIVE STREAMS & LIVEKIT TOKEN ---
app.get('/api/live', optionalAuth, (_req, res) => {
  const streams = db
    .prepare(
      `SELECT l.*, u.username as host_username, u.display_name as host_display_name, u.avatar_url as host_avatar_url
       FROM live_streams l JOIN users u ON l.host_id = u.id
       WHERE l.status = 'live' ORDER BY l.started_at DESC`
    )
    .all()
    .map((s: any) => ({
      ...s,
      viewerCount: liveRooms.get(s.id)?.size || 0,
    }));
  res.json({ streams });
});

app.post('/api/live/start', authMiddleware, (req: AuthRequest, res) => {
  const title = String(req.body.title || '').trim() || 'Canlı Yayın';
  // End any previous active stream by this host
  db.prepare("UPDATE live_streams SET status = 'ended', ended_at = ? WHERE host_id = ? AND status = 'live'").run(
    new Date().toISOString(),
    req.userId
  );

  const id = crypto.randomUUID();
  const roomName = `vyra-live-${id.slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare("INSERT INTO live_streams (id, host_id, title, status, room_name, started_at) VALUES (?, ?, ?, 'live', ?, ?)").run(
    id,
    req.userId,
    title,
    roomName,
    now
  );
  const stream = db
    .prepare(
      `SELECT l.*, u.username as host_username, u.display_name as host_display_name, u.avatar_url as host_avatar_url
       FROM live_streams l JOIN users u ON l.host_id = u.id WHERE l.id = ?`
    )
    .get(id);
  broadcastAll('live:started', { stream: { ...(stream as any), viewerCount: 1 } });
  res.status(201).json({ stream });
});

app.post('/api/live/:id/end', authMiddleware, (req: AuthRequest, res) => {
  const stream = db.prepare('SELECT * FROM live_streams WHERE id = ?').get(req.params.id) as any;
  if (!stream || stream.host_id !== req.userId) {
    res.status(403).json({ error: 'Yalnızca yayıncı yayını sonlandırabilir.' });
    return;
  }
  db.prepare("UPDATE live_streams SET status = 'ended', ended_at = ? WHERE id = ?").run(new Date().toISOString(), req.params.id);
  broadcastToLiveRoom(req.params.id, 'live:ended', { streamId: req.params.id });
  broadcastAll('live:ended', { streamId: req.params.id });
  liveRooms.delete(req.params.id);
  res.json({ ok: true });
});

app.get('/api/live/:id/chat', (_req, res) => {
  const messages = db
    .prepare(
      `SELECT lc.*, u.username, u.display_name, u.avatar_url
       FROM live_chat_messages lc JOIN users u ON lc.user_id = u.id
       WHERE lc.stream_id = ? ORDER BY lc.created_at ASC LIMIT 100`
    )
    .all(_req.params.id);
  res.json({ messages });
});

app.post('/api/live/:id/chat', authMiddleware, (req: AuthRequest, res) => {
  const content = String(req.body.content || '').trim();
  if (!content) {
    res.status(400).json({ error: 'Mesaj boş olamaz.' });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO live_chat_messages (id, stream_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    req.params.id,
    req.userId,
    content.slice(0, 400),
    now
  );
  const message = db
    .prepare('SELECT lc.*, u.username, u.display_name, u.avatar_url FROM live_chat_messages lc JOIN users u ON lc.user_id = u.id WHERE lc.id = ?')
    .get(id);
  broadcastToLiveRoom(req.params.id, 'live:chat', { streamId: req.params.id, message });
  res.status(201).json({ message });
});

app.post('/api/live/:id/invite-guest', authMiddleware, (req: AuthRequest, res) => {
  const stream = db.prepare('SELECT * FROM live_streams WHERE id = ?').get(req.params.id) as any;
  if (!stream || stream.host_id !== req.userId) {
    res.status(403).json({ error: 'Yalnızca yayıncı konuk davet edebilir.' });
    return;
  }
  const guestUsername = String(req.body.username || '').trim().toLowerCase();
  const guest = db.prepare('SELECT id, username, display_name FROM users WHERE username = ?').get(guestUsername) as any;
  if (!guest) {
    res.status(404).json({ error: 'Davet edilecek kullanıcı bulunamadı.' });
    return;
  }
  db.prepare('UPDATE live_streams SET guest_id = ? WHERE id = ?').run(guest.id, stream.id);
  sendToUser(guest.id, 'live:guest-invite', { streamId: stream.id, title: stream.title, hostId: req.userId });
  res.json({ ok: true, guest });
});

app.post('/api/livekit/token', authMiddleware, async (req: AuthRequest, res) => {
  const roomName = String(req.body.roomName || '');
  const isHost = Boolean(req.body.isHost);
  const lkUrl = process.env.LIVEKIT_URL;
  const lkKey = process.env.LIVEKIT_API_KEY;
  const lkSecret = process.env.LIVEKIT_API_SECRET;

  if (!lkUrl || !lkKey || !lkSecret || lkKey === 'MY_LIVEKIT_API_KEY') {
    res.json({ configured: false, mode: 'webrtc-ws-mesh' });
    return;
  }

  try {
    const user = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(req.userId) as any;
    const at = new AccessToken(lkKey, lkSecret, {
      identity: user.id,
      name: user.display_name || user.username,
      ttl: '2h',
    });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: isHost,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();
    res.json({ configured: true, mode: 'livekit', url: lkUrl, token });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'LiveKit token üretilemedi.' });
  }
});

// --- SETUP VITE OR PROD STATIC ---
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`VYRA sunucusu http://0.0.0.0:${PORT} adresinde çalışıyor`);
  });
}

startServer();
