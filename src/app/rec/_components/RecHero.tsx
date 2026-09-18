"use client";
import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { RecVideo } from "@/lib/rec-videos";
import { R } from "../_lib/tokens";
import { PreviewMedia } from "./RecMedia";

gsap.registerPlugin(ScrollTrigger);

export function RecHero({
  heroVideos,
  isMobile,
  reducedMotion,
  onScrollToWork,
}: {
  heroVideos: RecVideo[];
  isMobile: boolean;
  reducedMotion: boolean;
  onScrollToWork: () => void;
}) {
  const sectionRef        = useRef<HTMLDivElement>(null);
  const trackRef          = useRef<HTMLDivElement>(null);
  const headlineDriftRef  = useRef<HTMLDivElement>(null);
  const headlineScrollRef = useRef<HTMLDivElement>(null);
  const direcaoWordRef    = useRef<HTMLSpanElement>(null);
  const direcaoLineRef    = useRef<HTMLSpanElement>(null);
  const kickerRef         = useRef<HTMLDivElement>(null);
  const ctaWrapRef        = useRef<HTMLDivElement>(null);
  const transitionRef     = useRef<HTMLDivElement>(null);
  const fadeOverlayRef    = useRef<HTMLDivElement>(null);

  const clips = heroVideos.slice(0, 3);
  // Bloco duplicado (A,B,C,A,B,C) — permite o loop horizontal contínuo sem salto.
  const loopClips = clips.length > 0 ? [...clips, ...clips] : [];

  useGSAP(() => {
    if (reducedMotion || clips.length === 0) return;
    const track = trackRef.current;
    if (!track) return;

    // Duração calculada pela largura real do bloco — mesma velocidade percebida em qualquer viewport.
    const halfWidth = track.scrollWidth / 2;
    const speedPxPerSec = isMobile ? 24 : 32;
    const duration = Math.max(halfWidth / speedPxPerSec, 8);

    const marquee = gsap.to(track, {
      xPercent: -50,
      duration,
      ease: "none",
      repeat: -1,
    });

    const headline = headlineDriftRef.current;
    const headlineTween = headline
      ? gsap.to(headline, {
          xPercent: 7,
          duration: duration * 2.2,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
        })
      : undefined;

    const onVisibility = () => {
      if (document.hidden) { marquee.pause(); headlineTween?.pause(); }
      else { marquee.resume(); headlineTween?.resume(); }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Entrada intencional e discreta de "direção." — sem bounce/elastic/glow, roda uma vez.
    if (direcaoWordRef.current && direcaoLineRef.current) {
      gsap.fromTo(direcaoWordRef.current,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: .55, ease: "power2.out", delay: .2 }
      );
      gsap.fromTo(direcaoLineRef.current,
        { scaleX: 0 },
        { scaleX: 1, duration: .5, ease: "power2.out", delay: .5, transformOrigin: "left center" }
      );
    }

    // Transformação contínua ao longo de TODO o pin — cada trecho do scroll tem uma
    // mudança visual correspondente, pra não sobrar "trecho morto" no fim do range.
    // Com o texto de transição, a linha do tempo agora tem 3 estados sucessivos
    // (headline principal → "mas não é somente vídeo..." → fade sólido), cada um
    // ocupando uma fatia do mesmo progress 0-1, sem espaço vazio entre eles.
    const scaleMax  = isMobile ? 0.11 : 0.17;
    const driftMax  = isMobile ? 55   : 130;
    // "+=NNvh" como string não estava resultando na distância esperada (o pin-spacer
    // ficava com só ~55px extras, não ~500px) — usar pixels calculados explicitamente
    // a partir de window.innerHeight elimina qualquer ambiguidade de parsing.
    const pinDistance = () => window.innerHeight * (isMobile ? 0.46 : 0.62);

    // "Bump": sobe de 0→1 em [inStart,inEnd], segura em 1, desce de 1→0 em [outStart,outEnd].
    const bump = (p: number, inStart: number, inEnd: number, outStart: number, outEnd: number) => {
      if (p <= inStart) return 0;
      if (p < inEnd) return (p - inStart) / (inEnd - inStart);
      if (p < outStart) return 1;
      if (p < outEnd) return 1 - (p - outStart) / (outEnd - outStart);
      return 0;
    };

    const st = ScrollTrigger.create({
      trigger: sectionRef.current,
      start: "top top",
      end: () => `+=${pinDistance()}`,
      pin: true,
      scrub: 0.6,
      onUpdate: (self) => {
        const p = self.progress;

        // Vídeos: escala + deslocamento horizontal extra somado ao marquee independente
        // (GSAP combina xPercent do tween contínuo com x do onUpdate no mesmo elemento).
        gsap.set(track, { scale: 1 + p * scaleMax, x: -p * driftMax });

        // Estado 1 — headline principal: sai nos primeiros ~30% do pin.
        const hp = Math.min(p / 0.3, 1);
        if (headlineScrollRef.current) {
          gsap.set(headlineScrollRef.current, { y: -hp * 130, opacity: 1 - hp });
        }
        if (kickerRef.current) gsap.set(kickerRef.current, { y: -p * 36, opacity: 1 - hp });
        if (ctaWrapRef.current) gsap.set(ctaWrapRef.current, { y: p * 22, opacity: 1 - hp });

        // Estado 2 — "mas não é somente vídeo...": entra enquanto a headline principal
        // ainda está terminando de sair (crossfade, sem hiato), segura legível e sai
        // antes do fade sólido cobrir a cena.
        if (transitionRef.current) {
          const tp = bump(p, 0.26, 0.42, 0.62, 0.8);
          gsap.set(transitionRef.current, { opacity: tp, y: (1 - tp) * 18 });
        }

        // Estado 3 — últimos ~20% do pin: cobre com a cor sólida do fundo, emendando
        // com a próxima seção (mesmo #080706) — sem corte seco.
        if (fadeOverlayRef.current) {
          const fp = Math.max(0, (p - 0.8) / 0.2);
          gsap.set(fadeOverlayRef.current, { opacity: fp });
        }
      },
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      st.kill();
    };
  }, { scope: sectionRef, dependencies: [isMobile, reducedMotion, clips.map((c) => c.id).join(",")] });

  return (
    <section
      ref={sectionRef}
      style={{ position: "relative", height: "100vh", overflow: "hidden", background: R.bg }}
    >
      {loopClips.length > 0 ? (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center" }}>
          <div
            ref={trackRef}
            style={{ display: "flex", gap: isMobile ? "3vw" : "2vw", willChange: "transform" }}
          >
            {loopClips.map((video, i) => (
              <FilmClip key={`${video.id}-${i}`} video={video} isMobile={isMobile} eager={i < clips.length + 1} />
            ))}
          </div>
        </div>
      ) : (
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(155deg, ${R.warm} 0%, #0a0705 60%, #120c08 100%)` }} />
      )}

      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(5,4,3,0.35) 0%, rgba(5,4,3,0.05) 35%, rgba(5,4,3,0.12) 60%, rgba(5,4,3,0.85) 100%)", pointerEvents: "none" }} />

      <div
        ref={headlineScrollRef}
        style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 3 }}
      >
        <div ref={headlineDriftRef} style={{ willChange: "transform" }}>
          <h1
            style={{
              ...R.display, fontWeight: 600, textAlign: "center", color: R.text,
              fontSize: isMobile ? "clamp(2.6rem,13vw,3.8rem)" : "clamp(3.6rem,10vw,8.5rem)",
              lineHeight: .92, letterSpacing: "-.01em",
              textShadow: "0 6px 44px rgba(0,0,0,0.65)",
            }}
          >
            Vídeo com<br />
            <span ref={direcaoWordRef} style={{ position: "relative", display: "inline-block", color: R.red }}>
              direção.
              <span
                ref={direcaoLineRef}
                style={{
                  position: "absolute", left: 0, right: "6%", bottom: "-.06em", height: "3px",
                  background: R.red, transform: "scaleX(1)",
                }}
              />
            </span>
          </h1>
        </div>
      </div>

      <div ref={kickerRef} style={{ position: "absolute", top: "5.5rem", left: isMobile ? "1.5rem" : "2rem", zIndex: 3 }}>
        <p style={{ ...R.mono, fontSize: ".5rem", letterSpacing: ".2em", textTransform: "uppercase", color: R.muted }}>
          LOKAT.REC · Produção audiovisual
        </p>
      </div>

      <div
        ref={transitionRef}
        style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none", zIndex: 3, opacity: 0,
        }}
      >
        <p
          style={{
            ...R.display, fontWeight: 600, textAlign: "center", lineHeight: 1.05, letterSpacing: "-.005em",
            fontSize: isMobile ? "clamp(1.5rem,7vw,2.1rem)" : "clamp(1.8rem,4.4vw,3.2rem)",
            textShadow: "0 6px 34px rgba(0,0,0,0.6)",
          }}
        >
          <span style={{ color: R.text }}>Mas não é somente</span><br />
          <span style={{ color: R.red }}>vídeo...</span>
        </p>
      </div>

      <div ref={fadeOverlayRef} style={{ position: "absolute", inset: 0, background: R.bg, opacity: 0, pointerEvents: "none", zIndex: 4 }} />

      <div ref={ctaWrapRef} style={{ position: "absolute", bottom: isMobile ? "1.6rem" : "2rem", left: isMobile ? "1.5rem" : "2rem", zIndex: 3 }}>
        <TrabalhosCTA isMobile={isMobile} onClick={onScrollToWork} />
      </div>
    </section>
  );
}

function TrabalhosCTA({ isMobile, onClick }: { isMobile: boolean; onClick: () => void }) {
  const [active, setActive] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onTouchStart={() => setActive(true)}
      onTouchEnd={() => setTimeout(() => setActive(false), 250)}
      style={{
        ...R.mono, fontSize: isMobile ? "11px" : "12px", letterSpacing: ".14em", textTransform: "uppercase",
        color: R.text, background: "none", border: "none", padding: 0, cursor: "pointer",
        display: "inline-block", position: "relative", paddingBottom: "4px",
      }}
    >
      Ver trabalhos
      <span
        style={{
          position: "absolute", left: 0, bottom: 0, height: "1px", background: R.red,
          width: active ? "100%" : "34%",
          transition: "width .35s ease",
        }}
      />
    </button>
  );
}

function FilmClip({ video, isMobile, eager }: { video: RecVideo; isMobile: boolean; eager: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(eager);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.05, rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: "relative", flex: `0 0 ${isMobile ? 70 : 30}vw`,
        aspectRatio: "9/16", overflow: "hidden", background: R.warm,
      }}
    >
      <PreviewMedia video={video} shouldPlay={inView} />
    </div>
  );
}
