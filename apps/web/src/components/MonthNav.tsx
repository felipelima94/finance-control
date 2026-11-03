import Link from "next/link";
import { addMonths, monthLong } from "@/lib/format";

export function MonthNav({ month, basePath }: { month: string; basePath: string }) {
  return (
    <div className="month-nav">
      <Link href={`${basePath}?month=${addMonths(month, -1)}`} aria-label="Mês anterior">‹</Link>
      <strong>{monthLong(month)}</strong>
      <Link href={`${basePath}?month=${addMonths(month, 1)}`} aria-label="Próximo mês">›</Link>
    </div>
  );
}
