"use client";
import { useSyncExternalStore } from "react";
import Image from "next/image";
import { R } from "../_lib/tokens";

// Dimensões intrínsecas reais do arquivo (midia/lokat.rec(logo).png) — mantém o aspect-ratio correto.
const LOGO_W = 418;
const LOGO_H = 111;

function subscribeToScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

export function RecHeader({
  isMobile,
  onNavTrabalhos,
  onNavProdutora,
  whatsappHref,
}: {
  isMobile: boolean;
  onNavTrabalhos: () => void;
  onNavProdutora: () => void;
  whatsappHref: string;
}) {
  const scrolled = useSyncExternalStore(
    subscribeToScroll,
    () => window.scrollY > 40,
    () => false
  );

  return (
    <header
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: isMobile ? ".9rem 1.25rem" : "1.1rem 2rem",
        background: scrolled ? "rgba(8,7,6,0.72)" : "transparent",
        backdropFilter: scrolled ? "blur(10px)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(10px)" : "none",
        borderBottom: scrolled ? `1px solid ${R.border}` : "1px solid transparent",
        transition: "background .4s ease, border-color .4s ease",
      }}
    >
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="LOKAT.REC — voltar ao topo"
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center" }}
      >
        <Image
          src="/rec/brand/lokat-rec-logo.webp"
          alt="LOKAT.REC"
          width={LOGO_W}
          height={LOGO_H}
          priority
          style={{ height: isMobile ? "26px" : "28px", width: "auto" }}
        />
      </button>

      {!isMobile && (
        <nav style={{ display: "flex", gap: "2.2rem", alignItems: "center" }}>
          {[
            ["Trabalhos", onNavTrabalhos],
            ["Produtora", onNavProdutora],
          ].map(([label, fn]) => (
            <button
              key={label as string}
              type="button"
              onClick={fn as () => void}
              style={{ ...R.mono, fontSize: ".62rem", letterSpacing: ".16em", textTransform: "uppercase", color: R.muted, background: "none", border: "none", cursor: "pointer", padding: 0, transition: "color .2s" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = R.text)}
              onMouseLeave={(e) => (e.currentTarget.style.color = R.muted)}
            >
              {label as string}
            </button>
          ))}
          {/* Desktop continua discreto (texto, sem borda/fundo) — só o hover
              agora tinge de vermelho da marca em vez de branco neutro. */}
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Falar com a LOKAT.REC pelo WhatsApp"
            style={{ ...R.mono, fontSize: ".62rem", letterSpacing: ".16em", textTransform: "uppercase", color: R.muted, textDecoration: "none", transition: "color .2s" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = R.red)}
            onMouseLeave={(e) => (e.currentTarget.style.color = R.muted)}
          >
            Contato ↗
          </a>
        </nav>
      )}

      {isMobile && (
        // Mobile precisa de mais presença que o texto solto do desktop — borda +
        // fundo translúcido vermelho sutil (mesma linguagem do CTA do Hero),
        // sem virar botão verde de WhatsApp nem crescer a altura do header.
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Falar com a LOKAT.REC pelo WhatsApp"
          style={{
            ...R.mono, fontSize: ".54rem", letterSpacing: ".14em", textTransform: "uppercase",
            color: R.text, textDecoration: "none", display: "inline-block",
            border: `1px solid ${R.red}80`, background: `${R.red}14`,
            padding: ".38rem .75rem", borderRadius: "3px",
          }}
        >
          Contato
        </a>
      )}
    </header>
  );
}
