/* Pons Fork — shared wallet connect (Reown AppKit; the same stack pons.family runs).
   Owns its own connected-state in localStorage so every page shows the wallet instantly,
   then lazy-loads AppKit to reconnect the session and drive connect / disconnect / signing.
   Auto-wires any #connect / #nav-connect / [data-connect] button (skip with data-noauto). */
(() => {
  "use strict";
  const CDNS = [
    "https://cdn.jsdelivr.net/npm/@reown/appkit-cdn@1.1.0/dist/appkit.js",
    "https://unpkg.com/@reown/appkit-cdn@1.1.0/dist/appkit.js",
  ];
  const PROJECT_ID = "6d5eead1ed6dc7b4a74927eec58f80d7";
  const RPC = "https://rpc.arrowrpc.com";
  const EXPLORER = "https://robinhoodchain.blockscout.com";
  const CHAIN_ID = 4663;
  const SEL = "#connect,#nav-connect,[data-connect]";
  const LS = "pf_addr";

  const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
  const listeners = new Set();
  let acct = { address: undefined, isConnected: false, chainId: undefined };
  let kit = null, kitP = null;
  let sawConnected = false; // in-session flag: only clear state on a real connected→disconnected transition

  // optimistic state from our own storage → instant, bundle-free cross-page display
  try { const s = localStorage.getItem(LS); if (s) acct = { address: s, isConnected: true, chainId: CHAIN_ID }; } catch (_) {}

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
    acct = { address: address || undefined, isConnected: on, chainId: on ? (chainId ?? CHAIN_ID) : undefined };
    try { on ? localStorage.setItem(LS, address) : localStorage.removeItem(LS); } catch (_) {}
    paint();
    listeners.forEach((f) => { try { f(acct); } catch (_) {} });
  }

  async function ensure() {
    if (kit) return kit;
    if (kitP) return kitP;
    kitP = (async () => {
      let m, lastErr;
      for (const url of CDNS) {
        try { m = await import(url); break; }
        catch (e) { lastErr = e; console.warn("[pons-wallet] CDN failed:", url, e && e.message); }
      }
      if (!m) throw (lastErr || new Error("all CDNs failed"));
      const chain = m.networks.defineChain({
        id: CHAIN_ID, caipNetworkId: "eip155:" + CHAIN_ID, chainNamespace: "eip155",
        name: "Robinhood Chain",
        nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
        rpcUrls: { default: { http: [RPC] } },
        blockExplorers: { default: { name: "Blockscout", url: EXPLORER } },
      });
      const adapter = new m.WagmiAdapter({ projectId: PROJECT_ID, networks: [chain] });
      const modal = m.createAppKit({
        adapters: [adapter], networks: [chain], defaultNetwork: chain, projectId: PROJECT_ID,
        metadata: {
          name: "Pons Fork",
          description: "Automated creator-fee engine for pons.family tokens",
          url: "https://ponsfork.com", icons: ["https://ponsfork.com/logo.jpg"],
        },
        features: { analytics: false, email: false, socials: false, onramp: false, swaps: false },
        themeMode: "light",
        themeVariables: { "--w3m-accent": "#121513" },
      });
      const cfg = adapter.wagmiConfig, W = m.WagmiCore;
      const sync = (a) => {
        if (a && a.status === "connected" && a.address) { sawConnected = true; setAcct(a.address, a.chainId); }
        else if (a && a.status === "disconnected" && sawConnected) { sawConnected = false; setAcct(null); }
        // ignore the initial "disconnected" before any connection — keep optimistic display
      };
      W.watchAccount(cfg, { onChange: sync });
      kit = { modal, cfg, W, chain, viem: m.Viem };
      try { await W.reconnect(cfg); } catch (_) {}   // restore a prior session across page loads
      sync(W.getAccount(cfg));
      return kit;
    })().catch((e) => { console.error("[pons-wallet] AppKit init failed:", e); kitP = null; return null; });
    return kitP;
  }

  async function ensureChain() {
    const k = await ensure();
    if (k && acct.isConnected && acct.chainId !== CHAIN_ID) {
      try { await k.W.switchChain(k.cfg, { chainId: CHAIN_ID }); } catch (_) {}
    }
  }

  const api = {
    // click behaviour: connect modal when signed out, account modal (with Disconnect) when signed in
    async open() {
      const k = await ensure();
      if (!k) { alert("Wallet failed to load — check your connection and try again."); return; }
      k.modal.open();
    },
    async connect() { if (acct.isConnected) return acct.address; await api.open(); return acct.address; },
    async disconnect() { const k = await ensure(); if (k) { try { await k.W.disconnect(k.cfg); } catch (_) {} } sawConnected = false; setAcct(null); },
    address: () => acct.address,
    isConnected: () => acct.isConnected,
    chainId: () => acct.chainId,
    onChange(cb) { listeners.add(cb); try { cb(acct); } catch (_) {} return () => listeners.delete(cb); },
    ensureChain,
    async signMessage(message) {
      const k = await ensure(); if (!k) throw new Error("wallet unavailable");
      if (!acct.isConnected) { k.modal.open(); throw new Error("connect wallet first"); }
      await ensureChain(); return k.W.signMessage(k.cfg, { message });
    },
    async sendTransaction(tx) {
      const k = await ensure(); if (!k) throw new Error("wallet unavailable");
      if (!acct.isConnected) { k.modal.open(); throw new Error("connect wallet first"); }
      await ensureChain(); return k.W.sendTransaction(k.cfg, tx);
    },
    async writeContract(args) {
      const k = await ensure(); if (!k) throw new Error("wallet unavailable");
      if (!acct.isConnected) { k.modal.open(); throw new Error("connect wallet first"); }
      await ensureChain(); return k.W.writeContract(k.cfg, args);
    },
    ready: ensure,
  };
  window.ponsWallet = api;

  function wire() {
    document.querySelectorAll(SEL).forEach((b) => {
      if (b._pw || noauto(b)) return;
      b._pw = 1;
      if (!b.dataset.label) b.dataset.label = (b.textContent || "").trim() || "Connect wallet";
      b.addEventListener("click", (e) => { e.preventDefault(); api.open(); });
    });
    paint();
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", wire) : wire();

  // returning connected visitor → warm up AppKit in the background to confirm the session & enable disconnect
  if (acct.isConnected) ensure();
})();
