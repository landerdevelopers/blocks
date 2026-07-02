import { Monitor } from "lucide-react";

// Full-screen gate shown only below 1024px (lg). CSS-only (lg:hidden) so it
// needs no JS and causes no hydration mismatch. A marketing landing: heading +
// two opposite-scrolling screenshot carousels behind a bottom fade, with a
// "go wider" banner.

// Two carousel rows. Top row scrolls right, bottom row scrolls left. Uniform
// card size so the rows read as clean marquees.

const CDN = "https://imagedelivery.net/IEUjvl3YUlxY-MrTpOAWDQ";
const ROW_TOP = [
  `${CDN}/0363c0a3-6e98-49f3-8c9f-86eb4776cc00/thumbnail`,
  `${CDN}/ba823db0-12e7-4ab9-0973-74aa3474d300/thumbnail`,
  `${CDN}/b0472fed-b8a2-40ea-3584-82618ec88d00/thumbnail`,
  `${CDN}/73d4c7de-37cc-45d5-46f6-296556a13f00/thumbnail`,
  `${CDN}/4ead29cc-230f-4a6e-eea1-f663058c0c00/thumbnail`,
  `${CDN}/431c9b46-e98c-4efb-2496-4510ba619000/thumbnail`,
];
const ROW_BOTTOM = [
  `${CDN}/86669e86-accc-42b7-cf4f-4cde43ac7400/thumbnail`,
  `${CDN}/cfbe8e94-4594-4a36-0cf2-c10894bd5b00/thumbnail`,
  `${CDN}/8b217675-cb32-41dd-8726-1ab5bfd29000/thumbnail`,
  `${CDN}/593476c0-e83e-4861-a350-3566f40c0200/thumbnail`,
  `${CDN}/fe6957b4-5d41-49ec-0791-165e82e9b700/thumbnail`,
  `${CDN}/c4aec3b2-a07c-47af-c00d-f735685f2400/thumbnail`,
];

function Carousel({ images, reverse }: { images: string[]; reverse?: boolean }) {
  // Items rendered twice so the -50% translate loops seamlessly.
  const items = [...images, ...images];
  return (
    <div className="w-full overflow-hidden">
      <div className={`marquee-track ${reverse ? "marquee-reverse" : ""}`}>
        {items.map((src, i) => (
          <div
            key={i}
            className="mr-[14px] flex w-[240px] shrink-0 items-end justify-center rounded-[9px] border border-[#e7e9ee] bg-[#f5f5f5] p-[3px] drop-shadow-[0px_1px_1px_rgba(0,0,0,0.06)]"
          >
            <div className="aspect-video w-full overflow-hidden rounded-[6px] border border-[#e7e9ee]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover object-top" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MobileGate() {
  return (
    <div className="fixed inset-0 z-[100000] flex flex-col items-center overflow-hidden bg-white lg:hidden">
      {/* Header + hero copy */}
      <div className="relative z-10 flex w-full max-w-[560px] flex-col items-center gap-[40px] p-[22px]">
        <div className="flex flex-col items-center gap-[2px]">
          <p className="text-[20px] font-medium tracking-[-0.6px] text-[#09090b]">
            Figma Blocks
          </p>
          <div className="flex items-center gap-[6px] text-[18px] tracking-[-0.54px] text-[#333338]">
            <span>by</span>
            <a
              href="https://lander.studio"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-[6px] hover:underline"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/mobile/lander-mark.svg"
                alt=""
                className="h-[15px] w-[12px]"
              />
              <span>Lander Studio</span>
            </a>
          </div>
        </div>
        <div className="flex max-w-[380px] flex-col items-center gap-[14px] text-center">
          <h1 className="text-[28px] md:text-[32px] font-medium leading-[1.3] tracking-[-0.84px] text-black">
            Copy the Designs That Inspired You, Pixel by Pixel
          </h1>
          <p className="max-w-[400px] text-[16px] leading-[1.3] tracking-[-0.48px] text-[#71717b]">
            Skip the blank canvas. Explore free Figma blocks to dissect layouts
            and fuel your creativity.
          </p>
        </div>
      </div>

      {/* Two opposite-scrolling carousels */}
      <div className="mt-2 flex w-full flex-col gap-[14px]">
        <Carousel images={ROW_TOP} reverse />
        <Carousel images={ROW_BOTTOM} />
      </div>

      {/* Solid white base — fully hides the carousels behind/below the banner. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[90px] bg-white" />
      {/* Gradient above it — soft fade from the solid base into the carousels. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[90px] h-[220px] bg-gradient-to-t from-white to-transparent" />

      {/* "Go wider" banner */}
      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-[8px] rounded-[14px] bg-[#fff0d6] px-[16px] py-[12px]">
        <Monitor size={14} className="shrink-0 text-[#ca8000] md:size-5" />
        <p className="whitespace-nowrap text-[12px] md:text-[16px] tracking-[-0.36px] text-[#ca8000]">
          Copy &amp; Browse Designs on Screens Wider Than 1020px
        </p>
      </div>
    </div>
  );
}
