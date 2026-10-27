import { useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import type { BlobRef } from '@agent-native/contracts';
import { HoldButton } from '@agent-native/frame-native/components/hold-button';
import { useOsAction } from '@agent-native/frame-native/os-actions';
import { useSession } from '@agent-native/frame-native/session';
import type { CaptureBody, SurveyBrief } from './brief';
import { fieldOperations as ops } from '../contracts';
import { refusal, workRequest } from './os-requests';
import { ActionButton, ErrorText, Screen } from './shared';

type CaptureKind = CaptureBody['kind'];
type Condition = NonNullable<CaptureBody['condition']>;
const conditions: Condition[] = ['good', 'fair', 'poor', 'failed'];
const maxPhotos = 8;

function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T | undefined;
  onChange: (value: T | undefined) => void;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      className="flex-row flex-wrap gap-2"
    >
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(selected ? undefined : option)}
            className={`min-h-target justify-center rounded-full border px-4 ${selected ? 'border-primary bg-primary' : 'border-border'}`}
          >
            <Text
              className={`text-operator ${selected ? 'text-primary-foreground' : 'text-foreground'}`}
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Take photos and record one capture. Each photo is stored as a blob on the device as soon as it
 * is taken, so the report command only references them; the camera's temporary files are
 * deleted when the screen closes. The capture goes to the hub through the outbox whenever the
 * device reaches it. One visit records one capture: a retried save reuses its idempotency key.
 * On Android, a node's capture can also raise a work request in the maintenance app, with the
 * note as its text.
 */
export function CaptureScreen() {
  const params = useRoute().params as { assignmentId: string; nodeId?: string; codes?: string[] };
  const navigation = useNavigation();
  const { live, client, transport } = useSession();
  const perform = useOsAction();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const files = useRef<File[]>([]);
  const key = useRef(crypto.randomUUID());
  const [photos, setPhotos] = useState<{ ref: BlobRef; uri: string }[]>([]);
  const [kind, setKind] = useState<CaptureKind>();
  const [condition, setCondition] = useState<Condition>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const brief = useQuery(live.liveQueryOptions(ops.assignmentGet, { id: params.assignmentId })).data
    ?.brief as SurveyBrief | undefined;
  const node = brief?.nodes.find((item) => item.id === params.nodeId);
  const kinds = brief?.kinds ?? [];
  const chosenKind = kind ?? (kinds.length === 1 ? kinds[0] : undefined);

  useEffect(
    () => () => {
      for (const file of files.current) if (file.exists) file.delete();
    },
    [],
  );

  const take = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const picture = await camera.current?.takePictureAsync({ quality: 0.7 });
      if (!picture) return;
      const file = new File(picture.uri);
      files.current.push(file);
      const ref = await transport.blobs!.put(await file.bytes(), 'image/jpeg');
      setPhotos((list) => [...list, { ref, uri: picture.uri }]);
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  const raise = () => {
    if (!node) return;
    setError(undefined);
    perform('node.work-request', workRequest(node, note)).then(
      (outcome) => setError(refusal('The work request was not sent', outcome)),
      setError,
    );
  };
  const save = () => {
    if (!chosenKind) return;
    setBusy(true);
    setError(undefined);
    client
      .command(
        ops.surveyReport,
        {
          assignmentId: params.assignmentId,
          ...(params.nodeId ? { subject: params.nodeId } : {}),
          body: {
            kind: chosenKind,
            photos: photos.map((photo) => photo.ref),
            codes: params.codes ?? [],
            ...(condition ? { condition } : {}),
            note: note.trim(),
            takenAt: Date.now(),
          },
        },
        { idempotencyKey: key.current },
      )
      .then(() => navigation.goBack(), setError)
      .finally(() => setBusy(false));
  };

  if (!permission) return <Screen>{null}</Screen>;
  if (!permission.granted)
    return (
      <Screen>
        <Text className="text-operator text-foreground">
          The camera is needed to photograph the equipment.
        </Text>
        <ActionButton label="Allow the camera" onPress={() => void requestPermission()} />
      </Screen>
    );
  return (
    <ScrollView contentContainerClassName="gap-4 p-4" className="flex-1 bg-background">
      <Text className="text-operator font-semibold text-foreground">
        {node ? `${node.designation} · ${node.name}` : 'Unlinked: the hub links it later'}
      </Text>
      <CameraView ref={camera} style={{ height: 320, borderRadius: 12 }} facing="back" />
      <ActionButton
        label={`Take photo (${photos.length}/${maxPhotos})`}
        disabled={busy || photos.length >= maxPhotos}
        onPress={() => void take()}
      />
      {photos.length ? (
        <ScrollView horizontal contentContainerClassName="gap-2">
          {photos.map((photo) => (
            <Image
              key={photo.ref.digest}
              source={{ uri: photo.uri }}
              accessibilityLabel="Photo taken"
              style={{ width: 96, height: 96, borderRadius: 8 }}
            />
          ))}
        </ScrollView>
      ) : null}
      <Chips label="Kind" options={kinds} value={chosenKind} onChange={setKind} />
      <Chips label="Condition" options={conditions} value={condition} onChange={setCondition} />
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Note"
        accessibilityLabel="Note"
        multiline
        maxLength={1000}
        className="min-h-target rounded-xl border border-border px-4 py-3 text-operator text-foreground"
      />
      {node && Platform.OS === 'android' ? (
        <ActionButton label="Raise work request" disabled={busy} onPress={raise} />
      ) : null}
      <ErrorText error={error} />
      <HoldButton
        label="Save capture"
        holdingLabel="Keep holding to save"
        disabled={busy || !photos.length || !chosenKind}
        onConfirm={save}
      />
    </ScrollView>
  );
}
