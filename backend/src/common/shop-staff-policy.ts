/** Every active therapist serves every reservable service at their own shop.
 * Legacy TherapistService rows are retained for compatibility, never admission. */
export const SHOP_SERVICE_ACCESS_MODE = 'SHOP_ALL' as const;
