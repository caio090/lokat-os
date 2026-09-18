"use client";
import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { R } from "../_lib/tokens";

const STEPS = [
  { tc: "00:00", n: "01", t: "Roteiro",  d: "Briefing, conceito e estrutura antes de ligar a câmera." },
  { tc: "00:12", n: "02", t: "Set",      d: "Direção de cena, enquadramento, luz e ritmo de produção." },
  { tc: "00:24", n: "03", t: "Edição",   d: "Corte, trilha, texto e identidade visual alinhados à marca." },
  { tc: "00:36", n: "04", t: "Entrega",  d: "Peça pronta para publicação, campanha ou distribuição orgânica." },
];

export function BehindScenes({ isMobile }: { isMobile: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.25 });

  return (
    <section ref={ref} style={{ padding: isMobile ? "4rem 0" : "5.5rem 0", position: "relative" }}>
      <div style={{ maxWidth: "1300px", margin: "0 auto", padding: "0 2rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: isMobile ? "2.5rem" : "3.5rem" }}>
          <span style={{ ...R.mono, fontSize: ".5rem", letterSpacing: ".14em", color: R.red }}>● REC</span>
          <p style={{ ...R.mono, fontSize: ".54rem", letterSpacing: ".2em", textTransform: "uppercase", color: R.muted }}>[Bastidores]</p>
        </div>

        <div style={{ position: "relative" }}>
          {/* Linha do tempo */}
          <div style={{ position: "absolute", top: isMobile ? undefined : "1.9rem", left: isMobile ? "1.9rem" : 0, right: isMobile ? undefined : 0, bottom: isMobile ? "1.9rem" : undefined, width: isMobile ? "1px" : "auto", height: isMobile ? "auto" : "1px", background: R.border }} />
          <motion.div
            initial={{ scaleX: isMobile ? 1 : 0, scaleY: isMobile ? 0 : 1 }}
            animate={isInView ? { scaleX: 1, scaleY: 1 } : {}}
            transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
            style={{
              position: "absolute",
              top: isMobile ? undefined : "1.9rem", left: isMobile ? "1.9rem" : 0, right: isMobile ? undefined : 0, bottom: isMobile ? "1.9rem" : undefined,
              width: isMobile ? "1px" : "auto", height: isMobile ? "auto" : "1px",
              background: R.red, transformOrigin: isMobile ? "top" : "left",
            }}
          />

          <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? "2.5rem" : "1.5rem" }}>
            {STEPS.map((step, i) => (
              <motion.div
                key={step.n}
                initial={{ opacity: 0, y: 16 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: .6, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }}
                style={{ flex: isMobile ? undefined : 1, position: "relative", paddingLeft: isMobile ? "3.2rem" : 0 }}
              >
                {!isMobile && (
                  <div style={{ width: "9px", height: "9px", borderRadius: "50%", background: R.red, marginBottom: "1.2rem" }} />
                )}
                {isMobile && (
                  <div style={{ position: "absolute", left: "1.9rem", top: ".2rem", width: "9px", height: "9px", borderRadius: "50%", background: R.red, transform: "translateX(-50%)" }} />
                )}
                <p style={{ ...R.mono, fontSize: ".48rem", letterSpacing: ".14em", color: R.muted, marginBottom: ".5rem" }}>TC {step.tc} · {step.n}</p>
                <p style={{ ...R.display, fontSize: isMobile ? "1.5rem" : "1.7rem", fontWeight: 600, color: R.text, marginBottom: ".5rem" }}>{step.t}</p>
                <p style={{ ...R.grotesk, fontSize: ".82rem", lineHeight: 1.7, color: R.muted, maxWidth: "260px" }}>{step.d}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
