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
  applyStorageTitleOverride, HERO_DIA_DO_SOLTEIRO,
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
  // Parte estática (Mux/YouTube) não depende de nenhum fetch — populada direto no
  // useState inicial em vez de esperar o efeito assíncrono do Supabase resolver,
  // pra não deixar o Hero (que usa 2 desses 3 clipes) sem nada em conexão lenta.
  const [videos,        setVideos]        = useState<RecVideo[]>([...STATIC_VIDEOS, ...MUX_TEST_VIDEOS, ...YOUTUBE_MUSIC_VIDEOS, ...YOUTUBE_CONTENT_VIDEOS]);
  const [feedbackVideo, setFeedbackVideo] = useState<RecVideo | null>(STATIC_FEEDBACK);

  const workRef    = useRef<HTMLDivElement>(null);
  const aboutRef   = useRef<HTMLDivElement>(null);
  const contactRef = useRef<HTMLDivElement>(null);

  // Buscar vídeos: 1º tabela rec_videos, 2º storage listing, 3º STATIC_VIDEOS hardcoded
  useEffect(() => {
    if (!isSupabaseConfigured) {
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

      // Gosta Suco sai da renderização pública. Aplica também as correções de título público
      // derivadas de storage_path (ex: "Duhlache DIA DO SOLTEIRO" → nome de marca real).
      const nonFeedback = data
        .filter((v) => !v.is_feedback && v.storage_path !== GOSTA_SUCO_STORAGE_PATH)
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
  // "Gosta Suco", removido da página pública), "Noite das Patroas" no meio e o terceiro
  // clipe Mux preservado na composição atual — igual
  // à composição anterior, só a posição do meio mudou. Busca por playbackId (não por
  // título) pra não quebrar quando o título público muda.
  // Precisa ser um vídeo REAL reproduzível no Hero (nativo/Supabase) — não basta
  // excluir "mux": o catálogo inicial estático também tem YouTube (thumbnail-only,
  // sem player de fundo), que "provider !== mux" deixava passar. Isso fazia o
  // primeiro render pegar um clipe do YouTube por engano, e o clipe certo só
  // chegava depois do fetch do Supabase resolver — essa troca de identidade
  // disparava um re-init do ScrollTrigger (useGSAP em RecHero) que duplicava o
  // pin-spacer (era o bug real por trás do "pin dobrado").
  const heroVideoA = videos.find(
    (v) => v.provider !== "mux" && v.provider !== "youtube" && v.storage_path !== GOSTA_SUCO_STORAGE_PATH
  ) ?? HERO_DIA_DO_SOLTEIRO;
  const heroNoiteDasPatroas = videos.find((v) => v.playbackId === "wuN26wNRNNZIIkHWcBMxHVJqihavjFHnR02Ji2Iz9eOI");
  const heroThirdVideo = videos.find((v) => v.playbackId === "7HVIKdAWNXYTnsl1PaMn01m009QOCOLuVclX5XaMlewGU");
  const heroVideos = [
    heroVideoA,
    ...(heroNoiteDasPatroas ? [heroNoiteDasPatroas] : []),
    ...(heroThirdVideo ? [heroThirdVideo] : []),
  ];

  // Catálogo editorial — separado por workType, sem duplicar componente por categoria.
  // "Aftermovie" não vem desse catálogo: é o FilmSection (conteúdo real já existente,
  // "O dia dela" / Maria Clara XV anos), reposicionado antes do Sandubão nesta rodada.
  const commercialVideos  = videos.filter((v) => v.show_in_cards && v.storage_path !== GOSTA_SUCO_STORAGE_PATH && (v.workType ?? "commercial") === "commercial");
  const vtVideos          = videos.filter((v) => v.show_in_cards && v.workType === "vt");
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
        HOTFIX (Hero/Clientes handoff): a correção anterior usava um overlap de
        -90vh/-94vh — fechava o vão, mas como esse deslocamento é fixo (não depende
        do scroll), o Clientes ficava dentro da altura do viewport (900/844px) desde
        o primeiro frame, sobrepondo a headline/"Mas não é somente vídeo..." o tempo
        todo, não só no fim. Reduzido pra um overlap pequeno (px fixos, não vh) —
        pequeno o bastante pra nunca alcançar a área central onde ficam as headlines
        (ambas ficam verticalmente centralizadas, bem longe da borda inferior), mas
        suficiente pra fechar o vão residual que sobra depois que o Hero termina de
        rolar naturalmente após o unpin, sem reintroduzir a "viewport quase vazia".
      */}
      <div style={{ position: "relative", height: 0 }}>
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: .8, ease: [0.16, 1, 0.3, 1] }}
          style={{ position: "absolute", top: isMobile ? "-56px" : "-84px", left: 0, right: 0, zIndex: 5 }}
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
        videos={vtVideos}
        isMobile={isMobile}
        onOpen={setModalVideo}
        kicker="[VT / Campanhas]"
        heading="VT / Campanhas"
      />

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
