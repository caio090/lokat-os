"use client";
import { useEffect, useState } from "react";
import MuxPlayer, { type MuxCSSProperties } from "@mux/mux-player-react";
import type MuxPlayerElement from "@mux/mux-player";
import { Play } from "lucide-react";
import type { RecVideo } from "@/lib/rec-videos";
import { youtubeMaxThumb, youtubeFallbackThumb } from "../_lib/data";
import { R } from "../_lib/tokens";

type MediaHandle = HTMLVideoElement | MuxPlayerElement;

// HAVE_CURRENT_DATA — abaixo disso, chamar play() no mux-player corre risco real de
// AbortError ("interrupted by a new load request"): o player ainda está resolvendo a
// renditon/manifesto inicial internamente e um play() prematuro colide com esse setup.
const READY_ENOUGH = 2;

export function PreviewMedia({
  video, shouldPlay, onError,
}: {
  video: RecVideo;
  shouldPlay: boolean;
  onError?: () => void;
}) {
  // Ref por estado (não useRef): o mux-player carrega o custom element de forma
  // lazy (~2-3s depois do mount). Com useRef, o efeito de play/pause podia rodar
  // uma única vez com `el` ainda nulo (antes do elemento existir) e nunca mais
  // re-executar, porque `shouldPlay` não muda de novo — o vídeo ficava
  // permanentemente pausado no frame 0. Usando estado, o setter também serve de
  // ref callback: quando o elemento real finalmente monta, o efeito roda de novo
  // com uma referência válida.
  const [el, setEl] = useState<MediaHandle | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!el) return;

    if (!shouldPlay) {
      el.pause();
      // `el` é o nó DOM de mídia (video/mux-player), não dado de estado do React —
      // resetar currentTime é uma mutação externa legítima, não uma violação de imutabilidade.
      // eslint-disable-next-line react-hooks/immutability
      el.currentTime = 0;
      return;
    }

    const tryPlay = () => { Promise.resolve(el.play()).catch(() => undefined); };

    if (el.readyState >= READY_ENOUGH) {
      tryPlay();
      return;
    }
    // Ainda não carregou o suficiente — espera o evento em vez de forçar play() cedo demais.
    el.addEventListener("loadeddata", tryPlay, { once: true });
    return () => el.removeEventListener("loadeddata", tryPlay);
  }, [el, shouldPlay]);

  const handleReady = () => setReady(true);

  // Poster real sempre por baixo, sem gate de opacity — evita a "primeira dobra
  // preta" enquanto o vídeo carrega. Mux já tem thumbnail próprio (thumbnail_url);
  // o vídeo do Hero (Dia do Solteiro) ganhou um frame real extraído via ffmpeg
  // (ver applyStorageTitleOverride). Sem poster confirmado, cai no bg sólido —
  // nunca um poster inventado/genérico.
  const poster = video.thumbnail_url;

  if (video.provider === "mux" && video.playbackId) {
    const muxStyle: MuxCSSProperties = {
      position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 1,
      "--controls": "none", "--media-object-fit": "cover",
      opacity: ready ? 1 : 0, transition: "opacity .3s ease",
    };
    return (
      <>
        {poster && <PosterLayer src={poster} />}
        <MuxPlayer
          ref={setEl}
          playbackId={video.playbackId}
          streamType="on-demand"
          muted
          loop
          playsInline
          preload="metadata"
          poster={poster ?? undefined}
          style={muxStyle}
          onCanPlay={handleReady}
          onError={onError}
        />
      </>
    );
  }

  // YouTube: preview é só a thumbnail real — sem autoplay, sem iframe pesado carregado
  // de cara. O player completo só entra no modal, ao clicar (ver VideoModal).
  if (video.provider === "youtube" && video.youtubeId) {
    return <YoutubeThumb youtubeId={video.youtubeId} onError={onError} />;
  }

  return (
    <>
      {poster && <PosterLayer src={poster} />}
      <video
        ref={setEl}
        src={video.video_url}
        poster={poster ?? undefined}
        muted loop playsInline preload="metadata"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 1, opacity: ready ? 1 : 0, transition: "opacity .3s ease" }}
        onCanPlay={handleReady}
        onError={onError}
      />
    </>
  );
}

// Camada de poster sempre visível por baixo do vídeo (zIndex 0) — o vídeo (zIndex 1)
// entra por cima com um crossfade curto assim que estiver pronto. Decidido separado
// do atributo `poster` nativo porque esse suporte varia entre navegador/mux-player;
// como <img> simples é sempre confiável.
function PosterLayer({ src }: { src: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0 }} />
  );
}

function YoutubeThumb({ youtubeId, onError }: { youtubeId: string; onError?: () => void }) {
  const [src, setSrc] = useState(youtubeMaxThumb(youtubeId));
  const [triedFallback, setTriedFallback] = useState(false);
  const [loaded, setLoaded] = useState(false);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        onLoad={(e) => {
          // Quando maxresdefault não existe, o YouTube responde 404 mas com um
          // placeholder cinza de 120x90 — a imagem "carrega" (onError nunca dispara),
          // então o fallback real é detectar essa largura específica, não só onError.
          if (!triedFallback && e.currentTarget.naturalWidth <= 120) {
            setTriedFallback(true);
            setSrc(youtubeFallbackThumb(youtubeId));
            return;
          }
          setLoaded(true);
        }}
        onError={() => {
          if (!triedFallback) { setTriedFallback(true); setSrc(youtubeFallbackThumb(youtubeId)); }
          else onError?.();
        }}
        style={{ width: "100%", height: "100%", objectFit: "cover", opacity: loaded ? 1 : 0, transition: "opacity .35s ease" }}
      />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ width: "48px", height: "48px", border: `1px solid ${R.red}70`, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(8,7,6,0.4)" }}>
          <Play style={{ width: "16px", height: "16px", color: R.text, marginLeft: "2px" }} strokeWidth={1.5} />
        </div>
      </div>
    </div>
  );
}
