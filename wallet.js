/* Pons Fork — shared wallet connect (injected EIP-1193: Rabby / MetaMask / Trust / Coinbase …).
   Zero external dependencies. One session across every page via localStorage.
   Exposes window.ponsWallet; auto-wires #connect / #nav-connect / [data-connect] (skip with data-noauto). */
(() => {
  "use strict";
  const RPC = "https://rpc.arrowrpc.com";
  const EXPLORER = "https://robinhoodchain.blockscout.com";
  const CHAIN_HEX = "0x1237"; // 4663
  const CHAIN_ID = 4663;
  const SEL = "#connect,#nav-connect,[data-connect]";
  const LS_ADDR = "pf_addr", LS_OFF = "pf_off";

  const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
  const listeners = new Set();
  let acct = { address: undefined, isConnected: false, chainId: undefined };

  // EIP-6963: discover injected wallets so we can target one (e.g. Rabby) if several are installed
  const wallets = [];
  try {
    window.addEventListener("eip6963:announceProvider", (e) => {
      const d = e.detail;
      if (d && d.provider && !wallets.some((w) => w.info.rdns === d.info.rdns)) wallets.push(d);
    });
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  } catch (_) {}
  const providerFor = (rdns) => {
    if (rdns) { const w = wallets.find((x) => x.info.rdns === rdns); if (w) return w.provider; }
    if (wallets.length) return wallets[0].provider;
    return window.ethereum || null;
  };

  const noauto = (b) => b.hasAttribute("data-noauto");
  function paint() {
    document.querySelectorAll(SEL).forEach((b) => {
      if (noauto(b)) return;
      b.textContent = acct.isConnected ? short(acct.address) : (b.dataset.label || "Connect wallet");
      b.title = acct.isConnected ? "Wallet — click for account & disconnect" : "";
      b.classList.toggle("wallet-on", acct.isConnected);
    });
  }
  function setAcct(address, chainId) {
    const on = !!address;
    acct = { address: address || undefined, isConnected: on, chainId: on ? (chainId ?? acct.chainId ?? CHAIN_ID) : undefined };
    try { on ? localStorage.setItem(LS_ADDR, address) : localStorage.removeItem(LS_ADDR); } catch (_) {}
    paint();
    listeners.forEach((f) => { try { f(acct); } catch (_) {} });
  }

  // optimistic state from storage → instant, cross-page display
  try { if (localStorage.getItem(LS_OFF) !== "1") { const s = localStorage.getItem(LS_ADDR); if (s) acct = { address: s, isConnected: true, chainId: CHAIN_ID }; } } catch (_) {}

  let active = null;
  function bind(p) {
    if (!p || p._pfBound || !p.on) return; p._pfBound = true;
    p.on("accountsChanged", (a) => {
      if (a && a[0] && localStorage.getItem(LS_OFF) !== "1") setAcct(a[0], acct.chainId);
      else setAcct(null);
    });
    p.on("chainChanged", (c) => { acct.chainId = parseInt(c, 16); paint(); });
  }

  async function ensureChain(p) {
    let cid; try { cid = await p.request({ method: "eth_chainId" }); } catch (_) { return; }
    if (cid === CHAIN_HEX) return;
    try { await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] }); }
    catch (e) {
      if (e && e.code === 4902) {
        await p.request({ method: "wallet_addEthereumChain", params: [{ chainId: CHAIN_HEX, chainName: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [RPC], blockExplorerUrls: [EXPLORER] }] });
      } else throw e;
    }
  }

  async function doConnect(rdns) {
    const p = providerFor(rdns);
    if (!p) { alert("No wallet found. Install Rabby, MetaMask, or another browser wallet and reload."); return null; }
    active = p; bind(p);
    let accs;
    try { accs = await p.request({ method: "eth_requestAccounts" }); }
    catch (e) { if (e && e.code === 4001) return null; throw e; }
    if (!accs || !accs[0]) return null;
    try { await ensureChain(p); } catch (_) {}
    try { localStorage.removeItem(LS_OFF); } catch (_) {}
    setAcct(accs[0], CHAIN_ID);
    return accs[0];
  }

  // ── wallet chooser (only if 2+ injected wallets); otherwise connect straight away ──
  function connectFlow() {
    if (wallets.length <= 1) return doConnect();
    closeMenu();
    const ov = document.createElement("div");
    ov.id = "pf-w-modal";
    ov.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(18,21,19,.35);display:flex;align-items:center;justify-content:center;padding:20px";
    const card = document.createElement("div");
    card.style.cssText = "background:#fff;border-radius:16px;padding:16px;min-width:280px;max-width:340px;box-shadow:0 24px 60px rgba(0,0,0,.22);font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#121513";
    card.innerHTML = '<div style="font-weight:600;font-size:15px;margin:2px 4px 12px">Connect a wallet</div>';
    wallets.forEach((w) => {
      const row = document.createElement("button");
      row.style.cssText = "display:flex;align-items:center;gap:12px;width:100%;border:1px solid rgba(18,21,19,.1);background:#fff;border-radius:12px;padding:10px 12px;margin-bottom:8px;cursor:pointer;font:inherit;font-size:14px;text-align:left";
      row.innerHTML = (w.info.icon ? '<img src="' + w.info.icon + '" width="26" height="26" style="border-radius:6px"/>' : "") + '<span style="font-weight:500">' + w.info.name + "</span>";
      row.addEventListener("click", () => { closeModal(); doConnect(w.info.rdns); });
      card.appendChild(row);
    });
    ov.appendChild(card);
    ov.addEventListener("click", (e) => { if (e.target === ov) closeModal(); });
    document.body.appendChild(ov);
  }
  const closeModal = () => { const m = document.getElementById("pf-w-modal"); if (m) m.remove(); };

  // ── account menu: copy / profile / disconnect ──
  function openMenu(btn) {
    closeMenu();
    const m = document.createElement("div");
    m.id = "pf-w-menu";
    m.style.cssText = "position:absolute;z-index:100000;background:#fff;border:1px solid rgba(18,21,19,.12);border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.15);padding:6px;min-width:210px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif";
    const r = btn.getBoundingClientRect();
    m.style.top = (window.scrollY + r.bottom + 8) + "px";
    m.style.left = (window.scrollX + Math.max(8, r.right - 214)) + "px";
    const a = acct.address;
    const item = "display:block;width:100%;text-align:left;border:0;background:none;padding:9px 11px;border-radius:8px;cursor:pointer;font:inherit;font-size:13px;color:#121513;text-decoration:none;box-sizing:border-box";
    m.innerHTML =
      '<div style="padding:8px 11px;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#5c635d;word-break:break-all">' + a + "</div>" +
      '<button data-a="copy" style="' + item + '">Copy address</button>' +
      '<a data-a="prof" href="/profile/' + a + '" style="' + item + '">View profile</a>' +
      '<button data-a="disc" style="' + item + ';color:#d23c3c">Disconnect</button>';
    m.addEventListener("click", (e) => {
      const el = e.target.closest("[data-a]"); if (!el) return;
      if (el.dataset.a === "copy") { try { navigator.clipboard.writeText(a); } catch (_) {} }
      if (el.dataset.a === "disc") { api.disconnect(); }
      if (el.dataset.a !== "prof") closeMenu();
    });
    document.body.appendChild(m);
    setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
  }
  function onDoc(e) { const m = document.getElementById("pf-w-menu"); if (m && !m.contains(e.target)) closeMenu(); }
  function closeMenu() { const m = document.getElementById("pf-w-menu"); if (m) m.remove(); document.removeEventListener("mousedown", onDoc); }

  const toHex = (s) => "0x" + Array.from(new TextEncoder().encode(s)).map((b) => b.toString(16).padStart(2, "0")).join("");

  const api = {
    open() { acct.isConnected ? openMenuAt() : connectFlow(); },
    async connect() { return acct.isConnected ? acct.address : doConnect(); },
    async disconnect() { try { localStorage.setItem(LS_OFF, "1"); } catch (_) {} setAcct(null); },
    address: () => acct.address,
    isConnected: () => acct.isConnected,
    chainId: () => acct.chainId,
    onChange(cb) { listeners.add(cb); try { cb(acct); } catch (_) {} return () => listeners.delete(cb); },
    async signMessage(message) {
      const p = active || providerFor(); if (!p) throw new Error("no wallet");
      if (!acct.isConnected) await doConnect();
      return p.request({ method: "personal_sign", params: [toHex(message), acct.address] });
    },
    async sendTransaction(tx) {
      const p = active || providerFor(); if (!p) throw new Error("no wallet");
      if (!acct.isConnected) await doConnect();
      await ensureChain(p);
      const value = tx.value != null ? "0x" + BigInt(tx.value).toString(16) : "0x0";
      return p.request({ method: "eth_sendTransaction", params: [{ from: acct.address, to: tx.to, value, data: tx.data }] });
    },
    ready: async () => true,
  };
  window.ponsWallet = api;

  function openMenuAt() { const b = document.querySelector('#connect:not([data-noauto]),#nav-connect:not([data-noauto]),[data-connect]:not([data-noauto])'); if (b) openMenu(b); }

  function wire() {
    document.querySelectorAll(SEL).forEach((b) => {
      if (b._pw || noauto(b)) return; b._pw = 1;
      if (!b.dataset.label) b.dataset.label = (b.textContent || "").trim() || "Connect wallet";
      b.addEventListener("click", (e) => { e.preventDefault(); acct.isConnected ? openMenu(b) : connectFlow(); });
    });
    paint();
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", wire) : wire();

  // restore on load: confirm a stored session against the wallet (unless the user explicitly disconnected)
  (function restore() {
    try {
      if (localStorage.getItem(LS_OFF) === "1") { setAcct(null); return; }
      if (!localStorage.getItem(LS_ADDR)) return;
      setTimeout(async () => {
        const p = providerFor(); if (!p) return; active = p; bind(p);
        try { const a = await p.request({ method: "eth_accounts" }); setAcct(a && a[0] ? a[0] : null, acct.chainId); } catch (_) {}
      }, 350);
    } catch (_) {}
  })();
})();
