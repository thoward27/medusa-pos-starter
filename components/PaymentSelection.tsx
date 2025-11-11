import { Bluetooth } from '@/components/icons/bluetooth';
import { Smartphone } from '@/components/icons/smartphone';
import { Wallet } from '@/components/icons/wallet';
import { Text } from '@/components/ui/Text';
import { clx } from '@/utils/clx';
import React from 'react';
import { TouchableOpacity, View } from 'react-native';

export type PaymentMethod = 'cash' | 'tap_to_pay' | 'bluetooth_reader';

interface PaymentSelectionProps {
  value: PaymentMethod;
  onChange: (value: PaymentMethod) => void;
  className?: string;
}

export const PaymentSelection: React.FC<PaymentSelectionProps> = ({ value, onChange, className }) => {
  const paymentOptions: { value: PaymentMethod; label: string; description: string; icon: React.ReactNode }[] = [
    {
      value: 'cash',
      label: 'Cash',
      description: 'Physical currency',
      icon: <Wallet size={24} className="text-gray-400" />,
    },
    {
      value: 'tap_to_pay',
      label: 'Tap to Pay',
      description: 'Tap card to phone',
      icon: <Smartphone size={24} className="text-gray-400" />,
    },
    {
      value: 'bluetooth_reader',
      label: 'Bluetooth Reader',
      description: 'Card reader via Bluetooth',
      icon: <Bluetooth size={24} className="text-gray-400" />,
    },
  ];

  return (
    <View className={clx('gap-3', className)}>
      {paymentOptions.map((option) => {
        const isSelected = value === option.value;
        return (
          <TouchableOpacity
            key={option.value}
            onPress={() => onChange(option.value)}
            className={clx(
              'flex-row items-center gap-4 rounded-xl border-2 bg-white p-4',
              isSelected ? 'border-black' : 'border-gray-200',
            )}
          >
            <View
              className={clx(
                'h-6 w-6 items-center justify-center rounded-full border-2',
                isSelected ? 'border-black' : 'border-gray-300',
              )}
            >
              {isSelected && <View className="h-3 w-3 rounded-full bg-black" />}
            </View>
            <View className="flex-1 flex-row items-center gap-3">
              {option.icon}
              <View className="flex-1">
                <Text className="text-lg">{option.label}</Text>
                <Text className="text-sm text-gray-400">{option.description}</Text>
              </View>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};
