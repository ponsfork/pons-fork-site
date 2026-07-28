/* Pons Fork — shared wallet connect (Reown AppKit; the same stack pons.family runs).
   Lazy-loads the AppKit CDN bundle on first use and exposes window.ponsWallet.
   Auto-wires any #connect / #nav-connect / [data-connect] button (skip with data-noauto). */
(() => {
  "use strict";
  const APPKIT = "https://cdn.jsdelivr.net/npm/@reown/appkit-cdn@1.1.0/dist/appkit.js";
  const PROJECT_ID = "6d5eead1ed6dc7b4a74927eec58f80d7";
  const RPC = "https://rpc.arrowrpc.com";
  const EXPLORER = "https://robinhoodchain.blockscout.com";
  const CHAIN_ID = 4663;
  const SEL = "#connect,#nav-connect,[data-connect]";

  const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
  const listeners = new Set();
  let acct = { address: undefined, isConnected: false, chainId: undefined };
  let kit = null, initP = null;

  const noauto = (b) => b.hasAttribute("data-noauto");
  function paint() {
    document.querySelectorAll(SEL).forEach((b) => {
      if (noauto(b)) return;
      b.textContent = acct.isConnected ? short(acct.address) : (b.dataset.label || "Connect wallet");
    });
  }
  function emit() { paint(); listeners.forEach((f) => { try { f(acct); } catch (_) {} }); }

  async function ensure() {
    if (kit) return kit;
    if (initP) return initP;
    initP = (async () => {
      const m = await import(APPKIT);
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
        themeVariables: { "--w3m-accent": "#121513", "--w3m-font-family": '"Geist",system-ui,sans-serif' },
      });
      const cfg = adapter.wagmiConfig;
      const W = m.WagmiCore;
      const apply = (a) => {
        acct = { address: a.address, isConnected: a.status === "connected", chainId: a.chainId };
        emit();
      };
      apply(W.getAccount(cfg));
      W.watchAccount(cfg, { onChange: apply });
      kit = { modal, cfg, W, chain, viem: m.Viem };
      return kit;
    })();
    return initP;
  }

  async function ensureChain() {
    const k = await ensure();
    if (acct.isConnected && acct.chainId !== CHAIN_ID) {
      try { await k.W.switchChain(k.cfg, { chainId: CHAIN_ID }); } catch (_) {}
    }
  }

  const api = {
    async open() { const k = await ensure(); k.modal.open(); },
    async connect() { const k = await ensure(); if (!acct.isConnected) k.modal.open(); return acct.address; },
    async disconnect() { const k = await ensure(); await k.W.disconnect(k.cfg); },
    address: () => acct.address,
    isConnected: () => acct.isConnected,
    chainId: () => acct.chainId,
    onChange(cb) { listeners.add(cb); if (kit) { try { cb(acct); } catch (_) {} } return () => listeners.delete(cb); },
    ensureChain,
    async signMessage(message) {
      const k = await ensure();
      if (!acct.isConnected) { k.modal.open(); throw new Error("connect wallet first"); }
      return k.W.signMessage(k.cfg, { message });
    },
    async sendTransaction(tx) { const k = await ensure(); await ensureChain(); return k.W.sendTransaction(k.cfg, tx); },
    async writeContract(args) { const k = await ensure(); await ensureChain(); return k.W.writeContract(k.cfg, args); },
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
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  // restore a prior session (returning connected visitor) without blocking first paint
  try {
    if (Object.keys(localStorage).some((k) => /wagmi|w3m|walletconnect|reown|@appkit|@w3m/i.test(k))) ensure();
  } catch (_) {}
})();
