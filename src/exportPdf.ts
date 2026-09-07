/**
 * Export the conversation to a PDF the owner can save ("finish an informative
 * chat → download a PDF"). Complements the screenshot-then-wipe workflow.
 *
 *  - Native (iOS/Android, the ship target): render the chat to a PDF file with
 *    expo-print, then hand it to the OS share sheet (Save to Files, AirDrop…)
 *    via expo-sharing.
 *  - Web (the localhost dev preview): expo-print opens the browser print dialog
 *    where the owner picks "Save as PDF" (Sharing's Web Share API can't attach
 *    a local file, so we don't use it here).
 *
 * API shapes verified against the Expo v57 docs (per AGENTS.md):
 *   Print.printToFileAsync({ html }) -> { uri }   (native)
 *   Print.printAsync({ html })                    (web: opens print dialog)
 *   Sharing.shareAsync(uri, { mimeType, UTI })    (native)
 */
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { Message } from './db';

export interface ExportOptions {
  title?: string;
  /** ISO-ish timestamp string for the header; defaults to now. */
  dateLabel?: string;
}

/** Render + save/share the conversation as a PDF. Throws on failure. */
export async function exportChatToPdf(
  messages: Message[],
  opts: ExportOptions = {}
): Promise<void> {
  const html = buildHtml(messages, opts);

  if (Platform.OS === 'web') {
    // Opens the browser print dialog → "Save as PDF".
    await Print.printAsync({ html });
    return;
  }

  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: opts.title || 'Chat export',
    });
  }
  // If sharing isn't available the PDF still exists at `uri`; nothing else to do.
}

/** Escape user/bot text so it can't break the HTML or inject markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtml(messages: Message[], opts: ExportOptions): string {
  const title = escapeHtml(opts.title || 'Conversation');
  const dateLabel = escapeHtml(opts.dateLabel || defaultDateLabel());
  const count = messages.length;

  const turns = messages
    .map((m) => {
      const isUser = m.role === 'user';
      const who = isUser ? 'You' : 'Assistant';
      const cls = isUser ? 'user' : 'bot';
      return `
        <div class="turn ${cls}">
          <div class="who">${who}</div>
          <div class="bubble">${escapeHtml(m.content)}</div>
        </div>`;
    })
    .join('');

  // Inline CSS only — the PDF renderer has no external assets. white-space:
  // pre-wrap preserves the model's line breaks.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, Helvetica, Arial, sans-serif;
    color: #1a1a1a;
    margin: 0;
    padding: 32px 28px;
    font-size: 13px;
    line-height: 1.5;
  }
  header { border-bottom: 2px solid #e5e5e5; padding-bottom: 12px; margin-bottom: 20px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #888; font-size: 11px; }
  .turn { margin: 14px 0; }
  .who {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #999;
    margin-bottom: 3px;
  }
  .bubble {
    display: inline-block;
    max-width: 88%;
    padding: 9px 13px;
    border-radius: 12px;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .user { text-align: right; }
  .user .who { margin-right: 2px; }
  .user .bubble { background: #2563eb; color: #ffffff; border-bottom-right-radius: 3px; text-align: left; }
  .bot .bubble { background: #f0f0f0; color: #1a1a1a; border-bottom-left-radius: 3px; }
  footer { margin-top: 28px; border-top: 1px solid #eee; padding-top: 10px; color: #aaa; font-size: 10px; }
</style>
</head>
<body>
  <header>
    <h1>${title}</h1>
    <div class="meta">${dateLabel} · ${count} message${count === 1 ? '' : 's'}</div>
  </header>
  ${turns || '<p class="meta">No messages.</p>'}
  <footer>Exported from mlab-llm</footer>
</body>
</html>`;
}

function defaultDateLabel(): string {
  try {
    return new Date().toLocaleString();
  } catch {
    return '';
  }
}
