import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import LoginPage from "./LoginPage";
import MainPage from "./MainPage"; // pastikan path sesuai
import { fadeVariants } from "./components/motion";

export default function App() {
  const [user, setUser] = useState(null);

  const handleLogin = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    setUser(null);
  };

  return (
    <AnimatePresence mode="wait">
      {!user ? (
        <motion.div key="login" variants={fadeVariants} initial="hidden" animate="visible" exit="exit">
          <LoginPage onLogin={handleLogin} />
        </motion.div>
      ) : (
        <motion.div key="main" variants={fadeVariants} initial="hidden" animate="visible" exit="exit">
          <MainPage user={user} onLogout={handleLogout} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
