import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Text } from '@/components/ui/Text';
import * as React from 'react';
import { TextInput, View } from 'react-native';

interface PriceEditorDialogProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (newPrice: number) => void;
  currentPrice: number;
  originalPrice?: number | null;
  currencyCode?: string;
  itemTitle: string;
}

export const PriceEditorDialog: React.FC<PriceEditorDialogProps> = ({
  visible,
  onClose,
  onSubmit,
  currentPrice,
  originalPrice,
  currencyCode = 'USD',
  itemTitle,
}) => {
  const [priceInput, setPriceInput] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (visible) {
      // Format price for display
      const priceFormatted = currentPrice.toFixed(2);
      setPriceInput(priceFormatted);
      setError(null);
    }
  }, [visible, currentPrice]);

  const handleSubmit = () => {
    const parsedPrice = parseFloat(priceInput);

    if (isNaN(parsedPrice) || parsedPrice < 0) {
      setError('Please enter a valid price');
      return;
    }

    // Submit the price as-is
    onSubmit(parsedPrice);
    onClose();
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('en-US', {
      style: 'currency',
      currency: currencyCode,
      currencyDisplay: 'narrowSymbol',
    });
  };

  return (
    <Dialog visible={visible} onClose={onClose} title="Edit Price">
      <View className="gap-4">
        <View className="gap-2">
          <Text className="text-sm text-gray-500">{itemTitle}</Text>
          {originalPrice != null && originalPrice !== currentPrice && (
            <Text className="text-sm text-gray-400">Original Price: {formatCurrency(originalPrice)}</Text>
          )}
          {originalPrice == null && (
            <Text className="text-sm text-gray-400">Current Price: {formatCurrency(currentPrice)}</Text>
          )}
        </View>

        <View className="gap-1">
          <Text className="text-sm font-medium">New Price</Text>
          <TextInput
            className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-base"
            value={priceInput}
            onChangeText={(text) => {
              setPriceInput(text);
              setError(null);
            }}
            keyboardType="decimal-pad"
            placeholder="0.00"
            autoFocus
            selectTextOnFocus
          />
          {error && <Text className="text-sm text-error-500">{error}</Text>}
        </View>

        <View className="flex-row gap-2">
          <Button variant="outline" className="flex-1" onPress={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" onPress={handleSubmit}>
            Update Price
          </Button>
        </View>
      </View>
    </Dialog>
  );
};
