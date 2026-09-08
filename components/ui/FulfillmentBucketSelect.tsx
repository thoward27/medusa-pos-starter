import { ChevronDown } from '@/components/icons/chevron-down';
import { Text } from '@/components/ui/Text';
import { clx } from '@/utils/clx';
import { BUCKET_META, FulfillmentBucket } from '@/utils/fulfillment';
import * as React from 'react';
import { Modal, Pressable, View } from 'react-native';

interface FulfillmentBucketSelectProps {
  value: FulfillmentBucket;
  eligible: FulfillmentBucket[];
  onChange: (bucket: FulfillmentBucket) => void;
  disabled?: boolean;
}

// A compact dropdown for choosing a line item's fulfillment bucket. Trigger shows
// the current bucket; tapping opens a small menu of the eligible buckets.
export function FulfillmentBucketSelect({ value, eligible, onChange, disabled }: FulfillmentBucketSelectProps) {
  const [open, setOpen] = React.useState(false);
  const meta = BUCKET_META[value];
  // A single eligible bucket can't be changed — render it as a static chip.
  const interactive = !disabled && eligible.length > 1;

  return (
    <>
      <Pressable
        disabled={!interactive}
        onPress={() => setOpen(true)}
        className={clx('flex-row items-center gap-2 self-start rounded-lg border px-3 py-1.5', meta.chipClass, {
          'opacity-50': disabled,
        })}
      >
        <View className={clx('h-2.5 w-2.5 rounded-full', meta.dotClass)} />
        <Text className={clx('text-sm font-medium', meta.labelClass)}>{meta.label}</Text>
        {interactive && <ChevronDown size={14} className="text-gray-400" />}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 items-center justify-center bg-black/30 px-10" onPress={() => setOpen(false)}>
          <View className="w-full max-w-xs gap-1 rounded-2xl bg-white p-2">
            {eligible.map((bucket) => {
              const optionMeta = BUCKET_META[bucket];
              const selected = bucket === value;
              return (
                <Pressable
                  key={bucket}
                  onPress={() => {
                    onChange(bucket);
                    setOpen(false);
                  }}
                  className={clx('flex-row items-center gap-3 rounded-xl px-3 py-3', { 'bg-gray-100': selected })}
                >
                  <View className={clx('h-3 w-3 rounded-full', optionMeta.dotClass)} />
                  <View className="flex-1">
                    <Text className="font-medium">{optionMeta.label}</Text>
                    <Text className="text-xs text-gray-400">{optionMeta.description}</Text>
                  </View>
                  {selected && <Text className="text-gray-400">✓</Text>}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
