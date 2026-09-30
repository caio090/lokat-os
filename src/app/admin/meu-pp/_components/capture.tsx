"use client";

import { useId, useState } from "react";
import { Mic, Square } from "lucide-react";
import { useJarvisVoice } from "@/components/jarvis/use-jarvis-voice";
import { CAPTURE_LABEL, CAPTURE_TYPES, buildCapturePreview, suggestCaptureType, type CapturePreview, type CaptureType } from "@/lib/meu-pp/domain";
import { ErrorLine, Field, cls, useMeuPpAction } from "./ui";

/**
 * "O que está na sua cabeça?" — texto (ou voz, reaproveitando a transcrição
 * autenticada existente: áudio só em memória, nada persistido) → sugestão
 * LOCAL de tipo → preview editável → CONFIRMAR. Nada é gravado antes da
 * confirmação; descartar o preview não grava nada.
 */
export function CaptureBox({ dateKey, priorityCount }: { dateKey: string; priorityCount: number }) {
  const { run, busy, error, setError } = useMeuPpAction();
  const voice = useJarvisVoice();
  const inputId = useId();
  const [raw, setRaw] = useState("");
  const [source, setSource] = useState<"text" | "voice">("text");
  const [stage, setStage] = useState<"write" | "preview">("write");
  const [suggested, setSuggested] = useState<CaptureType>("note");
  const [type, setType] = useState<CaptureType>("note");
  const [preview, setPreview] = useState<CapturePreview>({ title: "" });
  const [focusToday, setFocusToday] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const analyze = () => {
    const text = raw.trim();
    if (!text) return;
    const s = suggestCaptureType(text);
    setSuggested(s);
    setType(s);
    setPreview(buildCapturePreview(text, s, dateKey));
    setFocusToday(false);
    setSaved(null);
    setError(null);
    setStage("preview");
  };
  const changeType = (t: CaptureType) => {
    setType(t);
    setPreview(buildCapturePreview(raw, t, dateKey));
  };
  const reset = () => {
    setRaw("");
    setSource("text");
    setStage("write");
    setError(null);
  };
  const confirm = async () => {
    const payload =
      type === "task"
        ? { title: preview.title, dueDate: preview.dueDate ?? null, focusToday }
        : type === "decision"
          ? { title: preview.title, decision: preview.decision ?? raw, rationale: preview.rationale ?? null }
          : type === "event"
            ? { title: preview.title, date: preview.date ?? dateKey, time: preview.time ?? null }
            : {};
    const ok = await run("captures", "POST", { text: raw, source, suggestedType: suggested, confirmedType: type, payload });
    if (ok) {
      setSaved(type === "note" ? "Guardado na caixa de notas." : `${CAPTURE_LABEL[type]} registrada.`);
      reset();
    }
  };

  const recording = voice.status === "listening" || voice.status === "requesting_permission";
  const transcribing = voice.status === "transcribing";
  const toggleVoice = async () => {
    if (recording) {
      const blob = await voice.stopRecording();
      if (!blob) return;
      const text = await voice.transcribe(blob);
      voice.reset();
      if (text) {
        setRaw((r) => (r ? `${r} ${text}` : text));
        setSource("voice");
      } else setError("Não foi possível transcrever. Tente de novo ou escreva.");
      return;
    }
    setError(null);
    await voice.startRecording();
  };

  return (
    <div className={`${cls.card} p-4`} data-capture>
      {stage === "write" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            analyze();
          }}
        >
          <label htmlFor={inputId} className="mb-2 block font-serif text-lg text-stone-900">
            O que está na sua cabeça?
          </label>
          <div className="flex items-start gap-2">
            <textarea
              id={inputId}
              data-meu-pp-capture-input
              rows={2}
              maxLength={4000}
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setSaved(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  analyze();
                }
              }}
              placeholder="Uma tarefa, uma decisão, algo que você percebeu…"
              className={`${cls.input} resize-none`}
            />
            <button
              type="button"
              onClick={toggleVoice}
              disabled={transcribing}
              aria-pressed={recording}
              aria-label={recording ? "Parar e transcrever" : "Capturar por voz"}
              className={`${cls.icon} border border-stone-300 ${recording ? "border-red-400 bg-red-50 text-red-700" : ""}`}
            >
              {recording ? <Square className="h-4 w-4" aria-hidden /> : <Mic className="h-[18px] w-[18px]" aria-hidden />}
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[12px] text-stone-500" aria-live="polite">
              {recording ? "Gravando… toque para parar." : transcribing ? "Transcrevendo…" : saved ?? "Nada é salvo antes de você confirmar."}
            </p>
            <button type="submit" disabled={!raw.trim() || recording || transcribing} className={cls.primary}>
              Continuar
            </button>
          </div>
        </form>
      ) : (
        <div>
          <p className={cls.label}>Parece {suggested === type ? "ser" : "que você prefere"}</p>
          <div role="radiogroup" aria-label="Tipo da captura" className="mt-2 flex flex-wrap gap-1.5">
            {CAPTURE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => changeType(t)}
                className={`min-h-11 rounded-full border px-3.5 text-[13px] transition-colors ${type === t ? "border-stone-900 bg-stone-900 text-stone-50" : "border-stone-300 bg-white text-stone-700 hover:border-stone-500"}`}
              >
                {CAPTURE_LABEL[t]}
                {t === suggested ? <span className="sr-only"> (sugerido)</span> : null}
              </button>
            ))}
          </div>

          <blockquote className="mt-3 border-l-2 border-stone-300 pl-3 text-[14px] text-stone-600">{raw}</blockquote>

          <div className="mt-4 space-y-3">
            {type !== "note" && type !== "reflection" ? (
              <Field label={type === "decision" ? "O que você decidiu (título)" : "Título"}>
                {(id) => <input id={id} value={preview.title} maxLength={200} onChange={(e) => setPreview({ ...preview, title: e.target.value })} className={cls.input} />}
              </Field>
            ) : null}
            {type === "task" ? (
              <>
                <Field label="Prazo (opcional)">
                  {(id) => <input id={id} type="date" value={preview.dueDate ?? ""} onChange={(e) => setPreview({ ...preview, dueDate: e.target.value || null })} className={cls.input} />}
                </Field>
                <label className="flex min-h-11 items-center gap-2.5 text-[14px] text-stone-700">
                  <input type="checkbox" checked={focusToday} disabled={priorityCount >= 3} onChange={(e) => setFocusToday(e.target.checked)} className="h-5 w-5 accent-stone-900" />
                  Uma das prioridades de hoje {priorityCount >= 3 ? "(já há 3)" : ""}
                </label>
              </>
            ) : null}
            {type === "decision" ? (
              <Field label="Por quê? (opcional)">
                {(id) => <textarea id={id} rows={2} value={preview.rationale ?? ""} onChange={(e) => setPreview({ ...preview, rationale: e.target.value })} className={cls.input} />}
              </Field>
            ) : null}
            {type === "event" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Dia">{(id) => <input id={id} type="date" value={preview.date ?? dateKey} onChange={(e) => setPreview({ ...preview, date: e.target.value })} className={cls.input} />}</Field>
                <Field label="Hora (opcional)">{(id) => <input id={id} type="time" value={preview.time ?? ""} onChange={(e) => setPreview({ ...preview, time: e.target.value || null })} className={cls.input} />}</Field>
              </div>
            ) : null}
            {type === "reflection" ? <p className="text-[13px] text-stone-500">Entra no reflexo de hoje.</p> : null}
            {type === "note" ? <p className="text-[13px] text-stone-500">Fica na caixa de notas até você decidir o que fazer com ela.</p> : null}
          </div>

          <ErrorLine error={error} />
          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setStage("write")} className={cls.ghost}>
              Voltar
            </button>
            <button type="button" onClick={confirm} disabled={busy || ((type === "task" || type === "decision" || type === "event") && !preview.title.trim())} className={cls.primary}>
              {busy ? "Salvando…" : "Confirmar"}
            </button>
          </div>
        </div>
      )}
      {stage === "write" ? <ErrorLine error={error} /> : null}
    </div>
  );
}
