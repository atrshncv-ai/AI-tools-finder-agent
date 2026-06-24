import { useState, useEffect } from "react";
import { ArrowUp } from "lucide-react";

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed bottom-6 right-6 z-40 flex items-center justify-center w-10 h-10 rounded-full shadow-lg transition-all duration-200 hover:scale-110"
      style={{ backgroundColor: "var(--color-accent)", color: "white" }}
    >
      <ArrowUp className="w-5 h-5" />
    </button>
  );
}
