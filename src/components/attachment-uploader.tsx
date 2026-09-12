"use client";
import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured, createClient } from "@/lib/supabase/client";
import {
  Link2, Upload, X, FileText, Film, Image, File, Loader2, AlertCircle, CheckCircle2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────

export interface AttachmentValue {
  url: string;
  name: string;
  type: string;
  size: number;
  source: "external_link" | "local_upload";
  storagePath?: string;
}

interface Props {
  value: AttachmentValue | null;
  onChange: (val: AttachmentValue | null) => void;
  label?: string;
  placeholder?: string;
  taskId?: string;
  disabled?: boolean;
  storagePathPrefix?: string;
}

// ── Constants ─────────────────────────────────────────────────

const ACCEPTED_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/svg+xml",
  "video/mp4", "video/quicktime", "video/webm",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "application/zip",
  "application/x-rar-compressed",
  "application/octet-stream", // .fig, .psd, .ai, .xd, .indd
].join(",");

const ACCEPTED_EXT = ".jpg,.jpeg,.png,.webp,.svg,.mp4,.mov,.webm,.pdf,.doc,.docx,.txt,.psd,.ai,.fig,.xd,.indd,.zip,.rar";

const MAX_SIZE_MB = 50;
const BUCKET = "operational-attachments";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(type: string) {
  if (type.startsWith("image/")) return <Image className="w-4 h-4 text-blue-400" />;
  if (type.startsWith("video/")) return <Film className="w-4 h-4 text-purple-400" />;
  if (type === "application/pdf") return <FileText className="w-4 h-4 text-red-400" />;
  return <File className="w-4 h-4 text-gray-400" />;
}

// ── Component ─────────────────────────────────────────────────

