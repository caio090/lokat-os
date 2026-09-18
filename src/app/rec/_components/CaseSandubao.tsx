"use client";
import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import type { RecVideo } from "@/lib/rec-videos";
import { R } from "../_lib/tokens";

export function CaseSandubao({ video, isMobile }: { video: RecVideo | null; isMobile: boolean }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const videoRef   = useRef<HTMLVideoElement>(null);
  const isInView   = useInView(sectionRef, { once: true, amount: 0.15 });
  const [showCover, setShowCover] = useState(true);
  const [playing,   setPlaying]   = useState(false);
  const [muted,     setMuted]     = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (!e.isIntersecting) { el.pause(); setPlaying(false); } }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const handlePlay = () => {
    setShowCover(false);
    setPlaying(true);
    setTimeout(() => videoRef.current?.play().catch(() => undefined), 50);
  };

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) { el.play().catch(() => undefined); setPlaying(true); }
    else           { el.pause(); setPlaying(false); }
  };

  return (
    <section ref={sectionRef} style={{ position: "relative", padding: isMobile ? "4rem 0" : "7rem 0" }}>
      <div style={{ maxWidth: "1300px", margin: "0 auto", padding: "0 2rem" }}>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: .7, ease: [0.16, 1, 0.3, 1] }}
          style={{ ...R.mono, fontSize: ".54rem", letterSpacing: ".2em", textTransform: "uppercase", color: R.red, marginBottom: ".8rem" }}
        >
          [Case real]
        </motion.p>
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: .7, delay: .05, ease: [0.16, 1, 0.3, 1] }}
          style={{ ...R.display, fontSize: "clamp(2.2rem,5vw,3.6rem)", fontWeight: 600, color: R.text, lineHeight: .98, marginBottom: "2.5rem" }}
        >
          Sandubão.
        </motion.h2>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0,52%) 1fr", gap: isMobile ? "2rem" : "4rem", alignItems: "center" }}>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: .9, delay: .1, ease: [0.16, 1, 0.3, 1] }}
            style={{ position: "relative" }}
          >
            {video?.video_url ? (
              <>
                {showCover && (
                  <div
                    onClick={handlePlay}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handlePlay(); } }}
                    aria-label="Assistir depoimento do Sandubão"
                    style={{ position: "absolute", inset: 0, zIndex: 4, cursor: "pointer", overflow: "hidden" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/rec/posters/sandubao-poster.webp" alt="Depoimento em vídeo — Sandubão" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(6,5,4,0.15) 0%, rgba(6,5,4,0.45) 100%)" }} />
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <div style={{ width: "76px", height: "76px", border: `1.5px solid ${R.text}`, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(8,7,6,0.55)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
                        <Play style={{ width: "26px", height: "26px", color: R.text, marginLeft: "3px" }} strokeWidth={1.5} fill={R.text} />
                      </div>
                    </div>
                  </div>
                )}

                <video ref={videoRef} src={video.video_url} muted={muted} playsInline preload="metadata" poster="/rec/posters/sandubao-poster.webp"
                  style={{ width: "100%", display: "block", background: R.bg, aspectRatio: "9/16", objectFit: "cover" }} />

                {!playing && !showCover && (
                  <div onClick={togglePlay} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(6,5,4,0.45)", cursor: "pointer", zIndex: 3 }}>
                    <div style={{ width: "54px", height: "54px", border: `1px solid ${R.red}80`, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Play style={{ width: "20px", height: "20px", color: R.red, marginLeft: "2px" }} strokeWidth={1.5} />
                    </div>
                  </div>
                )}
                {!showCover && (
                  <div style={{ position: "absolute", bottom: ".9rem", left: ".9rem", display: "flex", gap: ".4rem", zIndex: 3 }}>
                    <button type="button" onClick={togglePlay} aria-label={playing ? "Pausar" : "Reproduzir"} style={{ width: "32px", height: "32px", background: "rgba(6,5,4,0.8)", border: `1px solid ${R.border}`, color: R.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                      {playing ? <Pause style={{ width: "12px" }} /> : <Play style={{ width: "12px" }} />}
                    </button>
                    <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Ativar som" : "Silenciar"} style={{ width: "32px", height: "32px", background: "rgba(6,5,4,0.8)", border: `1px solid ${R.border}`, color: R.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                      {muted ? <VolumeX style={{ width: "12px" }} /> : <Volume2 style={{ width: "12px" }} />}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div style={{ width: "100%", aspectRatio: "9/16", background: R.warm, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <p style={{ ...R.mono, fontSize: ".5rem", letterSpacing: ".14em", textTransform: "uppercase", color: R.muted }}>Vídeo indisponível</p>
              </div>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: .9, delay: .25, ease: [0.16, 1, 0.3, 1] }}
          >
            <p style={{ ...R.grotesk, fontSize: "1rem", fontWeight: 500, lineHeight: 1.6, color: R.text, marginBottom: "2rem", maxWidth: "420px" }}>
              Cliente falando vale mais que promessa. A marca voltou a vender com clareza, sem parecer recomeço forçado.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: ".7rem" }}>
              {[
                ["Cliente",   "Sandubão"],
                ["Nicho",     "Hamburgueria · Floriano — PI"],
                ["Serviço",   "Remarketing · Posicionamento · Criativos"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: ".9rem", alignItems: "baseline", borderTop: `1px solid ${R.border}`, paddingTop: ".6rem" }}>
                  <span style={{ ...R.mono, fontSize: ".42rem", letterSpacing: ".14em", textTransform: "uppercase", color: R.muted, minWidth: "72px" }}>{k}</span>
                  <span style={{ ...R.grotesk, fontSize: ".84rem", fontWeight: 600, color: R.text }}>{v}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
