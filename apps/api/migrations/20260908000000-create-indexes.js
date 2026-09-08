module.exports = {
  async up(db) {
    await db.collection('movements').createIndex({ idempotencyKey: 1 }, { unique: true });
    await db.collection('movements').createIndex({ assetId: 1, occurredAt: 1 });
    await db.collection('reservations').createIndex({ idempotencyKey: 1 }, { unique: true });
  },

  async down(db) {
    await db.collection('movements').dropIndex({ idempotencyKey: 1 });
    await db.collection('movements').dropIndex({ assetId: 1, occurredAt: 1 });
    await db.collection('reservations').dropIndex({ idempotencyKey: 1 });
  },
};
