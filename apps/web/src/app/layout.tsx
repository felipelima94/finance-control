import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finance Control",
  description: "Controle financeiro pessoal: fluxo de caixa e investimentos",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
