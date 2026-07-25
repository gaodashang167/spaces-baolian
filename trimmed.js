const CFG = { id: '2523c510-9ff0-415b-9582-93949bfae7e3', chunk: 64 * 1024, dnPack: 32 * 1024, dnTail: 512, dnQr: 4, upPack: 20 * 1024, maxED: 8 * 1024, concur: 4, dproxy: 'ProxyIP.CMLiussss.net' };
export default { fetch: (req, env) => req.headers.get('Upgrade')?.toLowerCase() === 'websocket' ? ws(req, env) : new Response('Hello world!') }; const hex = c => (c > 64 ? c + 9 : c) & 0xF;
const dec = new TextDecoder();
const parseUUID = uuid => { const b = new Uint8Array(16); for (let i = 0, p = 0, c, h; i < 16; i++) { c = uuid.charCodeAt(p++); c === 45 && (c = uuid.charCodeAt(p++)); h = hex(c); c = uuid.charCodeAt(p++); c === 45 && (c = uuid.charCodeAt(p++)); b[i] = h << 4 | hex(c); } return b; };
const addr = (t, b) => t === 1 ? `${b[0]}.${b[1]}.${b[2]}.${b[3]}` : t === 3 ? dec.decode(b) : `[${Array.from({ length: 8 }, (_, i) => ((b[i * 2] << 8) | b[i * 2 + 1]).toString(16)).join(':')}]`;
const sprout = (f, h, p, opts, s = f.connect({ hostname: h, port: p }, opts)) => s.opened.then(() => s);
const raceSprout = (f, h, p, opts) => { if (!f?.connect) return Promise.reject(new Error('connect unavailable')); if (CFG.concur <= 1) return sprout(f, h, p, opts); const ts = Array(CFG.concur).fill().map(() => sprout(f, h, p, opts)); return Promise.any(ts).then(w => { ts.forEach(t => t.then(s => s !== w && s.close(), () => {})); return w; }); };

const parseAddr = (b, o, t) => { const l = t === 3 ? b[o++] : t === 1 ? 4 : t === 4 ? 16 : null; if (l === null) return null; const n = o + l; return n > b.length ? null : { targetAddrBytes: b.subarray(o, n), dataOffset: n }; };
const mkK = (cap, cpy = 0) => { let q = [], h = 0, b = 0, buf = null;
  const e = () => h >= q.length, trim = () => { h > 32 && h * 2 >= q.length && (q = q.slice(h), h = 0); }, clear = () => { q = []; h = 0; b = 0; };
  const take = () => { if (e()) return null; const d = q[h]; q[h++] = undefined; b -= d.byteLength; trim(); return d; };
  const sow = d => { const n = d?.byteLength || 0; return !n || (q.push(d), b += n, 1); };
  const pack = d => { d ||= take(); if (!d || e()) return [d, 0];
    let n = d.byteLength, j = h; while (j < q.length) { const x = q[j], nn = n + x.byteLength; if (nn > cap) break; n = nn; j++; }
    if (j === h) return [d, 0]; const out = buf ||= new Uint8Array(cap); out.set(d);
    for (let o = d.byteLength; h < j;) { const x = q[h]; q[h++] = undefined; b -= x.byteLength; out.set(x, o); o += x.byteLength; }
    trim(); const u = out.subarray(0, n); return [cpy ? u.slice() : u, 1]; };
  return { e, get b() { return b; }, clear, take, sow, pack }; };
const mkQ = cap => { const k = mkK(cap); return { get empty() { return k.e(); }, clear: k.clear, sow: k.sow, bundle: d => k.pack(d) }; };
const mkDn = w => { const cap = CFG.dnPack, tail = CFG.dnTail, low = Math.max(4096, tail * 12), k = mkK(cap, 1); let tp = 0, gen = 0, qk = 0, qr = 0;
  const reap = () => { tp && clearTimeout(tp); tp = 0; qr = 0; for (;;) { const [u] = k.pack(); if (!u) break; w.send(u); } };
  const ripen = () => { if (k.e() || tp) return; if (k.b >= cap || cap - k.b < tail) return reap(); tp = setTimeout(() => {
    tp = 0; if (k.e()) return; if (k.b >= cap || cap - k.b < tail) return reap();
    if (qr < CFG.dnQr && (gen !== qk || k.b < low)) { qr++; qk = gen; return ripen(); } reap(); }, 1); };
  return { send(u) { let o = 0, n = u?.byteLength || 0; if (!n) return; while (o < n) { const m = Math.min(cap - k.b, n - o); if (!m) { reap(); continue; }
      k.sow(o || m !== n ? u.subarray(o, o + m) : u); gen++; o += m; if (k.b >= cap || cap - k.b < tail) reap(); else ripen(); } }, reap }; };
const mill = async (rd, w) => { let r, byob = 1; try { r = rd.getReader({ mode: 'byob' }); } catch { byob = 0; r = rd.getReader(); } const tx = mkDn(w);
  if (byob) { let buf = new ArrayBuffer(CFG.chunk);
    try { for (;;) { const { done, value: v } = await r.read(new Uint8Array(buf, 0, CFG.chunk)); if (done) break; if (!v?.byteLength) continue; if (v.byteLength >= (CFG.chunk >> 1)) tx.reap(), w.send(v), buf = new ArrayBuffer(CFG.chunk); else tx.send(v.slice()), buf = v.buffer; } tx.reap(); } catch {} finally { try { tx.reap(); } catch {} try { r.releaseLock(); } catch {} } return; }
  // 非字节流（如 TURN/SSTP 自建的虚拟 TCP 流）不支持 BYOB，降级为普通 reader 循环
  try { for (;;) { const { done, value: v } = await r.read(); if (done) break; if (!v?.byteLength) continue; if (v.byteLength >= (CFG.chunk >> 1)) tx.reap(), w.send(v); else tx.send(v); } tx.reap(); } catch {} finally { try { tx.reap(); } catch {} try { r.releaseLock(); } catch {} } };
