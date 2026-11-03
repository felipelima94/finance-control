"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Visão geral" },
  { href: "/carteira", label: "Carteira" },
  { href: "/lancamentos", label: "Lançamentos" },
  { href: "/operacoes", label: "Operações" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      <div className="nav-inner">
        <span className="brand">Finance Control</span>
        {links.map((l) => {
          const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} className="link" aria-current={active ? "page" : undefined}>
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
