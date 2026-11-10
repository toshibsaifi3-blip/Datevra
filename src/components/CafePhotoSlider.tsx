import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface CafePhotoSliderProps {
  images: string[];
  cafeName: string;
  className?: string;
  aspectRatioClassName?: string;
  fallbackLetter?: string;
}

export function CafePhotoSlider({
  images,
  cafeName,
  className = "",
  aspectRatioClassName = "h-56 sm:h-64",
  fallbackLetter,
}: CafePhotoSliderProps) {
  const validImages = images.filter((img) => typeof img === "string" && img.trim().length > 0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  // If images change and index is out of bounds, reset index
  useEffect(() => {
    if (currentIndex >= validImages.length && validImages.length > 0) {
      setCurrentIndex(0);
    }
  }, [validImages.length, currentIndex]);

  const hasMultiple = validImages.length > 1;

  const goTo = useCallback(
    (nextIndex: number, dir: 1 | -1) => {
      setDirection(dir);
      setCurrentIndex(nextIndex);
    },
    [],
  );

  const prev = useCallback(
    (e?: React.MouseEvent | React.TouchEvent) => {
      e?.preventDefault();
      e?.stopPropagation();
      if (!hasMultiple) return;
      const nextIndex = (currentIndex - 1 + validImages.length) % validImages.length;
      goTo(nextIndex, -1);
    },
    [currentIndex, validImages.length, hasMultiple, goTo],
  );

  const next = useCallback(
    (e?: React.MouseEvent | React.TouchEvent) => {
      e?.preventDefault();
      e?.stopPropagation();
      if (!hasMultiple) return;
      const nextIndex = (currentIndex + 1) % validImages.length;
      goTo(nextIndex, 1);
    },
    [currentIndex, validImages.length, hasMultiple, goTo],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!hasMultiple) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      prev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      next();
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!hasMultiple) return;
    const touch = e.touches[0];
    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!hasMultiple || touchStartXRef.current === null || touchStartYRef.current === null) return;
    const touch = e.changedTouches[0];
    const diffX = touch.clientX - touchStartXRef.current;
    const diffY = touch.clientY - touchStartYRef.current;

    // Detect horizontal swipe if deltaX > 40 and horizontal distance exceeds vertical distance
    if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY)) {
      e.preventDefault();
      if (diffX > 0) {
        prev();
      } else {
        next();
      }
    }
    touchStartXRef.current = null;
    touchStartYRef.current = null;
  };

  // If no photos at all, render graceful branded fallback
  if (validImages.length === 0) {
    return (
      <div className={`relative ${aspectRatioClassName} bg-gradient-to-br from-burgundy via-coal to-midnight flex items-center justify-center overflow-hidden ${className}`}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(197,164,255,0.2),transparent_55%)]" />
        <span className="font-display text-8xl text-champagne/80 select-none drop-shadow-[0_0_25px_rgba(197,164,255,0.35)]">
          {fallbackLetter || cafeName.charAt(0) || "C"}
        </span>
      </div>
    );
  }

  const slideVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? "100%" : "-100%",
      opacity: 0.85,
    }),
    center: {
      x: "0%",
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? "-100%" : "100%",
      opacity: 0.85,
    }),
  };

  const currentPhoto = validImages[currentIndex];

  return (
    <div
      className={`relative ${aspectRatioClassName} w-full overflow-hidden select-none bg-black/40 group ${className}`}
      onKeyDown={handleKeyDown}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      tabIndex={hasMultiple ? 0 : -1}
      role={hasMultiple ? "region" : undefined}
      aria-label={hasMultiple ? `${cafeName} photos slider` : undefined}
      aria-roledescription={hasMultiple ? "carousel" : undefined}
    >
      <AnimatePresence initial={false} custom={direction}>
        <motion.div
          key={currentIndex}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{
            x: { type: "spring", stiffness: 320, damping: 32 },
            opacity: { duration: 0.25 },
          }}
          className="absolute inset-0 w-full h-full"
        >
          <img
            src={currentPhoto}
            alt={`${cafeName} photo ${currentIndex + 1} of ${validImages.length}`}
            className="w-full h-full object-cover object-center pointer-events-none"
            loading="lazy"
          />
        </motion.div>
      </AnimatePresence>

      {/* Subtle vignette gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-midnight/60 via-transparent to-black/20 pointer-events-none" />

      {/* Previous / Next buttons for desktop and accessible navigation */}
      {hasMultiple && (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label={`Previous photo for ${cafeName}`}
            className="absolute left-3 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] w-11 h-11 rounded-full glass-strong border border-white/20 text-ivory flex items-center justify-center opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 hover:scale-105 active:scale-95 transition-all shadow-lg z-10 touch-manipulation focus:outline-none focus:ring-2 focus:ring-rosegold"
          >
            <span className="text-xl leading-none -ml-0.5">‹</span>
          </button>
          <button
            type="button"
            onClick={next}
            aria-label={`Next photo for ${cafeName}`}
            className="absolute right-3 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] w-11 h-11 rounded-full glass-strong border border-white/20 text-ivory flex items-center justify-center opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 hover:scale-105 active:scale-95 transition-all shadow-lg z-10 touch-manipulation focus:outline-none focus:ring-2 focus:ring-rosegold"
          >
            <span className="text-xl leading-none -mr-0.5">›</span>
          </button>

          {/* Pagination dots & counter badge */}
          <div className="absolute bottom-3 inset-x-0 flex items-center justify-center gap-1.5 z-10 pointer-events-none">
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-md border border-white/10 pointer-events-auto">
              {validImages.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    goTo(i, i > currentIndex ? 1 : -1);
                  }}
                  aria-label={`Go to photo ${i + 1} of ${validImages.length} for ${cafeName}`}
                  aria-current={i === currentIndex ? "true" : undefined}
                  className={`h-1.5 rounded-full transition-all touch-manipulation ${
                    i === currentIndex
                      ? "w-4 bg-gradient-to-r from-rosegold to-champagne shadow-[0_0_8px_rgba(255,61,154,0.8)]"
                      : "w-1.5 bg-white/40 hover:bg-white/70"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Photo count indicator pill top-right */}
          <div className="absolute top-3.5 right-3.5 z-10 pointer-events-none">
            <span className="text-[0.65rem] font-medium tracking-wider px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-ivory-dim border border-white/15">
              {currentIndex + 1}/{validImages.length}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
