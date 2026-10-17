import { StyleSheet, Text, View } from 'react-native';
import { canonicalJson } from '@agent-native/contracts';

/** Placeholder root until the native frame hosts the configured application. */
export function App() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Mobile shell</Text>
      <Text>{canonicalJson({ ready: true })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '600' },
});
