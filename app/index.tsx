/**
 * Chat screen (brief §4.1). Custom header with the context meter + Wipe/Settings
 * buttons, a scrollable message list (user right / bot left), a "typing…"
 * indicator, the near-limit warning banner, an error banner, and a pinned input.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../src/store';
import { getTheme } from '../src/theme';
import { ContextMeter } from '../src/ContextMeter';
import { useKeyboardInset } from '../src/useKeyboardInset';
import { contextFraction } from '../src/tokens';
import { CONTEXT_WARN_THRESHOLD } from '../src/constants';
import { ChatError, isProxyEndpoint } from '../src/api';
import { StorageFullError } from '../src/storageError';
import { exportChatToPdf } from '../src/exportPdf';
import type { Message } from '../src/db';

export default function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = getTheme(useColorScheme());
  // On web the keyboard occludes the layout viewport rather than resizing it,
  // so we lift the whole screen by the occluded amount ourselves. 0 on native,
  // where KeyboardAvoidingView below still does the work.
  const keyboardInset = useKeyboardInset();
  const {
    ready,
    messages,
    sending,
    searching,
    settings,
    estimatePayload,
    send,
    wipe,
  } = useStore();

  const [draft, setDraft] = useState('');
  const [webOn, setWebOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  // Live token estimate of the next payload, including the current draft.
  const fraction = useMemo(
    () => contextFraction(estimatePayload(draft), settings.contextWindow),
    [estimatePayload, draft, settings.contextWindow, messages.length]
  );
  const nearLimit = fraction >= CONTEXT_WARN_THRESHOLD;

  const scrollToEnd = useCallback(() => {
    // Defer so the new row is laid out first.
    requestAnimationFrame(() =>
      listRef.current?.scrollToEnd({ animated: true })
    );
  }, []);

  // Opening the keyboard shortens the list; keep the latest message in view.
  useEffect(() => {
    if (keyboardInset > 0) scrollToEnd();
  }, [keyboardInset, scrollToEnd]);

  const onSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setError(null);
    setDraft('');
    scrollToEnd();
    try {
      await send(text, webOn);
      scrollToEnd();
    } catch (e) {
      setError(messageForError(e));
    }
  }, [draft, sending, send, scrollToEnd, webOn]);

  const onExport = useCallback(async () => {
    if (messages.length === 0) return;
    try {
      await exportChatToPdf(messages, { title: 'Conversation' });
    } catch {
      setError('Could not create the PDF. Try again.');
    }
  }, [messages]);

  const onWipe = useCallback(() => {
    if (messages.length === 0) return;
    const doWipe = async () => {
      await wipe();
      setError(null);
    };
    if (Platform.OS === 'web') {
      // Alert has no multi-button support on web; use confirm().
      // eslint-disable-next-line no-alert
      if (window.confirm("Wipe all memory? This can't be undone.")) doWipe();
      return;
    }
    Alert.alert(
      'Wipe all memory?',
      "This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Wipe', style: 'destructive', onPress: doWipe },
      ],
      { cancelable: true }
    );
  }, [messages.length, wipe]);

  const renderItem = useCallback(
    ({ item }: { item: Message }) => {
      const isUser = item.role === 'user';
      return (
        <View
          style={[
            styles.row,
            { justifyContent: isUser ? 'flex-end' : 'flex-start' },
          ]}
        >
          <View
            style={[
              styles.bubble,
              isUser
                ? { backgroundColor: theme.userBubble, borderBottomRightRadius: 4 }
                : { backgroundColor: theme.botBubble, borderBottomLeftRadius: 4 },
            ]}
          >
            <Text
              selectable
              style={{
                color: isUser ? theme.userText : theme.botText,
                fontSize: 16,
                lineHeight: 22,
              }}
            >
              {item.content}
            </Text>
          </View>
        </View>
      );
    },
    [theme]
  );

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: theme.bg, paddingBottom: keyboardInset },
      ]}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 8,
            backgroundColor: theme.surface,
            borderBottomColor: theme.border,
          },
        ]}
      >
        <View style={styles.headerGroup}>
          <IconButton
            label="Export chat as PDF"
            glyph="📄"
            onPress={onExport}
            disabled={messages.length === 0}
            color={theme.text}
          />
          <IconButton
            label="Wipe"
            glyph="🗑"
            onPress={onWipe}
            disabled={messages.length === 0}
            color={theme.text}
          />
        </View>
        <ContextMeter fraction={fraction} theme={theme} />
        <IconButton
          label="Settings"
          glyph="⚙️"
          onPress={() => router.push('/settings')}
          color={theme.text}
        />
      </View>

      {/* Near-limit warning banner (non-blocking) */}
      {nearLimit && (
        <View style={[styles.banner, { backgroundColor: theme.warnBg }]}>
          <Text style={[styles.bannerText, { color: theme.warnText }]}>
            Memory is getting full — screenshot and wipe soon to keep responses
            sharp.
          </Text>
        </View>
      )}

      {/* Error banner */}
      {error && (
        <Pressable
          onPress={() => setError(null)}
          style={[styles.banner, { backgroundColor: theme.errorBg }]}
        >
          <Text style={[styles.bannerText, { color: theme.errorText }]}>
            {error}
          </Text>
          <Text style={[styles.bannerDismiss, { color: theme.errorText }]}>
            Tap to dismiss
          </Text>
        </Pressable>
      )}

      {/* Message list */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => String(m.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={scrollToEnd}
          ListEmptyComponent={
            ready ? (
              <View style={styles.empty}>
                <Text style={[styles.emptyText, { color: theme.subtle }]}>
                  {settings.apiKey || isProxyEndpoint(settings.endpoint)
                    ? 'Say something to start the conversation.'
                    : 'Add your ModelsLab API key in Settings to begin.'}
                </Text>
              </View>
            ) : null
          }
        />

        {/* Typing / searching indicator */}
        {sending && (
          <View style={styles.typingRow}>
            <ActivityIndicator size="small" color={theme.subtle} />
            <Text style={[styles.typingText, { color: theme.subtle }]}>
              {searching ? '🌐 Searching the web…' : 'Bot is typing…'}
            </Text>
          </View>
        )}

        {/* Web-lookup hint (only when armed) */}
        {webOn && (
          <Text style={[styles.webHint, { color: theme.accent }]}>
            🌐 Web lookup on — this message searches the web first
            {settings.searchApiKey.trim() ? '' : ' (Wikipedia)'}.
          </Text>
        )}

        {/* Input bar */}
        <View
          style={[
            styles.inputBar,
            {
              // When the keyboard is up it already covers the home-indicator
              // strip, so the safe-area padding would just add dead space.
              paddingBottom: keyboardInset > 0 ? 8 : insets.bottom + 8,
              backgroundColor: theme.surface,
              borderTopColor: theme.border,
            },
          ]}
        >
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: theme.bg,
                color: theme.text,
                borderColor: theme.border,
              },
            ]}
            placeholder="Message"
            placeholderTextColor={theme.subtle}
            value={draft}
            onChangeText={setDraft}
            multiline
            editable={!sending}
            onSubmitEditing={onSend}
            blurOnSubmit={false}
          />
          <Pressable
            onPress={() => setWebOn((v) => !v)}
            accessibilityRole="switch"
            accessibilityState={{ checked: webOn }}
            accessibilityLabel="Look up on the web"
            style={[
              styles.webBtn,
              {
                backgroundColor: webOn ? theme.accent : theme.bg,
                borderColor: webOn ? theme.accent : theme.border,
              },
            ]}
          >
            <Text style={{ fontSize: 18, opacity: webOn ? 1 : 0.55 }}>🌐</Text>
          </Pressable>
          <Pressable
            onPress={onSend}
            disabled={sending || draft.trim().length === 0}
            style={[
              styles.sendBtn,
              {
                backgroundColor:
                  sending || draft.trim().length === 0
                    ? theme.border
                    : theme.accent,
              },
            ]}
          >
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function IconButton({
  label,
  glyph,
  onPress,
  disabled,
  color,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  disabled?: boolean;
  color: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={10}
      style={{ opacity: disabled ? 0.35 : 1, padding: 4 }}
    >
      <Text style={{ fontSize: 22, color }}>{glyph}</Text>
    </Pressable>
  );
}

