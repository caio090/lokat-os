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
  whatsappHref,
}: {
  heroVideos: RecVideo[];
  isMobile: boolean;
  reducedMotion: boolean;
  onScrollToWork: () => void;
  whatsappHref: string;
}) {
  const sectionRef        = useRef<HTMLDivElement>(null);
  const scaleWrapRef      = useRef<HTMLDivElement>(null);
  const trackRef          = useRef<HTMLDivElement>(null);
  const headlineDriftRef  = useRef<HTMLDivElement>(null);
  const headlineScrollRef = useRef<HTMLDivElement>(null);
  const direcaoWordRef    = useRef<HTMLSpanElement>(null);
  const direcaoLineRef    = useRef<HTMLSpanElement>(null);
  const kickerRef         = useRef<HTMLDivElement>(null);
  const ctaWrapRef        = useRef<HTMLDivElement>(null);
  const transitionRef     = useRef<HTMLDivElement>(null);
  const projectRef        = useRef<HTMLDivElement>(null);
  const fadeOverlayRef    = useRef<HTMLDivElement>(null);

  const clips = heroVideos.slice(0, 3);
  // Bloco duplicado (A,B,C,A,B,C) — permite o loop horizontal contínuo sem salto.
  const loopClips = clips.length > 0 ? [...clips, ...clips] : [];

  useGSAP(() => {
    // Lê direto do matchMedia em vez da prop `reducedMotion` — mesmo padrão do
    // mobileNow abaixo: usePrefersReducedMotion() usa useSyncExternalStore com
    // getServerSnapshot()=false (evita mismatch de hidratação), corrigindo pro
    // valor real do SO logo depois. Testado direto (Playwright com
    // reducedMotion:"reduce"): a prop chegava true só DEPOIS do efeito já ter
    // rodado com false, e como a versão anterior desse código tinha
    // `reducedMotion` nas dependencies, o efeito RE-rodava e corretamente não
    // reaplicava a animação — mas isso significa que, por um instante real,
    // a faixa chegava a animar com reduced-motion ativo, e testes automatizados
    // que leem o estado logo após o load pegavam esse instante. Ler o valor
    // real do SO aqui garante certo já na primeira e única execução, igual
    // ao mobileNow — sem depender de um segundo render pra corrigir.
    const reducedMotionNow = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotionNow || clips.length === 0) return;
    const track = trackRef.current;
    if (!track) return;

    // Lida direto com window.innerWidth em vez da prop `isMobile` — useIsMobile()
    // usa useSyncExternalStore com getServerSnapshot()=false (evita mismatch de
    // hidratação), corrigindo pra true logo depois em mobile real. Como esse
    // valor está nas dependencies do useGSAP, essa correção disparava um SEGUNDO
    // useGSAP setup (era o bug real por trás do "pin dobrado" só no mobile): o
    // primeiro criava o pin com pinDistance de desktop, o segundo criava outro
    // com pinDistance de mobile, e o cleanup do primeiro não desfazia a inflação
    // do spacer antes do segundo medir. Lendo o viewport real aqui (o efeito já
    // roda pós-hidratação) resolve certo já na primeira e única execução.
    const mobileNow = window.innerWidth < 768 || navigator.maxTouchPoints > 0;

    // Duração calculada pela largura real do bloco — mesma velocidade percebida em qualquer viewport.
    const speedPxPerSec = mobileNow ? 24 : 32;
    const durationFor = (width: number) => Math.max(width / 2 / speedPxPerSec, 8);
    const applyMarqueeDistance = (width: number) => {
      // PIXELS, não -50%. Isolado e confirmado em WebKit real (não emulação
      // Chromium — não reproduz isso): animar translateX(-50%) num container
      // flex deste tamanho (~1700px, 6 clipes) faz esse WebKit recalcular
      // "50% da largura" a cada frame de forma extremamente cara — rodava a
      // ~1/30 da velocidade configurada, com ou sem vídeo real decodificando
      // (testado com vídeo pausado/sem src: mesmo resultado; testado uma
      // réplica idêntica só com <div> coloridas: mesmo resultado; testado a
      // mesma réplica trocando só % por px: velocidade correta). Não é
      // contenção de main thread nem decode de vídeo — é especificamente o
      // cálculo de porcentagem grande a cada frame.
      track.style.setProperty("--rec-hero-marquee-distance", `-${width / 2}px`);
    };

    // Loop contínuo via animação CSS (@keyframes rec-hero-marquee, globals.css),
    // não gsap.to(repeat:-1) — desacopla o movimento contínuo do storytelling
    // ligado a scroll (ScrollTrigger/pin), que continua via GSAP normalmente
    // num wrapper por fora (scaleWrapRef) em vez do próprio track, já que os
    // dois não podem escrever no mesmo `transform` do mesmo elemento sem conflito.
    applyMarqueeDistance(track.scrollWidth);
    track.style.animation = `rec-hero-marquee ${durationFor(track.scrollWidth)}s linear infinite`;

    // A esteira NUNCA deve depender de vídeo pronto (canplay/readyState/Mux
    // inicializado) — só da largura real do próprio container. Mas essa largura
    // podia ficar presa num valor errado se o primeiro layout não refletisse a
    // dimensão final (ex: no mobile, useIsMobile() começa como false no SSR/
    // hidratação e só corrige pra true logo em seguida — nesse meio-tempo o track
    // teria sido medido com o flex-basis de desktop). ResizeObserver corrige a
    // duração e a distância sempre que a largura real mudar, sem depender de
    // nenhum evento de mídia.
    let lastWidth = track.scrollWidth;
    const ro = new ResizeObserver(() => {
      const w = track.scrollWidth;
      if (w > 0 && w !== lastWidth) {
        lastWidth = w;
        track.style.animationDuration = `${durationFor(w)}s`;
        applyMarqueeDistance(w);
      }
    });
    ro.observe(track);

    const headline = headlineDriftRef.current;
    const headlineTween = headline
      ? gsap.to(headline, {
          xPercent: 7,
          duration: durationFor(track.scrollWidth) * 2.2,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
        })
      : undefined;

    const onVisibility = () => {
      if (document.hidden) { track.style.animationPlayState = "paused"; headlineTween?.pause(); }
      else { track.style.animationPlayState = "running"; headlineTween?.resume(); }
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
    const scaleMax  = mobileNow ? 0.11 : 0.17;
    const driftMax  = mobileNow ? 55   : 130;
    // "+=NNvh" como string não estava resultando na distância esperada (o pin-spacer
    // ficava com só ~55px extras, não ~500px) — usar pixels calculados explicitamente
    // a partir de window.innerHeight elimina qualquer ambiguidade de parsing.
    const pinDistance = () => window.innerHeight * (mobileNow ? 0.22 : 0.34);

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

        // Vídeos: escala + deslocamento horizontal ligado ao scroll — aplicado no
        // wrapper de fora (scaleWrapRef), não no track: o track agora tem sua própria
        // animação CSS contínua no mesmo `transform`, e as duas não podem escrever
        // na mesma propriedade do mesmo elemento sem conflito.
        if (scaleWrapRef.current) gsap.set(scaleWrapRef.current, { scale: 1 + p * scaleMax, x: -p * driftMax });

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
          const tp = bump(p, 0.22, 0.36, 0.52, 0.68);
          gsap.set(transitionRef.current, { opacity: tp, y: (1 - tp) * 18 });
        }

        // Estado 3 — a ponte entra antes da segunda frase terminar de sair.
        if (projectRef.current) {
          const pp = bump(p, 0.56, 0.68, 0.82, 0.94);
          gsap.set(projectRef.current, { opacity: pp, y: (1 - pp) * 18 });
        }

        // Estado 4 — gradiente curto entrega a próxima seção.
        if (fadeOverlayRef.current) {
          const fp = Math.max(0, (p - 0.86) / 0.14);
          gsap.set(fadeOverlayRef.current, { opacity: fp });
        }
      },
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      st.kill();
      // `track.style.animation` é uma mutação direta de DOM, não uma tween GSAP —
      // o revert automático do useGSAP (gsap.context) não desfaz isso sozinho.
      // Limpar explicitamente evita que a animação continue rodando se o efeito
      // re-executar com reducedMotion=true (early return, sem reatribuir nada).
      track.style.animation = "";
    };
    // Identidade estável por mídia real (storage_path/playbackId), não o `id` do
    // objeto React — o mesmo vídeo real pode chegar primeiro via uma referência
    // imediata (fallback local, sem esperar o fetch do Supabase) e depois ser
    // "redescoberto" pelo catálogo ao vivo com um `id` diferente (era o real bug:
    // o pin-spacer dobrava de tamanho porque esse re-render recriava o
    // ScrollTrigger com pin:true enquanto o spacer anterior ainda existia).
    // `isMobile` de propósito fora dessa lista — o efeito já lê o viewport real
    // direto (mobileNow) toda vez que roda, então incluir a prop só reintroduziria
    // o re-init espúrio da correção de hidratação (false→true) que causava o bug acima.
    // `reducedMotion` de volta nas dependencies (diferente do isMobile) — é uma
    // preferência de acessibilidade, vale reagir se o usuário mudar em tempo
    // real. Seguro reincluir agora: o bug de duplicação do pin não era sobre
    // ter isso nas dependencies, e sim sobre a identidade do 1º vídeo do Hero
    // mudando de fonte (static → catálogo ao vivo) e disparando um SEGUNDO
    // setup — isso já foi corrigido separadamente (chave estável por
    // storage_path/playbackId). Como o efeito sempre lê reducedMotionNow ao
    // vivo, mesmo a 1ª execução (antes da correção de hidratação) já decide
    // certo, e uma 2ª execução real (usuário alternando a preferência) só
    // troca entre "anima" e "não anima" — nunca cria dois pins.
  }, { scope: sectionRef, dependencies: [reducedMotion, clips.map((c) => c.storage_path ?? c.playbackId ?? c.youtubeId ?? c.id).join(",")] });

  return (
    <section
      ref={sectionRef}
      style={{ position: "relative", height: "100vh", overflow: "hidden", background: R.bg }}
    >
      {loopClips.length > 0 ? (
        <div ref={scaleWrapRef} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", willChange: "transform" }}>
          <div
            ref={trackRef}
            style={{ display: "flex", gap: isMobile ? "3vw" : "2vw", willChange: "transform" }}
          >
            {loopClips.map((video, i) => (
              <FilmClip
                // Chave estável por mídia real (storage_path/playbackId/youtubeId), não
                // `video.id` — era a causa raiz do vídeo mobile nunca ficar pronto sem
                // interação: `videos` no page.tsx começa com STATIC_VIDEOS (id="s0" pro
                // "Dia do Solteiro") e é substituído pelo catálogo ao vivo do Supabase
                // assim que o fetch resolve (id real, diferente). Como o `key` mudava,
                // o React desmontava e remontava o <video>, cancelando o carregamento em
                // andamento (confirmado via rede real no WebKit: requests repetidos e
                // "cancelled" pro mesmo arquivo) — só "funcionava" depois de scroll porque,
                // em algum momento, um remount finalmente terminava de carregar sem ser
                // interrompido de novo. Mesma classe de bug do pin-spacer duplicado
                // corrigido antes no useGSAP; aqui é a chave de render, não a dependency array.
                key={`${video.storage_path ?? video.playbackId ?? video.youtubeId ?? video.id}-${i}`}
                video={video} isMobile={isMobile} eager={i < (isMobile ? 2 : clips.length + 1)}
              />
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

      {/* Removido só no mobile — redundante com a logo do header (agora mais
          compacto) e ocupava espaço logo no topo do Hero sem agregar. Desktop
          mantém: o ref continua existindo, o gsap.set no onUpdate já é
          null-safe (if (kickerRef.current)), então não precisa mexer na
          animação — sem o elemento no mobile, o guard só não faz nada. */}
      {!isMobile && (
        <div ref={kickerRef} style={{ position: "absolute", top: "5.5rem", left: "2rem", zIndex: 3 }}>
          <p style={{ ...R.mono, fontSize: ".5rem", letterSpacing: ".2em", textTransform: "uppercase", color: R.muted }}>
            LOKAT.REC · Produção audiovisual
          </p>
        </div>
      )}

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

      <div
        ref={projectRef}
        style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 3, opacity: 0 }}
      >
        <p style={{ ...R.display, fontWeight: 600, textAlign: "center", lineHeight: .98, fontSize: isMobile ? "clamp(1.7rem, 8vw, 2.35rem)" : "clamp(2rem, 4vw, 3.2rem)", textShadow: "0 6px 34px rgba(0,0,0,0.6)" }}>
          Seu <span style={{ color: R.red }}>projeto</span> pode ser o próximo.
        </p>
        <div style={{ position: "absolute", top: "calc(50% + 4.2rem)", pointerEvents: "auto" }}>
          <WhatsAppCTA href={whatsappHref} isMobile={isMobile} />
        </div>
      </div>

      <div ref={fadeOverlayRef} style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, transparent 20%, ${R.bg} 100%)`, opacity: 0, pointerEvents: "none", zIndex: 4 }} />

      <div ref={ctaWrapRef} style={{ position: "absolute", bottom: isMobile ? "1.6rem" : "2rem", left: isMobile ? "1.5rem" : "2rem", zIndex: 3, display: "flex", flexWrap: "wrap", gap: isMobile ? "1.1rem" : "1.6rem", alignItems: "baseline" }}>
        <EdgeCTA isMobile={isMobile} label="Ver trabalhos" onClick={onScrollToWork} />
        <EdgeCTA isMobile={isMobile} label="Falar com a REC ↗" href={whatsappHref} />
      </div>
    </section>
  );
}

// CTA minimalista de borda — texto + underline que expande no hover/tap, sem
// cápsula/background/borda. Usado tanto pro scroll interno ("Ver trabalhos",
// button) quanto pro link externo de WhatsApp ("Falar com a REC ↗", <a> real
// por semântica/acessibilidade — abre em nova aba, funciona com cmd/ctrl-click).
function EdgeCTA({
  isMobile, label, onClick, href,
}: {
  isMobile: boolean;
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const [active, setActive] = useState(false);

  const style: React.CSSProperties = {
    ...R.mono, fontSize: isMobile ? "11px" : "12px", letterSpacing: ".14em", textTransform: "uppercase",
    color: R.text, background: "none", border: "none", padding: 0, cursor: "pointer",
    display: "inline-block", position: "relative", paddingBottom: "4px", textDecoration: "none",
  };
  const underline = (
    <span
      style={{
        position: "absolute", left: 0, bottom: 0, height: "1px", background: R.red,
        width: active ? "100%" : "34%",
        transition: "width .35s ease",
      }}
    />
  );
  const handlers = {
    onMouseEnter: () => setActive(true),
    onMouseLeave: () => setActive(false),
    onTouchStart: () => setActive(true),
    onTouchEnd: () => setTimeout(() => setActive(false), 250),
  };

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label.replace("↗", "").trim()} style={style} {...handlers}>
        {label}
        {underline}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} style={style} {...handlers}>
      {label}
      {underline}
    </button>
  );
}

// CTA de contato imediatamente reconhecível como clicável (diferente do EdgeCTA
// minimalista acima) — usado só na 3ª frase do storytelling ("Seu projeto pode
// ser o próximo."). Ícone pequeno inline (sem lib nova), borda + fundo
// translúcido vermelho sutil, microanimação no hover/tap. Sem cápsula grande,
// sem verde de WhatsApp, sem glow — só o suficiente pra não parecer texto solto.
function WhatsAppCTA({ href, isMobile }: { href: string; isMobile: boolean }) {
  const [active, setActive] = useState(false);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Falar com a REC pelo WhatsApp"
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onTouchStart={() => setActive(true)}
      onTouchEnd={() => setTimeout(() => setActive(false), 250)}
      style={{
        ...R.mono, display: "inline-flex", alignItems: "center", gap: ".5rem",
        fontSize: isMobile ? "10px" : "12px", letterSpacing: ".13em", textTransform: "uppercase",
        color: R.text, textDecoration: "none",
        padding: isMobile ? ".55rem .85rem" : ".6rem 1.05rem",
        border: `1px solid ${R.red}${active ? "cc" : "80"}`,
        background: `${R.red}${active ? "2e" : "14"}`,
        borderRadius: "3px",
        transition: "background .25s ease, border-color .25s ease",
      }}
    >
      <WhatsAppGlyph style={{ width: "13px", height: "13px", flexShrink: 0, transform: active ? "translateX(2px)" : "translateX(0)", transition: "transform .25s ease" }} />
      Falar com a REC ↗
    </a>
  );
}

function WhatsAppGlyph({ style }: { style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={style} aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 1.67c2.2 0 4.26.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23-1.48 0-2.93-.39-4.19-1.15l-.3-.18-3.12.83.83-3.04-.2-.32a8.18 8.18 0 0 1-1.26-4.38c.01-4.54 3.7-8.24 8.25-8.24Zm-3.51 3.2c-.16 0-.43.05-.66.3-.22.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.13.15 1.74 2.77 4.29 3.77 2.12.83 2.55.66 3.01.62.46-.04 1.48-.6 1.68-1.2.24-.58.24-1.07.17-1.18-.06-.11-.23-.17-.48-.3-.25-.13-1.5-.74-1.74-.83-.24-.09-.41-.13-.58.13-.18.25-.66.82-.81 1-.15.17-.29.19-.55.06-.26-.13-1.08-.4-2.06-1.27-.76-.68-1.27-1.51-1.42-1.77-.15-.25-.02-.39.11-.52.11-.11.26-.29.37-.44.14-.14.18-.25.27-.42.09-.18.04-.34-.02-.47-.07-.12-.58-1.39-.82-1.92-.22-.52-.43-.45-.6-.45l-.3-.03Z" />
    </svg>
  );
}

function FilmClip({ video, isMobile, eager }: { video: RecVideo; isMobile: boolean; eager: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(eager);
  // Uma vez perto da viewport, o <video>/<mux-player> real fica montado pra sempre
  // (nunca desmonta ao sair de novo — só pausa via `shouldPlay`). Sem isso, os 6
  // clipes do loop (A/B/C/A/B/C, o Hero duplica pra costurar o loop infinito)
  // montavam mídia real simultaneamente desde o primeiro frame — no mobile Safari
  // real (confirmado em WebKit puro, não emulação Chromium) isso estourava o limite
  // de decoders simultâneos e um dos elementos nunca saía de readyState 1, preso
  // pra sempre até um evento externo (como voltar à aba) forçar o browser a
  // reavaliar. Só o clipe "eager" (perto da 1ª dobra) monta mídia de cara; os
  // outros mostram só o poster real até realmente chegarem perto.
  const [everInView, setEverInView] = useState(eager);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Margem maior só aqui (Hero) — os clipes já entram visíveis na primeira dobra,
    // então vale começar a carregar/tocar um pouco mais cedo do que os 200px padrão
    // usados no resto do site, sem alterar esse valor globalmente.
    const obs = new IntersectionObserver(([e]) => {
      setInView(e.isIntersecting);
      if (e.isIntersecting) setEverInView(true);
    }, { threshold: 0.05, rootMargin: "400px" });
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
      <PreviewMedia video={video} shouldPlay={inView} mount={everInView} />
    </div>
  );
}
