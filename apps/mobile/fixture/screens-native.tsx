import { useState } from 'react';
import { FlatList, TextInput, View } from 'react-native';
import { NotebookPen } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { HoldButton } from '@tortoise/frame-native/components/hold-button';
import { ListRow } from '@tortoise/frame-native/components/list-row';
import { defineNativeScreens } from '@tortoise/frame-native/screens';
import { useSession } from '@tortoise/frame-native/session';
import { noteAdd, noteList } from './manifest';

function Notes() {
  const { client, live } = useSession();
  const notes = useQuery(live.liveQueryOptions(noteList, {}));
  const [text, setText] = useState('');
  return (
    <View className="flex-1 gap-4 bg-background p-4">
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Note"
        accessibilityLabel="Note"
        className="min-h-target rounded-xl border border-border px-4 text-operator text-foreground"
      />
      <HoldButton
        label="Add note"
        disabled={!text.trim()}
        onConfirm={() => {
          void client.command(noteAdd, { text }, { idempotencyKey: crypto.randomUUID() });
          setText('');
        }}
      />
      <FlatList
        data={notes.data?.notes ?? []}
        keyExtractor={(note) => note.id}
        renderItem={({ item }) => <ListRow title={item.text} detail={item.id} />}
      />
    </View>
  );
}

export default defineNativeScreens({
  title: 'Notes',
  home: '/notes',
  routes: [{ path: '/notes', component: Notes, title: 'Notes' }],
  navigation: [{ to: '/notes', label: 'Notes', icon: NotebookPen }],
});
