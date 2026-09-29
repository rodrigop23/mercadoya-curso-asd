export type StockAdjustmentResult =
  | { adjusted: true; availableStock: number }
  | { adjusted: false; reason: 'product_not_found' | 'insufficient_stock' | 'stock_limit' };

export interface CatalogStockContract {
  getAvailableStock(productId: string): Promise<number | null>;
  adjustStock(productId: string, delta: number): Promise<StockAdjustmentResult>;
}
