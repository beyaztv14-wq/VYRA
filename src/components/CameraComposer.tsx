import React, { useEffect, useRef, useState } from 'react';
import { Camera, Video, RefreshCw, Image as ImageIcon, X, Check, Circle, Square } from 'lucide-react';
import { apiFetch, uploadMediaFile } from '../api';
import type { Post } from '../types';

interface CameraComposerProps {
  initialShotMode?: boolean;
  onClose: () => void;
  onCreated: (post: Post) => void;
}

export const CameraComposer: React.FC<CameraComposerProps> = ({
  initialShotMode = false,
  onClose,
  onCreated,
}) => {
  const [sourceMode, setSourceMode] = useState<'camera' | 'gallery'>('camera');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isShot, setIsShot] = useState(initialShotMode);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [caption, setCaption] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [previewBlob, setPreviewBlob] = useState<{ blob: Blob; url: string; type: 'image' | 'video'; name: string } | null>(null);
  const [publishing, setPublishing] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startCamera = async (facing: 'environment' | 'user') => {
    stopCamera();
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1080 }, height: { ideal: 1920 } },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch {
      setCameraError('Kamera veya mikrofon izni alınamadı. Galeriden fotoğraf/video seçebilir veya yalnızca metin paylaşabilirsiniz.');
    }
  };

  useEffect(() => {
    if (sourceMode === 'camera' && !previewBlob) {
      startCamera(facingMode);
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [sourceMode, facingMode, previewBlob]);

  const flipCamera = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  const takePhoto = () => {
    const vid = videoRef.current;
    if (!vid || !vid.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = vid.videoWidth;
    canvas.height = vid.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        setPreviewBlob({ blob, url, type: 'image', name: `vyra-photo-${Date.now()}.jpg` });
        setIsShot(false);
        stopCamera();
      },
      'image/jpeg',
      0.9
    );
  };

  const startRecording = () => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : MediaRecorder.isTypeSupported('video/mp4')
      ? 'video/mp4'
      : '';
    const recorder = mimeType
      ? new MediaRecorder(streamRef.current, { mimeType })
      : new MediaRecorder(streamRef.current);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const finalType = recorder.mimeType || 'video/webm';
      const blob = new Blob(chunksRef.current, { type: finalType });
      const url = URL.createObjectURL(blob);
      const ext = finalType.includes('mp4') ? 'mp4' : 'webm';
      setPreviewBlob({ blob, url, type: 'video', name: `vyra-video-${Date.now()}.${ext}` });
      stopCamera();
    };

    recorderRef.current = recorder;
    recorder.start(250);
    setRecording(true);
    setRecordSeconds(0);
    timerRef.current = window.setInterval(() => {
      setRecordSeconds((s) => s + 1);
    }, 1000);
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    setRecording(false);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isVideo = file.type.startsWith('video/');
    const url = URL.createObjectURL(file);
    setPreviewBlob({
      blob: file,
      url,
      type: isVideo ? 'video' : 'image',
      name: file.name,
    });
    if (!isVideo) setIsShot(false);
  };

  const handlePublish = async () => {
    if (!previewBlob && !caption.trim()) return;
    if (isShot && previewBlob?.type !== 'video') return;
    setPublishing(true);
    try {
      let mediaUrl = '';
      let mediaType: 'image' | 'video' | 'none' = 'none';
      if (previewBlob) {
        const uploaded = await uploadMediaFile(previewBlob.blob, previewBlob.name);
        mediaUrl = uploaded.url;
        mediaType = uploaded.mediaType;
      }
      const res = await apiFetch<{ post: Post }>('/api/posts', {
        method: 'POST',
        body: JSON.stringify({ caption, mediaUrl, mediaType, isShot }),
      });
      onCreated(res.post);
      onClose();
    } catch (err: any) {
      setCameraError(err.message || 'Paylaşım başarısız.');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-lg h-[92vh] sm:h-auto sm:max-h-[90vh] bg-white dark:bg-[#15171E] sm:rounded-3xl rounded-t-3xl border border-zinc-200 dark:border-[#232631] flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-[#232631] flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center text-zinc-600 dark:text-zinc-300"
            aria-label="Kapat"
          >
            <X className="w-5 h-5" />
          </button>
          <span className="font-display font-semibold text-sm text-zinc-900 dark:text-white">
            Yeni Paylaşım
          </span>
          <button
            type="button"
            onClick={handlePublish}
            disabled={publishing || (!previewBlob && !caption.trim()) || (isShot && previewBlob?.type !== 'video')}
            className="min-h-[40px] px-4 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            <span>{publishing ? 'Yükleniyor...' : 'Paylaş'}</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Format Toggle */}
          <div className="flex items-center gap-2 p-1 rounded-2xl bg-zinc-100 dark:bg-[#0D0E12]">
            <button
              type="button"
              onClick={() => setIsShot(false)}
              className={`flex-1 min-h-[40px] rounded-xl text-xs font-semibold transition-colors ${
                !isShot ? 'bg-white dark:bg-[#1E212B] text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500'
              }`}
            >
              Gönderi (Akış)
            </button>
            <button
              type="button"
              onClick={() => setIsShot(true)}
              className={`flex-1 min-h-[40px] rounded-xl text-xs font-semibold transition-colors ${
                isShot ? 'bg-white dark:bg-[#1E212B] text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500'
              }`}
            >
              VYRA Shot (Kısa Video)
            </button>
          </div>

          {/* Media Viewport */}
          {previewBlob ? (
            <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/5] max-h-[42vh] mx-auto flex items-center justify-center">
              {previewBlob.type === 'video' ? (
                <video src={previewBlob.url} controls playsInline className="w-full h-full object-contain" />
              ) : (
                <img src={previewBlob.url} alt="Önizleme" className="w-full h-full object-contain" />
              )}
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(previewBlob.url);
                  setPreviewBlob(null);
                }}
                className="absolute top-3 right-3 min-w-[40px] min-h-[40px] rounded-full bg-black/70 text-white flex items-center justify-center"
                aria-label="Medyayı kaldır"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSourceMode('camera')}
                  className={`flex-1 min-h-[42px] rounded-xl text-xs font-medium border flex items-center justify-center gap-2 ${
                    sourceMode === 'camera'
                      ? 'border-[#7C3AED] text-[#7C3AED] dark:text-[#A78BFA] bg-[#7C3AED]/5'
                      : 'border-zinc-200 dark:border-[#232631] text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  <Camera className="w-4 h-4" />
                  <span>Kamera</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSourceMode('gallery');
                    fileInputRef.current?.click();
                  }}
                  className={`flex-1 min-h-[42px] rounded-xl text-xs font-medium border flex items-center justify-center gap-2 ${
                    sourceMode === 'gallery'
                      ? 'border-[#7C3AED] text-[#7C3AED] dark:text-[#A78BFA] bg-[#7C3AED]/5'
                      : 'border-zinc-200 dark:border-[#232631] text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  <ImageIcon className="w-4 h-4" />
                  <span>Galeriden Seç</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {sourceMode === 'camera' && (
                <div className="relative rounded-2xl overflow-hidden bg-[#0D0E12] aspect-[4/5] max-h-[38vh] flex items-center justify-center">
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
                  />
                  {cameraError && (
                    <div className="absolute inset-0 bg-black/80 p-6 flex items-center justify-center text-center text-xs text-zinc-300">
                      {cameraError}
                    </div>
                  )}
                  {recording && (
                    <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-red-600 text-white font-mono text-xs tabular-nums">
                      KAYIT · {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, '0')}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={flipCamera}
                    className="absolute top-3 right-3 min-w-[44px] min-h-[44px] rounded-full bg-black/60 text-white flex items-center justify-center"
                    aria-label="Kamerayı çevir"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <div className="absolute bottom-3 inset-x-0 flex items-center justify-center gap-4">
                    {!isShot && !recording && (
                      <button
                        type="button"
                        onClick={takePhoto}
                        className="min-h-[46px] px-4 rounded-full bg-white text-zinc-900 font-semibold text-xs flex items-center gap-2 shadow-lg"
                      >
                        <Camera className="w-4 h-4" />
                        <span>Fotoğraf Çek</span>
                      </button>
                    )}
                    {!recording ? (
                      <button
                        type="button"
                        onClick={startRecording}
                        className="min-h-[46px] px-4 rounded-full bg-[#7C3AED] text-white font-semibold text-xs flex items-center gap-2 shadow-lg"
                      >
                        <Circle className="w-4 h-4 fill-current text-red-400" />
                        <span>Video Kaydet</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={stopRecording}
                        className="min-h-[46px] px-5 rounded-full bg-red-600 text-white font-semibold text-xs flex items-center gap-2 shadow-lg"
                      >
                        <Square className="w-4 h-4 fill-current" />
                        <span>Kaydı Durdur</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {cameraError && previewBlob && (
            <div className="text-xs text-red-500">{cameraError}</div>
          )}

          {isShot && previewBlob?.type !== 'video' && (
            <div className="text-xs text-amber-600 dark:text-amber-400">
              VYRA Shots için lütfen bir video kaydedin veya galeriden video seçin.
            </div>
          )}

          <textarea
            rows={3}
            placeholder="Neler oluyor? Etiket eklemek için #vyra #istanbul yazabilirsiniz..."
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className="w-full p-3.5 rounded-2xl bg-zinc-50 dark:bg-[#0D0E12] border border-zinc-200 dark:border-[#232631] text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-[#7C3AED] resize-none"
          />
        </div>
      </div>
    </div>
  );
};
