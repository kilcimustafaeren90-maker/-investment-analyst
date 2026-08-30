const STYLES: Record<string, string> = {
  STRONG_BUY: "bg-buy/20 text-buy border border-buy/40",
  BUY: "bg-buy/10 text-buy border border-buy/30",
  HOLD: "bg-warn/10 text-warn border border-warn/30",
  SELL: "bg-sell/10 text-sell border border-sell/30",
  STRONG_SELL: "bg-sell/20 text-sell border border-sell/40",
  INSUFFICIENT_DATA: "bg-muted/10 text-muted border border-muted/30",
};

const LABELS: Record<string, string> = {
  STRONG_BUY: "STRONG BUY",
  BUY: "BUY",
  HOLD: "HOLD",
  SELL: "SELL",
  STRONG_SELL: "STRONG SELL",
  INSUFFICIENT_DATA: "NO DATA",
};

export function SignalBadge({ recommendation }: { recommendation: string }) {
  return (
    <span className={`rec-badge ${STYLES[recommendation] ?? STYLES.INSUFFICIENT_DATA}`}>
      {LABELS[recommendation] ?? recommendation}
    </span>
  );
}