// ---- 反代链式协议：路径 target 解析（host/port/user/pass，支持 IPv6 [::]） ----
// /video/<加密串> 路径格式用的解密函数：明文按 UTF-8 转字节后与密钥（UUID字符串本身，含横杠）逐字节重复异或，再 base64；解密是逆过程
const base64SecretDecode = (encoded, secret) => {
  const binary = atob(encoded); const mixed = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) mixed[i] = binary.charCodeAt(i);
  const key = new TextEncoder().encode(secret); const data = new Uint8Array(mixed.length);
  for (let i = 0; i < mixed.length; i++) data[i] = mixed[i] ^ key[i % key.length];
  return new TextDecoder().decode(data);
};
// ---- 反代链式协议：路径 target 解析，对齐 edgetunnel 真实源码的「获取SOCKS5账号」函数 ----
// 账号密码支持 base64（自动识别：不含 ':' 且匹配 base64 字符集才解码，否则按明文处理）；IPv6 保留方括号；端口解析用去除非数字字符而非 parseInt 截断
const B64RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const pTarget = (raw, defPort) => {
  let address = String(raw || '').trim().replace(/^(socks5|http|https|turn|sstp):\/\//i, '').split('#')[0].trim();
  let user = '', pass = '';
  const at = address.lastIndexOf('@');
  if (at > -1) {
    let auth = address.slice(0, at).replaceAll('%3D', '=');
    if (!auth.includes(':') && B64RE.test(auth)) { try { auth = atob(auth); } catch {} }
    const ci = auth.indexOf(':');
    if (ci > -1) { user = auth.slice(0, ci); pass = auth.slice(ci + 1); } else user = auth;
    address = address.slice(at + 1);
  }
  const hostPart = address.split('/')[0];
  let host = hostPart, port = defPort;
  if (hostPart.includes(']:')) {
    const idx = hostPart.indexOf(']:');
    host = hostPart.slice(0, idx + 1); // 保留方括号，和真实实现一致
    port = parseInt(hostPart.slice(idx + 2).replace(/[^\d]/g, ''), 10) || defPort;
  } else if (!hostPart.startsWith('[')) {
    const parts = hostPart.split(':');
    if (parts.length === 2) { host = parts[0]; port = parseInt(parts[1].replace(/[^\d]/g, ''), 10) || defPort; }
  }
  return { user, pass, host, port };
};
const v6b = host => { const dc = host.indexOf('::'); let head = [], tail = []; if (dc > -1) { const l = host.slice(0, dc), r = host.slice(dc + 2); head = l ? l.split(':') : []; tail = r ? r.split(':') : []; } else head = host.split(':'); const miss = 8 - (head.length + tail.length); const g = [...head, ...Array(Math.max(0, miss)).fill('0'), ...tail]; const out = new Uint8Array(16); for (let i = 0; i < 8; i++) { const v = parseInt(g[i] || '0', 16) || 0; out[i * 2] = (v >> 8) & 0xFF; out[i * 2 + 1] = v & 0xFF; } return out; };
const mkRB = reader => { let buf = new Uint8Array(0); const fill = async () => { const { value, done } = await reader.read(); if (done) throw new Error('proxy closed'); const n = new Uint8Array(buf.byteLength + value.byteLength); n.set(buf); n.set(value, buf.byteLength); buf = n; }; return { need: async n => { while (buf.byteLength < n) await fill(); const out = buf.subarray(0, n); buf = buf.subarray(n); return out; }, get rest() { return buf; } }; };
// SOCKS5 握手（RFC 1928/1929）：返回握手后残留在缓冲区里、已属于目标数据流的字节
const doSocks5 = async (sock, user, pass, host, port) => {
  const w = sock.writable.getWriter(), hr = sock.readable.getReader(), rb = mkRB(hr), enc = new TextEncoder();
  const methods = user ? [0x00, 0x02] : [0x00];
  await w.write(new Uint8Array([0x05, methods.length, ...methods]));
  const greet = await rb.need(2); if (greet[0] !== 0x05) throw new Error('socks5 bad version');
  if (greet[1] === 0x02) { if (!user) throw new Error('socks5 auth required'); const ub = enc.encode(user), pb = enc.encode(pass); await w.write(new Uint8Array([0x01, ub.byteLength, ...ub, pb.byteLength, ...pb])); const ar = await rb.need(2); if (ar[1] !== 0x00) throw new Error('socks5 auth failed'); }
  else if (greet[1] !== 0x00) throw new Error('socks5 no acceptable method');
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(host), isV6 = !ipv4 && host.includes(':'); let atyp, ab;
  if (ipv4) { atyp = 0x01; ab = new Uint8Array(host.split('.').map(Number)); }
  else if (isV6) { atyp = 0x04; ab = v6b(host.startsWith('[') ? host.slice(1, -1) : host); }
  else { atyp = 0x03; const hb = enc.encode(host); ab = new Uint8Array(1 + hb.byteLength); ab[0] = hb.byteLength; ab.set(hb, 1); }
  const req = new Uint8Array(4 + ab.byteLength + 2); req.set([0x05, 0x01, 0x00, atyp]); req.set(ab, 4); req[req.byteLength - 2] = (port >> 8) & 0xFF; req[req.byteLength - 1] = port & 0xFF;
  await w.write(req);
  const head = await rb.need(4); if (head[1] !== 0x00) throw new Error('socks5 connect failed ' + head[1]);
  const ratyp = head[3]; const alen = ratyp === 0x01 ? 4 : ratyp === 0x04 ? 16 : ratyp === 0x03 ? (await rb.need(1))[0] : 0;
  await rb.need(alen + 2); const leftover = rb.rest.slice(); w.releaseLock(); hr.releaseLock(); return leftover; };
// ---- TURN TCP relay（RFC 5766/6062/8489），移植自 ToiCF/CF-Workers-TURN 的 Turn.js（仅支持 IPv4 目标，与参考实现一致；MD5 用 crypto.subtle.digest，经参考项目验证 CF Workers 运行时支持）----
const cat = (...a) => { const r = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); a.reduce((o, x) => (r.set(x, o), o + x.length), 0); return r; };
const MAGIC = new Uint8Array([0x21, 0x12, 0xA4, 0x42]);
const TMT = { AQ: 0x003, AO: 0x103, AE: 0x113, PQ: 0x008, PO: 0x108, CQ: 0x00A, CO: 0x10A, BQ: 0x00B, BO: 0x10B };
const TAT = { USER: 0x006, MI: 0x008, ERR: 0x009, PEER: 0x012, REALM: 0x014, NONCE: 0x015, TRANSPORT: 0x019, CONNID: 0x02A };
const tAttr = (t, v) => { const b = new Uint8Array(4 + v.length + (4 - v.length % 4) % 4), d = new DataView(b.buffer); d.setUint16(0, t); d.setUint16(2, v.length); b.set(v, 4); return b; };
const tMsg = (t, tid, a) => { const bd = cat(...a), h = new Uint8Array(20), d = new DataView(h.buffer); d.setUint16(0, t); d.setUint16(2, bd.length); h.set(MAGIC, 4); h.set(tid, 8); return cat(h, bd); };
const xorPeer = (ip, port) => { const b = new Uint8Array(8); b[1] = 1; new DataView(b.buffer).setUint16(2, port ^ 0x2112); ip.split('.').forEach((v, i) => b[4 + i] = +v ^ MAGIC[i]); return b; };
const parseStunT = d => {
  if (d.length < 20 || MAGIC.some((v, i) => d[4 + i] !== v)) return null;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), ml = dv.getUint16(2), attrs = {};
  for (let o = 20; o + 4 <= 20 + ml;) { const t = dv.getUint16(o), l = dv.getUint16(o + 2); if (o + 4 + l > d.length) break; attrs[t] = d.slice(o + 4, o + 4 + l); o += 4 + l + (4 - l % 4) % 4; }
  return { type: dv.getUint16(0), attrs }; };
