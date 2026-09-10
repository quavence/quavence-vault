import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'react-qr-code';
import { generateMnemonic, validateMnemonic } from '../shared/crypto/mnemonic';
import { isValidAddress } from '../shared/crypto/address';
import { NETWORK } from '../shared/constants';
import {
  Copy,
  Check,
  Lock,
  ExternalLink,
  Layers,
  Sparkles,
  RefreshCw,
  Maximize2,
  PanelRight,
  PanelRightClose,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  ArrowUpRight,
  ArrowDownLeft,
  X,
  Wallet,
  Coins,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  Send,
} from 'lucide-react';

interface TxItem {
  txid: string;
  block_height: number;
  amount: number;
  type: 'sent' | 'received';
  tx_type?: string;
  glyph?: {
    name?: string;
    theme?: string;
    rarity?: string;
    svgContent?: string;
    imageRef?: string;
    edition?: number;
  } | null;
  glyph_edition?: number;
  glyph_op_label?: string;
  glyph_hash?: string;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isolateSvgGradients(rawSvg?: string | null, key?: string | number): string {
  if (!rawSvg) return '';
  let svg = rawSvg.trim();
  if (svg.startsWith('data:image/svg+xml')) {
    try {
      svg = decodeURIComponent(svg.replace(/^data:image\/svg\+xml;utf8,/, ''));
    } catch {
      // keep raw
    }
  }

  // Derive a deterministic or unique prefix
  let hashStr = '';
  if (key !== undefined && key !== null && String(key).trim() !== '') {
    hashStr = String(key).replace(/[^a-zA-Z0-9_-]/g, '_');
  } else {
    // Fast string hash of svg contents
    let h = 5381;
    for (let i = 0; i < svg.length; i++) {
      h = ((h << 5) + h) + svg.charCodeAt(i);
      h |= 0;
    }
    hashStr = 's' + Math.abs(h).toString(36);
  }
  const prefix = `q_${hashStr}_`;

  // Avoid re-prefixing if already isolated with this prefix
  if (svg.includes(`id="${prefix}`) || svg.includes(`id='${prefix}`)) {
    return svg;
  }

  // 1. Collect all declared IDs and Filter Results in <defs>
  const idRegex = /\b(id|result)=["']([^"']+)["']/g;
  const declaredIds = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = idRegex.exec(svg)) !== null) {
    const id = match[2];
    if (!['SourceGraphic', 'SourceAlpha', 'BackgroundImage', 'BackgroundAlpha'].includes(id)) {
      declaredIds.add(id);
    }
  }

  if (declaredIds.size === 0) {
    return svg;
  }

  // 2. Replace each declared ID and all references to it
  for (const id of declaredIds) {
    const newId = `${prefix}${id}`;
    const defRegex = new RegExp(`\\b(id|result)=(['"])${escapeRegex(id)}\\2`, 'g');
    svg = svg.replace(defRegex, `$1=$2${newId}$2`);

    const urlRegex = new RegExp(`url\\((['"]?)#${escapeRegex(id)}\\1\\)`, 'g');
    svg = svg.replace(urlRegex, `url($1#${newId}$1)`);

    const hrefRegex = new RegExp(`(\\b(?:xlink:)?href=['"])#${escapeRegex(id)}(['"])`, 'g');
    svg = svg.replace(hrefRegex, `$1#${newId}$2`);

    const inRegex = new RegExp(`(\\bin2?=['"])${escapeRegex(id)}(['"])`, 'g');
    svg = svg.replace(inRegex, `$1${newId}$2`);
  }

  return svg;
}

function formatSvgForPreview(rawSvg?: string, key?: string | number): string {
  if (!rawSvg) return '';
  let svg = rawSvg.trim();
  if (svg.startsWith('data:image/svg+xml')) {
    try {
      svg = decodeURIComponent(svg.replace(/^data:image\/svg\+xml;utf8,/, ''));
    } catch {
      // keep raw
    }
  }
  svg = isolateSvgGradients(svg, key);
  if (svg.includes('<svg') && !svg.includes('viewBox')) {
    svg = svg.replace('<svg', '<svg viewBox="0 0 512 512"');
  }
  svg = svg.replace(/<svg([^>]*)width="[^"]*"/, '<svg$1width="100%"');
  svg = svg.replace(/<svg([^>]*)height="[^"]*"/, '<svg$1height="100%"');
  if (!svg.includes('width="100%"')) {
    svg = svg.replace('<svg', '<svg width="100%" height="100%"');
  }
  return svg;
}

function resolveImageSource(ref?: string, origin?: string): string | null {
  if (!ref) return null;
  if (ref.startsWith('data:') || ref.startsWith('http://') || ref.startsWith('https://')) {
    return ref;
  }
  if (ref.startsWith('/') && origin) {
    return `${origin}${ref}`;
  }
  return ref;
}

function getRarityBadgeStyle(rarity?: string) {
  const r = (rarity || '').toLowerCase();
  if (r.includes('legendary') || r.includes('mythic')) {
    return { bg: '#FEF3C7', text: '#B45309', border: '#FDE68A' };
  }
  if (r.includes('epic')) {
    return { bg: '#F3E8FF', text: '#7E22CE', border: '#E9D5FF' };
  }
  if (r.includes('rare')) {
    return { bg: '#ECFEFF', text: '#0E7490', border: '#CFFAFE' };
  }
  return { bg: '#F1F5F9', text: '#475569', border: '#E2E8F0' };
}

function openFullscreenSvg(rawSvg?: string) {
  if (!rawSvg) return;
  try {
    let cleanSvg = rawSvg.trim();
    if (cleanSvg.startsWith('data:image/svg+xml')) {
      cleanSvg = decodeURIComponent(cleanSvg.replace(/^data:image\/svg\+xml;utf8,/, ''));
    }
    const blob = new Blob([cleanSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  } catch (e) {
    console.error('[Open SVG Error]', e);
  }
}

function generateClientGlyphSvg(
  key: string = '420911',
  edition?: number,
  rarity?: string,
  title?: string
): string {
  const seedNum = (edition || 1) * 31337 + (parseInt(String(key).replace(/[^0-9a-fA-F]/g, '').slice(0, 6), 16) || 42);
  const edNum = edition || (parseInt(String(key).replace(/[^0-9]/g, '').slice(0, 5), 10) || 1);
  const rLower = (rarity || (edNum === 7860 ? 'legendary' : edNum % 50 === 0 ? 'legendary' : edNum % 10 === 0 ? 'epic' : edNum % 3 === 0 ? 'rare' : 'common')).toLowerCase();
  
  let primary = '#00FFD5';
  let accent = '#00C3FE';
  let badgeColor = '#38BDF8';
  let rarityLabel = 'COMMON';

  if (rLower.includes('legendary') || rLower.includes('mythic') || edNum === 7860) {
    primary = '#F59E0B';
    accent = '#EF4444';
    badgeColor = '#FBBF24';
    rarityLabel = 'LEGENDARY';
  } else if (rLower.includes('epic')) {
    primary = '#C084FC';
    accent = '#7E22CE';
    badgeColor = '#A855F7';
    rarityLabel = 'EPIC';
  } else if (rLower.includes('rare')) {
    primary = '#38BDF8';
    accent = '#0284C7';
    badgeColor = '#0EA5E9';
    rarityLabel = 'RARE';
  }

  const rot = (seedNum % 60) - 30;
  const numRays = 8 + (seedNum % 8);
  const rayAngleStep = (2 * Math.PI) / numRays;

  const rays = Array.from({ length: numRays }).map((_, i) => {
    const a = i * rayAngleStep;
    const r1 = 110;
    const r2 = 175 + (i % 2 === 0 ? 25 : 0);
    const x1 = (256 + r1 * Math.cos(a)).toFixed(1);
    const y1 = (256 + r1 * Math.sin(a)).toFixed(1);
    const x2 = (256 + r2 * Math.cos(a)).toFixed(1);
    const y2 = (256 + r2 * Math.sin(a)).toFixed(1);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${primary}" stroke-width="${i % 2 === 0 ? '2' : '1.2'}" opacity="0.8" />`;
  }).join('');

  const pfx = `cg${edNum}_${Math.abs(seedNum) % 10000}_`;

  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <radialGradient id="${pfx}bgGrad" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="#0E172A" />
      <stop offset="60%" stop-color="#020617" />
      <stop offset="100%" stop-color="#000000" />
    </radialGradient>
    <linearGradient id="${pfx}neonG" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${primary}" />
      <stop offset="100%" stop-color="${accent}" />
    </linearGradient>
    <radialGradient id="${pfx}coreG" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="35%" stop-color="${primary}" stop-opacity="0.85" />
      <stop offset="100%" stop-color="transparent" stop-opacity="0" />
    </radialGradient>
    <filter id="${pfx}glow">
      <feGaussianBlur stdDeviation="3" result="${pfx}blur" />
      <feMerge>
        <feMergeNode in="${pfx}blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>
  <rect width="512" height="512" rx="28" fill="url(#${pfx}bgGrad)" />
  <rect width="504" height="504" x="4" y="4" rx="26" fill="none" stroke="${primary}" stroke-width="1.2" opacity="0.35" />
  <circle cx="256" cy="256" r="216" fill="none" stroke="${accent}" stroke-width="1" opacity="0.4" stroke-dasharray="4,8" />
  <circle cx="256" cy="256" r="170" fill="none" stroke="${primary}" stroke-width="1.5" opacity="0.6" />
  <g transform="rotate(${rot} 256 256)" filter="url(#${pfx}glow)">
    ${rays}
    <polygon points="256,120 373,256 256,392 139,256" fill="url(#${pfx}neonG)" fill-opacity="0.18" stroke="${primary}" stroke-width="2" />
    <polygon points="256,145 352,256 256,367 160,256" fill="none" stroke="${accent}" stroke-width="1.5" opacity="0.85" />
    <polygon points="256,170 320,256 256,342 192,256" fill="url(#${pfx}neonG)" fill-opacity="0.25" stroke="#FFFFFF" stroke-width="1.2" />
  </g>
  <circle cx="256" cy="256" r="48" fill="url(#${pfx}coreG)" filter="url(#${pfx}glow)" />
  <polygon points="256,236 273,256 256,276 239,256" fill="#FFFFFF" />
  <circle cx="256" cy="256" r="4" fill="${primary}" />
  <text x="256" y="474" text-anchor="middle" fill="${badgeColor}" font-family="monospace, sans-serif" font-size="11" font-weight="700" letter-spacing="2">
    ${title ? title.toUpperCase() : `POUS GLYPH #${edNum}`} [${rarityLabel}]
  </text>
</svg>`;
}

async function resolveGlyphArtifact(
  glyphHash?: string,
  edition?: number,
  txid?: string,
  name?: string,
  rarity?: string
): Promise<{ name: string; theme?: string; rarity?: string; svgContent: string; imageRef?: string; edition?: number }> {
  const query = glyphHash || (edition ? String(edition) : txid);
  const cacheKey = `qvnc_art_${query || 'unknown'}`;

  // 1. Check local cache
  try {
    const cached = await chrome.storage.local.get(cacheKey);
    if (cached?.[cacheKey]?.svgContent) {
      return cached[cacheKey];
    }
  } catch {}

  // 2. Fetch from Explorer or DAO API endpoints
  if (query) {
    const endpoints = [
      `${NETWORK.DEFAULT_EXPLORER_URL}/api/glyphs/${encodeURIComponent(query)}`,
      `${NETWORK.DEFAULT_DAO_URL}/api/glyphs/details/${encodeURIComponent(query)}`,
    ];

    for (const ep of endpoints) {
      try {
        const res = await fetch(ep);
        if (res.ok) {
          const json = await res.json();
          const item = json.data || json;
          if (item) {
            const art = {
              name: item.name || name || `PoUS Glyph #${edition || ''}`,
              theme: item.theme || item.attributes?.theme,
              rarity: item.rarity || item.attributes?.rarity || rarity,
              svgContent: item.contentUri || item.svgContent,
              imageRef: item.imageRef,
              edition: item.edition || item.attributes?.edition || edition,
            };
            if (art.svgContent) {
              try {
                await chrome.storage.local.set({ [cacheKey]: art });
              } catch {}
              return art;
            }
          }
        }
      } catch {}
    }
  }

  // 3. Fallback to client-side generative parametric SVG
  const fallbackSvg = generateClientGlyphSvg(query || '420911', edition, rarity, name);
  const art = {
    name: name || (edition === 7860 ? 'Quavence Genesis Solar #7860' : `PoUS Glyph #${edition || ''}`),
    theme: edition === 7860 ? 'Solar Punk Phoenix' : 'PoUS Consensus Core',
    rarity: rarity || (edition === 7860 ? 'Legendary' : 'Common'),
    svgContent: fallbackSvg,
    edition,
  };
  try {
    await chrome.storage.local.set({ [cacheKey]: art });
  } catch {}
  return art;
}

