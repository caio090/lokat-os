"use client";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { motion } from "framer-motion";
import { Play } from "lucide-react";
import type { RecVideo } from "@/lib/rec-videos";
import { R } from "../_lib/tokens";
import { workTypeLabel, yearOf } from "../_lib/data";
import { PreviewMedia } from "./RecMedia";

// Elevação máxima do "card lift" no arraste horizontal mobile — dentro do
// range pedido (18–28px). Não se aplica no desktop: aqui os cards fazem
// flex-wrap (sem scroll horizontal real), então a métrica de distância até o
// centro do scroller não faria sentido.
const CARD_LIFT_MAX_PX = 22;

// Largura do card no mobile — mesmo valor usado no flex-basis de cada item e
// no cálculo do padding lateral que permite o primeiro/último card centralizarem.
const MOBILE_CARD_WIDTH = "68vw";

// Limiar do gesto: desloca ≥30px OU velocidade ≥0.35px/ms já conta como swipe
// intencional (dentro do range 24–40px pedido). Evita disparo com toque
// acidental de poucos pixels, sem exigir arrastar metade da tela.
const SWIPE_THRESHOLD_PX = 30;
const SWIPE_MIN_VELOCITY = 0.35;

// "1 swipe = 1 card": scroll-snap-type mandatory + scroll-snap-align center
// já ajudam, mas sozinhos não garantem que um flick forte não atravesse vários
// cards (scroll-snap-stop:always cobriria isso, mas não tem suporte real no
// Safari/iOS — que é justamente onde essa faixa precisa ficar fluida). Por
// isso o avanço real de índice é decidido aqui, em JS, e sempre limitado a
// ±1 a partir do card ativo, não importa a força do gesto.
function useSnapCarousel(
  scrollerRef: RefObject<HTMLDivElement | null>,
  cardRefs: RefObject<(HTMLDivElement | null)[]>,
  enabled: boolean
) {
  useEffect(() => {
    if (!enabled) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const cardCenterX = (card: HTMLDivElement) => {
      const r = card.getBoundingClientRect();
      return r.left + r.width / 2;
    };

    const closestIndexToCenter = () => {
      const scrollerRect = scroller.getBoundingClientRect();
      const centerX = scrollerRect.left + scrollerRect.width / 2;
      let best = 0;
      let bestDist = Infinity;
      cardRefs.current.forEach((card, idx) => {
        if (!card) return;
        const dist = Math.abs(cardCenterX(card) - centerX);
        if (dist < bestDist) { bestDist = dist; best = idx; }
      });
      return best;
    };

    let activeIndex = closestIndexToCenter();

    const scrollToIndex = (index: number, behavior: ScrollBehavior) => {
      const cards = cardRefs.current;
      const clamped = Math.max(0, Math.min(index, cards.length - 1));
      const card = cards[clamped];
      if (!card) return;
      const scrollerRect = scroller.getBoundingClientRect();
      const delta = cardCenterX(card) - (scrollerRect.left + scrollerRect.width / 2);
      scroller.scrollTo({ left: scroller.scrollLeft + delta, behavior });
      activeIndex = clamped;
    };

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startTime = 0;

    // Só rastreamos ponteiros primários (dedo/botão principal do mouse) —
    // sem preventDefault em nenhum handler: o scroll nativo continua livre
    // enquanto o dedo está na tela (item 9 do briefing).
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startTime = performance.now();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // Gesto majoritariamente vertical (rolando a página) — não mexe no
      // carrossel, deixa o scroll vertical nativo em paz (item 15, teste F).
      if (Math.abs(dy) > Math.abs(dx)) return;

      const dt = Math.max(performance.now() - startTime, 1);
      const velocity = Math.abs(dx) / dt;
      const intentional = Math.abs(dx) >= SWIPE_THRESHOLD_PX || velocity >= SWIPE_MIN_VELOCITY;

      // Toque acidental ou arraste curto demais: nunca deixa parado no meio,
      // volta pro card ativo. Swipe intencional: avança exatamente 1 índice,
      // nunca mais que isso mesmo num flick forte.
      const direction = dx < 0 ? 1 : -1;
      scrollToIndex(intentional ? activeIndex + direction : activeIndex, "smooth");
    };

    const onPointerCancel = () => { dragging = false; };

    scroller.addEventListener("pointerdown", onPointerDown, { passive: true });
    scroller.addEventListener("pointerup", onPointerUp, { passive: true });
    scroller.addEventListener("pointercancel", onPointerCancel, { passive: true });
    return () => {
      scroller.removeEventListener("pointerdown", onPointerDown);
      scroller.removeEventListener("pointerup", onPointerUp);
      scroller.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [enabled, scrollerRef, cardRefs]);
}

// Resposta contínua ao arraste horizontal: cada card sobe/desce conforme sua
// distância até o centro do scroller (0 no centro, máximo na borda). Lê a
// posição via getBoundingClientRect a cada frame (rAF-throttled a partir do
// evento de scroll, nunca setState) e escreve direto na custom property
// --card-lift do próprio elemento — nunca dispara re-render do React.
function useHorizontalCardLift(
  scrollerRef: RefObject<HTMLDivElement | null>,
  cardRefs: RefObject<(HTMLDivElement | null)[]>,
  enabled: boolean
) {
  useEffect(() => {
    if (!enabled) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;

    // prefers-reduced-motion: lido ao vivo (não via prop) — mesmo padrão já
    // usado no Hero para evitar o mismatch de hidratação do useSyncExternalStore.
    // Se ativo, nunca escrevemos --card-lift: o fallback do var() cobre o resto.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let rafId: number | null = null;

    const apply = () => {
      rafId = null;
      const scrollerRect = scroller.getBoundingClientRect();
      const centerX = scrollerRect.left + scrollerRect.width / 2;
      const half = scrollerRect.width / 2 || 1;
      for (const card of cardRefs.current) {
        if (!card) continue;
        const cardRect = card.getBoundingClientRect();
        const cardCenter = cardRect.left + cardRect.width / 2;
        const normalized = Math.min(Math.abs(cardCenter - centerX) / half, 1);
        card.style.setProperty("--card-lift", `${normalized * CARD_LIFT_MAX_PX}px`);
      }
    };

    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(apply);
    };

    apply();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [enabled, scrollerRef, cardRefs]);
}

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
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(t);
  }, []);

  useHorizontalCardLift(scrollerRef, cardRefs, isMobile);
  useSnapCarousel(scrollerRef, cardRefs, isMobile);

  if (videos.length === 0) return null;

  return (
    <section style={{ padding: isMobile ? "3rem 0" : "4.5rem 0" }}>
      <div style={{ maxWidth: "1300px", margin: "0 auto", padding: "0 2rem" }}>
        <p style={{ ...R.mono, fontSize: ".54rem", letterSpacing: ".2em", textTransform: "uppercase", color: R.red, marginBottom: ".4rem" }}>{kicker}</p>
        <h2 style={{ ...R.display, fontSize: "clamp(1.6rem,3.4vw,2.3rem)", fontWeight: 600, color: R.text, lineHeight: 1.0, marginBottom: "1.6rem" }}>{heading}</h2>

        <div
          ref={scrollerRef}
          style={{
            display: "flex",
            gap: isMobile ? "1rem" : "1.4rem",
            overflowX: isMobile ? "auto" : "visible",
            flexWrap: isMobile ? "nowrap" : "wrap",
            scrollSnapType: isMobile ? "x mandatory" : "none",
            // Espaço invisível antes do 1º e depois do último card — sem ele,
            // scroll-snap-align:center nunca conseguiria centralizar as pontas
            // (não têm pra onde "sobrar" scroll). O cálculo usa a largura real
            // do próprio scroller (100%), não a viewport inteira, então já
            // descupa o padding do container ao redor.
            paddingLeft: isMobile ? `calc((100% - ${MOBILE_CARD_WIDTH}) / 2)` : 0,
            paddingRight: isMobile ? `calc((100% - ${MOBILE_CARD_WIDTH}) / 2)` : 0,
            paddingBottom: isMobile ? ".3rem" : 0,
            WebkitOverflowScrolling: "touch",
          }}
        >
          {videos.map((video, i) => (
            // Wrapper externo dedicado ao "card lift" contínuo do arraste
            // horizontal (transform via --card-lift, nunca via React) — não
            // disputa transform com o motion.div interno, que já é dono do
            // reveal de entrada (opacity/y, uma vez no mount).
            <div
              key={video.id}
              ref={(node) => { cardRefs.current[i] = node; }}
              style={{
                flex: isMobile ? `0 0 ${MOBILE_CARD_WIDTH}` : "0 1 290px",
                scrollSnapAlign: isMobile ? "center" : undefined,
                scrollSnapStop: isMobile ? "always" : undefined,
                transform: isMobile ? "translateY(var(--card-lift, 0px))" : undefined,
                transition: isMobile ? "transform 100ms ease-out" : undefined,
                willChange: isMobile ? "transform" : undefined,
              }}
            >
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={mounted ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: .5, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
              >
                <CompactCard video={video} onOpen={() => onOpen(video)} />
              </motion.div>
            </div>
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
      aria-label={`Assistir ${video.title || video.client_name || "trabalho"}${video.title && video.client_name ? ` — ${video.client_name}` : ""}`}
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
        {video.client_name ?? "LOKAT.REC"} · {workTypeLabel(video.workType, video.workSubtype)}{year ? ` · ${year}` : ""}
      </p>
      {video.title && (
        <p style={{ ...R.grotesk, fontSize: ".82rem", fontWeight: 600, color: R.text, marginTop: ".15rem", lineHeight: 1.25 }}>
          {video.title}
        </p>
      )}
    </div>
  );
}
