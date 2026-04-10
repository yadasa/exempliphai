export function showPlusGateToast(opts: { message?: string; ms?: number } = {}) {
  const msg = String(opts.message || 'Upgrade to plus to access all features!');
  const ms = Number.isFinite(opts.ms as any) ? Number(opts.ms) : 3000;

  try {
    const existing = document.getElementById('exempliphai-plus-gate-toast');
    if (existing) existing.remove();
  } catch (_) {}

  const el = document.createElement('div');
  el.id = 'exempliphai-plus-gate-toast';
  el.innerHTML = `
    <div style="position:fixed; z-index:999999; right:18px; bottom:18px; max-width:340px; width:calc(100% - 36px);">
      <div style="position:relative; border-radius:16px; padding:14px 14px 12px 14px; background:rgba(124,58,237,0.95); color:#fff; box-shadow:0 22px 55px rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.18);">
        <button id="exempliphai-plus-gate-toast-close" aria-label="Close" style="position:absolute; top:10px; right:10px; width:26px; height:26px; border:none; border-radius:999px; background:rgba(255,255,255,0.18); color:#fff; cursor:pointer; font-weight:900; line-height:26px;">×</button>
        <div style="font-weight:900; letter-spacing:-0.01em; margin-right:28px;">${msg}</div>
      </div>
    </div>
  `;

  const remove = () => {
    try {
      el.style.transition = 'opacity 300ms ease';
      el.style.opacity = '0';
      window.setTimeout(() => el.remove(), 320);
    } catch (_) {
      try { el.remove(); } catch (_) {}
    }
  };

  try {
    document.body.appendChild(el);
    const btn = document.getElementById('exempliphai-plus-gate-toast-close');
    if (btn) btn.addEventListener('click', remove);
  } catch (_) {}

  window.setTimeout(remove, Math.max(500, ms));
}

