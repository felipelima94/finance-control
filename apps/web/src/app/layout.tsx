import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finance Control",
  description: "Controle financeiro pessoal: fluxo de caixa e investimentos",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
