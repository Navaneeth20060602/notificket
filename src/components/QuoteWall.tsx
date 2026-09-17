"use client";

type Quote = { id: string; text: string; movie: string; language: string };

// Each language gets a consistent gradient tint so columns feel varied but
// coherent, without using any real movie stills/posters (see note in chat -
// these are stylised cards, not copyrighted images).
const LANG_GRADIENT: Record<string, string> = {
  Telugu: "linear-gradient(135deg, rgba(244,63,94,0.18), rgba(249,115,22,0.10))",
  Hindi: "linear-gradient(135deg, rgba(139,92,246,0.18), rgba(217,70,239,0.10))",
  English: "linear-gradient(135deg, rgba(56,189,248,0.18), rgba(99,102,241,0.10))",
  Tamil: "linear-gradient(135deg, rgba(52,211,153,0.18), rgba(20,184,166,0.10))",
  Kannada: "linear-gradient(135deg, rgba(251,191,36,0.18), rgba(217,119,6,0.10))",
  Malayalam: "linear-gradient(135deg, rgba(96,165,250,0.18), rgba(14,165,233,0.10))",
  Marathi: "linear-gradient(135deg, rgba(248,113,113,0.18), rgba(190,24,93,0.10))",
  Bengali: "linear-gradient(135deg, rgba(192,132,252,0.18), rgba(236,72,153,0.10))",
};

function QuoteCard({ q }: { q: Quote }) {
  return (
    <div
      className="card p-4 mb-4"
      style={{ backgroundImage: LANG_GRADIENT[q.language] || undefined }}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted mb-2 flex items-center gap-1.5">
        <span>\ud83c\udfac</span>
        <span>{q.language}</span>
        <span className="text-faint">&middot; {q.movie}</span>
      </div>
      <p className="text-sm font-medium leading-snug">&ldquo;{q.text}&rdquo;</p>
    </div>
  );
}

export default function QuoteWall({ quotes }: { quotes: Quote[] }) {
  if (quotes.length === 0) return null;

  const byLang: Record<string, Quote[]> = {};
  for (const q of quotes) {
    (byLang[q.language] ||= []).push(q);
  }
  const languages = Object.keys(byLang);

  const columnCount = 4;
  const columns: Quote[][] = Array.from({ length: columnCount }, () => []);
  languages.forEach((lang, i) => {
    columns[i % columnCount].push(...byLang[lang]);
  });

  return (
    <div className="relative h-[560px] overflow-hidden rounded-2xl">
      {/* fade the top/bottom edges into the page background */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-20 z-10"
        style={{ background: "linear-gradient(to bottom, var(--bg), transparent)" }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-20 z-10"
        style={{ background: "linear-gradient(to top, var(--bg), transparent)" }}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 h-full px-1">
        {columns.map((col, i) => {
          if (col.length === 0) return null;
          const direction = i % 2 === 0 ? "quote-col-up" : "quote-col-down";
          const duration = 22 + i * 6; // seconds - staggers so columns never sync up
          return (
            <div key={i} className="overflow-hidden h-full">
              <div
                className={direction}
                style={{ animationDuration: `${duration}s` }}
              >
                {[...col, ...col].map((q, j) => (
                  <QuoteCard key={`${q.id}-${j}`} q={q} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