export function AttachmentUploader({
  value,
  onChange,
  label,
  placeholder = "Cole o link do arquivo (Drive, Dropbox, WeTransfer…)",
  taskId,
  disabled = false,
  storagePathPrefix,
}: Props) {
  const [tab,       setTab]       = useState<"link" | "upload">("link");
  const [linkInput, setLinkInput] = useState(value?.source === "external_link" ? value.url : "");
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [dragOver,  setDragOver]  = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Link mode ────────────────────────────────────────────────

  function commitLink(url: string) {
    const trimmed = url.trim();
    if (!trimmed) { onChange(null); return; }
    onChange({ url: trimmed, name: trimmed, type: "external_link", size: 0, source: "external_link" });
  }

  // ── Upload mode ──────────────────────────────────────────────

  const uploadFile = useCallback(async (file: File) => {
    if (disabled) return;
    setUploadErr(null);

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setUploadErr(`Arquivo muito grande. Máximo: ${MAX_SIZE_MB} MB.`);
      return;
    }

    if (!isSupabaseConfigured) {
      setUploadErr("Storage não configurado. Use o link externo.");
      return;
    }

    setUploading(true);
    try {
      const supabase  = createClient();
      const prefix    = storagePathPrefix ?? taskId ?? "misc";
      const filePath  = `${prefix}/${Date.now()}-${file.name}`;

      const { data, error } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, file, { upsert: false });

      if (error) {
        if (error.message?.includes("Bucket not found") || error.message?.includes("bucket")) {
          setUploadErr("Bucket não encontrado. Crie 'operational-attachments' no Supabase Storage ou use link externo.");
        } else {
          setUploadErr(`Erro no upload: ${error.message}`);
        }
        setUploading(false);
        return;
      }

      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(data.path);

      onChange({
        url:         publicUrl,
        name:        file.name,
        type:        file.type,
        size:        file.size,
        source:      "local_upload",
        storagePath: data.path,
      });
    } catch {
      setUploadErr("Erro inesperado no upload. Tente novamente ou use link externo.");
    }
    setUploading(false);
  }, [disabled, storagePathPrefix, taskId, onChange]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  // ── Already has value ─────────────────────────────────────────

  if (value) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 flex items-center gap-2.5">
        {value.source === "local_upload" ? (
          <>{fileIcon(value.type)}</>
        ) : (
          <Link2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-emerald-800 truncate">{value.name}</p>
          {value.size > 0 && (
            <p className="text-[10px] text-emerald-600">{formatBytes(value.size)}</p>
          )}
          {value.source === "external_link" && (
            <p className="text-[10px] text-emerald-500 truncate">{value.url.slice(0, 60)}{value.url.length > 60 ? "…" : ""}</p>
          )}
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => { onChange(null); setLinkInput(""); }}
            className="p-1 rounded-lg hover:bg-emerald-200 text-emerald-600 flex-shrink-0 transition-colors"
            title="Remover"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  }

  // ── Input mode ────────────────────────────────────────────────

  return (
    <div className="space-y-2">
      {label && <p className="text-xs font-semibold text-gray-700">{label}</p>}

      {/* Tabs */}
      <div className="flex rounded-xl overflow-hidden border border-gray-200 w-fit">
        <button
          type="button"
          onClick={() => { setTab("link"); setUploadErr(null); }}
          disabled={disabled}
          className={cn(
            "flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 transition-colors",
            tab === "link"
              ? "bg-indigo-600 text-white"
              : "bg-white text-gray-500 hover:text-gray-700",
          )}
        >
          <Link2 className="w-3 h-3" /> Link
        </button>
        <button
          type="button"
          onClick={() => { setTab("upload"); setUploadErr(null); }}
          disabled={disabled}
          className={cn(
            "flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 transition-colors border-l border-gray-200",
            tab === "upload"
              ? "bg-indigo-600 text-white"
              : "bg-white text-gray-500 hover:text-gray-700",
          )}
        >
          <Upload className="w-3 h-3" /> Upload
        </button>
      </div>

      {/* Link tab */}
      {tab === "link" && (
        <div className="flex items-center gap-1.5">
          <Link2 className="w-3 h-3 text-gray-400 flex-shrink-0" />
          <input
            type="url"
            placeholder={placeholder}
            value={linkInput}
            disabled={disabled}
            onChange={(e) => { setLinkInput(e.target.value); commitLink(e.target.value); }}
            className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-300 bg-white placeholder-gray-400 disabled:opacity-50"
          />
        </div>
      )}

      {/* Upload tab */}
      {tab === "upload" && (
        <div className="space-y-2">
          {/* Drag-drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !disabled && !uploading && fileRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-xl px-4 py-5 text-center cursor-pointer transition-colors",
              dragOver
                ? "border-indigo-400 bg-indigo-50"
                : "border-gray-200 hover:border-gray-300 bg-gray-50",
              (disabled || uploading) && "opacity-50 cursor-not-allowed",
            )}
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
                <p className="text-xs text-gray-500">Enviando arquivo…</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5">
                <Upload className="w-5 h-5 text-gray-300" />
                <p className="text-xs font-medium text-gray-600">Arraste o arquivo aqui ou clique para selecionar</p>
                <p className="text-[10px] text-gray-400">Imagens, vídeos, PDF, PSD, AI, Fig, ZIP — até {MAX_SIZE_MB} MB</p>
              </div>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_TYPES + "," + ACCEPTED_EXT}
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Note if storage not configured */}
          {!isSupabaseConfigured && (
            <div className="flex items-start gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-2">
              <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
              Upload local será ativado após configurar o armazenamento. Por enquanto, use o link do arquivo.
            </div>
          )}

          {/* Error */}
          {uploadErr && (
            <div className="flex items-start gap-1.5 text-[10px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-2.5 py-2">
              <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
              {uploadErr}
            </div>
          )}
        </div>
      )}

      {/* Preview (image preview after URL input when link is an image) */}
      {tab === "link" && linkInput.match(/\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i) && (
        <div className="mt-1 flex items-center gap-2 text-[10px] text-emerald-600">
          <CheckCircle2 className="w-3 h-3" /> Link de imagem detectado
        </div>
      )}
    </div>
  );
}