function processAddressTransactions(rawTxs: any[], knownGlyphs: any[] = []): TxItem[] {
  if (!Array.isArray(rawTxs)) return [];

  const glyphMap = new Map<string, any>();
  if (Array.isArray(knownGlyphs)) {
    for (const g of knownGlyphs) {
      if (g.mintTx) glyphMap.set(g.mintTx, g);
      if (g.txid) glyphMap.set(g.txid, g);
      if (g.attributes?.glyph_hash) glyphMap.set(g.attributes.glyph_hash, g);
      if (g.glyph_hash) glyphMap.set(g.glyph_hash, g);
      if (g.attributes?.edition) glyphMap.set(`edition_${g.attributes.edition}`, g);
      if (g.edition) glyphMap.set(`edition_${g.edition}`, g);
      if (g.id) glyphMap.set(`id_${g.id}`, g);
      if (g.name) glyphMap.set(`name_${g.name}`, g);
    }
  }

  const map = new Map<string, {
    txid: string;
    block_height: number;
    netSat: number;
    explicitType?: 'sent' | 'received';
    tx_type?: string;
    glyph?: any;
    glyph_edition?: number;
    glyph_op_label?: string;
    glyph_hash?: string;
  }>();

  for (const t of rawTxs) {
    if (!t.txid) continue;
    let sat = Number(t.amount || 0);
    // If raw amount is a floating point with decimals (e.g. 0.0001), convert from coin units to satoshis.
    // Integer amounts from explorer (e.g. 10000 satoshis carrier dust) are already in satoshis.
    if (!Number.isInteger(sat) || String(t.amount).includes('.')) {
      sat = Math.round(sat * 1e8);
    }

    // Preserve explicit type if already determined (e.g. from existing TxItem)
    const explicitType = (t as any).type === 'sent' || (t as any).type === 'received' ? (t as any).type : null;

    const tGlyphHash = t.glyph_hash || t.glyph?.glyphHash || t.glyph?.glyph_hash;
    const tEdition = t.glyph_edition || t.glyph?.edition;
    const tOpLabel = t.glyph_op_label || t.glyph?.opLabel || t.glyph?.op_label;

    const matched = glyphMap.get(t.txid) ||
      (tEdition ? glyphMap.get(`edition_${tEdition}`) : null) ||
      (tGlyphHash ? glyphMap.get(tGlyphHash) : null) ||
      (t.glyph?.name ? glyphMap.get(`name_${t.glyph.name}`) : null);

    const isGlyph = t.tx_type?.includes('glyph') || !!t.glyph || !!tEdition || !!tGlyphHash;

    let glyphObj: any = null;
    if (isGlyph) {
      const gName = t.glyph?.name || matched?.name || (tEdition === 7860 ? 'Quavence Genesis Solar #7860' : tEdition ? `PoUS Glyph #${tEdition}` : 'PoUS Artifact');
      const gRarity = t.glyph?.rarity || matched?.attributes?.rarity || matched?.rarity || (tEdition === 7860 ? 'Legendary' : 'Common');
      const gTheme = t.glyph?.theme || matched?.attributes?.theme || matched?.theme;
      const gSvg = t.glyph?.svgContent || t.glyph?.contentUri ||
        (typeof t.glyph?.imageRef === 'string' && t.glyph.imageRef.includes('<svg') ? t.glyph.imageRef : undefined) ||
        matched?.contentUri || matched?.svgContent ||
        generateClientGlyphSvg(tGlyphHash || t.txid, tEdition, gRarity, gName);

      glyphObj = {
        name: gName,
        theme: gTheme,
        rarity: gRarity,
        svgContent: gSvg,
        imageRef: t.glyph?.imageRef || matched?.imageRef,
        edition: tEdition || matched?.attributes?.edition,
      };
    }

    const existing = map.get(t.txid);
    if (existing) {
      existing.netSat += sat;
      if (explicitType && !existing.explicitType) existing.explicitType = explicitType;
      if (t.block_height) existing.block_height = Math.max(existing.block_height, t.block_height);
      if (!existing.glyph && glyphObj) existing.glyph = glyphObj;
      if (!existing.glyph_edition && tEdition) existing.glyph_edition = tEdition;
      if (!existing.glyph_op_label && tOpLabel) existing.glyph_op_label = tOpLabel;
      if (!existing.glyph_hash && tGlyphHash) existing.glyph_hash = tGlyphHash;
      if (!existing.tx_type && t.tx_type) existing.tx_type = t.tx_type;
    } else {
      map.set(t.txid, {
        txid: t.txid,
        block_height: t.block_height || 0,
        netSat: sat,
        explicitType,
        tx_type: t.tx_type,
        glyph: glyphObj,
        glyph_edition: tEdition,
        glyph_op_label: tOpLabel,
        glyph_hash: tGlyphHash,
      });
    }
  }

  const result: TxItem[] = [];
  for (const item of map.values()) {
    const isSent = item.explicitType ? item.explicitType === 'sent' : item.netSat < 0;
    const absSat = Math.abs(item.netSat);
    result.push({
      txid: item.txid,
      block_height: item.block_height,
      amount: absSat / 1e8,
      type: isSent ? 'sent' : 'received',
      tx_type: item.tx_type,
      glyph: item.glyph,
      glyph_edition: item.glyph_edition,
      glyph_op_label: item.glyph_op_label,
      glyph_hash: item.glyph_hash,
    });
  }

  return result.sort((a, b) => (b.block_height || 0) - (a.block_height || 0));
}

type Screen = 'loading' | 'welcome' | 'create_seed' | 'import_seed' | 'set_password' | 'unlock' | 'wallet' | 'approval';
type Tab = 'wallet' | 'glyphs';
type ModalType = 'none' | 'send' | 'receive';

