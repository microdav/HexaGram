export function HexaLogo({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="HexaGram logo"
    >
      <ellipse cx="50" cy="52" rx="14" ry="20" fill="#c87800" opacity="0.7" />
      <ellipse cx="50" cy="50" rx="14" ry="20" fill="#f5c518" />
      <line x1="37" y1="46" x2="63" y2="46" stroke="#c87800" strokeWidth="1.5" opacity="0.6" />
      <line x1="37" y1="53" x2="63" y2="53" stroke="#c87800" strokeWidth="1.5" opacity="0.6" />

      <circle cx="44.5" cy="37" r="3" fill="#1a1d24" />
      <circle cx="55.5" cy="37" r="3" fill="#1a1d24" />
      <circle cx="43.8" cy="36.2" r="1" fill="rgba(255,255,255,0.4)" />
      <circle cx="54.8" cy="36.2" r="1" fill="rgba(255,255,255,0.4)" />

      <polyline points="38,40 26,29 18,23" stroke="#e8b400" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <polyline points="36,51 20,51 12,53" stroke="#e8b400" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <polyline points="38,63 26,74 18,80" stroke="#e8b400" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />

      <polyline points="62,40 74,29 82,23" stroke="#e8b400" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <polyline points="64,51 80,51 88,53" stroke="#e8b400" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <polyline points="62,63 74,74 82,80" stroke="#e8b400" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
