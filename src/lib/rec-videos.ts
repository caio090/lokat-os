"use client";
import { createClient } from "@/lib/supabase/client";

export interface RecVideo {
  id: string;
  title: string;
  description: string | null;
  client_name: string | null;
  category: string | null;
  video_url: string;
  storage_path: string | null;
  thumbnail_url: string | null;
  is_public: boolean;
  is_featured: boolean;
  is_feedback: boolean;
  show_in_cards: boolean;
  sort_order: number;
  status: string;
  created_at: string;
  // Provedor de mídia — ausente/"supabase" mantém o comportamento atual (video_url do Storage).
  // "mux" usa playbackId; "youtube" usa youtubeId. Nenhum dos dois usa video_url pra tocar
  // (fica só como referência/fallback), mas o campo continua obrigatório por compatibilidade.
  provider?: "supabase" | "mux" | "youtube";
  playbackId?: string | null;
  youtubeId?: string | null;
  // Categoria editorial do trabalho — controla em qual seção do portfólio ele aparece.
  // Ausente = tratado como "commercial" (mantém o comportamento anterior ao catálogo editorial).
  workType?: "commercial" | "music-video" | "aftermovie" | "content";
  // Subtipo editorial opcional — refina o rótulo dentro do mesmo workType sem criar
  // uma seção própria (ex: um VT de campanha continua em "commercial", só muda o
  // texto entre parênteses do card). Ausente = rótulo padrão do workType.
  workSubtype?: "social-commercial" | "campaign-vt";
}

export type RecVideoInsert = Omit<RecVideo, "id" | "created_at"> & { created_by?: string };

const BUCKET = "rec-videos";
const ALLOWED = ["video/mp4", "video/webm", "video/quicktime", "video/mov"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function prettifyName(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")          // remove extensão
    .replace(/^rec\/\d+-/, "")         // remove pasta rec/ + timestamp
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Lista arquivos diretamente do Storage — fallback quando tabela rec_videos não existe.
// Tenta raiz do bucket e subpasta rec/ (admin upload path).
export async function getVideosFromStorage(): Promise<RecVideo[]> {
  const supabase = createClient();
  const results: RecVideo[] = [];

  const paths = ["", "rec"];
  for (const prefix of paths) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: 100, sortBy: { column: "created_at", order: "asc" } });
    if (error || !data) continue;

    for (const file of data) {
      if (!file.name || file.name.endsWith("/") || !file.name.match(/\.(mp4|webm|mov)$/i)) continue;
      const storagePath = prefix ? `${prefix}/${file.name}` : file.name;
      // getPublicUrl já faz o encoding do path internamente — encodar aqui
      // duplicava o encoding (ex: espaço virava %2520) e o navegador bloqueava
      // o request via ORB para arquivos com espaço/caracteres especiais no nome.
      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
      const lower = file.name.toLowerCase();
      const isFeedback = lower.includes("feedback") || lower.includes("depoimento") || lower.includes("testemunho");
      results.push({
        id: file.id ?? storagePath,
        title: prettifyName(file.name),
        description: null,
        client_name: "LOKAT.REC",
        category: isFeedback ? "feedback" : "campanha",
        video_url: publicUrl,
        storage_path: storagePath,
        thumbnail_url: null,
        is_public: true,
        is_featured: isFeedback,
        is_feedback: isFeedback,
        show_in_cards: !isFeedback,
        sort_order: 0,
        status: "active",
        created_at: file.created_at ?? "",
      });
    }
  }
  return results;
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function getPublicRecVideos(): Promise<RecVideo[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("rec_videos")
    .select("*")
    .eq("is_public", true)
    .eq("status", "active")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data as RecVideo[]) ?? [];
}

export async function getAdminRecVideos(): Promise<RecVideo[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("rec_videos")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data as RecVideo[]) ?? [];
}

export async function createRecVideo(
  data: Omit<RecVideo, "id" | "created_at">
): Promise<{ data: RecVideo | null; error: string | null }> {
  const supabase = createClient();
  const { data: res, error } = await supabase
    .from("rec_videos")
    .insert(data)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: res as RecVideo, error: null };
}

export async function updateRecVideo(
  id: string,
  fields: Partial<Omit<RecVideo, "id" | "created_at">>
): Promise<{ error: string | null }> {
  const supabase = createClient();
  const { error } = await supabase.from("rec_videos").update(fields).eq("id", id);
  if (error) return { error: error.message };
  return { error: null };
}

export async function archiveRecVideo(id: string): Promise<{ error: string | null }> {
  return updateRecVideo(id, { status: "archived" });
}

// ── Storage upload ───────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function uploadRecVideoFile(file: File): Promise<{
  publicUrl: string | null;
  storagePath: string | null;
  error: string | null;
}> {
  if (!ALLOWED.includes(file.type)) {
    return { publicUrl: null, storagePath: null, error: "Tipo de arquivo não permitido. Use MP4, WebM ou MOV." };
  }

  const ext       = file.name.split(".").pop() ?? "mp4";
  const slug      = slugify(file.name.replace(/\.[^.]+$/, ""));
  const path      = `rec/${Date.now()}-${slug}.${ext}`;
  const supabase  = createClient();

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });

  if (uploadError) {
    return { publicUrl: null, storagePath: null, error: uploadError.message };
  }

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { publicUrl, storagePath: path, error: null };
}
