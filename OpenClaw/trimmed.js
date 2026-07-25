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
 let address = String(raw || '').trim().replace(/^(socks5|http|https):\/\//i, '').split('#')[0].trim();
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
// 反代协议分发：socks5/http/https
const chainConnect = async (fetcher, chain, host, port) => {
 if (chain.proto === 'socks5') { const sock = await raceSprout(fetcher, chain.host, chain.port); const leftover = await doSocks5(sock, chain.user, chain.pass, host, port); return { sock, leftover }; }
 if (chain.proto === 'http') { const sock = await raceSprout(fetcher, chain.host, chain.port); const leftover = await doHttpConnect(sock, chain.user, chain.pass, host, port); return { sock, leftover }; }
 // https：统一走原生 secureTransport
 if (chain.proto === 'https') {
 const sock = await raceSprout(fetcher, chain.host, chain.port, { secureTransport: 'on' }); const leftover = await doHttpConnect(sock, chain.user, chain.pass, host, port); return { sock, leftover };
 }
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
 const wither = () => { if (closed) return; closed = true; uq.clear(); try { curW?.releaseLock(); } catch {} try { sock?.close(); } catch {} try { extraSock?.close(); } catch {} try { server.close(); } catch {} };
 const toU8 = d => d instanceof Uint8Array ? d : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d);
 const sow = d => { const u = toU8(d), n = u.byteLength; if (!n) return 1; if (uq.sow(u)) return 1; wither(); return 0; };
 // 反代模式解析，对齐 edgetunnel 真实源码：/video/<加密串> 优先级最高（整块JSON配置，恒定全局），
 // 解密/解析失败则静默降级到下面的三层路径正则 + query 参数形式：
 // 第一层 /(socks5?|http|https):// 或 :/ 或 :（0~2个斜杠都认）→ 默认全局，不走直连
 // 第二层 /xxx=value 或 /gxxx=value（g前缀=全局，否则=直连优先失败降级），支持 s5/gs5 短别名
 // 第三层（都没匹配到时）用 ?socks5=/?http=/?https= 查询参数，?globalproxy 单独控制全局
 const _defPort = { socks5: 1080, http: 80, https: 443 };
 const _normProto = kw => kw.includes('https') ? 'https' : kw.includes('http') ? 'http' : 'socks5';
 let chain = null;
 const _videoM = decodeURIComponent(_url.pathname).match(/\/video\/(.+)$/i);
 if (_videoM) { try { const plain = base64SecretDecode(_videoM[1], _uuidStr); const { type, ...addrObj } = JSON.parse(plain);
 const proto = String(type || '').toLowerCase(); if (!proto || !_defPort[proto]) throw new Error('链式代理类型无效');
 if (!addrObj.hostname || !addrObj.port) throw new Error('链式代理地址缺少 hostname 或 port');
 const port = Number(addrObj.port); if (isNaN(port)) throw new Error('链式代理端口无效');
 chain = { proto, global: true, user: addrObj.username || '', pass: addrObj.password || '', host: addrObj.hostname, port };
 } catch {} }
 let _cm = chain ? null : _url.pathname.match(/\/(socks5?|https|http):\/?\/?([^/?#\s]+)/i);
 if (_cm) { const proto = _normProto(_cm[1].toLowerCase()); chain = { proto, global: true, ...pTarget(_cm[2], _defPort[proto]) }; }
 else if (!chain && (_cm = _url.pathname.match(/\/(g?s5|socks5|g?http|g?https)=([^/?#\s]+)/i))) { const kw = _cm[1].toLowerCase(); const proto = _normProto(kw); chain = { proto, global: kw.startsWith('g'), ...pTarget(_cm[2], _defPort[proto]) }; }
 else if (!chain) { const qProto = ['socks5', 'http', 'https'].find(p => _url.searchParams.has(p)); if (qProto) chain = { proto: qProto, global: _url.searchParams.has('globalproxy'), ...pTarget(_url.searchParams.get(qProto), _defPort[qProto]) }; }
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
