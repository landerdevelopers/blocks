import Link from "next/link";
import { ChevronLeft } from "lucide-react";

// Usage License page — same reading-column layout as the Creator Program rules
// page. Reached from the "Usage License" link in the account modal.
function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="my-10 h-px w-full bg-[#ebebeb]" />
      <h2 className="mb-6 text-[24px] font-semibold tracking-[-0.03em] text-[#171717]">
        {heading}
      </h2>
      <div className="flex flex-col gap-6">{children}</div>
    </>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[18px] font-medium tracking-[-0.02em] text-[#525252]">
      {children}
    </p>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2.5 pl-6">
      {items.map((it) => (
        <li
          key={it}
          className="text-[18px] font-medium tracking-[-0.02em] text-[#525252]"
        >
          {it}
        </li>
      ))}
    </ul>
  );
}

export default function UsageLicensePage() {
  return (
    <main className="min-h-screen bg-white px-6 py-20">
      <div className="mx-auto flex w-full max-w-[820px] flex-col">
        {/* Return to Blocks */}
        <Link
          href="/"
          className="mb-[34px] flex w-fit items-center gap-0.5 rounded-[10px] border border-[#ebebeb] bg-white p-2 pr-3 text-[14px] tracking-[-0.03em] text-[#71717b] shadow-[0px_1px_2px_rgba(10,13,20,0.03)] transition-colors hover:bg-[#fafafa]"
        >
          <ChevronLeft size={18} strokeWidth={1.75} />
          Return to Blocks
        </Link>

        {/* Hero */}
        <h1 className="text-[48px] font-bold leading-[1.1] tracking-[-0.03em] text-[#171717]">
          License
        </h1>
        <p className="mt-3 mb-10 text-[15px] font-medium tracking-[-0.02em] text-[#a1a1aa]">
          Last updated: June 2026
        </p>

        <h2 className="mb-6 text-[24px] font-semibold tracking-[-0.03em] text-[#171717]">
          Overview
        </h2>
        <div className="flex flex-col gap-6">
          <P>
            All designs published on Blocks are provided for inspiration,
            learning, and use in personal or commercial projects, unless
            otherwise stated by the creator.
          </P>
          <P>
            By accessing or copying resources from Blocks, you agree to comply
            with the terms outlined below.
          </P>
        </div>

        <Section heading="What You Can Do">
          <P>You may:</P>
          <Bullets
            items={[
              "Use copied designs in personal projects",
              "Use copied designs in commercial projects",
              "Modify and customize designs to fit your needs",
              "Combine designs with your own work",
              "Use designs as a starting point for new projects",
            ]}
          />
        </Section>

        <Section heading="What You Cannot Do">
          <P>You may not:</P>
          <Bullets
            items={[
              "Resell or redistribute designs as standalone resources",
              "Re-upload copied designs to another marketplace or library",
              "Claim another creator's work as your own",
              "Publish copied designs on Blocks under your creator account",
              "Remove creator attribution where it is required",
            ]}
          />
        </Section>

        <Section heading="Creator Ownership">
          <P>
            Creators retain ownership of the designs they submit to Blocks.
          </P>
          <P>
            By publishing content on Blocks, creators grant Blocks the right to
            display, promote, and distribute their designs through the platform.
          </P>
        </Section>

        <Section heading="Content Responsibility">
          <P>Creators are responsible for ensuring that the content they publish:</P>
          <Bullets
            items={[
              "Is original or properly licensed",
              "Does not infringe on third-party rights",
              "Does not contain unlawful or misleading content",
            ]}
          />
          <P>
            Blocks reserves the right to remove content that violates these
            guidelines.
          </P>
        </Section>

        <Section heading="License Changes">
          <P>
            We may update this license from time to time. Continued use of Blocks
            after changes are published constitutes acceptance of the updated
            terms.
          </P>
        </Section>

        <Section heading="Contact">
          <P>
            If you have any questions regarding this license, please contact the
            Blocks team at:
          </P>
          <a
            href="mailto:hello@lander.studio"
            className="w-fit text-[18px] font-medium tracking-[-0.02em] text-[#2974ff] underline underline-offset-2 hover:opacity-80"
          >
            hello@lander.studio
          </a>
        </Section>
      </div>
    </main>
  );
}