export function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [pendingApproval, setPendingApproval] = useState<any>(null);
  const [showPayloadDetails, setShowPayloadDetails] = useState<boolean>(false);
  const [copiedApprovalAddr, setCopiedApprovalAddr] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<Tab>('wallet');
  const [activeModal, setActiveModal] = useState<ModalType>('none');
  const [selectedTx, setSelectedTx] = useState<TxItem | null>(null);
  const [txCopied, setTxCopied] = useState<boolean>(false);
  const [address, setAddress] = useState<string>('');
  const [sendRecipient, setSendRecipient] = useState<string>('');
  const [sendAmount, setSendAmount] = useState<string>('');
  const [sendBusy, setSendBusy] = useState<boolean>(false);
  const [sendError, setSendError] = useState<string>('');
  const [sendSuccessTxId, setSendSuccessTxId] = useState<string>('');
  const [balance, setBalance] = useState<string>('0.00000000');
  const [balanceLoading, setBalanceLoading] = useState<boolean>(false);
  const isFetchingRef = useRef<boolean>(false);
  const [transactions, setTransactions] = useState<TxItem[]>([]);
  const [glyphs, setGlyphs] = useState<any[]>([]);
  const [glyphsLoading, setGlyphsLoading] = useState<boolean>(false);
  const [selectedGlyph, setSelectedGlyph] = useState<any>(null);
  const [glyphTxCopied, setGlyphTxCopied] = useState<boolean>(false);
  const [glyphsViewMode, setGlyphsViewMode] = useState<'grid' | 'list'>('grid');
  const [sendGlyphActive, setSendGlyphActive] = useState<boolean>(false);
  const [sendGlyphRecipient, setSendGlyphRecipient] = useState<string>('');
  const [sendGlyphBusy, setSendGlyphBusy] = useState<boolean>(false);
  const [sendGlyphError, setSendGlyphError] = useState<string>('');
  const [sendGlyphSuccessTxId, setSendGlyphSuccessTxId] = useState<string>('');
  const [mnemonicDraft, setMnemonicDraft] = useState<string>('');
  const [importInput, setImportInput] = useState<string>('');
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);

  const isSidePanel = typeof window !== 'undefined' && (
    window.location.pathname.includes('sidepanel') ||
    document.body.classList.contains('sidepanel-view')
  );

  const handleToggleSidePanel = async () => {
    if (isSidePanel) {
      window.close();
      return;
    }
    try {
      if ((chrome as any)?.sidePanel?.open) {
        const w = await chrome.windows.getCurrent();
        if (w.id) {
          await (chrome as any).sidePanel.open({ windowId: w.id });
          window.close();
        }
      } else {
        chrome.tabs?.create?.({ url: 'sidepanel.html' });
      }
    } catch (err) {
      console.warn('[SidePanel open error]', err);
      chrome.tabs?.create?.({ url: 'sidepanel.html' });
    }
  };
  const [showConfirmPassword, setShowConfirmPassword] = useState<boolean>(false);
  const [unlockPassword, setUnlockPassword] = useState<string>('');
  const [showUnlockPassword, setShowUnlockPassword] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  useEffect(() => {
    checkInitialState();
  }, []);

  // Periodic background polling for balance, transactions, and glyphs while wallet screen is active
  useEffect(() => {
    if (screen !== 'wallet' || !address) return;

    // Refresh every 8 seconds when active (standard crypto wallet refresh rate)
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void fetchBalance(address, { silent: true });
    }, 8000);

    // Also trigger refresh immediately on window focus / tab visibility return
    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        void fetchBalance(address, { silent: true });
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [screen, address]);

  // Asynchronously resolve official artist vector artwork for any glyph transaction lacking server SVG
  useEffect(() => {
    if (transactions.length === 0) return;
    const glyphTxs = transactions.filter(
      (tx) => tx.tx_type?.includes('glyph') || !!tx.glyph || !!tx.glyph_edition || !!tx.glyph_hash
    );
    if (glyphTxs.length === 0) return;

    let cancelled = false;
    (async () => {
      let hasUpdates = false;
      const updated = [...transactions];
      for (let i = 0; i < updated.length; i++) {
        if (cancelled) break;
        const tx = updated[i];
        const isGlyph = tx.tx_type?.includes('glyph') || !!tx.glyph || !!tx.glyph_edition || !!tx.glyph_hash;
        if (!isGlyph) continue;
        // If already has official server SVG (not fallback), skip
        if (tx.glyph?.svgContent && !tx.glyph.svgContent.includes('bgGrad')) continue;

        const art = await resolveGlyphArtifact(
          tx.glyph_hash,
          tx.glyph_edition,
          tx.txid,
          tx.glyph?.name,
          tx.glyph?.rarity
        );
        if (art && art.svgContent && !art.svgContent.includes('bgGrad')) {
          updated[i] = {
            ...tx,
            glyph: {
              ...tx.glyph,
              ...art,
            },
          };
          hasUpdates = true;
        }
      }
      if (!cancelled && hasUpdates) {
        setTransactions(updated);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [transactions.length]);

  // When opening transaction details for a glyph, immediately resolve official artwork
  useEffect(() => {
    if (!selectedTx) return;
    const isGlyph = selectedTx.tx_type?.includes('glyph') || !!selectedTx.glyph || !!selectedTx.glyph_edition || !!selectedTx.glyph_hash;
    if (!isGlyph) return;

    let cancelled = false;
    (async () => {
      const art = await resolveGlyphArtifact(
        selectedTx.glyph_hash,
        selectedTx.glyph_edition,
        selectedTx.txid,
        selectedTx.glyph?.name,
        selectedTx.glyph?.rarity
      );
      if (!cancelled && art && art.svgContent) {
        setSelectedTx((prev) => (prev && prev.txid === selectedTx.txid ? {
          ...prev,
          glyph: {
            ...prev.glyph,
            ...art,
          },
        } : prev));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedTx?.txid]);

  const checkInitialState = async () => {
    try {
      // Check for approval request in query params or session storage
      const urlParams = new URLSearchParams(window.location.search);
      const reqId = urlParams.get('request');
      let approvalReq: any = null;

      if (reqId) {
        const resp = await chrome.runtime.sendMessage({
          type: 'APPROVAL_GET_PENDING',
          payload: { id: reqId },
        });
        if (resp?.data) approvalReq = resp.data;
      }

      if (!approvalReq) {
        try {
          const session = await chrome.storage.session.get('current_pending_request');
          if (session?.current_pending_request) {
            approvalReq = session.current_pending_request;
          }
        } catch {}
      }

      if (approvalReq) {
        setPendingApproval(approvalReq);
        setScreen('approval');
        return;
      }

      const hasVaultRes = await chrome.runtime.sendMessage({ type: 'VAULT_HAS_VAULT' });
      if (!hasVaultRes?.data) {
        // Restore active onboarding draft from chrome.storage.session (survives popup blur/close)
        try {
          const draft = await chrome.storage.session.get([
            'qvnc_draft_step',
            'qvnc_draft_mnemonic',
            'qvnc_draft_pwd',
            'qvnc_draft_pwd_confirm',
          ]);
          if (draft?.qvnc_draft_step && draft?.qvnc_draft_mnemonic) {
            setMnemonicDraft(draft.qvnc_draft_mnemonic);
            if (draft.qvnc_draft_pwd) setPasswordInput(draft.qvnc_draft_pwd);
            if (draft.qvnc_draft_pwd_confirm) setConfirmPasswordInput(draft.qvnc_draft_pwd_confirm);
            setScreen(draft.qvnc_draft_step);
            return;
          }
        } catch {}
        setScreen('welcome');
        return;
      }

      const unlockedRes = await chrome.runtime.sendMessage({ type: 'VAULT_IS_UNLOCKED' });
      if (unlockedRes?.data) {
        const accRes = await chrome.runtime.sendMessage({ type: 'VAULT_GET_ACCOUNT' });
        if (accRes?.data) {
          setAddress(accRes.data.address);
          fetchBalance(accRes.data.address, { isInitial: true });
          fetchGlyphs(accRes.data.address);
          setScreen('wallet');
          return;
        }
      }

      setScreen('unlock');
    } catch {
      setScreen('welcome');
    }
  };

  const fetchGlyphs = async (addr: string) => {
    if (!addr) return;
    setGlyphsLoading(true);
    try {
      const key = `glyphs_${addr}`;
      // 1. Immediately restore cached glyphs on mount for instant render (SWR pattern)
      try {
        const stored = await chrome.storage.local.get(key);
        if (Array.isArray(stored[key])) {
          setGlyphs(stored[key]);
        }
      } catch {}

      // 2. Query ONLY the official Quavence L1 Explorer for on-chain carrier UTXOs
      const res = await fetch(`${NETWORK.DEFAULT_EXPLORER_URL}/api/address/${encodeURIComponent(addr)}?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });

      if (res.ok) {
        const json = await res.json();
        const rawGlyphs = Array.isArray(json?.glyphs) ? json.glyphs : [];
        const onChainGlyphs = rawGlyphs.map((g: any) => {
          const edition = Number(g.edition || g.id || 0);
          const rarity = g.rarity || 'Common';
          const theme = g.theme || 'PoUS Consensus Core';
          const name = g.name || (edition === 7860 ? 'Solar Punk Phoenix #7860' : `PoUS Glyph #${edition}`);
          return {
            id: edition,
            edition,
            name,
            theme,
            rarity,
            svgContent: g.svgContent || g.contentUri || null,
            contentUri: g.contentUri || g.svgContent || null,
            imageRef: g.imageRef || null,
            glyphHash: g.glyphHash || g.glyph_hash || '',
            carrierAddress: g.carrierAddress || addr,
            carrierVout: g.carrierVout ?? 0,
            carrierDust: g.carrierDust ?? 10000,
            txid: g.txid || '',
            blockHeight: g.blockHeight,
            blockTime: g.blockTime,
            attributes: {
              edition,
              rarity,
              theme,
              glyph_hash: g.glyphHash || g.glyph_hash || '',
            },
          };
        });

        // 3. Authoritative SWR sync: Overwrite state and cache with exact on-chain reality
        setGlyphs(onChainGlyphs);
        try {
          await chrome.storage.local.set({ [key]: onChainGlyphs });
        } catch {}

        setTransactions((prev) =>
          prev.map((tx) => {
            const match = onChainGlyphs.find(
              (g: any) =>
                g.mintTx === tx.txid ||
                g.txid === tx.txid ||
                (tx.glyph_edition && (g.edition === tx.glyph_edition || g.attributes?.edition === tx.glyph_edition))
            );
            if (!match) return tx;
            return {
              ...tx,
              glyph: tx.glyph || match,
              glyph_edition: tx.glyph_edition || match.edition || match.attributes?.edition,
            };
          })
        );
      }
    } catch {
      // Keep cached on network failure
    } finally {
      setGlyphsLoading(false);
    }
  };

  const fetchBalance = async (
    addr: string,
    optionsOrManual: boolean | { isManualRefresh?: boolean; isInitial?: boolean; silent?: boolean } = false
  ) => {
    if (!addr) return;

    const isManual = typeof optionsOrManual === 'boolean'
      ? optionsOrManual
      : !!optionsOrManual?.isManualRefresh;
    const isInitial = typeof optionsOrManual === 'object' && !!optionsOrManual?.isInitial;
    const isSilent = typeof optionsOrManual === 'object' && !!optionsOrManual?.silent;

    // Avoid overlapping in-flight network requests unless user clicks manually
    if (isFetchingRef.current && !isManual) return;
    isFetchingRef.current = true;

    if (!isSilent) {
      setBalanceLoading(true);
    }
    const balanceKey = `balance_${addr}`;
    const txsKey = `txs_${addr}`;
    const glyphsKey = `glyphs_${addr}`;

    // 1. Immediately restore cached balance on initial mount only
    if (isInitial) {
      try {
        const cached = await chrome.storage.local.get([balanceKey, txsKey]);
        if (cached?.[balanceKey]) {
          setBalance(cached[balanceKey]);
        }
        if (Array.isArray(cached?.[txsKey]) && cached[txsKey].length > 0) {
          setTransactions(cached[txsKey]);
        }
      } catch {}
    }

    // 2. Fetch fresh balance, transactions, and on-chain glyphs from Explorer
    try {
      const res = await fetch(`${NETWORK.DEFAULT_EXPLORER_URL}/api/address/${encodeURIComponent(addr)}?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
      if (res.ok) {
        const json = await res.json();
        let raw = Number(json.balance || 0);
        // Explorer API balance is returned in satoshis (integer units). Divide by 1e8 to get QVNC coins.
        if (Number.isInteger(raw) && !String(json.balance).includes('.')) {
          raw = raw / 1e8;
        }
        const formatted = raw.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 8 });
        setBalance(formatted);
        try {
          await chrome.storage.local.set({ [balanceKey]: formatted });
        } catch {}

        // 3. Also sync on-chain glyphs from the exact same Explorer query
        let latestGlyphs = glyphs;
        if (Array.isArray(json.glyphs)) {
          latestGlyphs = json.glyphs.map((g: any) => {
            const edition = Number(g.edition || g.id || 0);
            const rarity = g.rarity || 'Common';
            const theme = g.theme || 'PoUS Consensus Core';
            const name = g.name || (edition === 7860 ? 'Solar Punk Phoenix #7860' : `PoUS Glyph #${edition}`);
            return {
              id: edition,
              edition,
              name,
              theme,
              rarity,
              svgContent: g.svgContent || g.contentUri || null,
              contentUri: g.contentUri || g.svgContent || null,
              imageRef: g.imageRef || null,
              glyphHash: g.glyphHash || g.glyph_hash || '',
              carrierAddress: g.carrierAddress || addr,
              carrierVout: g.carrierVout ?? 0,
              carrierDust: g.carrierDust ?? 10000,
              txid: g.txid || '',
              blockHeight: g.blockHeight,
              blockTime: g.blockTime,
              attributes: {
                edition,
                rarity,
                theme,
                glyph_hash: g.glyphHash || g.glyph_hash || '',
              },
            };
          });
          setGlyphs(latestGlyphs);
          try {
            await chrome.storage.local.set({ [glyphsKey]: latestGlyphs });
          } catch {}
        }

        if (Array.isArray(json.transactions)) {
          const processed = processAddressTransactions(json.transactions, latestGlyphs);
          setTransactions(processed);
          try {
            await chrome.storage.local.set({ [txsKey]: processed });
          } catch {}
        }
      }
    } catch {
      // ignore network errors in balance fetch
    } finally {
      isFetchingRef.current = false;
      if (!isSilent || isManual) {
        setBalanceLoading(false);
      }
    }
  };

  const handleStartCreate = async () => {
    const phrase = generateMnemonic(12);
    setMnemonicDraft(phrase);
    try {
      await chrome.storage.session.set({
        qvnc_draft_mnemonic: phrase,
        qvnc_draft_step: 'create_seed',
      });
    } catch {}
    setScreen('create_seed');
  };

  const handleSavePassword = async () => {
    if (passwordInput.length < 8) {
      setErrorMsg('Password must be at least 8 characters');
      return;
    }
    if (passwordInput !== confirmPasswordInput) {
      setErrorMsg('Passwords do not match');
      return;
    }

    setBusy(true);
    setErrorMsg('');
    try {
      const phraseToUse = mnemonicDraft || importInput.trim();
      const res = await chrome.runtime.sendMessage({
        type: 'VAULT_CREATE',
        payload: { mnemonic: phraseToUse, password: passwordInput },
      });

      if (res?.ok) {
        try {
          await chrome.storage.session.remove([
            'qvnc_draft_step',
            'qvnc_draft_mnemonic',
            'qvnc_draft_pwd',
            'qvnc_draft_pwd_confirm',
          ]);
        } catch {}
        setAddress(res.data.address);
        fetchBalance(res.data.address);
        fetchGlyphs(res.data.address);
        setScreen('wallet');
      } else {
        setErrorMsg(res?.error || 'Failed to create vault');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error creating vault');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    if (!unlockPassword) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'VAULT_UNLOCK',
        payload: { password: unlockPassword },
      });
      if (res?.ok) {
        setAddress(res.data.address);
        fetchBalance(res.data.address);
        fetchGlyphs(res.data.address);
        setScreen('wallet');
      } else {
        setErrorMsg(res?.error || 'Incorrect password');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Unlock error');
    } finally {
      setBusy(false);
    }
  };

  const handleLock = async () => {
    await chrome.runtime.sendMessage({ type: 'VAULT_LOCK' });
    setScreen('unlock');
    setUnlockPassword('');
  };

  const handleCopyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApprove = async () => {
    if (!pendingApproval) return;
    setBusy(true);
    try {
      await chrome.runtime.sendMessage({
        type: 'APPROVAL_RESOLVE',
        payload: { id: pendingApproval.id, result: true },
      });
    } catch (err) {
      console.warn('[handleApprove] message error:', err);
    } finally {
      try {
        await chrome.storage.session?.remove?.('current_pending_request');
      } catch {}
      setPendingApproval(null);
      setBusy(false);
      if (address) {
        setScreen('wallet');
      } else {
        checkInitialState();
      }
      try {
        window.close();
      } catch {}
    }
  };

  const handleReject = async () => {
    if (!pendingApproval) return;
    setBusy(true);
    try {
      await chrome.runtime.sendMessage({
        type: 'APPROVAL_REJECT',
        payload: { id: pendingApproval.id, reason: 'User rejected request' },
      });
    } catch (err) {
      console.warn('[handleReject] message error:', err);
    } finally {
      try {
        await chrome.storage.session?.remove?.('current_pending_request');
      } catch {}
      setPendingApproval(null);
      setBusy(false);
      if (address) {
        setScreen('wallet');
      } else {
        checkInitialState();
      }
      try {
        window.close();
      } catch {}
    }
  };

  const handleConfirmSend = async () => {
    if (sendBusy) return;

    const dest = sendRecipient.trim();
    const cleanAmount = sendAmount.replace(',', '.').trim();
    const amountVal = Number(cleanAmount);

    if (!dest) {
      setSendError('Please enter a recipient address');
      return;
    }

    if (!isValidAddress(dest)) {
      setSendError('Invalid Quavence address format (must start with S)');
      return;
    }

    if (!amountVal || isNaN(amountVal) || amountVal <= 0) {
      setSendError('Please enter a positive amount to send');
      return;
    }

    // Precise integer satoshi calculations (1 QVNC = 100,000,000 satoshis)
    const amountSat = Math.round(amountVal * 1e8);
    const feeSat = 10000; // Standard minimum network fee: 0.0001 QVNC
    const totalRequiredSat = amountSat + feeSat;

    const availableNum = Number(balance.replace(/,/g, ''));
    const availableSat = Math.round(availableNum * 1e8);

    if (totalRequiredSat > availableSat) {
      setSendError(
        `Insufficient funds. Required: ${(totalRequiredSat / 1e8).toFixed(4)} QVNC (includes 0.0001 fee), Available: ${balance} QVNC`
      );
      return;
    }

    setSendBusy(true);
    setSendError('');

    try {
      // 1. Fetch active UTXOs for address directly from Explorer
      const utxoRes = await fetch(`${NETWORK.DEFAULT_EXPLORER_URL}/api/address/${address}`);
      if (!utxoRes.ok) {
        throw new Error('Could not fetch address UTXOs from network.');
      }
      const addrData = await utxoRes.json();
      let rawUtxos: any[] = Array.isArray(addrData.utxos) ? addrData.utxos : [];

      // Carrier UTXO Safety Lock: identify and strictly exclude all outputs that carry PoUS AI Glyphs
      const heldGlyphsList: any[] = Array.isArray(addrData.glyphs) ? addrData.glyphs : (glyphs || []);
      const carrierKeys = new Set<string>();
      const carrierExcludeList: Array<{ txid: string; vout_index: number }> = [];

      heldGlyphsList.forEach((g: any) => {
        if (g.txid) {
          const vout = g.carrierVout ?? 0;
          carrierKeys.add(`${g.txid}:${vout}`);
          carrierExcludeList.push({ txid: g.txid, vout_index: vout });
        }
      });

      const utxos = rawUtxos.map((u: any) => ({
        ...u,
        isCarrier: Boolean(u.isCarrier || carrierKeys.has(`${u.txid}:${u.vout_index}`) || (u.amount === 10000 && carrierKeys.has(`${u.txid}:0`))),
      }));

      const spendableUtxos = utxos.filter((u: any) => !u.isCarrier);

      if (spendableUtxos.length === 0) {
        if (utxos.length > 0) {
          throw new Error('All unspent coins on this address are locked Carrier UTXOs protecting your on-chain PoUS AI Glyphs. They cannot be spent as regular QVNC.');
        }
        throw new Error('No confirmed spendable UTXOs found for this address.');
      }

      // 2. Sign transaction locally via Background Service Worker with private key
      const signRes = await chrome.runtime.sendMessage({
        type: 'VAULT_SIGN_TRANSACTION',
        payload: {
          utxos: spendableUtxos,
          excludeUtxos: carrierExcludeList,
          toAddress: dest,
          amountSat,
          feeSat,
        },
      });

      if (!signRes?.ok || !signRes?.data?.rawHex) {
        throw new Error(signRes?.error || 'Failed to assemble and sign transaction locally.');
      }

      const { rawHex } = signRes.data;

      // 3. Broadcast signed raw transaction directly to node via POST /api/tx/broadcast
      const broadcastRes = await fetch(`${NETWORK.DEFAULT_EXPLORER_URL}/api/tx/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawtx: rawHex }),
      });

      const responseText = await broadcastRes.text();
      let broadcastData: any = {};
      try {
        broadcastData = JSON.parse(responseText);
      } catch {
        throw new Error(
          `Explorer broadcast endpoint error (${broadcastRes.status}): Route /api/tx/broadcast is not active on ${NETWORK.DEFAULT_EXPLORER_URL}. Please deploy the latest explorer server.`
        );
      }

      if (!broadcastRes.ok || !broadcastData.success || !broadcastData.txid) {
        throw new Error(broadcastData.error || 'Network rejected raw transaction broadcast.');
      }

      setSendSuccessTxId(broadcastData.txid);
      if (address) {
        setTimeout(() => fetchBalance(address), 1200);
      }
    } catch (err: any) {
      setSendError(err.message || 'Transaction failed. Please check network connection.');
    } finally {
      setSendBusy(false);
    }
  };

  const handleSendGlyphL1 = async () => {
    if (sendGlyphBusy || !selectedGlyph) return;

    const dest = sendGlyphRecipient.trim();
    if (!dest) {
      setSendGlyphError('Please enter a recipient address');
      return;
    }

    if (!isValidAddress(dest)) {
      setSendGlyphError('Invalid Quavence address format (must start with S)');
      return;
    }

    if (dest === address) {
      setSendGlyphError('Cannot transfer to yourself');
      return;
    }

    const availableNum = Number(balance.replace(/,/g, ''));
    const availableSat = Math.round(availableNum * 1e8);
    const requiredSat = 20000; // 10,000 sat carrier dust + 10,000 sat miner fee

    if (availableSat < requiredSat) {
      setSendGlyphError(
        `Insufficient funds for L1 transaction. Required: ${(requiredSat / 1e8).toFixed(4)} QVNC (carrier dust + miner fee), Available: ${balance} QVNC`
      );
      return;
    }

    setSendGlyphBusy(true);
    setSendGlyphError('');

    try {
      // 1. Fetch active UTXOs for address directly from Explorer
      const utxoRes = await fetch(`${NETWORK.DEFAULT_EXPLORER_URL}/api/address/${address}`);
      if (!utxoRes.ok) {
        throw new Error('Could not fetch address UTXOs from network.');
      }
      const addrData = await utxoRes.json();
      let rawUtxos: any[] = Array.isArray(addrData.utxos) ? addrData.utxos : [];

      // Tag all carrier UTXOs to ensure fee funding never spends another glyph
      const heldGlyphsList: any[] = Array.isArray(addrData.glyphs) ? addrData.glyphs : (glyphs || []);
      const carrierKeys = new Set<string>();
      heldGlyphsList.forEach((g: any) => {
        if (g.txid) {
          carrierKeys.add(`${g.txid}:${g.carrierVout ?? 0}`);
        }
      });

      const utxos = rawUtxos.map((u: any) => ({
        ...u,
        isCarrier: Boolean(u.isCarrier || carrierKeys.has(`${u.txid}:${u.vout_index}`) || (u.amount === 10000 && carrierKeys.has(`${u.txid}:0`))),
      }));

      if (utxos.length === 0) {
        throw new Error('No confirmed spendable UTXOs found for this address.');
      }

      // 2. Sign L1 Glyph Transaction with OP_RETURN via background worker
      const glyphHash = selectedGlyph.attributes?.glyph_hash || selectedGlyph.glyphHash || String(selectedGlyph.id);
      const edition = Number(selectedGlyph.attributes?.edition || selectedGlyph.edition || selectedGlyph.id || 0);
      const carrierTxid = selectedGlyph.txid || selectedGlyph.carrierTxid;
      const carrierVout = selectedGlyph.carrierVout ?? 0;

      const signRes = await chrome.runtime.sendMessage({
        type: 'VAULT_SEND_GLYPH_L1',
        payload: {
          utxos,
          toAddress: dest,
          glyphMeta: {
            glyphId: glyphHash,
            edition,
            opType: 0x03, // TRANSFER
            carrierTxid,
            carrierVout,
          },
          feeSat: 10000,
          dustSat: 10000,
        },
      });

      if (!signRes?.ok || !signRes?.data?.rawHex) {
        throw new Error(signRes?.error || 'Failed to assemble and sign L1 glyph transaction.');
      }

      const { rawHex, txid: calculatedTxid, opReturnHex } = signRes.data;

      // 3. Broadcast to Quavence DAO backend (which uses DimiRpcClient sendrawtransaction + updates DB)
      const broadcastRes = await fetch(`${NETWORK.DEFAULT_DAO_URL}/api/glyphs/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawHex,
          slotId: selectedGlyph.id,
          glyphHash,
          fromAddress: address,
          toAddress: dest,
          txid: calculatedTxid,
          opReturnHex,
        }),
      });

      const broadcastData = await broadcastRes.json().catch(() => ({}));
      if (!broadcastRes.ok || !broadcastData.ok || !broadcastData.data?.txid) {
        throw new Error(broadcastData.error || 'Network rejected raw L1 glyph transaction.');
      }

      const finalTxid = broadcastData.data.txid;
      setSendGlyphSuccessTxId(finalTxid);

      // Refresh balance and glyphs
      if (address) {
        setTimeout(() => {
          fetchBalance(address);
          fetchGlyphs(address);
        }, 1200);
      }
    } catch (err: any) {
      setSendGlyphError(err.message || 'L1 transfer failed. Please check network connection.');
    } finally {
      setSendGlyphBusy(false);
    }
  };

  if (screen === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div className="brand">
          <img src="./icon-48.png" alt="Quavence" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'contain' }} />
          <span className="brand-title">Quavence Vault</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <header
        style={{
          height: 48,
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #E8EAED',
          background: '#ffffff',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img
            src="./icon-48.png"
            alt="Quavence"
            style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'contain' }}
          />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#111827', letterSpacing: '-0.01em' }}>
            Quavence Vault
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {screen === 'wallet' && (
            <button
              type="button"
              onClick={handleCopyAddress}
              title="Copy Address"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: '#F9FAFB',
                border: '1px solid #E5E7EB',
                borderRadius: 12,
                padding: '3px 8px',
                cursor: 'pointer',
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981' }} />
              <span style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace', color: copied ? '#10B981' : '#374151', fontWeight: 600 }}>
                {copied ? 'Copied!' : address ? `${address.slice(0, 5)}...${address.slice(-4)}` : ''}
              </span>
            </button>
          )}
          <button
            onClick={handleToggleSidePanel}
            style={{
              background: isSidePanel ? '#EFF6FF' : 'none',
              border: isSidePanel ? '1px solid #BFDBFE' : 'none',
              borderRadius: 6,
              color: isSidePanel ? '#2563EB' : '#9CA3AF',
              cursor: 'pointer',
              display: 'flex',
              padding: isSidePanel ? '2px 4px' : 0,
            }}
            title={isSidePanel ? "Открепить / Закрыть боковую панель" : "Прикрепить сбоку (Side Panel)"}
          >
            {isSidePanel ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
          </button>
          <button
            onClick={() => chrome.tabs?.create?.({ url: isSidePanel ? 'sidepanel.html' : 'popup.html' })}
            style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', display: 'flex', padding: 0 }}
            title="Expand to Full Tab"
          >
            <Maximize2 size={16} />
          </button>
          {screen === 'wallet' && (
            <button
              onClick={handleLock}
              style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', display: 'flex', padding: 0 }}
              title="Lock Wallet"
            >
              <Lock size={16} />
            </button>
          )}
        </div>
      </header>

      {/* Screen: Welcome */}
      {screen === 'welcome' && (
        <main
          className="content welcome-view"
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            height: isSidePanel ? 'calc(100vh - 52px)' : 'calc(600px - 52px)',
            padding: '0 24px',
          }}
        >
          <div className="hero-container" style={{ textAlign: 'center', marginBottom: 28 }}>
            <img
              src="./icon-128.png"
              alt="Quavence Logo"
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                objectFit: 'contain',
                display: 'block',
                margin: '0 auto 14px',
                border: '1px solid var(--border-card)',
              }}
            />
            <h1 className="hero-title" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
              Quavence Vault
            </h1>
            <p className="hero-desc" style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45, maxWidth: 280, margin: '0 auto' }}>
              Your sovereign Web3 non-custodial gateway for QVNC consensus and PoUS Glyphs.
            </p>
          </div>

          <div className="btn-group" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button className="btn btn-primary" onClick={handleStartCreate}>
              Create New Wallet
            </button>
            <button className="btn btn-secondary" onClick={() => setScreen('import_seed')}>
              Import Existing Phrase
            </button>
          </div>
        </main>
      )}

      {/* Screen: Create Seed Phrase */}
      {screen === 'create_seed' && (
        <main className="content onboarding-view">
          <h2 className="page-title">Secret Recovery Phrase</h2>
          <p className="page-subtitle">
            Write down these 12 words in order and store them safely. Never share your secret phrase with anyone.
          </p>

          <div className="mnemonic-card">
            <div className="mnemonic-grid">
              {mnemonicDraft.split(' ').map((word, i) => (
                <div key={i} className="mnemonic-word-box">
                  <span className="mnemonic-idx">{i + 1}.</span>
                  <span className="mnemonic-word">{word}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="copy-chip-btn"
            onClick={() => {
              navigator.clipboard.writeText(mnemonicDraft);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? (
              <>
                <Check size={16} /> Copied to Clipboard!
              </>
            ) : (
              <>
                <Copy size={16} /> Copy Secret Phrase
              </>
            )}
          </button>

          <div className="btn-group" style={{ marginTop: 'auto' }}>
            <button
              className="btn btn-primary"
              onClick={async () => {
                try {
                  await chrome.storage.session.set({ qvnc_draft_step: 'set_password' });
                } catch {}
                setScreen('set_password');
              }}
            >
              I Saved My Secret Phrase
            </button>
          </div>
        </main>
      )}

      {/* Screen: Import Seed Phrase */}
      {screen === 'import_seed' && (
        <main className="content onboarding-view">
          <h2 className="page-title">Import Secret Phrase</h2>
          <p className="page-subtitle">
            Enter your 12 or 24-word recovery phrase separated by spaces.
          </p>

          <div className="form-field">
            <textarea
              className="form-input"
              rows={4}
              placeholder="word1 word2 word3..."
              value={importInput}
              onChange={(e) => setImportInput(e.target.value)}
              style={{ height: 'auto', padding: '12px', resize: 'none', lineHeight: '22px' }}
            />
          </div>

          {errorMsg && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12, fontWeight: 500 }}>{errorMsg}</p>}

          <div className="btn-group" style={{ marginTop: 'auto' }}>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (!validateMnemonic(importInput)) {
                  setErrorMsg('Invalid seed phrase checksum or words');
                  return;
                }
                setErrorMsg('');
                setScreen('set_password');
              }}
            >
              Continue
            </button>
            <button className="btn btn-secondary" onClick={() => setScreen('welcome')}>
              Back
            </button>
          </div>
        </main>
      )}

      {/* Screen: Set Password */}
      {screen === 'set_password' && (
        <main className="content onboarding-view">
          <h2 className="page-title">Set Master Password</h2>
          <p className="page-subtitle">
            Create a strong password to unlock your vault on this device.
          </p>

          <div style={{ background: '#f8fafc', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', padding: '16px', marginBottom: 14 }}>
            {/* Field 1: New Password */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>
                New Password
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <KeyRound size={16} color="var(--text-muted)" style={{ position: 'absolute', left: 12 }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="form-input"
                  placeholder="At least 8 characters"
                  value={passwordInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPasswordInput(val);
                    chrome.storage.session?.set?.({ qvnc_draft_pwd: val });
                  }}
                  style={{ paddingLeft: 38, paddingRight: 38 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{ position: 'absolute', right: 10, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Field 2: Confirm Password */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>
                Confirm Password
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <KeyRound size={16} color="var(--text-muted)" style={{ position: 'absolute', left: 12 }} />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  className="form-input"
                  placeholder="Repeat your password"
                  value={confirmPasswordInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    setConfirmPasswordInput(val);
                    chrome.storage.session?.set?.({ qvnc_draft_pwd_confirm: val });
                  }}
                  style={{ paddingLeft: 38, paddingRight: 38 }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={{ position: 'absolute', right: 10, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          </div>

          {/* Validation Checklist */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: passwordInput.length >= 8 ? '#10b981' : 'var(--text-muted)', fontWeight: 500 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: passwordInput.length >= 8 ? '#10b981' : '#cbd5e1' }} />
              <span>At least 8 characters</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: passwordInput && passwordInput === confirmPasswordInput ? '#10b981' : 'var(--text-muted)', fontWeight: 500 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: passwordInput && passwordInput === confirmPasswordInput ? '#10b981' : '#cbd5e1' }} />
              <span>Passwords match</span>
            </div>
          </div>

          {errorMsg && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12, fontWeight: 500 }}>{errorMsg}</p>}

          <div className="btn-group" style={{ marginTop: 'auto' }}>
            <button
              className="btn btn-primary"
              onClick={handleSavePassword}
              disabled={busy || passwordInput.length < 8 || passwordInput !== confirmPasswordInput}
              style={{
                opacity: passwordInput.length >= 8 && passwordInput === confirmPasswordInput ? 1 : 0.5,
                cursor: passwordInput.length >= 8 && passwordInput === confirmPasswordInput ? 'pointer' : 'not-allowed',
              }}
            >
              {busy ? 'Securing Vault…' : 'Create Vault & Start'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setScreen(mnemonicDraft ? 'create_seed' : 'welcome')}
            >
              Back
            </button>
          </div>
        </main>
      )}

      {/* Screen: Unlock */}
      {screen === 'unlock' && (
        <main
          className="content"
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            height: isSidePanel ? 'calc(100vh - 52px)' : 'calc(600px - 52px)',
            padding: '0 24px',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <img
              src="./icon-128.png"
              alt="Quavence Logo"
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                objectFit: 'contain',
                display: 'block',
                margin: '0 auto 12px',
                border: '1px solid var(--border-default)',
              }}
            />
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>
              Unlock Vault
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Enter your master password to continue
            </p>
          </div>

          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <KeyRound size={16} color="var(--text-muted)" style={{ position: 'absolute', left: 12 }} />
            <input
              type={showUnlockPassword ? 'text' : 'password'}
              className="form-input"
              placeholder="Enter master password"
              value={unlockPassword}
              onChange={(e) => setUnlockPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
              style={{ paddingLeft: 38, paddingRight: 38 }}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowUnlockPassword(!showUnlockPassword)}
              style={{ position: 'absolute', right: 10, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
            >
              {showUnlockPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {errorMsg && (
            <p style={{ color: '#ef4444', fontSize: 12, marginBottom: 12, fontWeight: 500, textAlign: 'center' }}>
              {errorMsg}
            </p>
          )}

          <button
            className="btn btn-primary"
            onClick={handleUnlock}
            disabled={busy}
            style={{ width: '100%', height: 42, fontSize: 14, fontWeight: 600 }}
          >
            {busy ? 'Unlocking…' : 'Unlock Wallet'}
          </button>
        </main>
      )}

      {/* Screen: Approval Request (Prompt from dApp) */}
      {screen === 'approval' && pendingApproval && (
        <main
          className="content"
          style={{
            padding: '14px 16px 16px',
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
            background: '#ffffff',
            boxSizing: 'border-box',
            overflowY: 'auto',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: '#EFF6FF',
                color: '#2563EB',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 10px',
                border: '1px solid #BFDBFE',
              }}
            >
              <ShieldCheck size={24} />
            </div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 4 }}>
              {pendingApproval.type === 'DAPP_BUY_GLYPH_L1'
                ? 'Buy PoUS Glyph'
                : pendingApproval.type === 'DAPP_TRANSFER_GLYPH_L1'
                ? 'Deposit Glyph to Escrow'
                : pendingApproval.type === 'DAPP_CLAIM_GLYPH_L1'
                ? 'Claim PoUS Glyph (L1)'
                : pendingApproval.type === 'DAPP_CLAIM_GLYPH'
                ? 'Claim PoUS Glyph'
                : 'Signature Request'}
            </h2>
            <div
              style={{
                display: 'inline-block',
                background: '#F9FAFB',
                border: '1px solid #E5E7EB',
                borderRadius: 12,
                padding: '3px 10px',
                fontSize: 11,
                color: '#374151',
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              {pendingApproval.origin}
            </div>
          </div>

          <div
            style={{
              background: '#F9FAFB',
              border: '1px solid #E5E7EB',
              borderRadius: 10,
              padding: 12,
              marginBottom: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Request Details
            </span>

            {pendingApproval.type === 'DAPP_SIGN_MESSAGE' && (
              <div
                style={{
                  background: '#ffffff',
                  border: '1px solid #E5E7EB',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontSize: 12,
                  fontFamily: 'ui-monospace, monospace',
                  color: '#111827',
                  maxHeight: 180,
                  overflowY: 'auto',
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {pendingApproval.payload?.message}
              </div>
            )}

            {(pendingApproval.type === 'DAPP_CLAIM_GLYPH' || pendingApproval.type === 'DAPP_CLAIM_GLYPH_L1' || pendingApproval.type === 'DAPP_TRANSFER_GLYPH_L1' || pendingApproval.type === 'DAPP_BUY_GLYPH_L1') && (() => {
              const payload = pendingApproval.payload || {};
              const svgClean = formatSvgForPreview(
                payload.svgContent ||
                (typeof payload.imageRef === 'string' && payload.imageRef.includes('<svg') ? payload.imageRef : undefined),
                payload.edition || payload.glyph_hash || payload.txid || 'approval'
              );
              const imgSrc = !svgClean ? resolveImageSource(payload.imageRef, pendingApproval.origin) : null;
              const rarityStyle = getRarityBadgeStyle(payload.rarity);
              const activeAddr = payload.activeAddress || '';
              const shortAddr = activeAddr ? `${activeAddr.slice(0, 8)}...${activeAddr.slice(-6)}` : '';
              const payloadString = pendingApproval.type === 'DAPP_BUY_GLYPH_L1'
                ? `BUY_L1_GLYPH:listing=${payload.listingId}:edition=${payload.edition}:price=${payload.priceQvnc}QVNC:seller=${payload.sellerAddress}`
                : pendingApproval.type === 'DAPP_TRANSFER_GLYPH_L1'
                ? `TRANSFER_L1_GLYPH:edition=${payload.edition}:hash=${payload.glyphHash}:to=${payload.toAddress}:price=${payload.priceQvnc || 0}QVNC:dust=0.0001:fee=0.0001`
                : pendingApproval.type === 'DAPP_CLAIM_GLYPH_L1'
                ? `L1_GLYPH_OP_RETURN:drop=${payload.dropId}:slot=${payload.slotId}:owner=${activeAddr}:dust=0.0001:fee=0.0001`
                : `CLAIM_GLYPH:drop=${payload.dropId}:slot=${payload.slotId}:addr=${activeAddr}${payload.sessionUuid ? `:uuid=${payload.sessionUuid}` : ''}`;

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Hero Artifact Card */}
                  <div
                    style={{
                      background: 'linear-gradient(135deg, #0B0F19 0%, #111827 100%)',
                      border: '1px solid #1E293B',
                      borderRadius: 12,
                      padding: 10,
                      display: 'flex',
                      gap: 12,
                      alignItems: 'center',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                    }}
                  >
                    {/* Visual box */}
                    <div
                      style={{
                        width: 72,
                        height: 72,
                        minWidth: 72,
                        borderRadius: 8,
                        background: '#020617',
                        border: '1px solid rgba(6, 182, 212, 0.35)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        padding: svgClean ? 4 : 0,
                        boxShadow: 'inset 0 0 12px rgba(6, 182, 212, 0.15)',
                      }}
                    >
                      {svgClean ? (
                        <div
                          style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          dangerouslySetInnerHTML={{ __html: svgClean }}
                        />
                      ) : imgSrc ? (
                        <img
                          src={imgSrc}
                          alt={payload.slotName || 'Glyph'}
                          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        />
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#38BDF8', gap: 2 }}>
                          <Sparkles size={24} />
                          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em' }}>GLYPH</span>
                        </div>
                      )}
                    </div>

                    {/* Metadata column */}
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, gap: 3 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#F8FAFC',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={payload.slotName || `PoUS Glyph #${payload.slotId}`}
                      >
                        {payload.slotName || `PoUS Glyph #${payload.slotId}`}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: '#94A3B8',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {payload.dropLabel || `Drop #${payload.dropId}`}
                      </div>

                      {/* Badges row */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                        {payload.rarity && (
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 600,
                              padding: '1px 5px',
                              borderRadius: 4,
                              background: rarityStyle.bg,
                              color: rarityStyle.text,
                              border: `1px solid ${rarityStyle.border}`,
                            }}
                          >
                            {payload.rarity}
                          </span>
                        )}
                        {payload.theme && (
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 500,
                              padding: '1px 5px',
                              borderRadius: 4,
                              background: '#1E293B',
                              color: '#CBD5E1',
                              border: '1px solid #334155',
                              maxWidth: 90,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            title={payload.theme}
                          >
                            {payload.theme}
                          </span>
                        )}
                        {payload.edition && (
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 500,
                              padding: '1px 5px',
                              borderRadius: 4,
                              background: '#1E293B',
                              color: '#38BDF8',
                              border: '1px solid #0369A1',
                            }}
                          >
                            #{payload.edition}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Param rows table */}
                  <div
                    style={{
                      background: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      borderRadius: 10,
                      padding: '8px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      fontSize: 11,
                    }}
                  >
                    {/* Destination wallet */}
                    {activeAddr && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#64748B', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Wallet size={12} style={{ color: '#0EA5E9' }} />
                          Recipient Wallet:
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: '#0F172A', fontSize: 11 }}>
                            {shortAddr}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(activeAddr);
                              setCopiedApprovalAddr(true);
                              setTimeout(() => setCopiedApprovalAddr(false), 1800);
                            }}
                            title="Copy full address"
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 1,
                              color: copiedApprovalAddr ? '#10B981' : '#64748B',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            {copiedApprovalAddr ? <Check size={11} /> : <Copy size={11} />}
                          </button>
                        </div>
                      </div>
                    )}

                    {pendingApproval.type === 'DAPP_BUY_GLYPH_L1' ? (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748B' }}>Total Price:</span>
                          <span style={{ fontWeight: 700, color: '#0284C7' }}>
                            {payload.priceQvnc} QVNC
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748B' }}>Seller:</span>
                          <span style={{ fontWeight: 600, color: '#0F172A', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                            {payload.sellerAddress ? `${payload.sellerAddress.slice(0, 8)}...${payload.sellerAddress.slice(-6)}` : ''}
                          </span>
                        </div>
                        {payload.feeSat > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#64748B' }}>Marketplace Fee:</span>
                            <span style={{ fontWeight: 500, color: '#64748B' }}>
                              {(payload.feeSat / 1e8).toFixed(4)} QVNC
                            </span>
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748B' }}>L1 Miner Fee:</span>
                          <span style={{ fontWeight: 600, color: '#0F172A' }}>
                            0.00010000 QVNC
                          </span>
                        </div>
                      </>
                    ) : pendingApproval.type === 'DAPP_TRANSFER_GLYPH_L1' ? (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748B' }}>Escrow Vault:</span>
                          <span style={{ fontWeight: 600, color: '#0F172A', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                            {payload.toAddress ? `${payload.toAddress.slice(0, 8)}...${payload.toAddress.slice(-6)}` : 'Market Escrow'}
                          </span>
                        </div>
                        {payload.priceQvnc && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#64748B' }}>Listing Price:</span>
                            <span style={{ fontWeight: 700, color: '#0284C7' }}>
                              {payload.priceQvnc} QVNC
                            </span>
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748B' }}>Carrier Dust:</span>
                          <span style={{ fontWeight: 600, color: '#0F172A' }}>
                            0.00010000 QVNC
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748B' }}>L1 Miner Fee:</span>
                          <span style={{ fontWeight: 600, color: '#0F172A' }}>
                            0.00010000 QVNC
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748B' }}>Drop / Slot:</span>
                          <span style={{ fontWeight: 600, color: '#0F172A' }}>
                            Drop #{payload.dropId} • Slot #{payload.slotId}
                          </span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748B' }}>Protocol:</span>
                          <span style={{ color: '#059669', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                            <ShieldCheck size={12} />
                            {pendingApproval.type === 'DAPP_CLAIM_GLYPH_L1' ? 'Native L1 UTXO (OP_RETURN)' : 'PoUS On-Chain (Gasless)'}
                          </span>
                        </div>

                        {pendingApproval.type === 'DAPP_CLAIM_GLYPH_L1' && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 2, borderTop: '1px dashed #E2E8F0' }}>
                            <span style={{ color: '#64748B' }}>L1 Miner Fee:</span>
                            <span style={{ fontWeight: 600, color: '#0F172A' }}>
                              0.0001 QVNC
                            </span>
                          </div>
                        )}
                      </>
                    )}

                    {payload.coinReward && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 2, borderTop: '1px dashed #E2E8F0' }}>
                        <span style={{ color: '#64748B', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Coins size={12} style={{ color: '#F59E0B' }} />
                          Coin Bonus:
                        </span>
                        <span style={{ fontWeight: 700, color: '#D97706' }}>
                          +{payload.coinReward} QVNC Box
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Cryptographic Attestation Payload Expander */}
                  <div
                    style={{
                      background: '#F8FAFC',
                      border: '1px solid #E2E8F0',
                      borderRadius: 8,
                      overflow: 'hidden',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setShowPayloadDetails(!showPayloadDetails)}
                      style={{
                        width: '100%',
                        padding: '5px 8px',
                        background: 'transparent',
                        border: 'none',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        cursor: 'pointer',
                        fontSize: 10,
                        color: '#64748B',
                        fontWeight: 600,
                      }}
                    >
                      <span>Cryptographic Attestation Payload</span>
                      {showPayloadDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>

                    {showPayloadDetails && (
                      <div
                        style={{
                          padding: '6px 8px',
                          borderTop: '1px solid #E2E8F0',
                          background: '#FFFFFF',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 9.5,
                            fontFamily: 'ui-monospace, monospace',
                            color: '#334155',
                            wordBreak: 'break-all',
                            lineHeight: 1.35,
                            background: '#F1F5F9',
                            padding: '4px 6px',
                            borderRadius: 4,
                            border: '1px solid #E2E8F0',
                          }}
                        >
                          {payloadString}
                        </div>
                        <p style={{ fontSize: 9.5, color: '#94A3B8', marginTop: 3 }}>
                          Signed with ECDSA secp256k1 private key in local vault.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 14 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleReject}
              disabled={busy}
              style={{ flex: 1, height: 40, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Reject
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleApprove}
              disabled={busy}
              style={{ flex: 1, height: 40, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              {busy
                ? (pendingApproval.type === 'DAPP_BUY_GLYPH_L1' ? 'Buying…' : pendingApproval.type === 'DAPP_TRANSFER_GLYPH_L1' ? 'Depositing…' : 'Signing…')
                : (pendingApproval.type === 'DAPP_BUY_GLYPH_L1' ? 'Confirm Purchase' : pendingApproval.type === 'DAPP_TRANSFER_GLYPH_L1' ? 'Confirm Escrow Deposit' : 'Approve & Sign')}
            </button>
          </div>
        </main>
      )}

      {/* Screen: Wallet Dashboard */}
      {screen === 'wallet' && (
        <main
          className="content"
          style={{
            position: 'relative',
            height: isSidePanel ? 'calc(100vh - 48px)' : 'calc(600px - 48px)',
            overflow: 'hidden',
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Top Section: Balance, Buttons, and Tabs (Fixed, Zero Layout Shift) */}
          <div
            style={{
              padding: '16px 16px 0 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              flexShrink: 0,
            }}
          >
            {/* Balance Card */}
          <div
            style={{
              border: '1px solid #E8EAED',
              boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
              borderRadius: 12,
              padding: '14px 16px',
              background: '#ffffff',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: '#9CA3AF',
                  textTransform: 'uppercase',
                }}
              >
                AVAILABLE BALANCE
              </span>
              <button
                type="button"
                disabled={balanceLoading}
                onClick={() => address && fetchBalance(address, true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: balanceLoading ? '#2563EB' : '#9CA3AF',
                  cursor: balanceLoading ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 2,
                  transition: 'color 0.2s',
                }}
                title={balanceLoading ? 'Fetching latest on-chain data…' : 'Refresh balance and activity'}
              >
                <RefreshCw size={14} className={balanceLoading ? 'spin' : ''} />
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 32, fontWeight: 700, color: '#111827', letterSpacing: '-0.02em', lineHeight: 1 }}>
                {balance}
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#2563EB' }}>
                QVNC
              </span>
            </div>
          </div>

          {/* Action Buttons: Send / Receive / Explorer */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <button
              type="button"
              onClick={() => setActiveModal('send')}
              className="btn"
              style={{
                height: 36,
                background: '#2563EB',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: 13,
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => setActiveModal('receive')}
              className="btn"
              style={{
                height: 36,
                background: '#ffffff',
                border: '1.5px solid #D1D5DB',
                color: '#374151',
                fontWeight: 600,
                fontSize: 13,
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Receive
            </button>
            <a
              href={`${NETWORK.DEFAULT_EXPLORER_URL}/address/${address}`}
              target="_blank"
              rel="noreferrer"
              className="btn"
              style={{
                height: 36,
                background: '#ffffff',
                border: '1.5px solid #D1D5DB',
                color: '#374151',
                fontWeight: 600,
                fontSize: 13,
                borderRadius: 8,
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box',
              }}
            >
              Explorer
            </a>
          </div>

          {/* Underline Tabs 36px */}
          <div
            style={{
              display: 'flex',
              height: 36,
              borderBottom: '1px solid #E2E8F0',
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('wallet')}
              style={{
                flex: 1,
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'wallet' ? '2px solid #2563EB' : '2px solid transparent',
                marginBottom: -1,
                color: activeTab === 'wallet' ? '#2563EB' : '#64748B',
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
                padding: 0,
                transition: 'color 0.15s ease, border-color 0.15s ease',
              }}
            >
              Activity
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('glyphs');
                if (address) fetchGlyphs(address);
              }}
              style={{
                flex: 1,
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'glyphs' ? '2px solid #2563EB' : '2px solid transparent',
                marginBottom: -1,
                color: activeTab === 'glyphs' ? '#2563EB' : '#64748B',
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
                padding: 0,
                transition: 'color 0.15s ease, border-color 0.15s ease',
              }}
            >
              PoUS Glyphs{glyphs.length > 0 ? ` (${glyphs.length})` : ''}
            </button>
          </div>
          </div>

          {/* Scrollable Tab Content Area */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '12px 16px 16px 16px',
              minHeight: 0,
            }}
          >
          {/* Tab Content: Activity / Glyphs */}
          {activeTab === 'wallet' ? (
            transactions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 16px', color: '#9CA3AF' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 4 }}>
                  No recent transactions
                </div>
                <div style={{ fontSize: 11 }}>
                  Incoming and outgoing transfers will appear here.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {transactions.map((tx) => {
                  const isSent = tx.type === 'sent';
                  const isGlyph = tx.tx_type?.includes('glyph') || !!tx.glyph || !!tx.glyph_edition || !!tx.glyph_op_label;
                  const isMint = tx.tx_type === 'pous_glyph_mint' || tx.glyph_op_label === 'MINT';

                  let actionTitle = isSent ? 'Sent' : 'Received';
                  if (isGlyph) {
                    if (isMint) actionTitle = 'Minted PoUS Glyph';
                    else if (isSent) actionTitle = 'Sent Glyph';
                    else actionTitle = 'Received Glyph';
                  }

                  const glyphName = tx.glyph?.name || (tx.glyph_edition ? `Edition #${tx.glyph_edition}` : 'PoUS Artifact');
                  const glyphRarity = tx.glyph?.rarity;
                  const rarityStyle = getRarityBadgeStyle(glyphRarity);
                  const rawSvg = tx.glyph?.svgContent ||
                    (typeof tx.glyph?.imageRef === 'string' && tx.glyph.imageRef.includes('<svg') ? tx.glyph.imageRef : undefined);
                  const glyphSvgClean = formatSvgForPreview(rawSvg, tx.glyph_hash || tx.txid || tx.glyph_edition);
                  const glyphImgSrc = !glyphSvgClean ? resolveImageSource(tx.glyph?.imageRef, NETWORK.DEFAULT_DAO_URL) : null;

                  return (
                    <div
                      key={tx.txid}
                      onClick={() => {
                        setSelectedTx(tx);
                        setTxCopied(false);
                      }}
                      style={{
                        height: 54,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottom: '1px solid #F3F4F6',
                        cursor: 'pointer',
                        padding: '0 4px',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFC')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        {/* Circular / Real Glyph Artwork Thumbnail 32px */}
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            minWidth: 32,
                            borderRadius: isGlyph ? 6 : '50%',
                            background: isGlyph ? '#020617' : '#F8FAFC',
                            border: isGlyph ? '1px solid #1E293B' : '1px solid #E2E8F0',
                            color: isGlyph ? '#38BDF8' : '#475569',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            overflow: 'hidden',
                            padding: isGlyph && glyphSvgClean ? 2 : 0,
                          }}
                        >
                          {isGlyph ? (
                            glyphSvgClean ? (
                              <div
                                style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                dangerouslySetInnerHTML={{ __html: glyphSvgClean }}
                              />
                            ) : glyphImgSrc ? (
                              <img
                                src={glyphImgSrc}
                                alt={glyphName}
                                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                              />
                            ) : (
                              <div
                                style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                dangerouslySetInnerHTML={{
                                  __html: formatSvgForPreview(
                                    generateClientGlyphSvg(tx.glyph_hash || tx.txid, tx.glyph_edition, glyphRarity, glyphName),
                                    tx.glyph_hash || tx.txid || tx.glyph_edition
                                  )
                                }}
                              />
                            )
                          ) : isSent ? (
                            <ArrowUpRight size={13} />
                          ) : (
                            <ArrowDownLeft size={13} />
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0F172A', lineHeight: 1.25, display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {actionTitle}
                            </span>
                            {isGlyph && (
                              <span
                                style={{
                                  fontSize: 8.5,
                                  fontWeight: 700,
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  background: glyphRarity ? rarityStyle.bg : '#EFF6FF',
                                  color: glyphRarity ? rarityStyle.text : '#2563EB',
                                  border: `1px solid ${glyphRarity ? rarityStyle.border : '#DBEAFE'}`,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.04em',
                                }}
                              >
                                {glyphRarity || 'PoUS'}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 10.5, color: isGlyph ? '#2563EB' : '#94A3B8', fontFamily: isGlyph ? 'inherit' : 'ui-monospace, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {isGlyph ? glyphName : `${tx.txid.slice(0, 6)}...${tx.txid.slice(-4)}`}
                          </div>
                        </div>
                      </div>

                      <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                        <div
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: '#0F172A',
                          }}
                        >
                          {isSent ? '-' : '+'}{tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}{' '}
                          <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>QVNC</span>
                        </div>
                        {isGlyph && (
                          <div style={{ fontSize: 9.5, color: tx.block_height && tx.block_height > 0 ? '#059669' : '#D97706', fontWeight: 600 }}>
                            {tx.block_height && tx.block_height > 0 ? 'PoUS On-Chain' : 'Pending Mempool'}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : glyphsLoading && glyphs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 16px', color: '#9CA3AF' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 4 }}>
                Loading Artifacts…
              </div>
              <div style={{ fontSize: 11 }}>Synchronizing on-chain PoUS Glyphs</div>
            </div>
          ) : glyphs.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '32px 16px',
                border: '1px solid #E8EAED',
                borderRadius: 12,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 4 }}>
                No PoUS Artifacts
              </div>
              <div style={{ fontSize: 11, color: '#9CA3AF', lineHeight: 1.45, marginBottom: 14 }}>
                Non-custodial generative glyphs and certificates anchored to this address will render here.
              </div>
              <a
                href={`${NETWORK.DEFAULT_DAO_URL}/dao/quavence/drops`}
                target="_blank"
                rel="noreferrer"
                className="btn"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 14px',
                  height: 32,
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: '1.5px solid #D1D5DB',
                  color: '#374151',
                  background: '#ffffff',
                  textDecoration: 'none',
                }}
              >
                Explore Active Drops
              </a>
            </div>
          ) : (
            /* Collectibles Gallery (Phantom / Rainbow style) */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 16 }}>
              {/* Toolbar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#334155' }}>
                    {glyphs.length} Collectible{glyphs.length === 1 ? '' : 's'}
                  </span>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#10B981' }} title="Synced on-chain" />
                </div>
                <div style={{ display: 'flex', gap: 3, background: '#F1F5F9', borderRadius: 7, padding: 2 }}>
                  <button
                    type="button"
                    onClick={() => setGlyphsViewMode('grid')}
                    title="Grid View (2-Column)"
                    style={{
                      background: glyphsViewMode === 'grid' ? '#FFFFFF' : 'transparent',
                      border: 'none',
                      borderRadius: 5,
                      padding: '3px 7px',
                      cursor: 'pointer',
                      color: glyphsViewMode === 'grid' ? '#2563EB' : '#64748B',
                      display: 'flex',
                      alignItems: 'center',
                      boxShadow: glyphsViewMode === 'grid' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <LayoutGrid size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setGlyphsViewMode('list')}
                    title="List View (Full-Width)"
                    style={{
                      background: glyphsViewMode === 'list' ? '#FFFFFF' : 'transparent',
                      border: 'none',
                      borderRadius: 5,
                      padding: '3px 7px',
                      cursor: 'pointer',
                      color: glyphsViewMode === 'list' ? '#2563EB' : '#64748B',
                      display: 'flex',
                      alignItems: 'center',
                      boxShadow: glyphsViewMode === 'list' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <List size={13} />
                  </button>
                </div>
              </div>

              {glyphsViewMode === 'grid' ? (
                /* Grid View (Phantom / Rainbow standard 2-column square cards) */
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                  {glyphs.map((g) => {
                    const rawSvg = g.contentUri ||
                      (typeof g.imageRef === 'string' && g.imageRef.includes('<svg') ? g.imageRef : undefined);
                    const svgClean = formatSvgForPreview(rawSvg, g.id || g.edition || g.attributes?.glyph_hash);
                    const imgSrc = !svgClean ? resolveImageSource(g.imageRef, NETWORK.DEFAULT_DAO_URL) : null;
                    const rarityStyle = getRarityBadgeStyle(g.attributes?.rarity);

                    return (
                      <div
                        key={g.id}
                        onClick={() => {
                          setSelectedGlyph(g);
                          setGlyphTxCopied(false);
                        }}
                        style={{
                          background: '#FFFFFF',
                          border: '1px solid #E2E8F0',
                          borderRadius: 12,
                          overflow: 'hidden',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                          transition: 'all 0.18s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = '#38BDF8';
                          e.currentTarget.style.transform = 'translateY(-2px)';
                          e.currentTarget.style.boxShadow = '0 4px 14px rgba(14, 165, 233, 0.15)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = '#E2E8F0';
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
                        }}
                      >
                        {/* 1:1 Square Media Area */}
                        <div
                          style={{
                            position: 'relative',
                            width: '100%',
                            aspectRatio: '1 / 1',
                            background: '#030712',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            padding: svgClean ? 4 : 0,
                          }}
                        >
                          {svgClean ? (
                            <div
                              style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              dangerouslySetInnerHTML={{ __html: svgClean }}
                            />
                          ) : imgSrc ? (
                            <img
                              src={imgSrc}
                              alt={g.name}
                              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                          ) : (
                            <Sparkles size={24} style={{ color: '#38BDF8' }} />
                          )}

                          {/* Rarity Overlay Badge (Top-Right) */}
                          {g.attributes?.rarity && (
                            <span
                              style={{
                                position: 'absolute',
                                top: 5,
                                right: 5,
                                background: 'rgba(3, 7, 18, 0.75)',
                                backdropFilter: 'blur(4px)',
                                border: `1px solid ${rarityStyle.border}`,
                                borderRadius: 4,
                                padding: '1.5px 5px',
                                fontSize: 8.5,
                                fontWeight: 700,
                                color: rarityStyle.text,
                                textTransform: 'uppercase',
                                letterSpacing: '0.04em',
                              }}
                            >
                              {g.attributes.rarity}
                            </span>
                          )}

                          {/* Edition Overlay Badge (Bottom-Left) */}
                          <span
                            style={{
                              position: 'absolute',
                              bottom: 5,
                              left: 5,
                              background: 'rgba(3, 7, 18, 0.7)',
                              backdropFilter: 'blur(4px)',
                              borderRadius: 4,
                              padding: '1.5px 5px',
                              fontSize: 8.5,
                              fontWeight: 600,
                              color: '#94A3B8',
                              fontFamily: 'ui-monospace, monospace',
                            }}
                          >
                            #{g.attributes?.edition || g.id}
                          </span>
                        </div>

                        {/* Text Details Area (Never wraps clumsily) */}
                        <div style={{ padding: '7px 8px 8px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span
                            title={g.name}
                            style={{
                              fontSize: 11.5,
                              fontWeight: 700,
                              color: '#0F172A',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              lineHeight: 1.3,
                            }}
                          >
                            {g.name}
                          </span>
                          <span
                            style={{
                              fontSize: 9.5,
                              color: '#64748B',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {g.attributes?.theme || 'PoUS Artifact'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* List View (Rabby / MetaMask / Phantom List style) */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {glyphs.map((g) => {
                    const rawSvg = g.contentUri ||
                      (typeof g.imageRef === 'string' && g.imageRef.includes('<svg') ? g.imageRef : undefined);
                    const svgClean = formatSvgForPreview(rawSvg, g.id || g.edition || g.attributes?.glyph_hash);
                    const imgSrc = !svgClean ? resolveImageSource(g.imageRef, NETWORK.DEFAULT_DAO_URL) : null;
                    const rarityStyle = getRarityBadgeStyle(g.attributes?.rarity);

                    return (
                      <div
                        key={g.id}
                        onClick={() => {
                          setSelectedGlyph(g);
                          setGlyphTxCopied(false);
                        }}
                        style={{
                          background: '#FFFFFF',
                          border: '1px solid #E2E8F0',
                          borderRadius: 10,
                          padding: '8px 10px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = '#38BDF8';
                          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = '#E2E8F0';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      >
                        {/* Square Thumbnail */}
                        <div
                          style={{
                            width: 50,
                            height: 50,
                            minWidth: 50,
                            borderRadius: 8,
                            background: '#030712',
                            border: '1px solid #1E293B',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            padding: svgClean ? 3 : 0,
                          }}
                        >
                          {svgClean ? (
                            <div
                              style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              dangerouslySetInnerHTML={{ __html: svgClean }}
                            />
                          ) : imgSrc ? (
                            <img
                              src={imgSrc}
                              alt={g.name}
                              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                          ) : (
                            <Sparkles size={20} style={{ color: '#38BDF8' }} />
                          )}
                        </div>

                        {/* Title & Metadata Column */}
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: 2 }}>
                          <span
                            title={g.name}
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: '#0F172A',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              lineHeight: 1.3,
                            }}
                          >
                            {g.name}
                          </span>
                          <span style={{ fontSize: 10, color: '#64748B' }}>
                            {g.attributes?.theme || 'PoUS Genesis'} · #{g.attributes?.edition || g.id}
                          </span>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 }}>
                            {g.attributes?.rarity && (
                              <span
                                style={{
                                  fontSize: 8.5,
                                  fontWeight: 600,
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  background: rarityStyle.bg,
                                  color: rarityStyle.text,
                                  border: `1px solid ${rarityStyle.border}`,
                                }}
                              >
                                {g.attributes.rarity}
                              </span>
                            )}
                            <span
                              style={{
                                fontSize: 8.5,
                                fontWeight: 500,
                                padding: '1px 5px',
                                borderRadius: 4,
                                background: 'rgba(5, 150, 105, 0.1)',
                                color: '#059669',
                              }}
                            >
                              PoUS Verified
                            </span>
                          </div>
                        </div>

                        <ChevronRight size={15} color="#94A3B8" />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          </div>

          {/* Screen: PoUS Collectible Details or Send Glyph */}
          {selectedGlyph && (() => {
            const rawSvg = selectedGlyph.contentUri ||
              (typeof selectedGlyph.imageRef === 'string' && selectedGlyph.imageRef.includes('<svg') ? selectedGlyph.imageRef : undefined);
            const svgClean = formatSvgForPreview(rawSvg, selectedGlyph.id || selectedGlyph.edition || selectedGlyph.attributes?.glyph_hash);
            const imgSrc = !svgClean ? resolveImageSource(selectedGlyph.imageRef, NETWORK.DEFAULT_DAO_URL) : null;
            const rarityStyle = getRarityBadgeStyle(selectedGlyph.attributes?.rarity);

            /* View: Send Glyph on L1 (Clean full-height screen, never nested or clipped) */
            if (sendGlyphActive) {
              return (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: '#FFFFFF',
                    zIndex: 85,
                    display: 'flex',
                    flexDirection: 'column',
                    padding: 16,
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                  }}
                >
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setSendGlyphActive(false);
                        setSendGlyphError('');
                        setSendGlyphSuccessTxId('');
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        background: 'none',
                        border: 'none',
                        color: '#2563EB',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      <ChevronLeft size={16} />
                      Back
                    </button>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>
                      Send Glyph
                    </span>
                    <div style={{ width: 40 }} />
                  </div>

                  {sendGlyphSuccessTxId ? (
                    /* Success state with real txid */
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12, margin: 'auto 0' }}>
                      <div
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: '50%',
                          background: 'rgba(16, 185, 129, 0.15)',
                          border: '1px solid rgba(16, 185, 129, 0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#10B981',
                        }}
                      >
                        <Check size={28} />
                      </div>
                      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>
                        L1 Glyph Transferred!
                      </h3>
                      <p style={{ fontSize: 11, color: '#64748B', lineHeight: 1.4 }}>
                        The UTXO transaction with Satoshi OP_RETURN payload has been signed and broadcast to the network.
                      </p>

                      <div style={{ width: '100%', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 10, textAlign: 'left' }}>
                        <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>Transaction Hash (L1)</div>
                        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, wordBreak: 'break-all', color: '#0F172A' }}>
                          {sendGlyphSuccessTxId}
                        </div>
                        <a
                          href={`${NETWORK.DEFAULT_EXPLORER_URL}/tx/${sendGlyphSuccessTxId}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            color: '#2563EB',
                            marginTop: 6,
                            textDecoration: 'none',
                          }}
                        >
                          <ExternalLink size={11} />
                          View on Quavence Explorer
                        </a>
                      </div>

                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          setSendGlyphActive(false);
                          setSelectedGlyph(null);
                        }}
                        style={{ width: '100%', height: 38, fontSize: 12, fontWeight: 600, marginTop: 8 }}
                      >
                        Done
                      </button>
                    </div>
                  ) : (
                    /* Input and confirmation form */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {/* Selected artifact chip */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 8 }}>
                        <div style={{ width: 42, height: 42, minWidth: 42, borderRadius: 6, background: '#030712', border: '1px solid #1E293B', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                          {svgClean ? (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} dangerouslySetInnerHTML={{ __html: svgClean }} />
                          ) : (
                            <Sparkles size={16} color="#38BDF8" />
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {selectedGlyph.name}
                          </span>
                          <span style={{ fontSize: 10, color: '#64748B' }}>
                            Edition #{selectedGlyph.attributes?.edition || selectedGlyph.id} · {selectedGlyph.attributes?.rarity || 'Common'}
                          </span>
                        </div>
                      </div>

                      {/* Recipient Input */}
                      <div>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                          Recipient Address (Quavence)
                        </label>
                        <input
                          type="text"
                          placeholder="SX... (starts with S)"
                          value={sendGlyphRecipient}
                          onChange={(e) => {
                            setSendGlyphRecipient(e.target.value);
                            setSendGlyphError('');
                          }}
                          style={{
                            width: '100%',
                            height: 38,
                            borderRadius: 8,
                            border: sendGlyphRecipient && !isValidAddress(sendGlyphRecipient.trim()) ? '1px solid #EF4444' : '1px solid #CBD5E1',
                            padding: '0 10px',
                            fontSize: 11,
                            fontFamily: 'ui-monospace, monospace',
                            outline: 'none',
                          }}
                        />
                        {sendGlyphRecipient && !isValidAddress(sendGlyphRecipient.trim()) && (
                          <span style={{ fontSize: 10, color: '#EF4444', marginTop: 2, display: 'block' }}>
                            Must start with S and be a valid base58 address
                          </span>
                        )}
                      </div>

                      {/* L1 UTXO Protocol Breakdown */}
                      <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 10.5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748B' }}>Protocol Output:</span>
                          <span style={{ color: '#0284C7', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                            <ShieldCheck size={11} /> OP_RETURN (40 bytes)
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748B' }}>Glyph Carrier Dust:</span>
                          <span style={{ color: '#0F172A', fontWeight: 600 }}>0.00010000 QVNC</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748B' }}>Miner Network Fee:</span>
                          <span style={{ color: '#0F172A', fontWeight: 600 }}>0.00010000 QVNC</span>
                        </div>
                        <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                          <span style={{ color: '#0F172A' }}>Total Required:</span>
                          <span style={{ color: '#0F172A' }}>0.00020000 QVNC</span>
                        </div>
                      </div>

                      {sendGlyphError && (
                        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C', borderRadius: 6, padding: '6px 8px', fontSize: 11 }}>
                          {sendGlyphError}
                        </div>
                      )}

                      <button
                        type="button"
                        className="btn"
                        onClick={handleSendGlyphL1}
                        disabled={sendGlyphBusy || !sendGlyphRecipient || !isValidAddress(sendGlyphRecipient.trim())}
                        style={{
                          width: '100%',
                          height: 38,
                          fontSize: 13,
                          fontWeight: 600,
                          background: '#2563EB',
                          color: '#ffffff',
                          borderRadius: 8,
                          border: 'none',
                          opacity: sendGlyphRecipient && isValidAddress(sendGlyphRecipient.trim()) && !sendGlyphBusy ? 1 : 0.5,
                          cursor: sendGlyphRecipient && isValidAddress(sendGlyphRecipient.trim()) && !sendGlyphBusy ? 'pointer' : 'not-allowed',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginTop: 6,
                        }}
                      >
                        {sendGlyphBusy ? 'Broadcasting Transaction…' : 'Confirm & Send'}
                      </button>
                    </div>
                  )}
                </div>
              );
            }

            /* View: PoUS Collectible Details */
            return (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: '#FFFFFF',
                  display: 'flex',
                  flexDirection: 'column',
                  zIndex: 80,
                  overflowY: 'auto',
                  overscrollBehavior: 'contain',
                }}
              >
                {/* Top Nav Bar */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderBottom: '1px solid #E2E8F0',
                    background: '#FFFFFF',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedGlyph(null)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      background: 'none',
                      border: 'none',
                      color: '#2563EB',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: '4px 0',
                    }}
                  >
                    <ChevronLeft size={16} />
                    Collectibles
                  </button>

                  <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>
                    Collectible Details
                  </span>

                  {rawSvg ? (
                    <button
                      type="button"
                      onClick={() => openFullscreenSvg(rawSvg)}
                      title="Open Fullscreen Vector SVG in New Tab"
                      style={{
                        background: '#EFF6FF',
                        border: '1px solid #BFDBFE',
                        color: '#2563EB',
                        borderRadius: 6,
                        padding: '3px 8px',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <ExternalLink size={12} />
                      Full Screen
                    </button>
                  ) : (
                    <div style={{ width: 40 }} />
                  )}
                </div>

                {/* Main Content Area */}
                <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* Hero Media Box (Centered square with dark cyber canvas & glow) */}
                  <div
                    onClick={() => rawSvg && openFullscreenSvg(rawSvg)}
                    style={{
                      width: '100%',
                      maxWidth: 240,
                      aspectRatio: '1 / 1',
                      margin: '0 auto',
                      borderRadius: 16,
                      background: '#020617',
                      border: '1.5px solid rgba(6, 182, 212, 0.45)',
                      boxShadow: '0 8px 24px rgba(6, 182, 212, 0.22)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      padding: svgClean ? 6 : 0,
                      cursor: rawSvg ? 'pointer' : 'default',
                      position: 'relative',
                    }}
                    title={rawSvg ? 'Click to open full-resolution SVG in new tab' : undefined}
                  >
                    {svgClean ? (
                      <div
                        style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        dangerouslySetInnerHTML={{ __html: svgClean }}
                      />
                    ) : imgSrc ? (
                      <img
                        src={imgSrc}
                        alt={selectedGlyph.name}
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    ) : (
                      <Sparkles size={48} style={{ color: '#38BDF8' }} />
                    )}

                    {rawSvg && (
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 6,
                          background: 'rgba(2, 6, 23, 0.8)',
                          backdropFilter: 'blur(4px)',
                          border: '1px solid rgba(6, 182, 212, 0.3)',
                          borderRadius: 12,
                          padding: '2px 8px',
                          fontSize: 9,
                          fontWeight: 600,
                          color: '#38BDF8',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        <ExternalLink size={9} /> Tap to expand art
                      </div>
                    )}
                  </div>

                  {/* Title & Collection Header */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#2563EB' }}>
                        Quavence PoUS Genesis
                      </span>
                      <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Check size={8} color="#FFFFFF" />
                      </div>
                    </div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', lineHeight: 1.25 }}>
                      {selectedGlyph.name}
                    </h3>
                  </div>

                  {/* Traits & Attributes (OpenSea / Phantom 2x2 Grid) */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', marginBottom: 6 }}>
                      TRAITS & ATTRIBUTES
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                      <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '8px 10px' }}>
                        <div style={{ fontSize: 9, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: 2 }}>
                          Rarity
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: rarityStyle.text }}>
                          {selectedGlyph.attributes?.rarity || 'Common'}
                        </div>
                      </div>

                      <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '8px 10px' }}>
                        <div style={{ fontSize: 9, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: 2 }}>
                          Theme
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {selectedGlyph.attributes?.theme || 'Standard'}
                        </div>
                      </div>

                      <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '8px 10px' }}>
                        <div style={{ fontSize: 9, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: 2 }}>
                          Edition
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', fontFamily: 'ui-monospace, monospace' }}>
                          #{selectedGlyph.attributes?.edition || selectedGlyph.id}
                        </div>
                      </div>

                      <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '8px 10px' }}>
                        <div style={{ fontSize: 9, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: 2 }}>
                          Consensus
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#059669', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <ShieldCheck size={12} />
                          PoUS Verified
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* On-Chain Provenance Card */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', marginBottom: 6 }}>
                      ON-CHAIN PROVENANCE
                    </div>
                    <div
                      style={{
                        background: '#F8FAFC',
                        border: '1px solid #E2E8F0',
                        borderRadius: 8,
                        padding: 10,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      {selectedGlyph.attributes?.glyph_hash && (
                        <div>
                          <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>Consensus Hash</div>
                          <div
                            style={{
                              fontFamily: 'ui-monospace, monospace',
                              fontSize: 9.5,
                              wordBreak: 'break-all',
                              color: '#0F172A',
                              background: '#FFFFFF',
                              border: '1px solid #E2E8F0',
                              borderRadius: 4,
                              padding: 6,
                            }}
                          >
                            {selectedGlyph.attributes.glyph_hash}
                          </div>
                        </div>
                      )}

                      {selectedGlyph.mintTx && (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                            <span style={{ fontSize: 10, color: '#64748B' }}>Mint Transaction</span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(selectedGlyph.mintTx);
                                setGlyphTxCopied(true);
                                setTimeout(() => setGlyphTxCopied(false), 1800);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: glyphTxCopied ? '#10B981' : '#64748B',
                                fontSize: 10,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 3,
                              }}
                            >
                              {glyphTxCopied ? <Check size={11} /> : <Copy size={11} />}
                              {glyphTxCopied ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          <div
                            style={{
                              fontFamily: 'ui-monospace, monospace',
                              fontSize: 9.5,
                              wordBreak: 'break-all',
                              color: '#0F172A',
                              background: '#FFFFFF',
                              border: '1px solid #E2E8F0',
                              borderRadius: 4,
                              padding: 6,
                            }}
                          >
                            {selectedGlyph.mintTx}
                          </div>
                        </div>
                      )}

                      {address && (
                        <div>
                          <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>Owner Address</div>
                          <div
                            style={{
                              fontFamily: 'ui-monospace, monospace',
                              fontSize: 9.5,
                              wordBreak: 'break-all',
                              color: '#0F172A',
                              background: '#FFFFFF',
                              border: '1px solid #E2E8F0',
                              borderRadius: 4,
                              padding: 6,
                            }}
                          >
                            {address}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Bottom Action Buttons */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4, paddingBottom: 24 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setSendGlyphActive(true);
                          setSendGlyphRecipient('');
                          setSendGlyphError('');
                          setSendGlyphSuccessTxId('');
                        }}
                        style={{
                          flex: 1,
                          height: 36,
                          background: '#2563EB',
                          color: '#ffffff',
                          fontWeight: 600,
                          fontSize: 13,
                          borderRadius: 8,
                          border: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        Send
                      </button>

                      {rawSvg && (
                        <button
                          type="button"
                          onClick={() => openFullscreenSvg(rawSvg)}
                          style={{
                            flex: 1,
                            height: 36,
                            background: '#ffffff',
                            border: '1.5px solid #D1D5DB',
                            color: '#374151',
                            fontWeight: 600,
                            fontSize: 13,
                            borderRadius: 8,
                            cursor: 'pointer',
                          }}
                        >
                          Full SVG ↗
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedGlyph(null)}
                      style={{
                        width: '100%',
                        height: 34,
                        fontSize: 12,
                        fontWeight: 500,
                        color: '#64748B',
                        background: '#F8FAFC',
                        border: '1px solid #E2E8F0',
                        borderRadius: 8,
                        cursor: 'pointer',
                      }}
                    >
                      Back to Collectibles
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Modal: Transaction Details (Full popup white overlay) */}
          {selectedTx && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: '#ffffff',
                display: 'flex',
                flexDirection: 'column',
                padding: '16px',
                zIndex: 60,
                overflowY: 'auto',
                overscrollBehavior: 'contain',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Transaction Details</span>
                <button
                  type="button"
                  onClick={() => setSelectedTx(null)}
                  style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', padding: 2 }}
                >
                  <X size={18} />
                </button>
              </div>

              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    color: '#334155',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 10px',
                  }}
                >
                  {selectedTx.type === 'sent' ? (
                    <ArrowUpRight size={18} />
                  ) : (
                    <ArrowDownLeft size={18} />
                  )}
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#0F172A', marginBottom: 2 }}>
                  {selectedTx.type === 'sent' ? '-' : '+'}
                  {selectedTx.amount.toFixed(4)}{' '}
                  <span style={{ fontSize: 16, color: '#2563EB' }}>QVNC</span>
                </div>
                {selectedTx.block_height && selectedTx.block_height > 0 ? (
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#059669' }}>Confirmed</span>
                ) : (
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#D97706' }}>Pending (Unconfirmed)</span>
                )}
              </div>

              <div
                style={{
                  background: '#F9FAFB',
                  border: '1px solid #E5E7EB',
                  borderRadius: 8,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  marginBottom: selectedTx.glyph || selectedTx.tx_type?.includes('glyph') || selectedTx.glyph_edition ? 0 : 'auto',
                }}
              >
                {selectedTx.block_height && selectedTx.block_height > 0 ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: '#9CA3AF' }}>Block Height</span>
                    <span style={{ fontWeight: 600, color: '#111827', fontFamily: 'ui-monospace, monospace' }}>
                      #{selectedTx.block_height}
                    </span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: '#9CA3AF' }}>Status</span>
                    <span style={{ fontWeight: 600, color: '#D97706', fontFamily: 'ui-monospace, monospace' }}>
                      Mempool (0 conf)
                    </span>
                  </div>
                )}
                {selectedTx.glyph && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: '#9CA3AF' }}>Glyph Artifact</span>
                    <span style={{ fontWeight: 600, color: '#2563EB' }}>
                      {selectedTx.glyph.name || `Edition #${selectedTx.glyph_edition}`}
                    </span>
                  </div>
                )}
                {selectedTx.glyph?.rarity && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: '#9CA3AF' }}>Rarity</span>
                    <span style={{ fontWeight: 700, color: '#D97706' }}>
                      {selectedTx.glyph.rarity}
                    </span>
                  </div>
                )}
                {selectedTx.tx_type && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: '#9CA3AF' }}>Transaction Type</span>
                    <span style={{ fontWeight: 600, color: '#111827' }}>
                      {selectedTx.tx_type === 'pous_glyph_mint' || selectedTx.glyph_op_label === 'MINT'
                        ? 'PoUS Glyph Mint'
                        : selectedTx.tx_type?.includes('glyph')
                        ? 'PoUS Glyph Transfer'
                        : 'Coin Transfer'}
                    </span>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Transaction Hash</div>
                  <div
                    style={{
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 11,
                      wordBreak: 'break-all',
                      color: '#111827',
                      background: '#ffffff',
                      border: '1px solid #E5E7EB',
                      borderRadius: 6,
                      padding: 8,
                    }}
                  >
                    {selectedTx.txid}
                  </div>
                </div>
              </div>

              {/* Real Glyph Image Preview in Transaction Details */}
              {(() => {
                const isGlyphTx = selectedTx.tx_type?.includes('glyph') || !!selectedTx.glyph || !!selectedTx.glyph_edition || !!selectedTx.glyph_hash;
                if (!isGlyphTx) return null;

                const rawGlyphSvg = selectedTx.glyph?.svgContent ||
                  (typeof selectedTx.glyph?.imageRef === 'string' && selectedTx.glyph.imageRef.includes('<svg') ? selectedTx.glyph.imageRef : undefined) ||
                  generateClientGlyphSvg(selectedTx.glyph_hash || selectedTx.txid, selectedTx.glyph_edition, selectedTx.glyph?.rarity, selectedTx.glyph?.name);
                const cleanGlyphSvg = formatSvgForPreview(rawGlyphSvg, selectedTx.glyph_hash || selectedTx.txid || selectedTx.glyph_edition);
                const glyphImg = !cleanGlyphSvg ? resolveImageSource(selectedTx.glyph?.imageRef, NETWORK.DEFAULT_DAO_URL) : null;
                const rarityStyle = getRarityBadgeStyle(selectedTx.glyph?.rarity);

                return (
                  <div
                    style={{
                      margin: '14px auto 8px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 8,
                      flexShrink: 0,
                    }}
                  >
                    <div
                      onClick={() => rawGlyphSvg && openFullscreenSvg(rawGlyphSvg)}
                      style={{
                        width: 140,
                        height: 140,
                        borderRadius: 14,
                        background: '#020617',
                        border: `1.5px solid ${rarityStyle.border || 'rgba(6, 182, 212, 0.45)'}`,
                        boxShadow: '0 6px 20px rgba(0, 0, 0, 0.25), 0 0 16px rgba(6, 182, 212, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        padding: cleanGlyphSvg ? 6 : 0,
                        cursor: 'pointer',
                        position: 'relative',
                      }}
                      title="Click to open full-resolution SVG in new tab"
                    >
                      {cleanGlyphSvg ? (
                        <div
                          style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          dangerouslySetInnerHTML={{ __html: cleanGlyphSvg }}
                        />
                      ) : (
                        <img
                          src={glyphImg!}
                          alt={selectedTx.glyph?.name || 'Glyph'}
                          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        />
                      )}
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 5,
                          background: 'rgba(2, 6, 23, 0.85)',
                          backdropFilter: 'blur(4px)',
                          borderRadius: 10,
                          padding: '2px 8px',
                          fontSize: 8.5,
                          fontWeight: 600,
                          color: '#38BDF8',
                          border: '1px solid rgba(56, 189, 248, 0.35)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        <ExternalLink size={8.5} /> Expand Art
                      </div>
                    </div>
                    {rawGlyphSvg && (
                      <button
                        type="button"
                        onClick={() => openFullscreenSvg(rawGlyphSvg)}
                        style={{
                          background: '#EFF6FF',
                          border: '1px solid #BFDBFE',
                          borderRadius: 6,
                          color: '#2563EB',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '4px 10px',
                        }}
                      >
                        <ExternalLink size={11} /> Open Full Vector SVG ↗
                      </button>
                    )}
                  </div>
                );
              })()}

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    navigator.clipboard.writeText(selectedTx.txid);
                    setTxCopied(true);
                    setTimeout(() => setTxCopied(false), 2000);
                  }}
                  style={{
                    flex: 1,
                    height: 36,
                    fontSize: 12,
                    fontWeight: 600,
                    border: '1.5px solid #D1D5DB',
                    background: '#ffffff',
                    color: '#374151',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  {txCopied ? 'Copied!' : 'Copy Hash'}
                </button>
                <a
                  href={`${NETWORK.DEFAULT_EXPLORER_URL}/tx/${selectedTx.txid}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn"
                  style={{
                    flex: 1,
                    height: 36,
                    fontSize: 12,
                    fontWeight: 600,
                    background: '#2563EB',
                    color: '#ffffff',
                    borderRadius: 8,
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  Explorer ↗
                </a>
              </div>
            </div>
          )}

          {/* Modal: Receive / Deposit QR (Full popup white overlay) */}
          {activeModal === 'receive' && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: '#ffffff',
                display: 'flex',
                flexDirection: 'column',
                padding: '16px',
                zIndex: 60,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Receive QVNC</span>
                <button
                  type="button"
                  onClick={() => setActiveModal('none')}
                  style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', padding: 2 }}
                >
                  <X size={18} />
                </button>
              </div>

              <div style={{ textAlign: 'center', margin: 'auto 0' }}>
                <div
                  style={{
                    background: '#ffffff',
                    padding: 12,
                    borderRadius: 12,
                    border: '1px solid #E5E7EB',
                    display: 'inline-block',
                    marginBottom: 16,
                  }}
                >
                  <QRCode value={address} size={160} level="M" />
                </div>

                <div
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 11,
                    color: '#111827',
                    background: '#F9FAFB',
                    border: '1px solid #E5E7EB',
                    borderRadius: 8,
                    padding: '10px 12px',
                    wordBreak: 'break-all',
                    marginBottom: 16,
                  }}
                >
                  {address}
                </div>
              </div>

              <button
                type="button"
                className="btn"
                onClick={handleCopyAddress}
                style={{
                  width: '100%',
                  height: 36,
                  fontSize: 13,
                  fontWeight: 600,
                  background: '#2563EB',
                  color: '#ffffff',
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {copied ? 'Copied to Clipboard!' : 'Copy Address'}
              </button>
            </div>
          )}

          {/* Modal: Send (Full popup white overlay) */}
          {activeModal === 'send' && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: '#ffffff',
                display: 'flex',
                flexDirection: 'column',
                padding: '16px',
                zIndex: 60,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
                  {sendSuccessTxId ? 'Transfer Complete' : 'Send QVNC'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveModal('none');
                    setSendSuccessTxId('');
                    setSendError('');
                  }}
                  style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', padding: 2 }}
                >
                  <X size={18} />
                </button>
              </div>

              {sendSuccessTxId ? (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
                  <div style={{ textAlign: 'center', margin: 'auto 0' }}>
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: '50%',
                        background: '#D1FAE5',
                        color: '#10B981',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 12px',
                      }}
                    >
                      <Check size={28} />
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 4 }}>
                      Transaction Sent!
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#10B981', marginBottom: 16 }}>
                      -{Number(sendAmount).toFixed(2)} QVNC
                    </div>

                    <div
                      style={{
                        background: '#F9FAFB',
                        border: '1px solid #E5E7EB',
                        borderRadius: 8,
                        padding: 12,
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#6B7280' }}>Recipient</span>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: '#111827' }}>
                          {sendRecipient.slice(0, 6)}...{sendRecipient.slice(-4)}
                        </span>
                      </div>
                      <div>
                        <div style={{ color: '#6B7280', marginBottom: 2 }}>Transaction ID</div>
                        <div
                          style={{
                            fontFamily: 'ui-monospace, monospace',
                            fontSize: 11,
                            wordBreak: 'break-all',
                            color: '#111827',
                            background: '#ffffff',
                            padding: '6px 8px',
                            borderRadius: 6,
                            border: '1px solid #E5E7EB',
                          }}
                        >
                          {sendSuccessTxId}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setActiveModal('none');
                        setSendSuccessTxId('');
                        setSendRecipient('');
                        setSendAmount('');
                        setSendError('');
                      }}
                      style={{
                        flex: 1,
                        height: 38,
                        fontSize: 13,
                        fontWeight: 600,
                        border: '1.5px solid #D1D5DB',
                        background: '#ffffff',
                        color: '#374151',
                        borderRadius: 8,
                        cursor: 'pointer',
                      }}
                    >
                      Close
                    </button>
                    <a
                      href={`${NETWORK.DEFAULT_EXPLORER_URL}/tx/${sendSuccessTxId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn"
                      style={{
                        flex: 1,
                        height: 38,
                        fontSize: 13,
                        fontWeight: 600,
                        background: '#2563EB',
                        color: '#ffffff',
                        borderRadius: 8,
                        textDecoration: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      Explorer ↗
                    </a>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 'auto' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                        Recipient Address
                      </label>
                      <input
                        type="text"
                        className="tz-input"
                        placeholder="S..."
                        value={sendRecipient}
                        onChange={(e) => {
                          setSendRecipient(e.target.value);
                          setSendError('');
                        }}
                        style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
                      />
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <label style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>Amount</label>
                        <span style={{ fontSize: 11, color: '#9CA3AF' }}>Available: {balance} QVNC</span>
                      </div>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="tz-input"
                          placeholder="0.00"
                          value={sendAmount}
                          onChange={(e) => {
                            setSendAmount(e.target.value.replace(',', '.'));
                            setSendError('');
                          }}
                          style={{ paddingRight: 55 }}
                        />
                        <span style={{ position: 'absolute', right: 12, fontSize: 12, fontWeight: 600, color: '#2563EB' }}>
                          QVNC
                        </span>
                      </div>
                    </div>

                    {sendError && (
                      <div
                        style={{
                          background: '#FEF2F2',
                          border: '1px solid #FCA5A5',
                          borderRadius: 8,
                          padding: '8px 10px',
                          color: '#EF4444',
                          fontSize: 12,
                          fontWeight: 500,
                        }}
                      >
                        {sendError}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="btn"
                    disabled={!sendRecipient || !sendAmount || Number(sendAmount) <= 0 || sendBusy}
                    style={{
                      width: '100%',
                      height: 38,
                      fontSize: 13,
                      fontWeight: 600,
                      background: '#2563EB',
                      color: '#ffffff',
                      borderRadius: 8,
                      border: 'none',
                      opacity: sendRecipient && Number(sendAmount) > 0 && !sendBusy ? 1 : 0.5,
                      cursor: sendRecipient && Number(sendAmount) > 0 && !sendBusy ? 'pointer' : 'not-allowed',
                    }}
                    onClick={handleConfirmSend}
                  >
                    {sendBusy ? 'Broadcasting Transaction…' : 'Confirm & Send'}
                  </button>
                </>
              )}
            </div>
          )}
        </main>
      )}
    </>
  );
}
