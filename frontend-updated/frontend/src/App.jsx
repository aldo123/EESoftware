import { useState } from "react";
import LoginPage from "./LoginPage";
import MainPage from "./MainPage"; // pastikan path sesuai

export default function App() {
  const [user, setUser] = useState(null);

  const handleLogin = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    setUser(null);
  };

  return (
    <>
      {!user ? (
        <LoginPage onLogin={handleLogin} />
      ) : (
        <MainPage user={user} onLogout={handleLogout} />
      )}
    </>
  );
}