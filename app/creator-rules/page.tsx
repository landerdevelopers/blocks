"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import CreatorProgramModal from "@/app/components/CreatorProgramModal";
import { useAuthStore } from "@/store/authStore";

// Creator Program rules / overview page. Reached from every "Become a Creator"
// CTA. The "Apply To Become Creator" button opens the application modal.
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

export default function CreatorRulesPage() {
  const router = useRouter();
  const [showApply, setShowApply] = useState(false);
  // Pending application flag (prefetched at sign-in / set on submit) — true once
  // they've applied; gates the apply button + shows the "already applied" note.
  const alreadyApplied = useAuthStore((s) => s.pendingCreatorApp) === true;

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
        <h1 className="mb-10 text-[48px] font-bold leading-[1.1] tracking-[-0.03em] text-[#171717]">
          Creator Program
        </h1>

        <div className="flex flex-col gap-6">
          <P>
            The Creator Program lets you share your best design work with other
            designers on Blocks. Designers can discover, copy, and reuse your
            work, while you get more exposure from the Blocks community.
          </P>
          <P>
            Your creator profile also helps you showcase yourself better by
            adding your bio, social links, and hire button, increasing your
            chances of getting discovered and hired.
          </P>
        </div>

        <Section heading="How to Become a Creator">
          <P>
            To become a creator, apply by filling out the creator application
            form.
          </P>
          <P>
            Once submitted, our team will review your application and approve it
            within 24 hours.
          </P>
          <P>
            After approval, you&apos;ll get access to the Creator Portal from
            your profile. From there, you can upload, edit, manage, and track
            your design submissions.
          </P>
          <P>
            Before publishing your first design, please complete your creator
            profile by adding your username, bio, and social links.
          </P>
        </Section>

        <Section heading="How to Publish Your Design">
          <P>You can publish your designs directly from the Creator Portal.</P>
          <P>
            While submitting, make sure to select the correct category, tags,
            and filters so your design appears in the right place on Blocks.
          </P>
          <P>
            After submission, our team will review your design and either
            approve or reject it within 24 hours.
          </P>
          <P>Creators can submit up to 30 designs per day.</P>
          <P>
            If your design is rejected, you&apos;ll be able to see the rejection
            reason inside your Creator Portal and make the required changes
            before submitting again.
          </P>
        </Section>

        <Section heading="Things to Consider">
          <P>
            We&apos;re building Blocks to become one of the best places for
            designers to find inspiration and copy high-quality design
            resources.
          </P>
          <P>To maintain quality, every design is reviewed before publishing.</P>
          <P>
            Please submit only your best work. We curate designs carefully to
            make sure the platform stays valuable, clean, and useful for
            everyone.
          </P>
        </Section>

        {/* Apply */}
        <div className="flex flex-col items-start gap-2 pt-[34px]">
          <button
            type="button"
            onClick={() => setShowApply(true)}
            disabled={alreadyApplied}
            className="flex cursor-pointer items-center justify-center rounded-[10px] bg-[#2974ff] px-[18px] py-3 text-[18px] tracking-[-0.03em] text-white transition-colors hover:bg-[#1f63e6] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Apply To Become Creator
          </button>
          {alreadyApplied && (
            <p className="text-[15px] font-medium tracking-[-0.02em] text-[#71717b]">
              You&apos;ve already applied.
            </p>
          )}
        </div>
      </div>

      <CreatorProgramModal
        open={showApply}
        onClose={() => setShowApply(false)}
        onApplied={() => router.push("/")}
      />
    </main>
  );
}
