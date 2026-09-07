/**
 * Settings screen (brief §4.2). Editable, persisted to secure storage:
 *  - API key (masked)
 *  - System prompt (persona) with Reset to default
 *  - Model name
 *  - Endpoint URL, max_tokens, temperature, context-window size
 * Nothing here is wiped by the Chat "Wipe" button (brief §6).
 */
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { useStore } from '../src/store';
import { getTheme, type Theme } from '../src/theme';
import { DEFAULT_SYSTEM_PROMPT } from '../src/constants';

export default function SettingsScreen() {
  const theme = getTheme(useColorScheme());
  const { settings, effectiveSystemPrompt, saveSettings, resetSystemPrompt } =
    useStore();

  // Local draft state, seeded from the store once it's loaded.
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [showKey, setShowKey] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [model, setModel] = useState(settings.model);
  const [endpoint, setEndpoint] = useState(settings.endpoint);
  const [maxTokens, setMaxTokens] = useState(String(settings.maxTokens));
  const [temperature, setTemperature] = useState(String(settings.temperature));
  const [contextWindow, setContextWindow] = useState(
    String(settings.contextWindow)
  );
  const [searchApiKey, setSearchApiKey] = useState(settings.searchApiKey);
  const [showSearchKey, setShowSearchKey] = useState(false);
  const [searchProvider, setSearchProvider] = useState(settings.searchProvider);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  // Re-seed local drafts when the store finishes loading persisted values.
  useEffect(() => {
    setApiKey(settings.apiKey);
    setSystemPrompt(settings.systemPrompt);
    setModel(settings.model);
    setEndpoint(settings.endpoint);
    setMaxTokens(String(settings.maxTokens));
    setTemperature(String(settings.temperature));
    setContextWindow(String(settings.contextWindow));
    setSearchApiKey(settings.searchApiKey);
    setSearchProvider(settings.searchProvider);
  }, [
    settings.apiKey,
    settings.systemPrompt,
    settings.model,
    settings.endpoint,
    settings.maxTokens,
    settings.temperature,
    settings.contextWindow,
    settings.searchApiKey,
    settings.searchProvider,
  ]);

  const flash = (msg: string) => {
    setSavedNote(msg);
    setTimeout(() => setSavedNote(null), 2000);
  };

  const saveKey = async () => {
    await saveSettings({ apiKey: apiKey.trim() });
    flash('API key saved');
  };

  const savePrompt = async () => {
    await saveSettings({ systemPrompt });
    flash('System prompt saved');
  };

  const onResetPrompt = async () => {
    await resetSystemPrompt();
    setSystemPrompt('');
    flash('Reset to default persona');
  };

  const saveSearch = async () => {
    const provider = searchProvider.trim().toLowerCase();
    await saveSettings({
      searchApiKey: searchApiKey.trim(),
      searchProvider: provider === 'brave' ? 'brave' : 'tavily',
    });
    flash('Web search settings saved');
  };

  const saveModelAndParams = async () => {
    const mt = parseInt(maxTokens, 10);
    const temp = parseFloat(temperature);
    const ctx = parseInt(contextWindow, 10);
    await saveSettings({
      model: model.trim(),
      endpoint: endpoint.trim(),
      maxTokens: Number.isFinite(mt) && mt > 0 ? mt : settings.maxTokens,
      temperature:
        Number.isFinite(temp) && temp >= 0 ? temp : settings.temperature,
      contextWindow:
        Number.isFinite(ctx) && ctx > 0 ? ctx : settings.contextWindow,
    });
    flash('Model & parameters saved');
  };

  const s = makeStyles(theme);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {savedNote && (
          <View style={s.savedBanner}>
            <Text style={s.savedText}>{savedNote}</Text>
          </View>
        )}

        {/* API key */}
        <Text style={s.sectionTitle}>ModelsLab API key</Text>
        <Text style={s.help}>
          Stored securely on this device only. Never leaves except in API
          requests to ModelsLab.
        </Text>
        <View style={s.keyRow}>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="Paste your API key"
            placeholderTextColor={theme.subtle}
            secureTextEntry={!showKey}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable onPress={() => setShowKey((v) => !v)} style={s.showBtn}>
            <Text style={s.showBtnText}>{showKey ? 'Hide' : 'Show'}</Text>
          </Pressable>
        </View>
        <PrimaryButton label="Save API key" onPress={saveKey} theme={theme} />

        {/* System prompt */}
        <View style={s.divider} />
        <Text style={s.sectionTitle}>System prompt (persona)</Text>
        <Text style={s.help}>
          This is the curation lever — persona, tone, and house rules. Takes
          effect on your next message. Leave empty to use the built-in default.
        </Text>
        <TextInput
          style={[s.input, s.multiline]}
          value={systemPrompt}
          onChangeText={setSystemPrompt}
          placeholder={DEFAULT_SYSTEM_PROMPT}
          placeholderTextColor={theme.subtle}
          multiline
          textAlignVertical="top"
        />
        <Text style={s.effectiveNote}>
          {systemPrompt.trim()
            ? 'Using your custom persona.'
            : 'Using the built-in default persona.'}
        </Text>
        <View style={s.buttonRow}>
          <PrimaryButton
            label="Save prompt"
            onPress={savePrompt}
            theme={theme}
            style={{ flex: 1 }}
          />
          <SecondaryButton
            label="Reset to default"
            onPress={onResetPrompt}
            theme={theme}
            style={{ flex: 1 }}
          />
        </View>

        {/* Model & params */}
        <View style={s.divider} />
        <Text style={s.sectionTitle}>Model & parameters</Text>

        <Text style={s.fieldLabel}>Model</Text>
        <TextInput
          style={s.input}
          value={model}
          onChangeText={setModel}
          placeholder="ModelsLab/Llama-3.1-8b-Uncensored-Dare"
          placeholderTextColor={theme.subtle}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={s.fieldLabel}>Endpoint URL</Text>
        <TextInput
          style={s.input}
          value={endpoint}
          onChangeText={setEndpoint}
          placeholder="https://modelslab.com/api/uncensored-chat/v1/chat/completions"
          placeholderTextColor={theme.subtle}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={s.buttonRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.fieldLabel}>max_tokens</Text>
            <TextInput
              style={s.input}
              value={maxTokens}
              onChangeText={setMaxTokens}
              keyboardType="number-pad"
              placeholderTextColor={theme.subtle}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.fieldLabel}>temperature</Text>
            <TextInput
              style={s.input}
              value={temperature}
              onChangeText={setTemperature}
              keyboardType="decimal-pad"
              placeholderTextColor={theme.subtle}
            />
          </View>
        </View>

        <Text style={s.fieldLabel}>Context window (tokens, for the meter)</Text>
        <TextInput
          style={s.input}
          value={contextWindow}
          onChangeText={setContextWindow}
          keyboardType="number-pad"
          placeholderTextColor={theme.subtle}
        />

        <PrimaryButton
          label="Save model & parameters"
          onPress={saveModelAndParams}
          theme={theme}
        />

        {/* Web search */}
        <View style={s.divider} />
        <Text style={s.sectionTitle}>Web search (optional)</Text>
        <Text style={s.help}>
          Tap the 🌐 button next to Send to look things up for a message. Leave
          the key blank for free keyless lookups (Wikipedia + DuckDuckGo —
          facts, people, concepts only). Paste a free search-API key to unlock
          full open-web search (news, prices, any site).
        </Text>
        <View style={s.keyRow}>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={searchApiKey}
            onChangeText={setSearchApiKey}
            placeholder="Search API key (optional)"
            placeholderTextColor={theme.subtle}
            secureTextEntry={!showSearchKey}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            onPress={() => setShowSearchKey((v) => !v)}
            style={s.showBtn}
          >
            <Text style={s.showBtnText}>{showSearchKey ? 'Hide' : 'Show'}</Text>
          </Pressable>
        </View>
        <Text style={s.fieldLabel}>Provider (when a key is set)</Text>
        <TextInput
          style={s.input}
          value={searchProvider}
          onChangeText={setSearchProvider}
          placeholder="tavily"
          placeholderTextColor={theme.subtle}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={s.effectiveNote}>
          {searchApiKey.trim()
            ? `Open-web search via ${
                searchProvider.trim().toLowerCase() === 'brave'
                  ? 'Brave'
                  : 'Tavily'
              }.`
            : 'Keyless mode: Wikipedia + DuckDuckGo (encyclopedic only).'}
        </Text>
        <PrimaryButton
          label="Save web search settings"
          onPress={saveSearch}
          theme={theme}
        />

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PrimaryButton({
  label,
  onPress,
  theme,
  style,
}: {
  label: string;
  onPress: () => void;
  theme: Theme;
  style?: object;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        {
          backgroundColor: theme.accent,
          borderRadius: 10,
          paddingVertical: 12,
          alignItems: 'center',
          marginTop: 10,
        },
        style,
      ]}
    >
      <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function SecondaryButton({
  label,
  onPress,
  theme,
  style,
}: {
  label: string;
  onPress: () => void;
  theme: Theme;
  style?: object;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: 10,
          paddingVertical: 12,
          alignItems: 'center',
          marginTop: 10,
        },
        style,
      ]}
    >
      <Text style={{ color: theme.text, fontWeight: '600', fontSize: 15 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    content: { padding: 16 },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.text,
      marginBottom: 4,
    },
    help: { fontSize: 13, color: theme.subtle, marginBottom: 10, lineHeight: 18 },
    fieldLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.subtle,
      marginTop: 10,
      marginBottom: 4,
    },
    input: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: theme.text,
    },
    multiline: { minHeight: 140, paddingTop: 10 },
    keyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    showBtn: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: StyleSheet.hairlineWidth,
    },
    showBtnText: { color: theme.accent, fontWeight: '600' },
    effectiveNote: {
      fontSize: 12,
      color: theme.subtle,
      marginTop: 6,
      fontStyle: 'italic',
    },
    buttonRow: { flexDirection: 'row', gap: 10 },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.border,
      marginVertical: 22,
    },
    savedBanner: {
      backgroundColor: theme.warnBg,
      borderRadius: 8,
      padding: 10,
      marginBottom: 12,
    },
    savedText: { color: theme.warnText, fontWeight: '600', textAlign: 'center' },
  });
}
