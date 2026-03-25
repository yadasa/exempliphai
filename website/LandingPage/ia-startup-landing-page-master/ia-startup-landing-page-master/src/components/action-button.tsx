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
      className="relative cursor-pointer rounded-lg bg-linear-to-b from-[#190d2e] to-[#4a208a] px-3 py-2 font-medium text-sm shadow-[0px_0px_12px_#8c45ff]"
      {...props}
    >
      <div className="absolute inset-0 rounded-lg">
        <div className="mask-[linear-gradient(to_bottom,black,transparent)] absolute inset-0 rounded-lg border border-white/20" />
        <div className="mask-[linear-gradient(to_top,black,transparent)] absolute inset-0 rounded-lg border border-white/40" />
        <div className="absolute inset-0 rounded-lg shadow-[0_0_10px_rgb(140,69,255,0.7)_inset]" />
      </div>
      <span>{label}</span>
    </button>
  );
}
