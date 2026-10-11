import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Logo, PetalField } from "../../components/ui";

export default function NotFound() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-5 py-20 relative">
      <PetalField count={10} />
      <div className="text-center relative">
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <Logo size={60} />
        </motion.div>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.7 }}
          className="font-display text-[7rem] md:text-[9rem] leading-none text-gradient-gold font-semibold mt-8"
        >
          404
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.7 }}
          className="font-display text-3xl text-ivory mt-2"
        >
          This page slipped away
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.7 }}
          className="text-ivory-dim/80 mt-4 max-w-md mx-auto"
        >
          The page you're looking for doesn't exist or has moved — unlike a
          great first date, some things just aren't meant to be found.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65, duration: 0.6 }}
          className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link to="/" className="btn-gold rounded-full px-10 py-4 text-base font-semibold">
            Back to home
          </Link>
          <Link to="/experiences" className="btn-ghost rounded-full px-10 py-4 text-base">
            Explore experiences
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
