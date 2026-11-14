import { useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { DreamField } from "../../components/dream";
import { Skeleton, useToast } from "../../components/ui";
import { LimitReachedModal } from "../../components/LimitModal";
import { useAuth } from "../../context/AuthContext";
import { useBackend, useAsync } from "../../lib/data";
import type { UserProfile } from "../../lib/types";

interface FloatingHeartSpec {
  x: number;
  y: number;
  scale: number;
  palette: "blush" | "hot" | "magenta" | "lavender";
  floatAnim: "romanticHeartFloatA" | "romanticHeartFloatB";
  floatDuration: string;
  floatDelay: string;
  pulseDuration: string;
  pulseDelay: string;
}

const FLOATING_HEARTS: readonly FloatingHeartSpec[] = [
  // Inner cluster around the moon & couple (visible across mobile, tablet & desktop)
  { x: 572, y: 120, scale: 0.56, palette: "lavender", floatAnim: "romanticHeartFloatA", floatDuration: "7.8s", floatDelay: "-1.4s", pulseDuration: "3.9s", pulseDelay: "-0.7s" },
  { x: 344, y: 274, scale: 1.05, palette: "blush", floatAnim: "romanticHeartFloatB", floatDuration: "9.4s", floatDelay: "-3.1s", pulseDuration: "4.6s", pulseDelay: "-1.9s" },
  { x: 368, y: 384, scale: 0.90, palette: "hot", floatAnim: "romanticHeartFloatA", floatDuration: "8.2s", floatDelay: "-5.2s", pulseDuration: "4.2s", pulseDelay: "-0.4s" },
  { x: 404, y: 454, scale: 0.56, palette: "magenta", floatAnim: "romanticHeartFloatB", floatDuration: "7.1s", floatDelay: "-2.3s", pulseDuration: "3.6s", pulseDelay: "-2.1s" },
  { x: 350, y: 506, scale: 0.65, palette: "blush", floatAnim: "romanticHeartFloatA", floatDuration: "8.8s", floatDelay: "-4.4s", pulseDuration: "4.8s", pulseDelay: "-1.2s" },
  { x: 468, y: 518, scale: 0.90, palette: "blush", floatAnim: "romanticHeartFloatB", floatDuration: "9.8s", floatDelay: "-6.0s", pulseDuration: "4.4s", pulseDelay: "-2.6s" },
  { x: 726, y: 512, scale: 0.92, palette: "hot", floatAnim: "romanticHeartFloatA", floatDuration: "9.0s", floatDelay: "-1.8s", pulseDuration: "4.1s", pulseDelay: "-1.1s" },
  { x: 746, y: 336, scale: 0.46, palette: "hot", floatAnim: "romanticHeartFloatB", floatDuration: "6.8s", floatDelay: "-3.7s", pulseDuration: "3.5s", pulseDelay: "-0.8s" },
  { x: 828, y: 422, scale: 1.04, palette: "blush", floatAnim: "romanticHeartFloatA", floatDuration: "10.2s", floatDelay: "-5.5s", pulseDuration: "5.0s", pulseDelay: "-2.4s" },
  { x: 854, y: 304, scale: 0.96, palette: "magenta", floatAnim: "romanticHeartFloatB", floatDuration: "8.5s", floatDelay: "-2.0s", pulseDuration: "4.3s", pulseDelay: "-1.5s" },
  { x: 872, y: 202, scale: 0.58, palette: "hot", floatAnim: "romanticHeartFloatA", floatDuration: "7.4s", floatDelay: "-4.8s", pulseDuration: "3.8s", pulseDelay: "-0.3s" },
  // Outer left & right flanks balancing wider desktop and tablet viewports
  { x: 158, y: 286, scale: 1.16, palette: "magenta", floatAnim: "romanticHeartFloatB", floatDuration: "10.6s", floatDelay: "-3.9s", pulseDuration: "5.2s", pulseDelay: "-1.7s" },
  { x: 238, y: 422, scale: 0.82, palette: "lavender", floatAnim: "romanticHeartFloatA", floatDuration: "8.9s", floatDelay: "-6.4s", pulseDuration: "4.5s", pulseDelay: "-2.8s" },
  { x: 146, y: 444, scale: 0.62, palette: "blush", floatAnim: "romanticHeartFloatB", floatDuration: "7.6s", floatDelay: "-1.1s", pulseDuration: "4.0s", pulseDelay: "-0.9s" },
  { x: 222, y: 176, scale: 0.58, palette: "lavender", floatAnim: "romanticHeartFloatA", floatDuration: "8.1s", floatDelay: "-4.2s", pulseDuration: "3.7s", pulseDelay: "-2.0s" },
  { x: 1038, y: 342, scale: 1.14, palette: "lavender", floatAnim: "romanticHeartFloatA", floatDuration: "10.4s", floatDelay: "-2.7s", pulseDuration: "5.1s", pulseDelay: "-1.4s" },
  { x: 968, y: 446, scale: 0.86, palette: "hot", floatAnim: "romanticHeartFloatB", floatDuration: "9.2s", floatDelay: "-5.1s", pulseDuration: "4.7s", pulseDelay: "-2.3s" },
  { x: 1018, y: 186, scale: 0.78, palette: "blush", floatAnim: "romanticHeartFloatA", floatDuration: "8.6s", floatDelay: "-0.9s", pulseDuration: "4.3s", pulseDelay: "-1.6s" },
];

/** Inline SVG hero scene — glowing luminous-pink crescent moon carrying a romantic
 *  couple seated on its lower inner curve, surrounded by glowing floating hearts. */
function HeroScene() {
  // Left-backed, upward-right-opening crescent moon:
  // Outer circle: (595, 324), r = 202 | Inner cutout: (650, 274), r = 178
  const crescentPath =
    "M 549.3 127.2 A 202 202 0 1 0 786.5 388.2 A 178 178 0 1 1 549.3 127.2 Z";

  return (
    <svg
      viewBox="0 0 1200 640"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 w-full h-full animate-dream-zoom"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="heroSky" cx="50%" cy="22%" r="88%">
          <stop offset="0%" stopColor="#3f1c66" />
          <stop offset="45%" stopColor="#241045" />
          <stop offset="100%" stopColor="#0d061a" />
        </radialGradient>
        <radialGradient id="moonGlow" cx="48%" cy="52%" r="50%">
          <stop offset="0%" stopColor="#ff94d4" stopOpacity="0.9" />
          <stop offset="38%" stopColor="#ff3ca6" stopOpacity="0.54" />
          <stop offset="68%" stopColor="#b036c8" stopOpacity="0.24" />
          <stop offset="100%" stopColor="#ff3ca6" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="coupleBackGlow" cx="50%" cy="52%" r="50%">
          <stop offset="0%" stopColor="#ff9ed8" stopOpacity="0.46" />
          <stop offset="55%" stopColor="#d14cb8" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#ff3d9a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="coupleHeartGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ff47a3" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#ff8fd0" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#ff3d9a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="moonBody" x1="0.1" y1="0" x2="0.88" y2="1">
          <stop offset="0%" stopColor="#fff6fb" />
          <stop offset="28%" stopColor="#ffd1ec" />
          <stop offset="64%" stopColor="#ff8dce" />
          <stop offset="100%" stopColor="#f257b3" />
        </linearGradient>
        <linearGradient id="moonInnerRim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#ffe0f2" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffb3df" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id="coupleHeartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffc2e4" />
          <stop offset="55%" stopColor="#ff4aa8" />
          <stop offset="100%" stopColor="#d9217d" />
        </linearGradient>
        <linearGradient id="coupleSilhouette" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#210b3d" />
          <stop offset="55%" stopColor="#17072e" />
          <stop offset="100%" stopColor="#100420" />
        </linearGradient>
        <linearGradient id="coupleRimStroke" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffb8e4" stopOpacity="0.72" />
          <stop offset="60%" stopColor="#ff86ce" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#d14cb8" stopOpacity="0.14" />
        </linearGradient>
        <linearGradient id="hillFar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a1452" />
          <stop offset="100%" stopColor="#150a29" />
        </linearGradient>
        <linearGradient id="hillNear" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1b0d38" />
          <stop offset="100%" stopColor="#0b0517" />
        </linearGradient>
        <linearGradient id="heartBlushPink" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffe4f6" />
          <stop offset="52%" stopColor="#ff88cf" />
          <stop offset="100%" stopColor="#f244a4" />
        </linearGradient>
        <linearGradient id="heartHotPink" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffb3e0" />
          <stop offset="48%" stopColor="#ff389e" />
          <stop offset="100%" stopColor="#d11378" />
        </linearGradient>
        <linearGradient id="heartMagenta" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffc7f0" />
          <stop offset="50%" stopColor="#ee40c0" />
          <stop offset="100%" stopColor="#b51c96" />
        </linearGradient>
        <linearGradient id="heartLavender" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#efe2ff" />
          <stop offset="50%" stopColor="#be8cff" />
          <stop offset="100%" stopColor="#8658f0" />
        </linearGradient>
        <radialGradient id="heartAuraPink" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ff4da8" stopOpacity="0.68" />
          <stop offset="55%" stopColor="#ff85cb" stopOpacity="0.24" />
          <stop offset="100%" stopColor="#ff3d9a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="heartAuraLavender" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#b884ff" stopOpacity="0.65" />
          <stop offset="55%" stopColor="#9f68ff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#8658f0" stopOpacity="0" />
        </radialGradient>
        <filter id="crescentOuterGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="16" result="outerBlur" />
          <feFlood floodColor="#ff38a8" floodOpacity="0.85" result="pinkTint" />
          <feComposite in="pinkTint" in2="outerBlur" operator="in" result="coloredGlow" />
          <feMerge>
            <feMergeNode in="coloredGlow" />
            <feMergeNode in="coloredGlow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="heartNeonGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.4" result="heartBlur" />
          <feMerge>
            <feMergeNode in="heartBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <path
          id="glowHeartShape"
          d="M 0 11 C -7 4 -15 -1 -15 -7 C -15 -12 -11 -15 -6.5 -15 C -3.4 -15 -1.1 -13.1 0 -10.5 C 1.1 -13.1 3.4 -15 6.5 -15 C 11 -15 15 -12 15 -7 C 15 -1 7 4 0 11 Z"
        />
        <clipPath id="crescentClip">
          <path d={crescentPath} />
        </clipPath>
        <g id="coupleSilhouettes">
          {/* MALE SILHOUETTE — unified contour: tousled romantic hair, tender profile facing right,
              slim tapered torso & shoulder leaning forward, seated thighs on moon, boots dangling below */}
          <path
            d="M 568 345
               C 562 336 561 325 566 316
               C 568 312 572 310 576 308
               C 579 305 585 305 588 308
               C 592 305 597 307 599 311
               C 604 310 607 314 603 318
               C 605 320 605 323 602 325
               C 602 328 604 330 606 333
               C 606 335 604 336 602 337
               C 603 339 602 341 600 342
               C 600 344 598 346 593 347
               L 589 348
               L 591 356
               C 596 367 601 380 604 391
               L 617 397
               C 619 399 618 403 614 404
               L 603 401
               C 603 406 607 412 613 416
               C 618 421 620 434 619 449
               L 622 496
               L 624 522
               C 626 525 630 528 629 532
               C 628 535 621 536 616 534
               C 614 532 614 526 614 521
               L 607 485
               L 603 466
               L 606 492
               L 609 518
               C 611 521 615 524 613 528
               C 612 531 605 532 600 530
               C 598 527 598 521 598 516
               L 590 475
               L 586 449
               C 574 446 562 439 555 430
               C 549 422 549 410 553 395
               C 557 379 560 364 567 353
               Z"
          />

          {/* FEMALE SILHOUETTE — unified contour: delicate upward-tilted profile facing left,
              long silky S-curved flowing hair, slim waist, flared dress on moon, slender tapered legs */}
          <path
            d="M 624 358
               C 621 355 619 351 620 348
               C 618 347 617 345 618 343
               C 615 341 614 339 617 336
               C 619 333 619 329 622 326
               C 626 320 634 317 644 319
               C 656 322 664 333 670 349
               C 676 365 685 375 698 377
               C 693 386 685 388 678 384
               C 684 394 686 403 683 411
               C 676 410 670 405 665 398
               C 667 408 669 416 665 421
               C 661 419 658 411 657 403
               C 660 416 666 431 672 443
               C 660 452 647 454 636 452
               L 636 490
               L 635 524
               C 636 530 637 536 634 539
               C 631 541 628 539 628 534
               L 627 518
               L 625 533
               C 625 538 621 540 618 538
               C 616 535 617 529 618 523
               L 620 489
               L 618 451
               C 613 449 611 444 612 436
               C 613 424 616 412 620 402
               L 611 404
               C 607 404 606 400 609 398
               L 620 390
               C 621 380 622 368 624 358
               Z"
          />
        </g>
      </defs>

      {/* night sky */}
      <rect width="1200" height="640" fill="url(#heroSky)" />

      {/* scattered stars & four-point celestial sparkles */}
      <g fill="#ffffff">
        {[
          [80, 90, 2.1], [190, 150, 1.4], [260, 65, 1.7], [340, 120, 1.2],
          [430, 80, 1.9], [505, 130, 1.2], [710, 88, 1.6], [795, 135, 1.2],
          [880, 68, 2.0], [960, 155, 1.4], [1040, 95, 1.8], [1115, 175, 1.2],
          [160, 235, 1.1], [1040, 250, 1.3], [385, 225, 1.2], [830, 245, 1.3],
        ].map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} opacity={0.5 + (i % 3) * 0.16} />
        ))}
        {/* subtle glowing 4-point stars mirroring the mockup */}
        <path
          d="M 800 148 Q 800 164 816 164 Q 800 164 800 180 Q 800 164 784 164 Q 800 164 800 148 Z"
          fill="#ffd1ec"
          opacity="0.9"
        />
        <path
          d="M 846 172 Q 846 180 854 180 Q 846 180 846 188 Q 846 180 838 180 Q 846 180 846 172 Z"
          fill="#ffb5e0"
          opacity="0.82"
        />
        <path
          d="M 380 314 Q 380 326 392 326 Q 380 326 380 338 Q 380 326 368 326 Q 380 326 380 314 Z"
          fill="#ffe0f2"
          opacity="0.84"
        />
      </g>

      {/* strong magenta/pink outer moon halo */}
      <circle
        cx="592"
        cy="336"
        r="272"
        fill="url(#moonGlow)"
        className="animate-glow-pulse"
      />
      <circle cx="614" cy="364" r="136" fill="url(#coupleBackGlow)" />

      {/* glowing crescent moon (independent animated layer) */}
      <g
        className="animate-moon-pulse"
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
      >
        {/* outer crescent luminous body with strong pink/magenta outer glow */}
        <path
          d={crescentPath}
          fill="url(#moonBody)"
          filter="url(#crescentOuterGlow)"
        />
        {/* subtle lunar craters and surface texture clipped inside crescent */}
        <g clipPath="url(#crescentClip)">
          {/* soft surface mottling */}
          <ellipse cx="426" cy="312" rx="24" ry="28" fill="#f072bc" opacity="0.28" />
          <ellipse cx="442" cy="395" rx="36" ry="32" fill="#ff9ed6" opacity="0.34" />
          <ellipse cx="496" cy="464" rx="46" ry="34" fill="#e65aad" opacity="0.25" />
          <ellipse cx="568" cy="492" rx="32" ry="22" fill="#ff82ca" opacity="0.32" />
          <ellipse cx="656" cy="496" rx="28" ry="18" fill="#e056a8" opacity="0.24" />
          {/* subtle crater details along left & lower curve */}
          <circle cx="444" cy="258" r="11" fill="#de5aa9" opacity="0.24" />
          <circle cx="418" cy="336" r="14" fill="#d94ea2" opacity="0.22" />
          <circle cx="454" cy="368" r="8" fill="#fff0f8" opacity="0.42" />
          <circle cx="476" cy="442" r="18" fill="#e25cad" opacity="0.26" />
          <circle cx="528" cy="478" r="12" fill="#d84fa0" opacity="0.25" />
          <circle cx="556" cy="500" r="8" fill="#fff2fa" opacity="0.38" />
          <circle cx="614" cy="494" r="14" fill="#e059aa" opacity="0.24" />
          <circle cx="684" cy="478" r="10" fill="#d94ea2" opacity="0.2" />
          <circle cx="730" cy="444" r="7" fill="#ffe6f5" opacity="0.35" />
          {/* bright inner crescent edge highlight */}
          <path
            d="M 549.3 127.2 A 178 178 0 1 0 786.5 388.2"
            fill="none"
            stroke="url(#moonInnerRim)"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        </g>
      </g>

      {/* small glowing floating heart & seated romantic couple (independent animated layer) */}
      <g
        className="animate-couple-float"
        style={{ transformBox: "fill-box", transformOrigin: "center bottom" }}
      >
        <circle cx="642" cy="236" r="32" fill="url(#coupleHeartGlow)" />
        <g
          className="animate-heartbeat"
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        >
          <path
            d="M 642 252 C 633 243 623 236 623 228 C 623 222 628 218 633.8 218 C 637.6 218 640.5 220.3 642 223.4 C 643.5 220.3 646.4 218 650.2 218 C 656 218 661 222 661 228 C 661 236 651 243 642 252 Z"
            fill="url(#coupleHeartFill)"
            stroke="#ffe8f5"
            strokeWidth="1.1"
            strokeOpacity="0.82"
          />
        </g>

        {/* subtle top-weighted pink rim-light contour */}
        <use
          href="#coupleSilhouettes"
          fill="none"
          stroke="url(#coupleRimStroke)"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        {/* main rich dark plum-violet silhouettes */}
        <use href="#coupleSilhouettes" fill="url(#coupleSilhouette)" />
      </g>

      {/* distant hills */}
      <path d="M0 520 Q 200 440 400 505 T 800 495 T 1200 515 V 640 H 0 Z" fill="url(#hillFar)" />
      {/* near hill */}
      <path d="M0 580 Q 300 520 620 575 T 1200 565 V 640 H 0 Z" fill="url(#hillNear)" />

      {/* glowing floating hearts distributed smoothly around the moon and scene */}
      <g>
        {FLOATING_HEARTS.map((h, i) => {
          const fillId =
            h.palette === "blush"
              ? "url(#heartBlushPink)"
              : h.palette === "hot"
                ? "url(#heartHotPink)"
                : h.palette === "magenta"
                  ? "url(#heartMagenta)"
                  : "url(#heartLavender)";
          const auraId = h.palette === "lavender" ? "url(#heartAuraLavender)" : "url(#heartAuraPink)";
          return (
            <g key={i} transform={`translate(${h.x}, ${h.y})`}>
              <g
                style={{
                  animation: `${h.floatAnim} ${h.floatDuration} ease-in-out infinite`,
                  animationDelay: h.floatDelay,
                  transformBox: "fill-box",
                  transformOrigin: "center",
                }}
              >
                <g
                  style={{
                    animation: `romanticHeartPulse ${h.pulseDuration} ease-in-out infinite`,
                    animationDelay: h.pulseDelay,
                    transformBox: "fill-box",
                    transformOrigin: "center",
                  }}
                >
                  <circle cx={0} cy={-2} r={24 * h.scale} fill={auraId} />
                  <use
                    href="#glowHeartShape"
                    transform={`scale(${h.scale})`}
                    fill={fillId}
                    filter="url(#heartNeonGlow)"
                    stroke={h.palette === "lavender" ? "#f4ebff" : "#ffe6f5"}
                    strokeWidth="0.9"
                    strokeOpacity="0.68"
                  />
                </g>
              </g>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

const ease = [0.22, 1, 0.36, 1] as const;

function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 36 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.9, delay, ease }}
      className={className}
    >
      {children}
    </motion.div>
  );
}


