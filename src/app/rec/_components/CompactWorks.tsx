"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Play } from "lucide-react";
import type { RecVideo } from "@/lib/rec-videos";
import { R } from "../_lib/tokens";
import { workTypeLabel, yearOf } from "../_lib/data";
import { PreviewMedia } from "./RecMedia";

// Substitui o mecanismo antigo de Selected Work (sticky 100vh + altura em
// (n-1)*85vh + scroll horizontal longo) — era a causa do segundo trecho de
// "scroll morto": o usuário ficava preso rolando na vertical sem nada mudar,
// só pra empurrar o carrossel horizontal por baixo. Aqui não existe nenhum
// pin nem sticky: os cards rolam com o fluxo normal da página (scroll nativo,
// wrap no desktop, faixa horizontal com snap leve no mobile).
export function CompactWorks({ videos, isMobile, onOpen, kicker, heading }: {
  videos: RecVideo[];
  isMobile: boolean;
  onOpen: (video: RecVideo) => void;
  kicker: string;
  heading: string;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(t);
  }, []);

  if (videos.length === 0) return null;

  return (
    <section style={{ padding: isMobile ? "3rem 0" : "4.5rem 0" }}>
      <div style={{ maxWidth: "1300px", margin: "0 auto", padding: "0 2rem" }}>
        <p style={{ ...R.mono, fontSize: ".54rem", letterSpacing: ".2em", textTransform: "uppercase", color: R.red, marginBottom: ".4rem" }}>{kicker}</p>
        <h2 style={{ ...R.display, fontSize: "clamp(1.6rem,3.4vw,2.3rem)", fontWeight: 600, color: R.text, lineHeight: 1.0, marginBottom: "1.6rem" }}>{heading}</h2>

        <div
          style={{
            display: "flex",
            gap: isMobile ? "1rem" : "1.4rem",
            overflowX: isMobile ? "auto" : "visible",
            flexWrap: isMobile ? "nowrap" : "wrap",
            scrollSnapType: isMobile ? "x proximity" : "none",
            paddingBottom: isMobile ? ".3rem" : 0,
            WebkitOverflowScrolling: "touch",
          }}
        >
          {videos.map((video, i) => (
            <motion.div
              key={video.id}
              initial={{ opacity: 0, y: 16 }}
              animate={mounted ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: .5, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
              style={{
                flex: isMobile ? "0 0 68vw" : "0 1 290px",
                scrollSnapAlign: isMobile ? "start" : undefined,
              }}
            >
              <CompactCard video={video} onOpen={() => onOpen(video)} />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CompactCard({ video, onOpen }: { video: RecVideo; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [failed, setFailed] = useState(false);
  const year = yearOf(video);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      aria-label={`Assistir ${video.title}${video.client_name ? ` — ${video.client_name}` : ""}`}
      style={{ cursor: "pointer" }}
    >
      <div ref={ref} style={{ position: "relative", aspectRatio: "16/9", overflow: "hidden", background: R.warm }}>
        {video.video_url && !failed ? (
          <PreviewMedia video={video} shouldPlay={inView} onError={() => setFailed(true)} />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Play style={{ width: "18px", height: "18px", color: R.muted, opacity: .3 }} strokeWidth={1} />
          </div>
        )}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(6,5,4,0) 55%, rgba(6,5,4,0.72) 100%)", pointerEvents: "none" }} />
      </div>
      <p style={{ ...R.mono, fontSize: ".42rem", letterSpacing: ".14em", textTransform: "uppercase", color: R.muted, marginTop: ".55rem" }}>
        {video.client_name ?? "LOKAT.REC"} · {workTypeLabel(video.workType)}{year ? ` · ${year}` : ""}
      </p>
      <p style={{ ...R.grotesk, fontSize: ".82rem", fontWeight: 600, color: R.text, marginTop: ".15rem", lineHeight: 1.25 }}>
        {video.title}
      </p>
    </div>
  );
}
