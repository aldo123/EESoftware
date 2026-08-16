// Shared Framer Motion primitives — keeps modal/page transitions consistent app-wide.
import { motion } from "framer-motion";

export const EASE_OUT = [0.16, 1, 0.3, 1];

export const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.18, ease: "easeOut" } },
  exit: { opacity: 0, transition: { duration: 0.15, ease: "easeIn" } },
};

export const panelVariants = {
  hidden: { opacity: 0, scale: 0.94, y: 14 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.24, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.15, ease: "easeIn" } },
};

export const fadeVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2, ease: "easeOut" } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: "easeIn" } },
};

export const slideUpVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE_OUT } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.12, ease: "easeIn" } },
};

export const dropdownVariants = {
  hidden: { opacity: 0, scale: 0.96, y: -6 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.15, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.1, ease: "easeIn" } },
};

// Backdrop for fixed-inset modal overlays. Pass the same className the div had before.
export function ModalBackdrop({ className, children, ...props }) {
  return (
    <motion.div
      className={className}
      variants={backdropVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      {...props}
    >
      {children}
    </motion.div>
  );
}

// Inner panel of a modal — scales/slides in, inherits animate/exit state from ModalBackdrop parent.
export function ModalPanel({ className, children, ...props }) {
  return (
    <motion.div className={className} variants={panelVariants} {...props}>
      {children}
    </motion.div>
  );
}
