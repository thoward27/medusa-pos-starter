import { clx } from '@/utils/clx';
import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({ checked, onCheckedChange, label, disabled, className }) => {
  return (
    <Pressable
      className={clx('flex-row items-center gap-3', disabled && 'opacity-50', className)}
      onPress={() => !disabled && onCheckedChange(!checked)}
      disabled={disabled}
    >
      <View
        className={clx(
          'h-6 w-6 items-center justify-center rounded border-2',
          checked ? 'border-blue-600 bg-blue-600' : 'border-gray-300 bg-white',
        )}
      >
        {checked && <Text className="text-base font-bold text-white">✓</Text>}
      </View>
      {label && <Text className={clx('flex-1 text-base', disabled && 'text-gray-400')}>{label}</Text>}
    </Pressable>
  );
};
