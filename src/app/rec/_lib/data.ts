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

// Teste 01 — primeiro trabalho servido via Mux (Playback ID público, sem credenciais).
// Cliente/categoria ainda não confirmados: ficam ausentes de propósito, não inventados.
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

// Teste 02 — segundo Playback ID Mux recebido sem título/cliente/categoria confirmados.
// Título abaixo é um rótulo provisório de teste, não um nome de trabalho real — não inventado.
export const MUX_TEST_VIDEO_2: RecVideo = {
  id: "mux-test-2",
  title: "Teste Mux 02",
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

// Teste 03 — novo Playback ID Mux (rodada "Portfólio + Parallax"). Substitui o vídeo
// "Gosta Suco" na listagem de Comerciais (esse continua servindo o Hero normalmente).
export const MUX_TEST_VIDEO_3: RecVideo = {
  id: "mux-test-3",
  title: "Teste Mux 03",
  client_name: null,
  category: null,
  workType: "commercial",
  provider: "mux",
  playbackId: "I5XRAObcrjynzumvWfGutXe00eFgt02et4fG9Xp3AVIew",
  video_url: "https://stream.mux.com/I5XRAObcrjynzumvWfGutXe00eFgt02et4fG9Xp3AVIew.m3u8",
  storage_path: null,
  thumbnail_url: "https://image.mux.com/I5XRAObcrjynzumvWfGutXe00eFgt02et4fG9Xp3AVIew/thumbnail.jpg",
  is_public: true, is_featured: false, is_feedback: false, show_in_cards: true,
  sort_order: 1001, status: "active", description: null, created_at: "",
};

export const MUX_TEST_VIDEOS: RecVideo[] = [MUX_TEST_VIDEO, MUX_TEST_VIDEO_2, MUX_TEST_VIDEO_3];

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

// Rótulo pequeno/secundário por categoria — usado entre parênteses junto ao título.
export function workTypeLabel(workType: RecVideo["workType"]): string {
  switch (workType) {
    case "music-video": return "videoclipe";
    case "aftermovie":  return "aftermovie";
    case "content":     return "conteúdo";
    default:            return "comercial";
  }
}

// Nome de arquivo real usado pra identificar o vídeo "da Já" no catálogo dinâmico do
// Supabase Storage — confirmado com o usuário (não é o mesmo que "Dia dos Solteiros").
export const GOSTA_SUCO_STORAGE_PATH = "duhlanche-GOSTA-SUCO.mp4";

// Ano legível a partir de created_at — nunca inventa dado que não existe.
export function yearOf(video: RecVideo): string | null {
  if (!video.created_at) return null;
  const d = new Date(video.created_at);
  if (Number.isNaN(d.getTime())) return null;
  return String(d.getFullYear());
}