/** Map a thrown error to a user-facing message (brief §6, §8). */
function messageForError(e: unknown): string {
  if (e instanceof StorageFullError) {
    return 'This browser’s storage is full, so the message could not be saved. Export the chat (📄), then Wipe (🗑) to keep going.';
  }
  if (e instanceof ChatError) {
    switch (e.kind) {
      case 'no_key':
        return 'No API key set. Add your ModelsLab key in Settings.';
      case 'auth':
        return 'API key was rejected. Check it in Settings.';
      case 'context_limit':
        return "The conversation hit the model's memory limit. Screenshot what you need, then Wipe to continue.";
      case 'network':
        return 'Network error. Check your connection and tap Send to retry.';
      case 'bad_response':
        return 'Got an unexpected response from ModelsLab. Try again.';
      default:
        return e.message || 'Something went wrong. Tap Send to retry.';
    }
  }
  return 'Something went wrong. Tap Send to retry.';
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  banner: { paddingHorizontal: 16, paddingVertical: 10 },
  bannerText: { fontSize: 13, lineHeight: 18 },
  bannerDismiss: { fontSize: 11, marginTop: 4, opacity: 0.8 },
  listContent: { padding: 12, flexGrow: 1 },
  row: { flexDirection: 'row', marginVertical: 4 },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  typingText: { fontSize: 13 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
  },
  webBtn: {
    height: 40,
    width: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    height: 40,
    paddingHorizontal: 18,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { color: '#ffffff', fontWeight: '600', fontSize: 15 },
  webHint: {
    paddingHorizontal: 16,
    paddingTop: 6,
    fontSize: 12,
  },
});
