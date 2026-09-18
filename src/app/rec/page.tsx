"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { getPublicRecVideos, getVideosFromStorage, type RecVideo } from "@/lib/rec-videos";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { R, useIsMobile, usePrefersReducedMotion } from "./_lib/tokens";
import {
  STATIC_VIDEOS, STATIC_FEEDBACK, MUX_TEST_VIDEOS,
  YOUTUBE_MUSIC_VIDEOS, YOUTUBE_CONTENT_VIDEOS, GOSTA_SUCO_STORAGE_PATH,
  applyStorageTitleOverride,
} from "./_lib/data";
import { whatsappUrl } from "./_lib/whatsapp";
import { RecHeader } from "./_components/RecHeader";
import { RecHero } from "./_components/RecHero";
import { ClientCasesMarquee } from "./_components/ClientCasesMarquee";
import { CompactWorks } from "./_components/CompactWorks";
import { CaseSandubao } from "./_components/CaseSandubao";
import { FilmSection } from "./_components/FilmSection";
import { BehindScenes } from "./_components/BehindScenes";
import { RecAbout } from "./_components/RecAbout";
import { RecContact } from "./_components/RecContact";
import { VideoModal } from "./_components/VideoModal";

export default function LokatRecPage() {
  const isMobile      = useIsMobile();
  const reducedMotion = usePrefersReducedMotion();

  const [modalVideo,    setModalVideo]    = useState<RecVideo | null>(null);
  const [videos,        setVideos]        = useState<RecVideo[]>([]);
  const [feedbackVideo, setFeedbackVideo] = useState<RecVideo | null>(null);

  const workRef    = useRef<HTMLDivElement>(null);
  const aboutRef   = useRef<HTMLDivElement>(null);
  const contactRef = useRef<HTMLDivElement>(null);

  // Buscar vídeos: 1º tabela rec_videos, 2º storage listing, 3º STATIC_VIDEOS hardcoded
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setVideos([...STATIC_VIDEOS, ...MUX_TEST_VIDEOS, ...YOUTUBE_MUSIC_VIDEOS, ...YOUTUBE_CONTENT_VIDEOS]);
      setFeedbackVideo(STATIC_FEEDBACK);
      return;
    }

    const load = async () => {
      let data = await getPublicRecVideos().catch(() => [] as RecVideo[]);
      if (data.length === 0) {
        data = await getVideosFromStorage().catch(() => [] as RecVideo[]);
      }

      const feedback = data.find((v) => v.is_feedback && v.is_featured)
        ?? data.find((v) => v.is_feedback)
        ?? (STATIC_FEEDBACK.video_url ? STATIC_FEEDBACK : null);

      // "Vídeo da Já" (Gosta Suco): continua normalmente em Comerciais — só sai do
      // Hero (ver heroVideos abaixo). Aplica também as correções de título público
      // derivadas de storage_path (ex: "Duhlache DIA DO SOLTEIRO" → nome de marca real).
      const nonFeedback = data
        .filter((v) => !v.is_feedback)
        .map(applyStorageTitleOverride);

      setFeedbackVideo(feedback);
      setVideos([
        ...(nonFeedback.length > 0 ? nonFeedback : STATIC_VIDEOS),
        ...MUX_TEST_VIDEOS,
        ...YOUTUBE_MUSIC_VIDEOS,
        ...YOUTUBE_CONTENT_VIDEOS,
      ]);
    };

    void load();
  }, []);

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) =>
    ref.current?.scrollIntoView({ behavior: "smooth" });

  // Hero — 3 clipes únicos do Infinite Film Strip: 1 vídeo real do catálogo (excluindo
  // "Gosta Suco", que saiu do Hero nesta rodada mas continua normalmente em Comerciais),
  // "Noite das Patroas" no meio, e "Duh Lanches — Lanche da Madrugada" no final — igual
  // à composição anterior, só a posição do meio mudou. Busca por playbackId (não por
  // título) pra não quebrar quando o título público muda.
  const heroVideoA        = videos.find((v) => v.provider !== "mux" && v.storage_path !== GOSTA_SUCO_STORAGE_PATH);
  const heroNoiteDasPatroas = videos.find((v) => v.playbackId === "wuN26wNRNNZIIkHWcBMxHVJqihavjFHnR02Ji2Iz9eOI");
  const heroLancheMadrugada = videos.find((v) => v.playbackId === "7HVIKdAWNXYTnsl1PaMn01m009QOCOLuVclX5XaMlewGU");
  const heroVideos = [
    ...(heroVideoA ? [heroVideoA] : []),
    ...(heroNoiteDasPatroas ? [heroNoiteDasPatroas] : []),
    ...(heroLancheMadrugada ? [heroLancheMadrugada] : []),
  ];

  // Catálogo editorial — separado por workType, sem duplicar componente por categoria.
  // "Aftermovie" não vem desse catálogo: é o FilmSection (conteúdo real já existente,
  // "O dia dela" / Maria Clara XV anos), reposicionado antes do Sandubão nesta rodada.
  const commercialVideos  = videos.filter((v) => v.show_in_cards && (v.workType ?? "commercial") === "commercial");
  const musicVideos       = videos.filter((v) => v.workType === "music-video");
  const contentVideos     = videos.filter((v) => v.workType === "content");

  return (
    <div style={{ background: R.bg, color: R.text, minHeight: "100vh", overflowX: "clip" }}>

      {modalVideo && <VideoModal video={modalVideo} onClose={() => setModalVideo(null)} />}

      <RecHeader
        isMobile={isMobile}
        onNavTrabalhos={() => scrollTo(workRef)}
        onNavProdutora={() => scrollTo(aboutRef)}
        whatsappHref={whatsappUrl("Olá! Vim pelo site da LOKAT REC e queria conversar sobre um projeto.")}
      />

      <RecHero
        heroVideos={heroVideos}
        isMobile={isMobile}
        reducedMotion={reducedMotion}
        onScrollToWork={() => scrollTo(workRef)}
        whatsappHref={whatsappUrl("Olá! Vim pelo site da LOKAT REC e queria conversar sobre um projeto.")}
      />

      {/*
        O Hero é 100vh pinado — depois que o pin libera, o próprio elemento (900px/844px)
        ainda precisa rolar normalmente pra sair da tela, e como o overlay sólido do fim
        do pin fica travado em opacity:1 (gsap.set não reage mais a scroll depois que o
        progress trava em 1), esse trecho inteiro aparecia como uma caixa preta sólida —
        quase um viewport inteiro de "vazio" (medido: ~900px desktop / ~844px mobile).
        Fix: um âncora de altura zero (não desloca nada abaixo no fluxo normal) com um
        filho position:absolute deslocado pra cima, fazendo o Clientes sobrepor
        visualmente o fim do Hero sem mover Comerciais/resto da página (margin-top
        negativo direto colapsava o fluxo normal e empurrava a página inteira pra cima).
      */}
      <div style={{ position: "relative", height: 0 }}>
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: .8, ease: [0.16, 1, 0.3, 1] }}
          style={{ position: "absolute", top: isMobile ? "-94vh" : "-90vh", left: 0, right: 0, zIndex: 5 }}
        >
          <ClientCasesMarquee isMobile={isMobile} />
        </motion.div>
      </div>

      <div ref={workRef}>
        <CompactWorks
          videos={commercialVideos}
          isMobile={isMobile}
          onOpen={setModalVideo}
          kicker="[Comerciais]"
          heading="Comerciais"
        />
      </div>

      <CompactWorks
        videos={musicVideos}
        isMobile={isMobile}
        onOpen={setModalVideo}
        kicker="[Videoclipes]"
        heading="Videoclipes"
      />

      <FilmSection isMobile={isMobile} reducedMotion={reducedMotion} />

      <CompactWorks
        videos={contentVideos}
        isMobile={isMobile}
        onOpen={setModalVideo}
        kicker="[Conteúdo / Vlog]"
        heading="Conteúdo / Vlog"
      />

      <CaseSandubao video={feedbackVideo} isMobile={isMobile} />

      <BehindScenes isMobile={isMobile} />

      <RecAbout ref={aboutRef} isMobile={isMobile} />

      <RecContact ref={contactRef} isMobile={isMobile} />

      <footer style={{ borderTop: `1px solid ${R.border}`, padding: "2rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", textAlign: "center" }}>
        <span style={{ ...R.mono, fontSize: ".7rem", letterSpacing: ".1em", fontWeight: 700, color: R.text }}>LOKAT<span style={{ color: R.red }}>.</span>REC</span>
        <p style={{ ...R.mono, fontSize: ".46rem", letterSpacing: ".14em", textTransform: "uppercase", color: R.muted }}>Floriano — PI · Brasil · Desde 2022</p>
        <Link href="/" style={{ ...R.mono, fontSize: ".48rem", letterSpacing: ".12em", textTransform: "uppercase", color: R.muted, textDecoration: "none" }}>
          ← LOKAT OS
        </Link>
      </footer>
    </div>
  );
}
