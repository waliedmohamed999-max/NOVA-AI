import { Bookmark, Heart, MessageCircle, Send, ThumbsUp, Repeat2, Music2, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";

export type PreviewPost = {
  platform: string;
  format: string;
  hook: string | null;
  caption: string;
  cta: string | null;
  hashtags: string[];
  designBrief?: { concept?: string; textOnImage?: string | null; palette?: string[]; layout?: string } | null;
  imageUrl?: string | null;
};

const CH: Record<string, string> = {
  INSTAGRAM: "var(--ch-instagram)",
  FACEBOOK: "var(--ch-facebook)",
  LINKEDIN: "var(--ch-linkedin)",
  TIKTOK: "var(--ch-tiktok)",
};

export function PlatformDot({ platform, className }: { platform: string; className?: string }) {
  return <span className={cn("inline-block size-2 rounded-full", className)} style={{ background: CH[platform] ?? "var(--ink-4)" }} aria-hidden />;
}

/** The creative: a real image when one exists, otherwise a branded rendering of the design brief. */
function Creative({ post, aspect }: { post: PreviewPost; aspect: string }) {
  const palette = post.designBrief?.palette?.length ? post.designBrief.palette : ["#17161c", "#f7f5f1"];
  const text = post.designBrief?.textOnImage ?? post.hook ?? "";
  if (post.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={post.imageUrl} alt="" className={cn("w-full object-cover", aspect)} />;
  }
  return (
    <div className={cn("relative flex w-full flex-col justify-end overflow-hidden p-6", aspect)} style={{ background: `linear-gradient(145deg, ${palette[0]}, ${palette[1] ?? palette[0]})` }}>
      <div className="absolute -end-10 -top-10 size-40 rounded-full opacity-25" style={{ background: palette[2] ?? "#fff" }} aria-hidden />
      {post.format === "CAROUSEL" && (
        <div className="absolute end-3 top-3 rounded-full bg-black/40 px-2 py-0.5 text-[11px] font-medium text-white">1/5</div>
      )}
      <p className="relative line-clamp-4 font-display text-2xl leading-tight text-white drop-shadow-sm [text-wrap:balance]">{text}</p>
    </div>
  );
}

function Caption({ post, clamp }: { post: PreviewPost; clamp?: boolean }) {
  return (
    <p className={cn("whitespace-pre-line text-[13px] leading-relaxed text-ink", clamp && "line-clamp-6")}>
      {post.caption}
      {post.hashtags.length > 0 && <span className="mt-1 block text-info">{post.hashtags.join(" ")}</span>}
    </p>
  );
}

export function PostPreview({ post, brandName, device = "mobile" }: { post: PreviewPost; brandName: string; device?: "mobile" | "desktop" }) {
  const avatar = (
    <span className="flex size-8 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-ink-inverse">{brandName.slice(0, 2).toUpperCase()}</span>
  );
  const frame = device === "mobile" ? "w-full max-w-[360px] rounded-2xl border-[6px] border-ink/90 shadow-lg" : "w-full max-w-[560px] rounded-2xl border border-line shadow-md";

  if (post.platform === "LINKEDIN") {
    return (
      <div className={cn("overflow-hidden bg-surface", frame)} dir="auto">
        <div className="flex items-center gap-2.5 p-4">
          {avatar}
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">{brandName}</div>
            <div className="text-[11px] text-ink-3">Promoted · 1m</div>
          </div>
          <MoreHorizontal className="size-4 text-ink-3" />
        </div>
        <div className="px-4 pb-3">
          <Caption post={post} clamp={device === "mobile"} />
        </div>
        <Creative post={post} aspect="aspect-[1.91/1]" />
        <div className="flex justify-around border-t border-line py-2 text-xs font-medium text-ink-3">
          <span className="flex items-center gap-1.5"><ThumbsUp className="size-4" /> Like</span>
          <span className="flex items-center gap-1.5"><MessageCircle className="size-4" /> Comment</span>
          <span className="flex items-center gap-1.5"><Repeat2 className="size-4" /> Repost</span>
        </div>
      </div>
    );
  }

  if (post.platform === "TIKTOK" || post.format === "REEL" || post.format === "STORY" || post.format === "SHORT_VIDEO") {
    return (
      <div className={cn("relative overflow-hidden bg-black", frame, device === "desktop" && "max-w-[340px]")} dir="auto">
        <Creative post={post} aspect="aspect-[9/16]" />
        <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/80 to-transparent p-4 pt-16 text-white">
          <div className="text-[13px] font-semibold">@{brandName.toLowerCase().replace(/\s+/g, "")}</div>
          <p className="line-clamp-3 text-[12px] leading-snug opacity-95">{post.caption}</p>
          <div className="flex items-center gap-1.5 text-[11px] opacity-80"><Music2 className="size-3" /> Original sound</div>
        </div>
      </div>
    );
  }

  // Instagram / Facebook feed
  return (
    <div className={cn("overflow-hidden bg-surface", frame)} dir="auto">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        {avatar}
        <div className="flex-1 text-[13px] font-semibold">{brandName.toLowerCase().replace(/\s+/g, "")}</div>
        <MoreHorizontal className="size-4 text-ink-3" />
      </div>
      <Creative post={post} aspect={post.format === "CAROUSEL" ? "aspect-[4/5]" : "aspect-square"} />
      <div className="flex items-center gap-4 px-3 pt-3 text-ink">
        {post.platform === "FACEBOOK" ? <ThumbsUp className="size-5" /> : <Heart className="size-5" />}
        <MessageCircle className="size-5" />
        <Send className="size-5" />
        <Bookmark className="ms-auto size-5" />
      </div>
      <div className="px-3 pb-4 pt-2">
        <Caption post={post} clamp={device === "mobile"} />
      </div>
    </div>
  );
}
