import type { RecVideo } from "@/lib/rec-videos";

// URL base do bucket Supabase — preenchida automaticamente pelo env var
const SUPABASE_REC_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/rec-videos`
  : "";

// Monta URL pública com encoding correto (suporta espaços no nome)
export function recUrl(filename: string): string {
  if (!SUPABASE_REC_BASE) return "";
  return `${SUPABASE_REC_BASE}/${encodeURIComponent(filename)}`;
}

function mkv(id: string, title: string, file: string, category: string, order: number): RecVideo {
  return { id, title, client_name: "Sandubão", category, video_url: recUrl(file), storage_path: file, thumbnail_url: null, is_public: true, is_featured: false, is_feedback: false, show_in_cards: true, sort_order: order, status: "active", description: null, created_at: "" };
}

// Filenames exatos do bucket rec-videos no Supabase Storage
export const STATIC_VIDEOS: RecVideo[] = [
  mkv("s0", "Dia dos Solteiros",  "duhlache-DIA -DO-SOLTEIRO.mp4", "campanha", 0),
  { ...mkv("s1", "DUH Lanches",  "duhlanche1.mp4",            "campanha", 1),   client_name: "DUH Lanches" },
  { ...mkv("s2", "Vol. 2",       "duhlache2.mp4",             "campanha", 2),   client_name: "DUH Lanches" },
  { ...mkv("s3", "Vol. 3",       "duhlanche3.mp4",            "campanha", 3),   client_name: "DUH Lanches" },
  { ...mkv("s4", "Vol. 4",       "duhlanche4.mp4",            "campanha", 4),   client_name: "DUH Lanches" },
  { ...mkv("s5", "Vol. 5",       "dulanche5.mp4",             "campanha", 5),   client_name: "DUH Lanches" },
  { ...mkv("s6", "VT HP",        "VT HP II 30 SEG V2.mp4",   "institucional", 6), client_name: "DUH Lanches" },
];

export const STATIC_FEEDBACK: RecVideo = {
  id: "fb1", title: "Depoimento Sandubão", client_name: "Sandubão", category: "feedback",
  video_url: recUrl("feedbackduh.mp4"),
  storage_path: "feedbackduh.mp4", thumbnail_url: null,
  is_public: true, is_featured: true, is_feedback: true, show_in_cards: false,
  sort_order: 999, status: "active", description: null, created_at: "",
};

// Mux 7HV: o histórico do catálogo comprova "A Certeza!" como título original.
// O rótulo "Lanche da Madrugada" foi aplicado a este ID sem confirmação e não
// deve continuar público até que o vídeo correto seja identificado.
export const MUX_TEST_VIDEO: RecVideo = {
  id: "mux-test-1",
  title: "A Certeza!",
  client_name: null,
  category: null,
  provider: "mux",
  playbackId: "7HVIKdAWNXYTnsl1PaMn01m009QOCOLuVclX5XaMlewGU",
  video_url: "https://stream.mux.com/7HVIKdAWNXYTnsl1PaMn01m009QOCOLuVclX5XaMlewGU.m3u8",
  storage_path: null,
  thumbnail_url: "https://image.mux.com/7HVIKdAWNXYTnsl1PaMn01m009QOCOLuVclX5XaMlewGU/thumbnail.jpg",
  is_public: true, is_featured: false, is_feedback: false, show_in_cards: true,
  sort_order: 999, status: "active", description: null, created_at: "",
};

// Centro de Neurodesenvolvimento — thumbnail mostra a mulher falando com a
// identidade da Medical ao fundo/roupa. Título público confirmado pelo usuário,
// substituindo o rótulo antigo "Teste Mux 02". Nome de cliente separado ainda
// não confirmado — fica ausente de propósito, não inventado.
export const MUX_TEST_VIDEO_2: RecVideo = {
  id: "mux-test-2",
  title: "Centro de Neurodesenvolvimento",
  client_name: null,
  category: null,
  provider: "mux",
  playbackId: "pW4w5jFqRfa5jnVQh9gCxQAoSyKBf78g902UaOwomopg",
  video_url: "https://stream.mux.com/pW4w5jFqRfa5jnVQh9gCxQAoSyKBf78g902UaOwomopg.m3u8",
  storage_path: null,
  thumbnail_url: "https://image.mux.com/pW4w5jFqRfa5jnVQh9gCxQAoSyKBf78g902UaOwomopg/thumbnail.jpg",
  is_public: true, is_featured: false, is_feedback: false, show_in_cards: true,
  sort_order: 1000, status: "active", description: null, created_at: "",
};

// Playback ID da rodada "Portfólio + Parallax" — perdeu a posição visual pra
// "Noite das Patroas" nesta rodada ("REC COMMERCIALS + HERO HANDOFF"), mas
// permanece no catálogo (Playback ID não removido, só reposicionado mais
// adiante em Comerciais). Nome de campanha/cliente ainda não confirmado —
// título fica vazio de propósito (não inventar, não mostrar rótulo de teste
// publicamente). Playback ID: I5XRAObcrjynzumvWfGutXe00eFgt02et4fG9Xp3AVIew.
export const MUX_TEST_VIDEO_3: RecVideo = {
  id: "mux-test-3",
  title: "Duh Lanches — Lanche da Madrugada",
  client_name: null,
  category: null,
  workType: "commercial",
  provider: "mux",
  playbackId: "I5XRAObcrjynzumvWfGutXe00eFgt02et4fG9Xp3AVIew",
  video_url: "https://stream.mux.com/I5XRAObcrjynzumvWfGutXe00eFgt02et4fG9Xp3AVIew.m3u8",
  storage_path: null,
  thumbnail_url: "https://image.mux.com/I5XRAObcrjynzumvWfGutXe00eFgt02et4fG9Xp3AVIew/thumbnail.jpg",
  is_public: true, is_featured: false, is_feedback: false, show_in_cards: true,
  sort_order: 1004, status: "active", description: null, created_at: "",
};

// Noite das Patroas — título confirmado pelo usuário, assume a posição visual
// que antes pertencia ao "Teste Mux 03" em Comerciais.
export const MUX_NOITE_DAS_PATROAS: RecVideo = {
  id: "mux-noite-das-patroas",
  title: "Noite das Patroas",
  client_name: null,
  category: null,
  workType: "commercial",
  provider: "mux",
  playbackId: "wuN26wNRNNZIIkHWcBMxHVJqihavjFHnR02Ji2Iz9eOI",
  video_url: "https://stream.mux.com/wuN26wNRNNZIIkHWcBMxHVJqihavjFHnR02Ji2Iz9eOI.m3u8",
  storage_path: null,
  thumbnail_url: "https://image.mux.com/wuN26wNRNNZIIkHWcBMxHVJqihavjFHnR02Ji2Iz9eOI/thumbnail.jpg",
  is_public: true, is_featured: false, is_feedback: false, show_in_cards: true,
  sort_order: 1002, status: "active", description: null, created_at: "",
};

// Dia dos Pais — VT horizontal de campanha, em seção editorial própria.
export const MUX_DIA_DOS_PAIS: RecVideo = {
  id: "mux-dia-dos-pais",
  title: "Dia dos Pais",
  client_name: null,
  category: null,
  workType: "vt",
  workSubtype: "campaign-vt",
  provider: "mux",
  playbackId: "77sY5fDYL22Tp7upR02sR4eib600jRoyxwyLpdmhklBho",
  video_url: "https://stream.mux.com/77sY5fDYL22Tp7upR02sR4eib600jRoyxwyLpdmhklBho.m3u8",
  storage_path: null,
  thumbnail_url: "https://image.mux.com/77sY5fDYL22Tp7upR02sR4eib600jRoyxwyLpdmhklBho/thumbnail.jpg",
  is_public: true, is_featured: false, is_feedback: false, show_in_cards: true,
  sort_order: 1003, status: "active", description: null, created_at: "",
};

// Ordem editorial dos trabalhos Mux comerciais; o VT é renderizado em seção própria.
export const MUX_TEST_VIDEOS: RecVideo[] = [
  MUX_TEST_VIDEO,
  MUX_TEST_VIDEO_2,
  MUX_NOITE_DAS_PATROAS,
  MUX_DIA_DOS_PAIS,
  MUX_TEST_VIDEO_3,
];

// Thumbnail real do YouTube a partir do ID — maxresdefault nem sempre existe (vídeos
// verticais/curtos às vezes não geram essa resolução); o componente de preview faz
// fallback pra hqdefault via onError, que sempre existe.
export function youtubeMaxThumb(id: string): string {
  return `https://img.youtube.com/vi/${id}/maxresdefault.jpg`;
}
export function youtubeFallbackThumb(id: string): string {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

// Videoclipes reais — título e artista/canal confirmados via oEmbed público do
// próprio YouTube (https://www.youtube.com/oembed?url=...), não inventados.
export const YOUTUBE_MUSIC_VIDEO_1: RecVideo = {
  id: "yt-mv-1",
  title: "kotarx - ghostface",
  client_name: "kotarx",
  category: null,
  workType: "music-video",
  provider: "youtube",
  youtubeId: "TyVxOzHN5yU",
  video_url: "https://youtu.be/TyVxOzHN5yU",
  storage_path: null,
  thumbnail_url: youtubeMaxThumb("TyVxOzHN5yU"),
  is_public: true, is_featured: false, is_feedback: false, show_in_cards: true,
  sort_order: 1100, status: "active", description: null, created_at: "",
};

export const YOUTUBE_MUSIC_VIDEO_2: RecVideo = {
  id: "yt-mv-2",
  title: "Terço",
  client_name: "Eddi",
  category: null,
  workType: "music-video",
  provider: "youtube",
  youtubeId: "0CUEm8hPYII",
  video_url: "https://youtu.be/0CUEm8hPYII",
  storage_path: null,
  thumbnail_url: youtubeMaxThumb("0CUEm8hPYII"),
  is_public: true, is_featured: false, is_feedback: false, show_in_cards: true,
  sort_order: 1101, status: "active", description: null, created_at: "",
};

export const YOUTUBE_MUSIC_VIDEOS: RecVideo[] = [YOUTUBE_MUSIC_VIDEO_1, YOUTUBE_MUSIC_VIDEO_2];

// Conteúdo/vlog — mesma origem (oEmbed real, não inventado). Canal "explorando felicidades".
export const YOUTUBE_CONTENT_VIDEO_1: RecVideo = {
  id: "yt-content-1",
  title: "EP. 01 — O Sonho Começou! Rumo ao Ushuaia de Bike",
  client_name: "explorando felicidades",
  category: null,
  workType: "content",
  provider: "youtube",
  youtubeId: "Bs0c_USc9-A",
  video_url: "https://youtu.be/Bs0c_USc9-A",
  storage_path: null,
  thumbnail_url: youtubeMaxThumb("Bs0c_USc9-A"),
  is_public: true, is_featured: false, is_feedback: false, show_in_cards: true,
  sort_order: 1200, status: "active", description: null, created_at: "",
};

export const YOUTUBE_CONTENT_VIDEOS: RecVideo[] = [YOUTUBE_CONTENT_VIDEO_1];

// Rótulo pequeno/secundário por categoria — usado junto ao título.
export function workTypeLabel(workType: RecVideo["workType"], workSubtype?: RecVideo["workSubtype"]): string {
  if (workType === "vt" || workSubtype === "campaign-vt") return "VT de campanha";
  switch (workType) {
    case "music-video": return "videoclipe";
    case "aftermovie":  return "aftermovie";
    case "content":     return "conteúdo";
    default:            return "comercial";
  }
}

// Nome de arquivo real usado pra identificar o vídeo "da Já" no catálogo dinâmico do
// Supabase Storage — confirmado com o usuário (não é o mesmo que "Dia dos Solteiros").
// Usado só pra composição do Hero nesta rodada: o vídeo continua normalmente em
// Comerciais (rodada "CORREÇÃO IMPORTANTE - HERO REC" reverteu o show_in_cards:false
// de uma rodada anterior — só sai do Hero, não do catálogo/seção).
export const GOSTA_SUCO_STORAGE_PATH = "duhlanche-GOSTA-SUCO.mp4";

// Metadados editoriais confirmados para registros que chegam do Supabase.
// Não altera banco/Storage; apenas normaliza a apresentação pública.
export function applyEditorialOverride(video: RecVideo): RecVideo {
  if (video.playbackId === MUX_TEST_VIDEO.playbackId) {
    return { ...video, title: "A Certeza!", workType: "commercial", workSubtype: undefined };
  }
  if (video.playbackId === MUX_DIA_DOS_PAIS.playbackId) {
    return { ...video, title: "Dia dos Pais", workType: "vt", workSubtype: "campaign-vt" };
  }
  if (video.playbackId === MUX_TEST_VIDEO_3.playbackId) {
    return { ...video, title: "Duh Lanches — Lanche da Madrugada", workType: "commercial" };
  }
  return video;
}

// Correções de título/poster público por storage_path — o listing dinâmico do
// Supabase Storage deriva o título do nome do arquivo (prettifyName), o que
// produzia rótulos técnicos ("Duhlache DIA DO SOLTEIRO") e nunca tem poster
// (thumbnail_url sempre null). O poster é um frame real extraído via ffmpeg do
// próprio vídeo (não gerado/inventado) — usado no Hero pra evitar a "primeira
// dobra preta" enquanto o vídeo carrega, especialmente em conexões mais lentas.
const STORAGE_OVERRIDES: Record<string, { title: string; thumbnail_url?: string }> = {
  "duhlache-DIA -DO-SOLTEIRO.mp4": { title: "Duh Lanches — Dia do Solteiro", thumbnail_url: "/rec/posters/dia-do-solteiro-poster.webp" },
};

export function applyStorageTitleOverride(video: RecVideo): RecVideo {
  const override = video.storage_path ? STORAGE_OVERRIDES[video.storage_path] : undefined;
  return applyEditorialOverride(override ? { ...video, ...override } : video);
}

// Referência direta e imediata do 1º clipe real do Hero (Dia do Solteiro) — usa
// recUrl() (só precisa do env var, já disponível no bundle, zero fetch) em vez de
// esperar o catálogo assíncrono do Supabase (getPublicRecVideos/getVideosFromStorage)
// resolver. Antes disso, o Hero inteiro (inclusive os 2 clipes Mux, que também são
// constantes estáticas sem dependência de rede nenhuma) ficava esperando essa
// única promise global — em conexão lenta, a "primeira dobra" da página inteira
// ficava sem nenhum vídeo por vários segundos. Mesmo arquivo/URL que o listing
// dinâmico acabaria descobrindo; só evita a espera.
export const HERO_DIA_DO_SOLTEIRO: RecVideo = {
  id: "hero-dia-do-solteiro",
  title: "Duh Lanches — Dia do Solteiro",
  client_name: "LOKAT.REC",
  category: "campanha",
  video_url: recUrl("duhlache-DIA -DO-SOLTEIRO.mp4"),
  storage_path: "duhlache-DIA -DO-SOLTEIRO.mp4",
  thumbnail_url: "/rec/posters/dia-do-solteiro-poster.webp",
  is_public: true, is_featured: false, is_feedback: false, show_in_cards: true,
  sort_order: 0, status: "active", description: null, created_at: "",
};

// Ano legível a partir de created_at — nunca inventa dado que não existe.
export function yearOf(video: RecVideo): string | null {
  if (!video.created_at) return null;
  const d = new Date(video.created_at);
  if (Number.isNaN(d.getTime())) return null;
  return String(d.getFullYear());
}
