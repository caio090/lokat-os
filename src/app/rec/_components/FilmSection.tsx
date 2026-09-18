"use client";
import { useRef, useState } from "react";
import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import { Play } from "lucide-react";
import { R } from "../_lib/tokens";

const FILME_YT    = "fkImA1oe_3E";
const FILME_THUMB = `https://img.youtube.com/vi/${FILME_YT}/maxresdefault.jpg`;

export function FilmSection({ isMobile, reducedMotion }: { isMobile: boolean; reducedMotion: boolean }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start end", "end start"] });
  const linked = !isMobile && !reducedMotion;

  const _yFrame = useSpring(useTransform(scrollYProgress, [0, 1], [60, -60]), { stiffness: 55, damping: 22 });
  const _yText  = useSpring(useTransform(scrollYProgress, [0, 1], [20, -90]), { stiffness: 55, damping: 22 });

  const yFrame = linked ? _yFrame : 0;
  const yText  = linked ? _yText : 0;

  return (
    <section ref={sectionRef} style={{ position: "relative", padding: isMobile ? "4rem 0" : "7rem 0", overflow: "hidden" }}>
      <div style={{ maxWidth: "1300px", margin: "0 auto", padding: "0 2rem", position: "relative" }}>

        <motion.div
          style={{ y: yText }}
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: linked ? undefined : 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: .8, ease: [0.16, 1, 0.3, 1] }}
        >
          <p style={{ ...R.mono, fontSize: ".54rem", letterSpacing: ".22em", textTransform: "uppercase", color: R.red, marginBottom: ".7rem" }}>[Produção especial]</p>
          <h2 style={{ ...R.display, fontSize: "clamp(2.2rem,5.5vw,4rem)", fontWeight: 600, lineHeight: .96, letterSpacing: "-.005em", color: R.text, maxWidth: "700px" }}>
            O dia dela,<br />pra durar pra sempre.
          </h2>
        </motion.div>

        <motion.div
          style={{ y: yFrame, marginTop: isMobile ? "2.5rem" : "4.5rem", position: "relative" }}
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: linked ? undefined : 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 1, delay: .1, ease: [0.16, 1, 0.3, 1] }}
        >
          <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, overflow: "hidden", background: R.bg }}>
            {playing ? (
              <iframe
                src={`https://www.youtube.com/embed/${FILME_YT}?autoplay=1&rel=0&modestbranding=1&color=white`}
                title="Filme XV Maria Clara — LOKAT.REC"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
              />
            ) : (
              <div
                onClick={() => setPlaying(true)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPlaying(true); } }}
                aria-label="Assistir filme completo — XV anos Maria Clara"
                style={{ position: "absolute", inset: 0, cursor: "pointer", overflow: "hidden" }}
              >
                <img src={FILME_THUMB} alt="Filme XV Maria Clara" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(6,5,4,0.92) 0%, rgba(6,5,4,0.35) 45%, rgba(6,5,4,0.05) 100%)" }} />

                <div style={{ position: "absolute", bottom: isMobile ? "1.4rem" : "2.2rem", left: isMobile ? "1.4rem" : "2.2rem", right: "1.5rem", display: "flex", alignItems: "center", gap: "1rem" }}>
                  <div style={{ width: "52px", height: "52px", border: `1px solid ${R.red}`, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Play style={{ width: "18px", height: "18px", color: R.red, marginLeft: "2px" }} strokeWidth={1.5} />
                  </div>
                  <div>
                    <p style={{ ...R.mono, fontSize: ".44rem", letterSpacing: ".18em", textTransform: "uppercase", color: R.muted, marginBottom: ".3rem" }}>Maria Clara · XV anos</p>
                    <p style={{ ...R.display, fontSize: "clamp(1.2rem,2.6vw,1.9rem)", fontWeight: 600, color: R.text, lineHeight: 1.0 }}>
                      O dia que ela nunca vai esquecer.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
