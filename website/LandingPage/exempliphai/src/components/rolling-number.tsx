"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

type CharCell = {
  key: string;
  char: string;
  animate: boolean;
};

function splitForRoll(current: string, prev?: string): CharCell[] {
  const cur = String(current ?? "");
  const p = prev == null ? "" : String(prev);

  // Align strings from the right so digit positions stay stable when commas appear/disappear.
  const maxLen = Math.max(cur.length, p.length);
  const curPadded = cur.padStart(maxLen, " ");
  const prevPadded = p.padStart(maxLen, " ");

  const cells: CharCell[] = [];
  for (let i = 0; i < maxLen; i++) {
    const c = curPadded[i];
    const prevC = prevPadded[i];
    const isDigit = c >= "0" && c <= "9";
    const prevIsDigit = prevC >= "0" && prevC <= "9";
    const animate = isDigit && prevIsDigit && c !== prevC;
    cells.push({
      key: `${i}`,
      char: c,
      animate,
    });
  }

  // Trim leading padding spaces from the rendered output.
  while (cells.length && cells[0].char === " ") cells.shift();
  return cells;
}

export function RollingNumber({ value, className }: { value: string; className?: string }) {
  const prev = usePrevious(value);
  const cells = useMemo(() => splitForRoll(value, prev), [value, prev]);

  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "baseline" }}>
      {cells.map((cell, idx) => (
        <DigitCell key={`${cell.key}-${idx}`} char={cell.char} animate={cell.animate} />
      ))}
    </span>
  );
}

function DigitCell({ char, animate }: { char: string; animate: boolean }) {
  const [shown, setShown] = useState(char);
  const prev = usePrevious(char);

  useEffect(() => {
    setShown(char);
  }, [char]);

  // Non-digits (commas, spaces, dots) render statically.
  const isDigit = char >= "0" && char <= "9";
  if (!isDigit) {
    return <span style={{ whiteSpace: "pre" }}>{char}</span>;
  }

  if (!animate || prev == null) {
    return <span className="tabular-nums">{shown}</span>;
  }

  return (
    <span
      className="tabular-nums"
      style={{
        display: "inline-block",
        position: "relative",
        height: "1em",
        width: "0.62em",
        overflow: "hidden",
        lineHeight: "1em",
      }}
      aria-label={char}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={char}
          initial={{ y: "100%" }}
          animate={{ y: "0%" }}
          exit={{ y: "-100%" }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          style={{ position: "absolute", left: 0, right: 0, top: 0, textAlign: "center" }}
        >
          {char}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

