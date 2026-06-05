"use client";

import { useState } from "react";
import Sidebar from "./components/Sidebar";
import Gallery from "./components/Gallery";
import LoginModal from "./components/LoginModal";
import ProfileModal from "./components/ProfileModal";
import AccountModal from "./components/AccountModal";
import LimitModal from "./components/LimitModal";

const DAILY_LIMIT = 10;

export default function Home() {
  const [cols, setCols] = useState(3);
  const [loggedIn, setLoggedIn] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loginNotice, setLoginNotice] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [used, setUsed] = useState(0);
  const [showLimit, setShowLimit] = useState(false);
  const [showLogos, setShowLogos] = useState(false);
  const [logoFilter, setLogoFilter] = useState<string[]>([]);

  const openLogin = (notice: boolean) => {
    setLoginNotice(notice);
    setShowLogin(true);
  };

  // One copy: count it, or show the limit popup once exhausted. Returns whether the copy is allowed.
  const tryCopy = () => {
    if (used >= DAILY_LIMIT) {
      setShowLimit(true);
      return false;
    }
    setUsed(used + 1);
    return true;
  };

  // Email onboarding → collect profile. Google → straight in, no onboarding.
  const loginWithEmail = () => {
    setShowLogin(false);
    setLoggedIn(true);
    setShowProfile(true);
  };
  const loginWithGoogle = () => {
    setShowLogin(false);
    setLoggedIn(true);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#f5f5f5] pt-4 font-sans">
      {/* Dev login toggle */}
      <button
        type="button"
        onClick={() => setLoggedIn((v) => !v)}
        className="fixed left-2 top-2 z-[1100] flex cursor-pointer items-center gap-1.5 rounded-full border border-[#e7e9ee] bg-white/90 px-2 py-1 text-[11px] font-medium tracking-[-0.03em] text-[#09090b] shadow-sm backdrop-blur-sm"
      >
        <span
          className={`size-2 rounded-full ${
            loggedIn ? "bg-[#1C9A00]" : "bg-[#d4d4d8]"
          }`}
        />
        {loggedIn ? "Logged in" : "Logged out"}
      </button>

      <Sidebar
        cols={cols}
        onColsChange={setCols}
        loggedIn={loggedIn}
        onLoginClick={() => openLogin(false)}
        onMenuClick={() => setShowAccount(true)}
        onFilter={(id, filters) => {
          const logos = id === "logos";
          setShowLogos(logos);
          setLogoFilter(logos ? filters : []);
          // 6-col layout is logos-only — clamp back when leaving.
          if (!logos && cols > 5) setCols(5);
        }}
        maxCols={showLogos ? 6 : 5}
      />
      <Gallery
        cols={cols}
        loggedIn={loggedIn}
        onRequireLogin={() => openLogin(true)}
        onCopy={tryCopy}
        logos={showLogos}
        logoFilter={logoFilter}
      />

      <LoginModal
        open={showLogin}
        onClose={() => setShowLogin(false)}
        notice={loginNotice}
        onSubmit={loginWithEmail}
        onGoogle={loginWithGoogle}
      />

      <ProfileModal open={showProfile} onClose={() => setShowProfile(false)} />

      <AccountModal
        open={showAccount}
        onClose={() => setShowAccount(false)}
        onLogout={() => {
          setShowAccount(false);
          setLoggedIn(false);
        }}
        used={used}
      />

      <LimitModal
        open={showLimit}
        onClose={() => setShowLimit(false)}
        limit={DAILY_LIMIT}
      />
    </div>
  );
}
