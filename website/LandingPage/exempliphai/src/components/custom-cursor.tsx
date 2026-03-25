"use client";

import { useEffect, useRef } from "react";

export function CustomCursor() {
  const dotRef = useRef<HTMLDivElement | null>(null);
  const outlineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Only for precise pointers (mouse/trackpad).
    const isFinePointer =
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: fine)").matches;
    if (!isFinePointer) return;

    const mouse = { x: 0, y: 0 };
    const position = { x: 0, y: 0 };

    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };

    document.addEventListener("mousemove", handleMouseMove);

    let raf = 0;
    const animate = () => {
      position.x += (mouse.x - position.x) * 0.12;
      position.y += (mouse.y - position.y) * 0.12;

      if (dotRef.current && outlineRef.current) {
        dotRef.current.style.transform = `translate3d(${mouse.x - 6}px, ${mouse.y - 6}px, 0)`;
        outlineRef.current.style.transform = `translate3d(${position.x - 20}px, ${position.y - 20}px, 0)`;
      }

      raf = window.requestAnimationFrame(animate);
    };

    raf = window.requestAnimationFrame(animate);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      window.cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <div
        ref={outlineRef}
        className="custom-cursor-ring"
        aria-hidden="true"
      />
      <div ref={dotRef} className="custom-cursor-dot" aria-hidden="true" />
    </>
  );
}
