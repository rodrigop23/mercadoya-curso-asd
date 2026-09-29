export const eventSubjects = {
  ordersPlaced: 'orders.placed',
  inventoryReserved: 'inventory.reserved',
  inventoryRejected: 'inventory.rejected',
} as const;

export type EventSubject = (typeof eventSubjects)[keyof typeof eventSubjects];
