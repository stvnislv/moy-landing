import { ImageResponse } from "next/og";
import { nbsp, site } from "@/config/site";
import { loadOgFonts } from "@/lib/og-fonts";

export const alt = `${site.name}: ${site.role}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          fontFamily: "Onest",
          color: "#1d1e20",
          background:
            "radial-gradient(60% 70% at 90% 0%, rgba(0,113,227,0.22), rgba(242,242,244,0) 70%), #f2f2f4",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", fontSize: 84, fontWeight: 300, lineHeight: 1, letterSpacing: "-0.03em" }}>
          <span>{site.name}:</span>
          <span>{nbsp(site.role)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 32, fontWeight: 500 }}>
          <span style={{ background: "#0071e3", color: "#fff", borderRadius: 999, padding: "14px 32px" }}>
            Написать в Telegram
          </span>
          <span style={{ color: "#5f626a" }}>@{site.telegram}</span>
        </div>
      </div>
    ),
    { ...size, fonts: await loadOgFonts() },
  );
}
