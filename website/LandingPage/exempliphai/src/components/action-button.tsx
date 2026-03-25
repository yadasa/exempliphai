import type { HTMLAttributes } from "react";

type ActionButtonProps = Omit<
  HTMLAttributes<HTMLButtonElement>,
  "className"
> & {
  label: string;
};

export function ActionButton({ label, ...props }: ActionButtonProps) {
  return (
    <button
      className="relative cursor-pointer rounded-lg bg-linear-to-b from-[#2563eb] to-[#7c3aed] px-3 py-2 font-medium text-sm text-white shadow-[0px_0px_18px_rgba(124,58,237,0.45)]"
      {...props}
    >
      <div className="absolute inset-0 rounded-lg">
        <div className="mask-[linear-gradient(to_bottom,black,transparent)] absolute inset-0 rounded-lg border border-white/20" />
        <div className="mask-[linear-gradient(to_top,black,transparent)] absolute inset-0 rounded-lg border border-white/40" />
        <div className="absolute inset-0 rounded-lg shadow-[0_0_14px_rgba(37,99,235,0.35)_inset]" />
      </div>
      <span>{label}</span>
    </button>
  );
}