const SHORTCUTS = [
  { label: "People", icon: "◈", to: "/discover" },
  { label: "Cafés", icon: "☕", to: "/cafes" },
  { label: "Experiences", icon: "❧", to: "/experiences" },
  { label: "More", icon: "✦", to: "" },
];

function Shortcut({ label, icon, to }: { label: string; icon: string; to: string }) {
  const openMenu = () => window.dispatchEvent(new CustomEvent("datevra:open-menu"));
  const inner = (
    <>
      <span className="w-14 h-14 sm:w-16 sm:h-16 rounded-full glass flex items-center justify-center text-xl sm:text-2xl text-champagne shadow-[0_0_20px_rgba(197,164,255,0.25)] border border-champagne/25 transition-transform group-active:scale-95">
        <span className="drop-shadow-[0_0_8px_rgba(255,61,154,0.7)]">{icon}</span>
      </span>
      <span className="mt-2 text-xs tracking-wide text-ivory-dim/90">{label}</span>
    </>
  );
  const cls = "group flex flex-col items-center";
  return to ? (
    <Link to={to} className={cls} aria-label={label}>
      {inner}
    </Link>
  ) : (
    <button onClick={openMenu} className={cls} aria-label="More options">
      {inner}
    </button>
  );
}

function SuggestedCard({ profile }: { profile: UserProfile }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const navigate = useNavigate();
  const [liked, setLiked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [limitHit, setLimitHit] = useState(false);

  const like = async () => {
    if (!user) {
      navigate("/register");
      return;
    }
    if (busy || liked) return;
    setBusy(true);
    try {
      const { match } = await db.sendLike(user.id, profile.id);
      setLiked(true);
      toast(match ? `It's a match with ${profile.firstName}! Say hello in Matches.` : `You liked ${profile.firstName} ♥`);
    } catch (e) {
      if (e instanceof Error && e.message.includes("DAILY_LIKE_LIMIT_REACHED")) {
        setLimitHit(true);
      } else {
        toast(e instanceof Error ? e.message : "Couldn't send that like.", "rose");
      }
    } finally {
      setBusy(false);
    }
  };

  const photo = profile.photos?.[0];
  return (
    <div className="glass rounded-3xl overflow-hidden card-hover flex flex-col min-w-0">
      <div className="relative h-44 bg-gradient-to-br from-burgundy via-coal to-midnight">
        {photo ? (
          <img
            src={photo}
            alt={profile.firstName}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center font-display text-6xl text-champagne/40">
            {profile.firstName.charAt(0)}
          </span>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-midnight/70 via-transparent to-transparent" />
        <button
          onClick={like}
          aria-label={liked ? "Liked" : `Like ${profile.firstName}`}
          className={`absolute top-2.5 right-2.5 w-11 h-11 rounded-full flex items-center justify-center text-xl backdrop-blur-md transition-all active:scale-90 touch-manipulation ${
            liked
              ? "bg-rosegold text-white shadow-[0_0_16px_rgba(255,61,154,0.9)]"
              : "bg-black/35 text-blush border border-white/20 hover:border-rosegold/60"
          }`}
        >
          <span className={liked ? "animate-heartbeat inline-block" : ""}>♥</span>
        </button>
        {profile.verified && (
          <span className="absolute bottom-3 left-3 text-[0.65rem] px-2.5 py-1 rounded-full bg-celestial/25 border border-celestial/40 text-blush backdrop-blur-md">
            ✓ Verified
          </span>
        )}
      </div>
      <div className="p-4">
        <p className="font-display text-lg text-ivory leading-tight">
          {profile.firstName}, {profile.age}
        </p>
        <p className="text-xs text-mist mt-1 flex items-center gap-1">
          <span className="text-rosegold/70">✦</span> {profile.city}
          {profile.online && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />}
        </p>
      </div>
      {limitHit && (
        <LimitReachedModal open={true} kind="likes" onClose={() => setLimitHit(false)} />
      )}
    </div>
  );
}

export default function Home() {
  const db = useBackend();
  const { user } = useAuth();
  const { data: profiles, loading } = useAsync((b) => b.listProfiles(), [db], [] as UserProfile[], {
    cacheKey: "profiles",
  });
  const suggested = profiles.filter((p) => p.id !== user?.id).slice(0, 3);

  return (
    <div className="relative overflow-x-clip">
      {/* ================= HERO ================= */}
      <section className="relative px-4 sm:px-5 pt-24 sm:pt-28 pb-10 max-w-6xl mx-auto">
        <Reveal>
          <div className="relative rounded-[2rem] overflow-hidden glow-border">
            {/* illustration with slow cinematic zoom */}
            <div className="relative h-[44svh] sm:h-[52svh] min-h-[300px] sm:min-h-[380px] max-h-[560px] overflow-hidden">
              <HeroScene />
              <div className="absolute inset-0 bg-gradient-to-t from-midnight via-transparent to-midnight/30" />
              {/* heartbeat glow centered over the luminous crescent moon */}
              <div className="absolute left-1/2 top-[51%] -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                <span className="block w-52 h-52 rounded-full bg-rosegold/30 blur-3xl animate-heartbeat" />
              </div>
              {/* glowing heart trail orbiting the crescent moon */}
              <div className="absolute left-1/2 top-[51%] -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                <span className="block animate-orbit-glow text-2xl text-blush drop-shadow-[0_0_12px_rgba(255,61,154,1)]">
                  ♥
                </span>
              </div>
              <DreamField count={22} seed={11} className="opacity-80" />
            </div>
          </div>
        </Reveal>

        {/* headline below the illustration */}
        <div className="text-center mt-10 max-w-2xl mx-auto">
          <Reveal delay={0.1}>
            <h1 className="font-display text-4xl sm:text-[2.6rem] leading-[1.12] md:text-6xl text-ivory">
              Some Moments
              <br />
              <span className="text-gradient-dream">Feel Like Magic</span>
            </h1>
          </Reveal>
          <Reveal delay={0.22}>
            <p className="mt-5 text-ivory-dim/85 text-[1.02rem] leading-relaxed">
              Connect with people who make life more beautiful.
            </p>
          </Reveal>
          <Reveal delay={0.32}>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/register"
                className="btn-gold rounded-full px-10 py-4 text-base font-semibold w-full sm:w-auto text-center"
              >
                Sign Up
              </Link>
              <Link
                to="/discover"
                className="rounded-full px-10 py-4 text-base font-medium w-full sm:w-auto text-center border border-rosegold/50 border-champagne/40 bg-white/[0.03] backdrop-blur-md text-ivory hover:border-rosegold transition-all hover:-translate-y-0.5"
              >
                Explore
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ================= SHORTCUTS ================= */}
      <section className="px-4 sm:px-5 pb-4 max-w-6xl mx-auto">
        <Reveal>
          <div className="grid grid-cols-4 gap-2 max-w-md mx-auto">
            {SHORTCUTS.map((s) => (
              <Shortcut key={s.label} {...s} />
            ))}
          </div>
        </Reveal>
      </section>

      {/* ================= SUGGESTED ================= */}
      <section className="px-4 sm:px-5 py-10 max-w-6xl mx-auto">
        <Reveal>
          <div className="flex items-center justify-between gap-4 mb-6">
            <h2 className="font-display text-2xl sm:text-3xl text-ivory">Suggested For You</h2>
            <Link to="/discover" className="text-sm text-rosegold hover:text-blush transition-colors shrink-0">
              See All →
            </Link>
          </div>
        </Reveal>
        {loading ? (
          <div className="grid grid-cols-1 min-[480px]:grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-64 rounded-3xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 min-[480px]:grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
            {suggested.map((p, i) => (
              <Reveal key={p.id} delay={i * 0.1}>
                <SuggestedCard profile={p} />
              </Reveal>
            ))}
          </div>
        )}
      </section>

      {/* ================= CLOSING CTA ================= */}
      <section className="px-4 sm:px-5 py-12 sm:py-16 max-w-6xl mx-auto text-center">
        <Reveal>
          <div className="relative glass-strong rounded-[2rem] px-5 sm:px-8 py-10 sm:py-14 overflow-hidden">
            <DreamField count={16} seed={23} hearts sparkles={false} stars={false} className="opacity-60" />
            <p className="text-[0.7rem] uppercase tracking-[0.42em] text-rosegold/90">✦ Begin ✦</p>
            <h2 className="font-display text-3xl sm:text-4xl text-ivory mt-4">
              Your story starts <span className="text-gradient-dream">tonight</span>
            </h2>
            <p className="mt-4 text-ivory-dim/80 max-w-xl mx-auto">
              Join Datevra — verified profiles, thoughtful matching, and dates arranged like art.
            </p>
            <Link to="/register" className="btn-gold rounded-full px-8 sm:px-10 py-3.5 sm:py-4 min-h-[44px] w-full sm:w-auto text-base font-semibold inline-flex items-center justify-center mt-8">
              Sign Up Free
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
