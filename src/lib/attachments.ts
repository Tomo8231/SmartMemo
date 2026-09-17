// 添付ファイル（画像・ファイル・リンク）の生成・表示まわりの UI 非依存ヘルパ。

export type Attachment = { id: string; name: string; mime: string; data: string };

export const MAX_ATTACHMENTS = 5;
export const MAX_FILE_BYTES  = 3 * 1024 * 1024; // 3 MB for non-image files
// 画像は compressImage で縮小するので上限は緩めでよいが、無制限だと
// 縮小前の data URL 化（元サイズの約 1.33 倍の文字列）でタブが落ちる。
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export function compressImage(dataUrl: string, maxW = 1400): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      (canvas.getContext('2d') as CanvasRenderingContext2D).drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ─────────────────────────────────────────────────────────────
// Attachment preview helpers
// ─────────────────────────────────────────────────────────────
export function dataUrlToObjectUrl(dataUrl: string, mime: string): string {
  const b64 = dataUrl.split(',')[1] || '';
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return URL.createObjectURL(new Blob([arr], { type: mime }));
}

export function getLinkLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url.length > 28 ? url.slice(0, 28) + '…' : url; }
}

// ─────────────────────────────────────────────────────────────
// Attachment creation
// ─────────────────────────────────────────────────────────────
export function newAttachmentId(): string {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// 入力欄に書かれた URL をリンク添付にする。スキーム省略時は https を補う。
// http(s) 以外（javascript: など）は開いたときにこのアプリの権限でスクリプトが
// 動きうるので、作る段階で弾く。
export function makeLinkAttachment(raw: string): Attachment | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
  if (!isSafeExternalUrl(url)) return null;
  return { id: newAttachmentId(), name: getLinkLabel(url), mime: 'text/x-url', data: url };
}

// 選ばれたファイルを添付に変換する。上限件数・サイズを超えたものは toast で知らせて飛ばす。
// 画像は縮小して保存量を抑える。
export async function filesToAttachments(
  files: File[], remaining: number, toast?: (msg: string) => void,
): Promise<Attachment[]> {
  if (remaining <= 0) { if (files.length) toast?.(`添付ファイルは最大${MAX_ATTACHMENTS}件です`); return []; }
  const out: Attachment[] = [];
  for (const file of files.slice(0, remaining)) {
    const isImage = file.type.startsWith('image/');
    const limit   = isImage ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
    if (file.size > limit) {
      toast?.(`${file.name} はサイズが大きすぎます（最大${Math.round(limit / 1024 / 1024)}MB）`); continue;
    }
    const raw = await readFileAsDataUrl(file);
    const data = isImage ? await compressImage(raw) : raw;
    out.push({ id: newAttachmentId(), name: file.name, mime: file.type, data });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Opening / downloading
// ─────────────────────────────────────────────────────────────
// 添付はバックアップのインポートやクラウド同期でも入ってくるため、
// 画面で作ったものと同じ前提（http(s) のリンク / data: のファイル）を
// 開く直前にも確かめる。
export function isSafeExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch { return false; }
}

// noopener: 開いた先のページから window.opener 経由でこのタブを
// 書き換えられないようにする（reverse tabnabbing 対策）。
export function openExternalUrl(url: string): void {
  if (!isSafeExternalUrl(url)) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function downloadFile(a: Attachment) {
  if (!/^(data|blob):/i.test(a.data)) return;
  const el = document.createElement('a');
  el.href = a.data; el.download = a.name;
  document.body.appendChild(el); el.click(); document.body.removeChild(el);
}

export function canPreview(mime: string) {
  return mime.startsWith('image/') || mime === 'application/pdf' || mime === 'text/plain' || mime === 'text/csv';
}

export function openOrPreview(a: Attachment, setLightbox: (a: Attachment) => void) {
  if (a.mime === 'text/x-url') { openExternalUrl(a.data); return; }
  if (canPreview(a.mime)) { setLightbox(a); return; }
  downloadFile(a);
}

export function attFileIco(mime: string): string {
  if (mime === 'application/pdf') return '📕';
  if (mime === 'text/csv') return '📊';
  if (mime.includes('sheet') || mime.includes('excel')) return '📊';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  return '📄';
}
