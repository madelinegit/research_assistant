/**
 * The header context meter (brief §6): a small bar + "Memory: NN%" label that
 * turns amber past the warn threshold. Reflects how full the model's context
 * window is with the current conversation.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CONTEXT_WARN_THRESHOLD } from './constants';
import type { Theme } from './theme';

interface Props {
  fraction: number; // 0..1
  theme: Theme;
}

export function ContextMeter({ fraction, theme }: Props) {
  const pct = Math.round(fraction * 100);
  const warn = fraction >= CONTEXT_WARN_THRESHOLD;
  const fillColor = warn ? theme.meterFillWarn : theme.meterFill;

  return (
    <View style={styles.wrap} accessibilityLabel={`Memory ${pct} percent full`}>
      <Text style={[styles.label, { color: theme.subtle }]}>Memory {pct}%</Text>
      <View style={[styles.track, { backgroundColor: theme.meterTrack }]}>
        <View
          style={[
            styles.fill,
            { width: `${Math.min(pct, 100)}%`, backgroundColor: fillColor },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 3 },
  label: { fontSize: 12, fontWeight: '600' },
  track: {
    width: 120,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 3 },
});
