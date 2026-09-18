"use client";
import { forwardRef, useState } from "react";
import { AtSign, Mail, Video } from "lucide-react";
import { motion } from "framer-motion";
import { R } from "../_lib/tokens";

function ContactForm() {
  const [nome,  setNome]  = useState("");
  const [email, setEmail] = useState("");
  const [wpp,   setWpp]   = useState("");
  const [msg,   setMsg]   = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const texto = [
      `Olá, sou ${nome || "alguém"} e tenho um projeto para a LOKAT.REC.`,
      email ? `E-mail: ${email}` : "",
      wpp   ? `WhatsApp: ${wpp}` : "",
      msg   ? `Sobre a gravação: ${msg}` : "",
    ].filter(Boolean).join("\n");
    window.open(`https://wa.me/5589994217181?text=${encodeURIComponent(texto)}`, "_blank");
  };

  const fieldStyle: React.CSSProperties = {
    width: "100%", background: "transparent", border: "none", borderBottom: `1px solid ${R.border}`,
    color: R.text, padding: ".7rem 0", ...R.grotesk, fontSize: ".95rem", outline: "none", transition: "border-color .2s",
  };
  const focus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => (e.currentTarget.style.borderColor = R.red);
  const blur  = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => (e.currentTarget.style.borderColor = R.border);

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.8rem" }}>
      {[
        { label: "Nome / Empresa", ph: "Sua marca",               type: "text",  val: nome,  set: setNome },
        { label: "E-mail",         ph: "contato@suamarca.com.br", type: "email", val: email, set: setEmail },
        { label: "WhatsApp",       ph: "(89) 9 0000-0000",        type: "tel",   val: wpp,   set: setWpp },
      ].map(({ label, ph, type, val, set }) => (
        <div key={label}>
          <label style={{ ...R.mono, fontSize: ".48rem", letterSpacing: ".16em", textTransform: "uppercase", color: R.muted, display: "block", marginBottom: ".5rem" }}>{label}</label>
          <input type={type} placeholder={ph} value={val} onChange={(e) => set(e.target.value)} style={fieldStyle} onFocus={focus} onBlur={blur} />
        </div>
      ))}
      <div>
        <label style={{ ...R.mono, fontSize: ".48rem", letterSpacing: ".16em", textTransform: "uppercase", color: R.muted, display: "block", marginBottom: ".5rem" }}>Sobre a gravação</label>
        <textarea rows={2} placeholder="Tipo de vídeo, objetivo, prazo…" value={msg} onChange={(e) => setMsg(e.target.value)}
          style={{ ...fieldStyle, resize: "vertical" }} onFocus={focus} onBlur={blur} />
      </div>
      <button type="submit"
        style={{ alignSelf: "flex-start", background: "none", color: R.red, padding: ".6rem 0", ...R.mono, fontSize: ".7rem", letterSpacing: ".14em", textTransform: "uppercase", border: "none", borderBottom: `1px solid ${R.red}`, cursor: "pointer", fontWeight: 700, marginTop: ".5rem" }}
      >Enviar no WhatsApp →</button>
    </form>
  );
}

export const RecContact = forwardRef<HTMLDivElement, { isMobile: boolean }>(function RecContact({ isMobile }, ref) {
  return (
    <section ref={ref} style={{ position: "relative" }}>
      <div style={{ maxWidth: "1300px", margin: "0 auto", padding: isMobile ? "4rem 2rem 3.5rem" : "6.5rem 2rem 5.5rem" }}>
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: .8, ease: [0.16, 1, 0.3, 1] }}
          style={{ ...R.display, fontSize: "clamp(2.2rem,6.5vw,4.4rem)", fontWeight: 600, lineHeight: .96, letterSpacing: "-.005em", color: R.text, marginBottom: isMobile ? "2.5rem" : "3.5rem" }}
        >
          Tem uma ideia?<br /><em style={{ fontStyle: "normal", color: R.red }}>Vamos filmar.</em>
        </motion.h2>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? "3rem" : "6rem", alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>
            {[
              { label: "WhatsApp",  sub: "(89) 9 9421-7181",     Icon: Video,  href: "https://wa.me/5589994217181?text=Ol%C3%A1%2C%20vim%20pela%20Lokat.rec%20e%20quero%20fazer%20um%20projeto%20audiovisual." },
              { label: "E-mail",    sub: "lokat.rec@hotmail.com", Icon: Mail,  href: "mailto:lokat.rec@hotmail.com" },
              { label: "Instagram", sub: "@Lokat.rec",            Icon: AtSign, href: "https://instagram.com/lokat.rec" },
            ].map(({ label, sub, Icon, href }) => (
              <a key={label} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", gap: "1rem", textDecoration: "none", borderBottom: `1px solid ${R.border}`, paddingBottom: "1.2rem" }}
              >
                <Icon style={{ width: "16px", height: "16px", color: R.red, flexShrink: 0 }} strokeWidth={1.5} />
                <div>
                  <p style={{ ...R.mono, fontSize: ".44rem", letterSpacing: ".14em", textTransform: "uppercase", color: R.muted }}>{label}</p>
                  <p style={{ ...R.grotesk, fontSize: ".95rem", color: R.text, fontWeight: 600 }}>{sub}</p>
                </div>
              </a>
            ))}
          </div>

          <ContactForm />
        </div>
      </div>
    </section>
  );
});
