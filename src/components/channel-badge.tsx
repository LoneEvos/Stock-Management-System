import Image from "next/image";
import { CHANNEL_LABEL } from "@/lib/format";

/** Logo marketplace di public/ — dipakai semua tampilan kanal. */
const LOGO: Record<string, string> = {
  shopee: "/shopee-logo-shopee-icon-transparent-social-media-icons-free-png.webp",
  tiktok: "/tiktok-shop-icon-logo-symbol-free-png.webp",
};

/** Logo kanal (Shopee/TikTok Shop) + label; kanal lain memakai kotak inisial. */
export function ChannelBadge({
  channel,
  hideLabel,
}: {
  channel: string;
  hideLabel?: boolean;
}) {
  const logo = LOGO[channel];
  const label = CHANNEL_LABEL[channel] ?? channel;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      {logo ? (
        <Image
          src={logo}
          alt={label}
          width={16}
          height={16}
          className="size-4 shrink-0 object-contain"
        />
      ) : (
        <span className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-[4px] bg-[#e2e5e9] text-[8px] font-extrabold text-[#475569]">
          {(channel.charAt(0) || "?").toUpperCase()}
        </span>
      )}
      {!hideLabel && label}
    </span>
  );
}
