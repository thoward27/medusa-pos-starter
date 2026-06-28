import { CircleAlert } from '@/components/icons/circle-alert';
import { Eye } from '@/components/icons/eye';
import { EyeOff } from '@/components/icons/eye-off';
import { InfoBanner } from '@/components/InfoBanner';
import { clx } from '@/utils/clx';
import React, { useEffect, useState } from 'react';
import { useController, useFormContext } from 'react-hook-form';
import { TextInput, TextInputProps, TouchableOpacity, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

interface TextFieldProps extends Omit<TextInputProps, 'value' | 'onChangeText'> {
  name: string;
  placeholder?: string;
  floatingPlaceholder?: boolean;
  className?: string;
  inputClassName?: string;
  errorClassName?: string;
  errorVariation?: 'default' | 'inline';
  // Optional transform applied to input on change and to the displayed value,
  // e.g. live phone-number masking. Should be idempotent.
  formatValue?: (text: string) => string;
}

export function TextField({
  name,
  placeholder,
  floatingPlaceholder = false,
  className = '',
  inputClassName = '',
  errorClassName = '',
  errorVariation = 'default',
  secureTextEntry,
  formatValue,
  ...textInputProps
}: TextFieldProps) {
  const { control } = useFormContext();
  const {
    field: { onChange, onBlur, value },
    fieldState: { error },
  } = useController({
    name,
    control,
  });

  const [isFocused, setIsFocused] = useState(false);
  const [showValue, setShowValue] = useState(false);

  const showFloating = isFocused || !!value;
  const floatingPlaceholderTranslateY = useSharedValue(0);
  const floatingPlaceholderScale = useSharedValue(1);

  const floatingPlaceholderStyle = useAnimatedStyle(() => {
    return {
      transformOrigin: 'top left',
      transform: [
        {
          translateY: floatingPlaceholderTranslateY.value,
        },
        {
          scale: floatingPlaceholderScale.value,
        },
      ],
    };
  });

  useEffect(() => {
    if (showFloating) {
      floatingPlaceholderTranslateY.value = withTiming(-7, { duration: 150 });
      floatingPlaceholderScale.value = withTiming(0.6825, { duration: 150 });
    } else {
      floatingPlaceholderTranslateY.value = withTiming(0, { duration: 150 });
      floatingPlaceholderScale.value = withTiming(1, { duration: 150 });
    }
  }, [floatingPlaceholderScale, floatingPlaceholderTranslateY, showFloating]);

  return (
    <View className={className}>
      <View className="relative justify-center">
        {floatingPlaceholder && (
          <Animated.Text
            className={clx('absolute left-3 z-10 text-base', error ? 'text-error-500' : 'text-gray-300')}
            style={floatingPlaceholderStyle}
            pointerEvents="none"
          >
            {placeholder}
          </Animated.Text>
        )}
        <TextInput
          className={clx(
            'rounded-xl border border-gray-200 bg-white px-3 py-4 focus:border-active-500',
            {
              '!border-error-500': error,
              'pb-2 pt-6': floatingPlaceholder,
              'pr-9': error && errorVariation === 'inline',
            },
            inputClassName,
          )}
          placeholder={floatingPlaceholder ? undefined : placeholder}
          placeholderTextColor="#b5b5b5"
          value={formatValue ? formatValue(value || '') : value || ''}
          secureTextEntry={secureTextEntry && !showValue}
          onChangeText={(text) => onChange(formatValue ? formatValue(text) : text)}
          onBlur={() => {
            setIsFocused(false);
            onBlur();
          }}
          onFocus={() => setIsFocused(true)}
          {...textInputProps}
        />
        {secureTextEntry && (
          <TouchableOpacity className="absolute right-2 p-1" onPress={() => setShowValue(!showValue)}>
            {showValue ? (
              <Eye size={16} className={error ? 'text-error-500' : 'text-gray-300'} />
            ) : (
              <EyeOff size={16} className={error ? 'text-error-500' : 'text-gray-300'} />
            )}
          </TouchableOpacity>
        )}
        {error && errorVariation === 'inline' && (
          <View className="absolute right-3">
            <CircleAlert size={16} color="#ef4444" />
          </View>
        )}
      </View>
      {error && errorVariation === 'default' && (
        <InfoBanner
          colorScheme="error"
          variant="ghost"
          className={clx('mt-2 gap-1', errorClassName)}
          textClassName="text-2xs"
        >
          {error.message}
        </InfoBanner>
      )}
    </View>
  );
}
