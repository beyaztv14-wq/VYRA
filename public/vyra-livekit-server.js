// VYRA — Güvenli LiveKit Token Sunucusu (Node.js + Express)
// API anahtarları asla HTML dosyasına yazılmaz; yalnızca bu sunucuda ortam değişkenlerinden okunur.
// Kurulum: npm install express cors dotenv livekit-server-sdk @supabase/supabase-js

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { AccessToken } from 'livekit-server-sdk';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.post('/api/livekit/token', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return res.status(401).json({ error: 'Yetkisiz istek' });

    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: 'Geçersiz Supabase oturumu' });
    }

    const { roomName, isHost } = req.body;
    if (!roomName) return res.status(400).json({ error: 'roomName gerekli' });

    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      {
        identity: userData.user.id,
        name: userData.user.user_metadata?.username || userData.user.id,
        ttl: '2h',
      }
    );

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: Boolean(isHost),
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    res.json({ url: process.env.LIVEKIT_URL, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`VYRA LiveKit Token Sunucusu ${port} portunda çalışıyor`);
});