const parseErrT = d => d?.length >= 4 ? (d[2] & 7) * 100 + d[3] : 0;
const addIntegrityT = async (m, key) => { const c = new Uint8Array(m), d = new DataView(c.buffer); d.setUint16(2, d.getUint16(2) + 24); const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']); return cat(c, tAttr(TAT.MI, new Uint8Array(await crypto.subtle.sign('HMAC', k, c)))); };
const readStunT = async (rd, buf) => {
  let b = buf ?? new Uint8Array(0); const pull = async () => { const { done, value } = await rd.read(); if (done) throw 0; b = cat(b, new Uint8Array(value)); };
  try { while (b.length < 20) await pull(); const n = 20 + (b[2] << 8 | b[3]); while (b.length < n) await pull();
    return [parseStunT(b.subarray(0, n)), b.length > n ? b.subarray(n) : null]; } catch { return [null, null]; } };
const md5t = async s => new Uint8Array(await crypto.subtle.digest('MD5', new TextEncoder().encode(s)));
// 域名解析（TURN/SSTP 的目标只支持 IPv4，走 CF DoH A 记录解析）
const resolveIPv4 = async h => /^\d+\.\d+\.\d+\.\d+$/.test(h) ? h : (await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(h)}&type=A`, { headers: { Accept: 'application/dns-json' } }).then(r => r.json()).catch(() => ({}))).Answer?.find(a => a.type === 1)?.data ?? null;
const doTurn = async (fetcher, chainHost, chainPort, user, pass, targetHost, targetPort) => {
  const ip = await resolveIPv4(targetHost); if (!ip) throw new Error('turn: target must resolve to IPv4');
  const ctrl = await raceSprout(fetcher, chainHost, chainPort);
  const cw = ctrl.writable.getWriter(), cr = ctrl.readable.getReader(), tid = () => crypto.getRandomValues(new Uint8Array(12)), tp = new Uint8Array([6, 0, 0, 0]);
  const closeAll = (...s) => s.forEach(x => { try { x?.close(); } catch {} });
  await cw.write(tMsg(TMT.AQ, tid(), [tAttr(TAT.TRANSPORT, tp)]));
  let [r, ex] = await readStunT(cr); if (!r) { closeAll(ctrl); throw new Error('turn: no allocate response'); }
  let key = null, aa = []; let data;
  const sign = m => key ? addIntegrityT(m, key) : m, peer = tAttr(TAT.PEER, xorPeer(ip, targetPort));
  if (r.type === TMT.AE && user && parseErrT(r.attrs[TAT.ERR]) === 401) {
    const realm = new TextDecoder().decode(r.attrs[TAT.REALM] ?? new Uint8Array(0)), nonce = r.attrs[TAT.NONCE] ?? new Uint8Array(0);
    key = await md5t(`${user}:${realm}:${pass}`);
    aa = [tAttr(TAT.USER, new TextEncoder().encode(user)), tAttr(TAT.REALM, new TextEncoder().encode(realm)), tAttr(TAT.NONCE, nonce)];
    const [am, pm, cm] = await Promise.all([sign(tMsg(TMT.AQ, tid(), [tAttr(TAT.TRANSPORT, tp), ...aa])), sign(tMsg(TMT.PQ, tid(), [peer, ...aa])), sign(tMsg(TMT.CQ, tid(), [peer, ...aa]))]);
    await cw.write(cat(am, pm, cm)); data = await raceSprout(fetcher, chainHost, chainPort);
    [r, ex] = await readStunT(cr, ex); if (r?.type !== TMT.AO) { closeAll(ctrl, data); throw new Error('turn: allocate failed after auth'); }
  } else if (r.type === TMT.AO) {
    const [pm, cm] = await Promise.all([sign(tMsg(TMT.PQ, tid(), [peer, ...aa])), sign(tMsg(TMT.CQ, tid(), [peer, ...aa]))]);
    await cw.write(cat(pm, cm)); data = await raceSprout(fetcher, chainHost, chainPort);
  } else { closeAll(ctrl); throw new Error('turn: allocate rejected'); }
  [r, ex] = await readStunT(cr, ex); if (r?.type !== TMT.PO) { closeAll(ctrl, data); throw new Error('turn: createpermission failed'); }
  [r, ex] = await readStunT(cr, ex); if (r?.type !== TMT.CO || !r.attrs[TAT.CONNID]) { closeAll(ctrl, data); throw new Error('turn: connect failed'); }
  const dw = data.writable.getWriter(), dr = data.readable.getReader();
  await dw.write(await sign(tMsg(TMT.BQ, tid(), [tAttr(TAT.CONNID, r.attrs[TAT.CONNID]), ...aa])));
  let extra; [r, extra] = await readStunT(dr); if (r?.type !== TMT.BO) { closeAll(ctrl, data); throw new Error('turn: connectionbind failed'); }
  cr.releaseLock(); cw.releaseLock(); dw.releaseLock(); dr.releaseLock();
  return { sock: data, leftover: extra || null, extra: ctrl }; };
// ---- SSTP(SoftEther) 反代，移植自 ToiCF/CF-Workers-SoftEther 的 Softether.js ----
// 完整 SSTP(HTTPS隧道) + PPP(LCP/PAP/IPCP) 协商 + 手工构造 IPv4/TCP 报文实现的用户态 TCP 出站链路
// 仅支持 IPv4 目标（手工 IP 包构造是 IPv4-only，与参考实现一致，不支持 IPv6 目标）
// PAP 账号密码：路径提供了 user/pass 则使用自定义账号；未提供则回退参考项目默认的 VPN Gate 访客账号 "vpn"/"vpn"
const su16 = (b, o) => b[o] << 8 | b[o + 1], su32 = (b, o) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
const srng = n => crypto.getRandomValues(new Uint8Array(n)), srng16 = () => su16(srng(2), 0), srng32 = () => su32(srng(4), 0);
const sipB = ip => new Uint8Array(ip.split('.').map(Number)), sE = new Uint8Array(0), sMSS = 1400;
const sPapDefault = new TextEncoder().encode(atob('dnBu')); // "vpn"，参考实现的 VPN Gate 访客默认账号
const scksum = (d, o, n) => { let s = 0; for (let i = o; i < o + n - 1; i += 2) s += su16(d, i); if (n & 1) s += d[o + n - 1] << 8; while (s >> 16) s = (s & 0xFFFF) + (s >> 16); return (~s) & 0xFFFF; };
const createSstp = () => {
  let buf = sE, pppId = 1, sock, rd, wr, host, rb = new ArrayBuffer(65536);
  const readBytes = async n => {
    if (buf.length >= n) { const r = buf.subarray(0, n); buf = buf.subarray(n); return r; }
    const saved = buf.length > 0 ? new Uint8Array(buf) : null, need = n - buf.length;
    const { value, done } = await rd.readAtLeast(need, new Uint8Array(rb, 0, 65536));
    if (done) throw 0; rb = value.buffer;
    if (saved) { const t = cat(saved, value); buf = t.subarray(n); return t.subarray(0, n); }
    buf = value.subarray(n); return value.subarray(0, n); };
  const readLine = async () => {
    for (;;) { const i = buf.indexOf(10);
      if (i >= 0) { let l = new TextDecoder().decode(buf.subarray(0, i)); buf = buf.subarray(i + 1); return l.replace(/\r$/, ''); }
      const saved = buf.length > 0 ? new Uint8Array(buf) : null;
      const { value, done } = await rd.readAtLeast(1, new Uint8Array(rb, 0, 65536));
      if (done) throw 0; rb = value.buffer; buf = saved ? cat(saved, value) : value; } };
  const readPkt = async (ms = 10000) => {
    let t; const to = new Promise((_, rej) => { t = setTimeout(() => rej('T'), ms); });
    try { const h = await Promise.race([readBytes(4), to]); clearTimeout(t); const len = su16(h, 2) & 0xFFF;
      return { ctrl: (h[1] & 1) !== 0, body: len > 4 ? await readBytes(len - 4) : sE }; } catch (e) { clearTimeout(t); throw e; } };
  const sstpData = f => { const n = 6 + f.length, p = new Uint8Array(n); p.set([0x10, 0, ((n >> 8) & 0xF) | 0x80, n & 0xFF, 0xFF, 0x03]); p.set(f, 6); return p; };
  const sstpCtrl = (mt, attrs = []) => {
    const al = attrs.reduce((s, a) => s + 4 + a.data.length, 0), p = new Uint8Array(8 + al), v = new DataView(p.buffer);
    p[0] = 0x10; p[1] = 0x01; v.setUint16(2, (8 + al) | 0x8000); v.setUint16(4, mt); v.setUint16(6, attrs.length);
    attrs.reduce((o, a) => (p[o + 1] = a.id, v.setUint16(o + 2, 4 + a.data.length), p.set(a.data, o + 4), o + 4 + a.data.length), 8);
    return p; };
  const ppp = (proto, code, id, opts = []) => {
    const ol = opts.reduce((s, o) => s + 2 + o.data.length, 0), f = new Uint8Array(6 + ol), v = new DataView(f.buffer);
    v.setUint16(0, proto); f[2] = code; f[3] = id; v.setUint16(4, 4 + ol);
    opts.reduce((o, x) => (f[o] = x.type, f[o + 1] = 2 + x.data.length, f.set(x.data, o + 2), o + 2 + x.data.length), 6);
    return f; };
  const pap = (id, userB, passB) => { const tl = 6 + 1 + userB.length + 1 + passB.length, f = new Uint8Array(2 + tl), v = new DataView(f.buffer);
    v.setUint16(0, 0xc023); f[2] = 1; f[3] = id; v.setUint16(4, tl); f[6] = userB.length; f.set(userB, 7); f[7 + userB.length] = passB.length; f.set(passB, 8 + userB.length); return f; };
  const parsePPP = d => { let o = d.length >= 2 && d[0] === 0xFF && d[1] === 0x03 ? 2 : 0; if (d.length - o < 4) return null;
    const p = su16(d, o); return p === 0x0021 ? { protocol: p, ip: d.subarray(o + 2) } : d.length - o >= 6 ? { protocol: p, code: d[o + 2], id: d[o + 3], payload: d.subarray(o + 6), raw: d.subarray(o) } : null; };
  const parseOpts = d => { const r = []; for (let i = 0; i + 2 <= d.length;) { const t = d[i], l = d[i + 1]; if (l < 2 || i + l > d.length) break; r.push({ type: t, data: d.subarray(i + 2, i + l) }); i += l; } return r; };
  const connect_ = async (fetcher, h, p) => { sock = await raceSprout(fetcher, h, p, { secureTransport: 'on' });
    rd = sock.readable.getReader({ mode: 'byob' }); wr = sock.writable.getWriter(); host = h; };
  const establish = async (userB, passB) => {
    const http = new TextEncoder().encode(`SSTP_DUPLEX_POST /sra_{BA195980-CD49-458b-9E23-C84EE0ADCD75}/ HTTP/1.1\r\nHost: ${host}\r\nContent-Length: 18446744073709551615\r\nSSTPCORRELATIONID: {${crypto.randomUUID()}}\r\n\r\n`);
    const pa = new Uint8Array(2); new DataView(pa.buffer).setUint16(0, 1); const mru = new Uint8Array(2); new DataView(mru.buffer).setUint16(0, 1500);
    await wr.write(cat(http, sstpCtrl(0x0001, [{ id: 1, data: pa }]), sstpData(ppp(0xc021, 1, pppId++, [{ type: 1, data: mru }]))));
    const st = await readLine(); while ((await readLine()) !== ''); if (!st.includes('200')) throw 0;
    let sa = false, ld = false, auth = false, done = false, myIp = null;
    for (let r = 0; r < 25 && !done; r++) {
      const pk = await readPkt(); if (pk.ctrl) { if (!sa && pk.body.length >= 2 && su16(pk.body, 0) === 2) sa = true; continue; }
      const pp = parsePPP(pk.body); if (!pp) continue;
      if (pp.protocol === 0xc021) {
        if (pp.code === 1) { const a = new Uint8Array(pp.raw); a[2] = 2;
          await wr.write(ld && !auth ? cat(sstpData(a), sstpData(pap(pppId++, userB, passB))) : sstpData(a)); if (ld) auth = true;
        } else if (pp.code === 2) { ld = true; if (!auth) { await wr.write(sstpData(pap(pppId++, userB, passB))); auth = true; } }
      } else if (pp.protocol === 0xc023 && pp.code === 2) await wr.write(sstpData(ppp(0x8021, 1, pppId++, [{ type: 3, data: new Uint8Array(4) }])));
      else if (pp.protocol === 0x8021) {
        if (pp.code === 1) { const a = new Uint8Array(pp.raw); a[2] = 2; await wr.write(sstpData(a)); }
        else if (pp.code === 3) { const o = parseOpts(pp.payload).find(x => x.type === 3); if (o) { myIp = [...o.data].join('.'); await wr.write(sstpData(ppp(0x8021, 1, pppId++, [{ type: 3, data: o.data }]))); } }
        else if (pp.code === 2) { const o = parseOpts(pp.payload).find(x => x.type === 3); if (o) myIp = [...o.data].join('.'); done = true; }
      } }
    if (!myIp) throw 0; return myIp; };
  const close = () => { [rd, wr, sock].forEach(x => { try { x?.cancel?.() ?? x?.close?.(); } catch {} }); };
  return { connect: connect_, establish, readPkt, parsePPP, get buf() { return buf; }, get wr() { return wr; }, close }; };
const createTcp = (sstp, srcIp, dstIp, dstPort) => {
  const srcPort = 10000 + (srng16() % 50000), srcB = sipB(srcIp), dstB = sipB(dstIp);
  let seq = srng32(), ack = 0;
  const ipTpl = new Uint8Array(20); ipTpl.set([0x45, 0, 0, 0, 0, 0, 0x40, 0, 64, 6]); ipTpl.set(srcB, 12); ipTpl.set(dstB, 16);
  const pseudo = new Uint8Array(1432); pseudo.set(srcB); pseudo.set(dstB, 4); pseudo[9] = 6;
  const frame = (flags, data = sE) => {
    const pl = data.length, tl = 20 + pl, il = 20 + tl, st = 8 + il, f = new Uint8Array(st), v = new DataView(f.buffer);
    f.set([0x10, 0, ((st >> 8) & 0xF) | 0x80, st & 0xFF, 0xFF, 0x03, 0, 0x21]); f.set(ipTpl, 8);
    v.setUint16(10, il); v.setUint16(12, srng16()); v.setUint16(18, scksum(f, 8, 20));
    v.setUint16(28, srcPort); v.setUint16(30, dstPort); v.setUint32(32, seq); v.setUint32(36, ack);
    f[40] = 0x50; f[41] = flags; v.setUint16(42, 65535); if (pl) f.set(data, 48);
    pseudo[10] = tl >> 8; pseudo[11] = tl & 0xFF; pseudo.set(f.subarray(28, 28 + tl), 12);
    v.setUint16(44, scksum(pseudo, 0, 12 + tl)); return f; };
  const match = ip => { if (ip.length < 40 || ip[9] !== 6) return null; const ihl = (ip[0] & 0xF) * 4;
    if (su16(ip, ihl) !== dstPort || su16(ip, ihl + 2) !== srcPort) return null;
    return { flags: ip[ihl + 13], seq: su32(ip, ihl + 4), off: ihl + ((ip[ihl + 12] >> 4) & 0xF) * 4 }; };
  const handshake = async () => {
    await sstp.wr.write(frame(0x02)); seq++;
    for (let i = 0; i < 30; i++) { const pk = await sstp.readPkt(); if (pk.ctrl) continue;
      const pp = sstp.parsePPP(pk.body); if (!pp || pp.protocol !== 0x0021) continue;
      const m = match(pp.ip); if (!m || (m.flags & 0x12) !== 0x12) continue;
      ack = (m.seq + 1) >>> 0; sstp.wr.write(frame(0x10)); return true; }
    throw 0; };
  return { frame, match, handshake, get seq() { return seq; }, set seq(v) { seq = v; }, get ack() { return ack; }, set ack(v) { ack = v; } }; };
const sstpConn = async (fetcher, sstpHost, sstpPort, ipP, targetPort, userB, passB) => {
  const sstp = createSstp(), close = () => sstp.close();
  try {
    await sstp.connect(fetcher, sstpHost, sstpPort);
    const [myIp, targetIp] = await Promise.all([sstp.establish(userB, passB), ipP]); if (!targetIp) { close(); return null; }
    const tcp = createTcp(sstp, myIp, targetIp, targetPort); await tcp.handshake();
    let ctrl = null;
    const readable = new ReadableStream({ start: c => { ctrl = c; }, cancel: close });
    (async () => {
      try { let pend = [], pLen = 0;
        const flush = () => { if (!pLen) return; ctrl.enqueue(pend.length === 1 ? pend[0] : cat(...pend)); pend = []; pLen = 0; sstp.wr.write(tcp.frame(0x10)).catch(() => {}); };
        for (;;) { const pk = await sstp.readPkt(60000); if (pk.ctrl) continue;
          const pp = sstp.parsePPP(pk.body); if (!pp || pp.protocol !== 0x0021) continue;
          const m = tcp.match(pp.ip); if (!m) continue;
          if (m.off < pp.ip.length) { const d = pp.ip.subarray(m.off); if (d.length) { tcp.ack = (m.seq + d.length) >>> 0; pend.push(new Uint8Array(d)); pLen += d.length; } }
          if (m.flags & 0x01) { flush(); tcp.ack = (tcp.ack + 1) >>> 0; sstp.wr.write(tcp.frame(0x11)).catch(() => {}); ctrl.close(); return; }
          if (sstp.buf.length < 4 || pLen >= 32768) flush(); }
      } catch { try { ctrl.close(); } catch {} } })();
    const writable = new WritableStream({
      async write(chunk) { const d = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        if (d.length <= sMSS) { await sstp.wr.write(tcp.frame(0x18, d)); tcp.seq = (tcp.seq + d.length) >>> 0; return; }
        const frames = []; for (let o = 0; o < d.length; o += sMSS) { const seg = d.subarray(o, Math.min(o + sMSS, d.length)); frames.push(tcp.frame(0x18, seg)); tcp.seq = (tcp.seq + seg.length) >>> 0; }
        await sstp.wr.write(cat(...frames)); }, close: () => sstp.wr.write(tcp.frame(0x11)).catch(() => {}), abort: close });
    return { readable, writable, close };
  } catch { close(); return null; } };
const doSstp = async (fetcher, chain, host, port) => {
  const ipP = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host : resolveIPv4(host);
  const userB = chain.user ? new TextEncoder().encode(chain.user) : sPapDefault;
  const passB = chain.pass ? new TextEncoder().encode(chain.pass) : sPapDefault;
  const sock = await sstpConn(fetcher, chain.host, chain.port, ipP, port, userB, passB);
  if (!sock) throw new Error('sstp: connection failed'); return sock; };
// HTTP(S) CONNECT 隧道；https 模式下 sock 本身已是 TLS（见 chainConnect 的 secureTransport）
const doHttpConnect = async (sock, user, pass, host, port) => {
  const w = sock.writable.getWriter(), hr = sock.readable.getReader(), rb = mkRB(hr), enc = new TextEncoder(), dec = new TextDecoder();
  const hh = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  let req = `CONNECT ${hh}:${port} HTTP/1.1\r\nHost: ${hh}:${port}\r\nProxy-Connection: Keep-Alive\r\n`;
  if (user) req += `Proxy-Authorization: Basic ${btoa(`${user}:${pass}`)}\r\n`; req += '\r\n';
  await w.write(enc.encode(req));
  let head = new Uint8Array(0);
  for (;;) { const b = await rb.need(1); const n = new Uint8Array(head.byteLength + 1); n.set(head); n.set(b, head.byteLength); head = n; if (head.byteLength >= 4 && head[head.byteLength - 4] === 13 && head[head.byteLength - 3] === 10 && head[head.byteLength - 2] === 13 && head[head.byteLength - 1] === 10) break; if (head.byteLength > 8192) throw new Error('http proxy header too large'); }
  const statusLine = dec.decode(head).split('\r\n')[0]; if (!/\s2\d\d(\s|$)/.test(statusLine)) throw new Error('http proxy: ' + statusLine);
  const leftover = rb.rest.slice(); w.releaseLock(); hr.releaseLock(); return leftover; };
// 反代协议分发：socks5/http/https/turn/sstp 全部走真实协议实现
const chainConnect = async (fetcher, chain, host, port) => {
  if (chain.proto === 'socks5') { const sock = await raceSprout(fetcher, chain.host, chain.port); const leftover = await doSocks5(sock, chain.user, chain.pass, host, port); return { sock, leftover }; }
  if (chain.proto === 'http') { const sock = await raceSprout(fetcher, chain.host, chain.port); const leftover = await doHttpConnect(sock, chain.user, chain.pass, host, port); return { sock, leftover }; }
  // https：代理主机是域名走原生 secureTransport（快，Cloudflare 原生 TLS 校验证书）；是裸IP则原生TLS无法校验证书，改走 Mini TLS（跳过校验），对齐 edgetunnel 的 isIPHostname 判断逻辑
  if (chain.proto === 'https') {
    const sock = await raceSprout(fetcher, chain.host, chain.port, { secureTransport: 'on' }); const leftover = await doHttpConnect(sock, chain.user, chain.pass, host, port); return { sock, leftover };
  }
  if (chain.proto === 'turn') { return doTurn(fetcher, chain.host, chain.port, chain.user, chain.pass, host, port); }
  if (chain.proto === 'sstp') { const sock = await doSstp(fetcher, chain, host, port); return { sock, leftover: null }; }
  const sock = await raceSprout(fetcher, chain.host, chain.port); return { sock, leftover: null }; };
const ws = async (req, env) => {
  const [client, server] = Object.values(new WebSocketPair()); server.accept({ allowHalfOpen: true }); server.binaryType = 'arraybuffer'; const fetcher = req.fetcher; const _url = new URL(req.url);
  // UUID：env.UUID 优先，未设置则用 CFG.id 默认值（同 PROXYIP 的优先级模式）；relay/matchID 每次连接内按此生成，因为 env 只在请求时可得
  const _uuidStr = (env?.UUID || CFG.id).trim();
  const idB = parseUUID(_uuidStr);
  const matchID = c => { for (let i = 0; i < 16; i++) if (c[i + 1] !== idB[i]) return false; return true; };
  const relay = c => { if (c.length < 24 || !matchID(c)) return null; let o = 19 + c[17]; const p = (c[o] << 8) | c[o + 1]; let t = c[o + 2]; if (t !== 1) t += 1; const a = parseAddr(c, o + 3, t); return a ? { addrType: t, ...a, port: p } : null; };
  const edStr = req.headers.get('sec-websocket-protocol'); const _edMax = _url.searchParams.has('ed') ? (parseInt(_url.searchParams.get('ed')) || 0) : CFG.maxED; const ed = edStr && _edMax > 0 && edStr.length <= _edMax * 4 / 3 + 4 ? /** @type {*} */ (Uint8Array).fromBase64(edStr, { alphabet: 'base64url' }) : null; let curW = null, sock = null, extraSock = null, closed = false, busy = false;
  const uq = mkQ(CFG.upPack);
  // extraSock：TURN 的控制连接（承载 allocation），必须和数据连接同生命周期，否则 allocation 被回收、数据连接跟着断
  const wither = () => { if (closed) return; closed = true; uq.clear(); try { curW?.releaseLock(); } catch {} try { sock?.close(); } catch {} try { extraSock?.close(); } catch {} try { server.close(); } catch {} };
  const toU8 = d => d instanceof Uint8Array ? d : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d);
  const sow = d => { const u = toU8(d), n = u.byteLength; if (!n) return 1; if (uq.sow(u)) return 1; wither(); return 0; };
  // 反代模式解析，对齐 edgetunnel 真实源码：/video/<加密串> 优先级最高（整块JSON配置，恒定全局），
  // 解密/解析失败则静默降级到下面的三层路径正则 + query 参数形式：
  // 第一层 /(socks5?|http|https|turn|sstp):// 或 :/ 或 :（0~2个斜杠都认）→ 默认全局，不走直连
  // 第二层 /xxx=value 或 /gxxx=value（g前缀=全局，否则=直连优先失败降级），支持 s5/gs5 短别名
  // 第三层（都没匹配到时）用 ?socks5=/?http=/?https=/?turn=/?sstp= 查询参数，?globalproxy 单独控制全局
  const _defPort = { socks5: 1080, http: 80, https: 443, turn: 3478, sstp: 443 };
  const _normProto = kw => kw.includes('sstp') ? 'sstp' : kw.includes('turn') ? 'turn' : kw.includes('https') ? 'https' : kw.includes('http') ? 'http' : 'socks5';
  let chain = null;
  const _videoM = decodeURIComponent(_url.pathname).match(/\/video\/(.+)$/i);
  if (_videoM) { try { const plain = base64SecretDecode(_videoM[1], _uuidStr); const { type, ...addrObj } = JSON.parse(plain);
    const proto = String(type || '').toLowerCase(); if (!proto || !_defPort[proto]) throw new Error('链式代理类型无效');
    if (!addrObj.hostname || !addrObj.port) throw new Error('链式代理地址缺少 hostname 或 port');
    const port = Number(addrObj.port); if (isNaN(port)) throw new Error('链式代理端口无效');
    chain = { proto, global: true, user: addrObj.username || '', pass: addrObj.password || '', host: addrObj.hostname, port };
  } catch {} }
  let _cm = chain ? null : _url.pathname.match(/\/(socks5?|https|http|turn|sstp):\/?\/?([^/?#\s]+)/i);
  if (_cm) { const proto = _normProto(_cm[1].toLowerCase()); chain = { proto, global: true, ...pTarget(_cm[2], _defPort[proto]) }; }
  else if (!chain && (_cm = _url.pathname.match(/\/(g?s5|socks5|g?http|g?https|g?turn|g?sstp)=([^/?#\s]+)/i))) { const kw = _cm[1].toLowerCase(); const proto = _normProto(kw); chain = { proto, global: kw.startsWith('g'), ...pTarget(_cm[2], _defPort[proto]) }; }
  else if (!chain) { const qProto = ['socks5', 'http', 'https', 'turn', 'sstp'].find(p => _url.searchParams.has(p)); if (qProto) chain = { proto: qProto, global: _url.searchParams.has('globalproxy'), ...pTarget(_url.searchParams.get(qProto), _defPort[qProto]) }; }
  // PROXYIP：路径（含 proxyip./pyip=/ip= 别名）> query ?proxyip= > env 变量 > 默认兜底域名；不支持全局，始终「直连优先，失败降级」
  const _pathPxyRaw = chain ? '' : (_url.pathname.match(/\/(?:proxyip[.=]|pyip=|ip=)([^?#\s]+)/i)?.[1] || _url.searchParams.get('proxyip') || '');
  const proxyList = (_pathPxyRaw || (env?.PROXYIP || '') || CFG.dproxy).trim().split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  const pickProxy = () => { if (!proxyList.length) return null; const raw = proxyList[Math.floor(Math.random() * proxyList.length)]; if (raw.includes(']:')) { const idx = raw.indexOf(']:'); const h = raw.slice(0, idx + 1), p = parseInt(raw.slice(idx + 2).replace(/[^\d]/g, ''), 10); return { h, p: p > 0 && p < 65536 ? p : null }; } if (raw.startsWith('[')) return { h: raw, p: null }; const parts = raw.split(':'); if (parts.length === 2) { const p = parseInt(parts[1].replace(/[^\d]/g, ''), 10); if (p > 0 && p < 65536) return { h: parts[0], p }; } return { h: raw, p: null }; };
  const thresh = async () => { if (busy || closed) return; busy = true; try { for (;;) {
    if (closed) break; if (!sock) { const [d] = uq.bundle(); if (!d) break; const r = relay(d); if (!r) throw wither(); server.send(new Uint8Array([d[0], 0])); const host = addr(r.addrType, r.targetAddrBytes), port = r.port, payload = d.subarray(r.dataOffset); let leftover = null;
      if (chain) { if (chain.global) { const res = await chainConnect(fetcher, chain, host, port); sock = res.sock; leftover = res.leftover; extraSock = res.extra || null; } else { sock = await raceSprout(fetcher, host, port).catch(async () => { const res = await chainConnect(fetcher, chain, host, port); leftover = res.leftover; extraSock = res.extra || null; return res.sock; }); } }
      else { sock = await raceSprout(fetcher, host, port).catch(async () => { const pxy = pickProxy(); if (!pxy) throw new Error('direct failed'); return raceSprout(fetcher, pxy.h, pxy.p || port); }); }
      if (!sock) throw wither(); curW = sock.writable.getWriter(); if (leftover && leftover.byteLength) server.send(leftover); const [first] = uq.bundle(payload); first?.byteLength && await curW.write(first); mill(sock.readable, server).finally(() => wither()); continue; }
    const [d] = uq.bundle(); if (!d) break; await curW.write(d);
  } } catch { wither(); } finally { busy = false; !uq.empty && !closed && thresh(); } };
  if (ed && sow(ed)) thresh();
  server.addEventListener('message', e => { closed || (sow(e.data) && thresh()); });
  server.addEventListener('close', () => wither()); server.addEventListener('error', () => wither());
  return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Extensions': '' } }); };