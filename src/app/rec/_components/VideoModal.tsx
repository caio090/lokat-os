"use client";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import MuxPlayer, { type MuxCSSProperties } from "@mux/mux-player-react";
import type { RecVideo } from "@/lib/rec-videos";
import { R } from "../_lib/tokens";

export function VideoModal({ video, onClose }: { video: RecVideo; onClose: () => void }) {
  const isMux     = video.provider === "mux" && Boolean(video.playbackId);
  const isYoutube = video.provider === "youtube" && Boolean(video.youtubeId);
  const isNativeVideo = !isMux && !isYoutube;
  const ref       = useRef<HTMLVideoElement>(null);
  const [muted,   setMuted]   = useState(false);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (isNativeVideo && video.video_url) ref.current?.play().catch(() => undefined);
  }, [isNativeVideo, video.video_url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const togglePlay = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) { el.play().catch(() => undefined); setPlaying(true); }
    else           { el.pause(); setPlaying(false); }
  };

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={video.title}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(4,3,2,0.97)", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "980px", position: "relative" }}>

        {isMux ? (
          <MuxPlayer
            playbackId={video.playbackId as string}
            streamType="on-demand"
            autoPlay
            playsInline
            style={{
              width: "100%", display: "block", maxHeight: "82vh",
              "--media-object-fit": "contain",
            } as MuxCSSProperties}
          />
        ) : isYoutube ? (
          <iframe
            src={`https://www.youtube.com/embed/${video.youtubeId}?autoplay=1&rel=0&modestbranding=1&color=white`}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ width: "100%", aspectRatio: "16/9", maxHeight: "82vh", border: "none", display: "block" }}
          />
        ) : video.video_url ? (
          <video ref={ref} src={video.video_url} muted={muted} loop playsInline preload="metadata" controls={false}
            style={{ width: "100%", display: "block", background: "#000", maxHeight: "82vh", objectFit: "contain" }}
            onError={(e) => {
              e.currentTarget.style.display = "none";
              const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
              if (fallback) fallback.style.display = "flex";
            }} />
        ) : null}
        {isNativeVideo && (
          <div style={{ width: "100%", aspectRatio: "16/9", background: "#100c08", display: video.video_url ? "none" : "flex", alignItems: "center", justifyContent: "center" }}>
            <p style={{ ...R.mono, fontSize: ".62rem", letterSpacing: ".18em", textTransform: "uppercase", color: R.muted }}>Vídeo indisponível</p>
          </div>
        )}

        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "2px", background: `linear-gradient(to right, ${R.red}, transparent)` }} />

        {isNativeVideo && video.video_url && (
          <div style={{ position: "absolute", bottom: ".75rem", left: ".75rem", display: "flex", gap: ".4rem" }}>
            <button type="button" onClick={togglePlay} aria-label={playing ? "Pausar" : "Reproduzir"} style={{ width: "36px", height: "36px", background: "rgba(8,7,6,0.85)", border: `1px solid ${R.border}`, color: R.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              {playing ? <Pause style={{ width: "14px" }} /> : <Play style={{ width: "14px" }} />}
            </button>
            <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Ativar som" : "Silenciar"} style={{ width: "36px", height: "36px", background: "rgba(8,7,6,0.85)", border: `1px solid ${R.border}`, color: R.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              {muted ? <VolumeX style={{ width: "12px" }} /> : <Volume2 style={{ width: "12px" }} />}
            </button>
          </div>
        )}

        <div style={{ position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: ".7rem" }}>
          <div style={{ display: "flex", gap: "1rem", alignItems: "baseline", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: "1rem", alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ ...R.mono, fontSize: ".5rem", letterSpacing: ".16em", color: R.red }}>● REC</span>
              {video.category && <span style={{ ...R.mono, fontSize: ".5rem", letterSpacing: ".16em", textTransform: "uppercase", color: R.muted }}>{video.category}</span>}
              <span style={{ ...R.grotesk, fontSize: ".9rem", fontWeight: 700, color: R.text }}>{video.title}</span>
              {video.client_name && <span style={{ ...R.mono, fontSize: ".44rem", color: R.muted }}>{video.client_name}</span>}
            </div>
            <button type="button" onClick={onClose} style={{ ...R.mono, fontSize: ".5rem", letterSpacing: ".14em", textTransform: "uppercase", color: R.muted, background: "none", border: "none", cursor: "pointer", flexShrink: 0 }}>✕ fechar</button>
          </div>
          {video.description && (
            <p style={{ ...R.grotesk, fontSize: ".7rem", lineHeight: 1.4, color: R.muted, marginTop: ".35rem", maxWidth: "520px" }}>
              {video.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
