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
} from "./_lib/data";
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

      // "Vídeo da Já" (Gosta Suco): sai da listagem de Comerciais, mas continua no
      // catálogo completo — o Hero lê daqui e não filtra por show_in_cards.
      const nonFeedback = data
        .filter((v) => !v.is_feedback)
        .map((v) => v.storage_path === GOSTA_SUCO_STORAGE_PATH ? { ...v, show_in_cards: false } : v);

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

  // Hero 03: 2 vídeos reais já em catálogo (Supabase) + o teste Mux "A Certeza!", nessa ordem.
  // Lê do catálogo completo (não filtrado por show_in_cards) — por isso "Gosta Suco"
  // continua aparecendo aqui mesmo depois de sair da listagem de Comerciais.
  const muxCerteza = videos.find((v) => v.provider === "mux" && v.title === "A Certeza!");
  const heroVideos = [
    ...videos.filter((v) => v.provider !== "mux").slice(0, 2),
    ...(muxCerteza ? [muxCerteza] : []),
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
        onNavContato={() => scrollTo(contactRef)}
      />

      <RecHero
        heroVideos={heroVideos}
        isMobile={isMobile}
        reducedMotion={reducedMotion}
        onScrollToWork={() => scrollTo(workRef)}
      />

      <motion.div
        initial={{ opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: .8, ease: [0.16, 1, 0.3, 1] }}
      >
        <ClientCasesMarquee isMobile={isMobile} />
      </motion.div>

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
