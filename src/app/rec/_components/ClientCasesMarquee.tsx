"use client";
import { useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { R } from "../_lib/tokens";

// Logos reais já existentes no projeto (public/clients/), recuperados da seção
// "Empresas que confiam na Lokat" do domínio principal (src/app/page.tsx, removida
// em 48d377c). Nomes preservados exatamente como estavam — nada inventado.
// Servidos a partir de public/rec/brand/clients/ — versão WebP com o fundo sólido
// original recortado (chroma-key por distância de cor a partir dos cantos da
// imagem), pra não ficar com cara de "card" quadrado no marquee. Os arquivos
// originais em public/clients/ permanecem intactos.
const CLIENTS = [
  { name: "Duh Lanches",       file: "duh-lanches.webp" },
  { name: "MD Móveis",         file: "md-moveis.webp" },
  { name: "Los Caldos",        file: "los-caldos.webp" },
  { name: "My Sorvetes",       file: "my-sorvetes.webp" },
  { name: "O Pedreirão",       file: "pedreirar.webp" },
  { name: "Odonto Lura",       file: "odonto-lura.webp" },
  { name: "Sandubão Lanches",  file: "sandubao.webp" },
  { name: "Banca do Jean",     file: "banca-jean.webp" },
  { name: "DR",                file: "logo-dr.webp" },
];

export function ClientCasesMarquee({ isMobile }: { isMobile: boolean }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const track = trackRef.current;
    if (!track) return;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;

    const halfWidth = track.scrollWidth / 2;
    const speedPxPerSec = isMobile ? 16 : 21;
    const duration = Math.max(halfWidth / speedPxPerSec, 20);

    const tween = gsap.to(track, {
      xPercent: -50,
      duration,
      ease: "none",
      repeat: -1,
    });

    const onEnter = () => gsap.to(tween, { timeScale: 0.35, duration: .4, ease: "power2.out" });
    const onLeave = () => gsap.to(tween, { timeScale: 1, duration: .6, ease: "power2.out" });
    const section = sectionRef.current;
    if (!isMobile && section) {
      section.addEventListener("mouseenter", onEnter);
      section.addEventListener("mouseleave", onLeave);
    }

    const onVisibility = () => { if (document.hidden) tween.pause(); else tween.resume(); };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (!isMobile && section) {
        section.removeEventListener("mouseenter", onEnter);
        section.removeEventListener("mouseleave", onLeave);
      }
    };
  }, { scope: sectionRef, dependencies: [isMobile] });

  const logoHeight = isMobile ? 34 : 52;
  const gap = isMobile ? "2.2rem" : "4rem";
  const loopLogos = [...CLIENTS, ...CLIENTS];

  return (
    <section
      ref={sectionRef}
      style={{
        position: "relative",
        padding: isMobile ? "2.2rem 0" : "3rem 0",
        borderTop: `1px solid ${R.border}`,
        borderBottom: `1px solid ${R.border}`,
        background: R.bg,
      }}
    >
      <p style={{
        ...R.mono, fontSize: ".5rem", letterSpacing: ".22em", textTransform: "uppercase",
        color: R.muted, textAlign: "center", marginBottom: isMobile ? "1.2rem" : "1.6rem", opacity: .7,
      }}>
        Clientes
      </p>

      <div style={{
        overflow: "hidden",
        maskImage: "linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%)",
      }}>
        <div ref={trackRef} style={{ display: "flex", alignItems: "center", gap, width: "max-content", willChange: "transform" }}>
          {loopLogos.map((client, i) => (
            <ClientLogo key={`${client.file}-${i}`} client={client} height={logoHeight} isMobile={isMobile} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ClientLogo({ client, height, isMobile }: { client: { name: string; file: string }; height: number; isMobile: boolean }) {
  const [active, setActive] = useState(false);
  const [failed, setFailed] = useState(false);

  const tap = () => {
    setActive(true);
    setTimeout(() => setActive(false), 900);
  };

  if (failed) {
    return (
      <span style={{ ...R.mono, fontSize: ".5rem", letterSpacing: ".1em", textTransform: "uppercase", color: R.muted, opacity: .35, flexShrink: 0 }}>
        {client.name}
      </span>
    );
  }

  return (
    <div
      onMouseEnter={() => !isMobile && setActive(true)}
      onMouseLeave={() => !isMobile && setActive(false)}
      onTouchStart={isMobile ? tap : undefined}
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        zIndex: active ? 2 : 1,
        cursor: "default",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/rec/brand/clients/${client.file}`}
        alt={client.name}
        onError={() => setFailed(true)}
        style={{
          height: `${height}px`,
          width: "auto",
          objectFit: "contain",
          filter: active ? "none" : "grayscale(100%)",
          opacity: active ? 1 : .34,
          transform: active ? "scale(1.05)" : "scale(1)",
          transition: "filter .38s ease, opacity .38s ease, transform .38s ease, box-shadow .38s ease",
          boxShadow: active ? "0 6px 22px rgba(0,0,0,0.35)" : "none",
        }}
      />
    </div>
  );
}
