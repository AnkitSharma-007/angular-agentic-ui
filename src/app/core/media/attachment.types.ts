// Multimodal user-turn input. An `InlineAttachment` is base64 media that gets
// inlined into the Gemini request as an `inlineData` part — nothing is uploaded
// anywhere, keeping the app's "nothing leaves the browser but Gemini" posture.

export type AttachmentKind = 'image' | 'audio';

export interface InlineAttachment {
  readonly id: string;
  readonly kind: AttachmentKind;
  readonly mimeType: string; // e.g. 'image/jpeg', 'audio/webm'
  readonly dataBase64: string; // raw base64, no `data:` prefix
  readonly name?: string;
  readonly sizeBytes: number;
}

// A user turn is text, optional attachments, or both.
export interface UserTurnInput {
  readonly text: string;
  readonly attachments?: readonly InlineAttachment[];
}

// UI-facing view of a stored user turn (derived from raw history), used to echo
// what the user sent above the response. `dataUrl` is display-ready.
export interface UserTurnAttachmentView {
  readonly kind: AttachmentKind;
  readonly mimeType: string;
  readonly dataUrl: string;
}

export interface UserTurnView {
  readonly text: string;
  readonly attachments: readonly UserTurnAttachmentView[];
}

export const EMPTY_USER_TURN_VIEW: UserTurnView = { text: '', attachments: [] };

// Callers may pass a bare string (text-only, the common case) or the full
// object; normalize once at the boundary so downstream code sees one shape.
export function normalizeUserTurnInput(input: string | UserTurnInput): UserTurnInput {
  return typeof input === 'string' ? { text: input } : input;
}

export function toInlineDataPart(a: InlineAttachment): {
  readonly inlineData: { readonly mimeType: string; readonly data: string };
} {
  return { inlineData: { mimeType: a.mimeType, data: a.dataBase64 } };
}

export function toDataUrl(a: InlineAttachment): string {
  return `data:${a.mimeType};base64,${a.dataBase64}`;
}

export function kindFromMime(mimeType: string): AttachmentKind {
  return mimeType.startsWith('audio/') ? 'audio' : 'image';
}

// MIME types we are willing to turn into a `data:` URL and render. Upload only
// ever produces `image/jpeg`, but replays are user-editable/portable, so the
// display path must not trust a stored MIME (e.g. `text/html`, `image/svg+xml`)
// that could be abused via a `data:` URL. Anything outside this allowlist is
// dropped from the echoed user turn rather than rendered. (L12)
const DISPLAYABLE_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

const DISPLAYABLE_AUDIO_MIME = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
]);

export function isDisplayableAttachmentMime(mimeType: string): boolean {
  const mime = mimeType.trim().toLowerCase();
  return DISPLAYABLE_IMAGE_MIME.has(mime) || DISPLAYABLE_AUDIO_MIME.has(mime);
}
